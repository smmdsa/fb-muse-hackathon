// Engine glue. Pure packages decide. This file persists the results.

import { BENCH_POLICY, fightPolicies } from "@agent-wars/battle-core";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { validatePolicy } from "@agent-wars/behavior-dna";
import { earnAc, createWallet } from "@agent-wars/economy";
import { applyRanked, createLedger, ratingFor } from "@agent-wars/ranking";
import { rankFor } from "@agent-wars/ranking";
import { buildStandings } from "@agent-wars/leaderboard";
import { compileMock } from "@agent-wars/ai-provider";
import type { Store } from "./store.ts";
import { mintId } from "./store.ts";

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
    "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
  ).run(id, input.seed, input.versionId, "benchmark-v1", out.winner, out.ticks, out.checksum, Date.now());
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
    "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, delta_a, delta_b, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
  ).run(input.key, input.seed, input.aVersionId, input.bVersionId, winner, out.ticks, out.checksum, applied.deltaA, applied.deltaB, Date.now());
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

// Compile plus validate plus publish in one honest step for the milestone.
export async function compileAndPublish(
  store: Store,
  input: { agentId: string; prompt: string },
): Promise<{ versionId: string; errors: string[] }> {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent) throw new Error("unknown agent");
  const versionId = mintId("v");
  const compiled = await compileMock({ prompt: input.prompt, agentVersionId: versionId });
  if (!compiled.policy) return { versionId: "", errors: compiled.errors };
  const check = validatePolicy(compiled.policy);
  if (!check.ok) return { versionId: "", errors: check.errors };
  const crypto = await import("node:crypto");
  const sha = crypto.createHash("sha256").update(JSON.stringify(compiled.policy)).digest("hex");
  store.db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
    versionId, input.agentId, JSON.stringify(compiled.policy), sha, Date.now(),
  );
  store.db.prepare("UPDATE agents SET active_version_id = ? WHERE id = ?").run(versionId, input.agentId);
  return { versionId, errors: [] };
}
