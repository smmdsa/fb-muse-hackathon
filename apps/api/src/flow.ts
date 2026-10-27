// Engine glue. Pure packages decide. This file persists the results.

import { BENCH_POLICY, fightPolicies } from "@agent-wars/battle-core";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { validatePolicy } from "@agent-wars/behavior-dna";
import { earnAc, createWallet } from "@agent-wars/economy";
import { applyRanked, createLedger, ratingFor } from "@agent-wars/ranking";
import { rankFor } from "@agent-wars/ranking";
import { buildStandings } from "@agent-wars/leaderboard";
import { hasKey, portraitFromEnv, portraitPromptFor, providerFromEnv } from "@agent-wars/ai-provider";
import type { Store } from "./store.ts";
import { mintId } from "./store.ts";

export type FlowEnv = {
  META_SPARK_KEY?: string;
  META_IMAGE_KEY?: string;
  META_API_KEY?: string;
  META_API_BASE?: string;
  AGENT_WARS_MODEL_COMPILE?: string;
  AGENT_WARS_MODEL_PORTRAIT?: string;
};

export function getLeader(store: Store, token: string): Record<string, unknown> | null {
  return store.db.prepare("SELECT * FROM leaders WHERE token = ?").get(token) as Record<string, unknown> | null;
}

export function getVersion(store: Store, versionId: string): { policy: AgentPolicy; agentId: string } | null {
  const row = store.db.prepare("SELECT * FROM versions WHERE id = ?").get(versionId) as Record<string, unknown> | null;
  if (!row) return null;
  return { policy: JSON.parse(row.policy_json as string) as AgentPolicy, agentId: row.agent_id as string };
}

// Training settles nothing. It returns the receipt only.
export function runTraining(
  store: Store,
  input: { versionId: string; seed: string },
): { matchId: string; winner: string; ticks: number; checksum: string } {
  const found = getVersion(store, input.versionId);
  if (!found) throw new Error("unknown version");
  const out = fightPolicies(found.policy, BENCH_POLICY, input.seed);
  const id = mintId("m");
  store.db.prepare(
    "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
  ).run(id, input.seed, input.versionId, "benchmark-v1", out.winner, out.ticks, out.checksum, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB }));
  return { matchId: id, ...out };
}

// Ranked settles AP and AC for both leaders. One key counts once.
export function runRanked(
  store: Store,
  input: { aVersionId: string; bVersionId: string; seed: string; key: string },
): Record<string, unknown> {
  const dup = store.db.prepare("SELECT * FROM matches WHERE id = ?").get(input.key) as Record<string, unknown> | null;
  if (dup) return { ...dup, deduped: true };
  const a = getVersion(store, input.aVersionId);
  const b = getVersion(store, input.bVersionId);
  if (!a || !b) throw new Error("unknown version");
  const aAgent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(a.agentId) as Record<string, unknown>;
  const bAgent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(b.agentId) as Record<string, unknown>;
  if (aAgent.leader_id === bAgent.leader_id) throw new Error("self match denied");
  const out = fightPolicies(a.policy, b.policy, input.seed);
  const winner = out.winner === "DRAW" ? "DRAW" : out.winner;
  const ledger = createLedger("local-s1");
  for (const row of store.db.prepare("SELECT * FROM leaders").all() as Record<string, unknown>[]) {
    const r = ratingFor(ledger, row.id as string);
    r.ratingMilli = row.rating_milli as number;
    r.placementGames = row.placement as number;
    r.placed = (row.placed as number) === 1;
  }
  const applied = applyRanked(ledger, {
    matchId: input.key,
    leaderA: aAgent.leader_id as string,
    leaderB: bAgent.leader_id as string,
    winner: winner as "A" | "B" | "DRAW",
    rated: true,
  });
  for (const [id, st] of ledger.ratings) {
    store.db.prepare("UPDATE leaders SET rating_milli = ?, ap = ?, placement = ?, placed = ? WHERE id = ?").run(
      st.ratingMilli, st.ap, st.placementGames, st.placed ? 1 : 0, id,
    );
  }
  const pay = (leaderId: string, kind: "win" | "loss" | "no-contest", side: string) => {
    const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown>;
    const wallet = createWallet(leaderId, 0);
    wallet.ac = row.ac as number;
    wallet.rp = row.rp as number;
    for (const k of store.db.prepare("SELECT key FROM wallet_keys WHERE wallet_id = ?").all(leaderId) as { key: string }[]) {
      wallet.keys.add(k.key);
    }
    const before = wallet.txns.length;
    const res = earnAc(wallet, { key: `${input.key}-${side}`, kind, suspicious: false, now: Date.now() });
    store.db.prepare("INSERT OR IGNORE INTO wallet_keys (wallet_id, key) VALUES (?, ?)").run(leaderId, `${input.key}-${side}`);
    for (const t of wallet.txns.slice(before)) {
      store.db.prepare("INSERT INTO wallet_txns (wallet_id, idem_key, currency, delta, reason, at) VALUES (?, ?, ?, ?, ?, ?)").run(
        leaderId, t.idempotencyKey, t.currency, t.delta, t.reason, t.at,
      );
    }
    store.db.prepare("UPDATE leaders SET ac = ?, rp = ? WHERE id = ?").run(wallet.ac, wallet.rp, leaderId);
    return res.credited;
  };
  const paidA = pay(aAgent.leader_id as string, winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest", "a");
  const paidB = pay(bAgent.leader_id as string, winner === "B" ? "win" : winner === "A" ? "loss" : "no-contest", "b");
  store.db.prepare(
    "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, delta_a, delta_b, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
  ).run(input.key, input.seed, input.aVersionId, input.bVersionId, winner, out.ticks, out.checksum, applied.deltaA, applied.deltaB, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB }));
  return { matchId: input.key, winner, ticks: out.ticks, checksum: out.checksum, deltaA: applied.deltaA, deltaB: applied.deltaB, paidA, paidB };
}

// The board lists placed leaders for the local season.
export function board(store: Store, limit = 100): unknown[] {
  const rows = store.db.prepare("SELECT * FROM leaders").all() as Record<string, unknown>[];
  return buildStandings(
    "local-s1",
    rows.map((r) => ({
      leaderId: r.id as string,
      seasonId: "local-s1",
      ratingMilli: r.rating_milli as number,
      ap: r.ap as number,
      placementGames: r.placement as number,
      placed: (r.placed as number) === 1,
      rankTier: rankFor(r.ap as number).tier,
      division: rankFor(r.ap as number).division,
    })),
    limit,
  );
}

// Breeding creates the hero row. With an image key it also paints the portrait
// in the locked house style. Without one the hero fights faceless, honestly.
export async function createAgent(
  store: Store,
  env: FlowEnv,
  input: { leaderId: string; name: string; concept: string },
): Promise<{ agentId: string; portraitUrl: string | null }> {
  const id = mintId("agent");
  let portraitUrl: string | null = null;
  if (hasKey("portrait", env)) {
    try {
      const art = await portraitFromEnv(env).generatePortrait({
        prompt: portraitPromptFor(`${input.name || "arena robot"}: ${input.concept || "arena fighter"}`),
      });
      portraitUrl = art.url;
    } catch {
      portraitUrl = null;
    }
  }
  store.db.prepare("INSERT INTO agents (id, leader_id, active_version_id, name, concept, portrait_url) VALUES (?, ?, NULL, ?, ?, ?)").run(
    id, input.leaderId, input.name || null, input.concept || null, portraitUrl,
  );
  return { agentId: id, portraitUrl };
}

// Compile plus validate plus publish in one honest step for the milestone.
export async function compileAndPublish(
  store: Store,
  env: FlowEnv,
  input: { agentId: string; prompt: string },
): Promise<{ versionId: string; errors: string[]; provider: string; isMock: boolean }> {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent) throw new Error("unknown agent");
  const versionId = mintId("v");
  const compiled = await providerFromEnv(env).compileStrategy({ prompt: input.prompt, agentVersionId: versionId });
  if (!compiled.policy) return { versionId: "", errors: compiled.errors, provider: compiled.provider, isMock: compiled.isMock };
  const check = validatePolicy(compiled.policy);
  if (!check.ok) return { versionId: "", errors: check.errors, provider: compiled.provider, isMock: compiled.isMock };
  const crypto = await import("node:crypto");
  const sha = crypto.createHash("sha256").update(JSON.stringify(compiled.policy)).digest("hex");
  store.db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at, provider, is_mock) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    versionId, input.agentId, JSON.stringify(compiled.policy), sha, Date.now(), compiled.provider, compiled.isMock ? 1 : 0,
  );
  store.db.prepare("UPDATE agents SET active_version_id = ? WHERE id = ?").run(versionId, input.agentId);
  return { versionId, errors: [], provider: compiled.provider, isMock: compiled.isMock };
}

// The dashboard shows one hero: portrait, ELO, every version with its chips,
// and each chip with its trigger totals across all fights of that version.
export function dashboard(store: Store, agentId: string, leaderId: string): Record<string, unknown> {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as Record<string, unknown> | null;
  if (!agent || agent.leader_id !== leaderId) throw new Error("agent not found for this leader");
  const leader = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown>;
  const rank = rankFor(leader.ap as number);
  const versionRows = store.db.prepare("SELECT * FROM versions WHERE agent_id = ? ORDER BY created_at").all(agentId) as Record<string, unknown>[];
  const versions = versionRows.map((v) => {
    const fights = store.db.prepare("SELECT * FROM matches WHERE a_version = ? OR b_version = ?").all(v.id, v.id) as Record<string, unknown>[];
    const policy = JSON.parse(v.policy_json as string) as { rules: { id: string; move: string; fire?: boolean }[] };
    const triggers: Record<string, number> = {};
    let wins = 0;
    let ticks = 0;
    for (const f of fights) {
      const side = f.a_version === v.id ? "a" : "b";
      if ((side === "a" && f.winner === "A") || (side === "b" && f.winner === "B")) wins += 1;
      ticks += f.ticks as number;
      try {
        const chips = JSON.parse((f.chips_json as string) || "{}") as Record<string, Record<string, number>>;
        for (const [chip, n] of Object.entries(chips[side] ?? {})) {
          triggers[chip] = (triggers[chip] ?? 0) + (n as number);
        }
      } catch {
        continue;
      }
    }
    return {
      versionId: v.id,
      provider: v.provider ?? "mock",
      isMock: (v.is_mock ?? 1) === 1,
      createdAt: v.created_at,
      chips: policy.rules.map((r) => ({ id: r.id, move: r.move, fire: r.fire === true, triggers: triggers[r.id] ?? 0 })),
      fights: fights.length,
      wins,
      winRate: fights.length ? wins / fights.length : 0,
      avgTicks: fights.length ? Math.round(ticks / fights.length) : 0,
    };
  });
  return {
    agent: { id: agent.id, name: agent.name ?? null, concept: agent.concept ?? null, portraitUrl: agent.portrait_url ?? null, activeVersionId: agent.active_version_id ?? null },
    leader: { handle: leader.handle, ap: leader.ap, ac: leader.ac, tier: rank.tier, division: rank.division },
    versions,
  };
}
