// Engine glue. Pure packages decide. This file persists the results.

import { BENCH_POLICY, fightPolicies } from "@agent-wars/battle-core";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { validatePolicy } from "@agent-wars/behavior-dna";
import { earnAc, createWallet } from "@agent-wars/economy";
import { applyRanked, createLedger, ratingFor } from "@agent-wars/ranking";
import { rankFor } from "@agent-wars/ranking";
import { buildStandings } from "@agent-wars/leaderboard";
import { hasKey, portraitFromEnv, portraitPromptFor, providerFromEnv } from "@agent-wars/ai-provider";
import { draft, refresh, spendManualMatch, REGEN_MS, STAMINA_MAX } from "@agent-wars/autobattle";
import type { Status } from "@agent-wars/autobattle";
import { pickBot } from "@agent-wars/battle-core";
import { MAX_PAIR_MEETINGS, pairMeetings } from "@agent-wars/matchmaker";
import type { History } from "@agent-wars/matchmaker";
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

// Ranked pre-checks. The route spends energy only after this passes.
export function validateRanked(
  store: Store,
  input: { aVersionId: string; bVersionId: string },
): void {
  const a = getVersion(store, input.aVersionId);
  const b = getVersion(store, input.bVersionId);
  if (!a || !b) throw new Error("unknown version");
  const aAgent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(a.agentId) as Record<string, unknown>;
  const bAgent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(b.agentId) as Record<string, unknown>;
  if (!aAgent || !bAgent) throw new Error("unknown agent");
  if (aAgent.leader_id === bAgent.leader_id) throw new Error("self match denied");
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
  const paidA = creditAc(store, aAgent.leader_id as string, input.key, "a", winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest");
  const paidB = creditAc(store, bAgent.leader_id as string, input.key, "b", winner === "B" ? "win" : winner === "A" ? "loss" : "no-contest");
  store.db.prepare(
    "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, delta_a, delta_b, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
  ).run(input.key, input.seed, input.aVersionId, input.bVersionId, winner, out.ticks, out.checksum, applied.deltaA, applied.deltaB, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB }));
  return { matchId: input.key, winner, ticks: out.ticks, checksum: out.checksum, deltaA: applied.deltaA, deltaB: applied.deltaB, paidA, paidB };
}

// One AC credit. Idempotent per match key and side; the daily cap lives in the ledger.
export function creditAc(
  store: Store,
  leaderId: string,
  matchKey: string,
  side: string,
  kind: "win" | "loss" | "no-contest",
): number {
  const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown>;
  const wallet = createWallet(leaderId, 0);
  wallet.ac = row.ac as number;
  wallet.rp = row.rp as number;
  for (const k of store.db.prepare("SELECT key FROM wallet_keys WHERE wallet_id = ?").all(leaderId) as { key: string }[]) {
    wallet.keys.add(k.key);
  }
  const before = wallet.txns.length;
  const res = earnAc(wallet, { key: `${matchKey}-${side}`, kind, suspicious: false, now: Date.now() });
  store.db.prepare("INSERT OR IGNORE INTO wallet_keys (wallet_id, key) VALUES (?, ?)").run(leaderId, `${matchKey}-${side}`);
  for (const t of wallet.txns.slice(before)) {
    store.db.prepare("INSERT INTO wallet_txns (wallet_id, idem_key, currency, delta, reason, at) VALUES (?, ?, ?, ?, ?, ?)").run(
      leaderId, t.idempotencyKey, t.currency, t.delta, t.reason, t.at,
    );
  }
  store.db.prepare("UPDATE leaders SET ac = ?, rp = ? WHERE id = ?").run(wallet.ac, wallet.rp, leaderId);
  return res.credited;
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

// Energy reads the persisted machine, refreshes regen, and saves it back.
// The machine is the single source: stamina, caps, and next recharge.
export function energyFor(store: Store, leaderId: string, now = Date.now()): Status {
  const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown> | null;
  if (!row) throw new Error("unknown leader");
  const agent = store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(leaderId) as Record<string, unknown> | null;
  let st: Status = row.autobattle_json ? (JSON.parse(row.autobattle_json as string) as Status) : draft(leaderId, now);
  st = { ...st, leaderId, published: !!agent?.active_version_id };
  st = refresh(st, now);
  store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(st), leaderId);
  return st;
}

export function energyView(st: Status, now = Date.now()): { energy: number; energyMax: number; nextRegenMs: number } {
  const nextRegenMs = st.stamina >= st.staminaMax ? 0 : Math.max(0, st.lastStaminaAt + REGEN_MS - now);
  return { energy: st.stamina, energyMax: st.staminaMax ?? STAMINA_MAX, nextRegenMs };
}

// A manual match spends one charge. Training never calls this function.
export function spendEnergy(store: Store, leaderId: string, now = Date.now()): { ok: boolean; reason?: string; status: Status } {
  const cur = energyFor(store, leaderId, now);
  const r = spendManualMatch(cur, now);
  store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(r.status), leaderId);
  return r.guard.ok ? { ok: true, status: r.status } : { ok: false, reason: (r.guard as { reason: string }).reason, status: r.status };
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
    energy: energyView(energyFor(store, leaderId)),
    versions,
  };
}

export const BOT_SETTLE_MS = 30_000;
export const RANKED_TICKET_MS = 10 * 60_000;

export type TicketMode = "casual" | "ranked";

// Nearest ELO human with a published version. Never self, never over the pair cap.
export function findHumanOpponent(
  store: Store,
  leaderId: string,
  now: number,
): { leaderId: string; versionId: string; ap: number } | null {
  const me = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown> | null;
  if (!me) return null;
  const rows = store.db.prepare(
    `SELECT m.created_at AS at, aa.leader_id AS a, ab.leader_id AS b FROM matches m
     JOIN versions va ON va.id = m.a_version JOIN agents aa ON aa.id = va.agent_id
     JOIN versions vb ON vb.id = m.b_version JOIN agents ab ON ab.id = vb.agent_id
     WHERE m.rated = 1`
  ).all() as Record<string, unknown>[];
  const history: History = { marks: rows.map((m) => ({ a: m.a as string, b: m.b as string, at: m.at as number })) };
  const agents = store.db.prepare("SELECT * FROM agents WHERE active_version_id IS NOT NULL").all() as Record<string, unknown>[];
  let best: { leaderId: string; versionId: string; ap: number } | null = null;
  let bestGap = Infinity;
  for (const a of agents) {
    const other = a.leader_id as string;
    if (other === leaderId) continue;
    const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(other) as Record<string, unknown> | null;
    if (!row) continue;
    if (pairMeetings(history, leaderId, other, now) >= MAX_PAIR_MEETINGS) continue;
    const gap = Math.abs((row.ap as number) - (me.ap as number));
    if (gap < bestGap) {
      bestGap = gap;
      best = { leaderId: other, versionId: a.active_version_id as string, ap: row.ap as number };
    }
  }
  return best;
}

// Casual unrated fight: no AP moves, AC still pays the human side.
export function runCasual(
  store: Store,
  input: { aVersionId: string; bVersionId?: string; bBot?: string; seed: string; leaderId: string },
): { matchId: string; winner: string; ticks: number; checksum: string; foe: string; bot: boolean; paid: number } {
  const found = getVersion(store, input.aVersionId);
  if (!found) throw new Error("unknown version");
  const bot = input.bBot ? pickBotFor(store, input.leaderId) : null;
  const foeLabel = input.bVersionId ?? (bot ? bot.id : "");
  if (!input.bVersionId && !bot) throw new Error("no opponent");
  const foePolicy = input.bVersionId
    ? (getVersion(store, input.bVersionId)?.policy ?? null)
    : (bot?.policy ?? null);
  if (!foePolicy) throw new Error("unknown foe version");
  const out = fightPolicies(found.policy, foePolicy, input.seed);
  const id = mintId("m");
  store.db.prepare(
    "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
  ).run(id, input.seed, input.aVersionId, foeLabel, out.winner, out.ticks, out.checksum, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB }));
  const winner = out.winner === "DRAW" ? "DRAW" : out.winner;
  const paid = creditAc(store, input.leaderId, id, "a", winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest");
  return { matchId: id, winner, ticks: out.ticks, checksum: out.checksum, foe: foeLabel, bot: !!bot, paid };
}

function pickBotFor(store: Store, leaderId: string): { id: string; policy: import("@agent-wars/behavior-dna").AgentPolicy } {
  const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown> | null;
  const bot = pickBot((row?.ap as number) ?? 500);
  return { id: bot.id, policy: bot.policy };
}

function settleTicket(store: Store, ticket: Record<string, unknown>, foeVersion: string | null, now: number): Record<string, unknown> {
  const mode = ticket.mode as TicketMode;
  let matchId: string;
  let foeLabel = foeVersion ?? "";
  if (mode === "ranked" && foeVersion) {
    const settled = runRanked(store, {
      aVersionId: ticket.version_id as string,
      bVersionId: foeVersion,
      seed: `q-${ticket.id}`,
      key: ticket.id as string,
    });
    matchId = settled.matchId as string;
  } else {
    const bot = foeVersion ? null : true;
    const settled = runCasual(store, {
      aVersionId: ticket.version_id as string,
      bVersionId: foeVersion ?? undefined,
      bBot: bot ? "1" : undefined,
      seed: `q-${ticket.id}`,
      leaderId: ticket.leader_id as string,
    });
    matchId = settled.matchId;
    foeLabel = settled.foe;
  }
  store.db.prepare("UPDATE tickets SET status = 'settled', foe_version = ?, match_id = ? WHERE id = ?").run(
    foeLabel, matchId, ticket.id,
  );
  return { ...(store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id) as Record<string, unknown>) };
}

// The queue spends one energy at request time. Humans settle at once;
// casual falls back to a same-band bot after 30 seconds, ranked waits.
export function requestMatch(
  store: Store,
  input: { leaderId: string; versionId: string; mode: TicketMode },
  now = Date.now(),
): Record<string, unknown> {
  if (input.mode !== "casual" && input.mode !== "ranked") throw new Error("unknown mode");
  const owned = store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(input.leaderId) as Record<string, unknown> | null;
  const version = getVersion(store, input.versionId);
  if (!version || !owned || version.agentId !== owned.id) throw new Error("unknown version");
  if ((owned.active_version_id as string) !== input.versionId) throw new Error("queue your active version");
  const spent = spendEnergy(store, input.leaderId, now);
  if (!spent.ok) throw new Error((spent as { reason: string }).reason);
  const id = mintId("t");
  const wait = input.mode === "casual" ? BOT_SETTLE_MS : RANKED_TICKET_MS;
  store.db.prepare("INSERT INTO tickets (id, leader_id, version_id, mode, status, created_at, settle_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)").run(
    id, input.leaderId, input.versionId, input.mode, now, now + wait,
  );
  const foe = findHumanOpponent(store, input.leaderId, now);
  if (foe) {
    const row = store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as Record<string, unknown>;
    return settleTicket(store, row, foe.versionId, now);
  }
  return store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as Record<string, unknown>;
}

// Lazy settle on read. No cron: the next poll after the deadline settles.
export function readTicket(
  store: Store,
  input: { ticketId: string; leaderId: string },
  now = Date.now(),
): Record<string, unknown> & { match?: Record<string, unknown> } {
  const ticket = store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(input.ticketId) as Record<string, unknown> | null;
  if (!ticket || ticket.leader_id !== input.leaderId) throw new Error("unknown ticket");
  if (ticket.status !== "queued") {
    const out = { ...ticket } as Record<string, unknown> & { match?: Record<string, unknown> };
    if (ticket.match_id) {
      out.match = (store.db.prepare("SELECT * FROM matches WHERE id = ?").get(ticket.match_id as string) as Record<string, unknown>) ?? undefined;
    }
    return out;
  }
  if (now < (ticket.settle_at as number)) {
    if (ticket.mode === "ranked") {
      const foe = findHumanOpponent(store, input.leaderId, now);
      if (foe) {
        const settled = settleTicket(store, ticket, foe.versionId, now);
        return withMatch(store, settled);
      }
    }
    return { ...ticket };
  }
  if (ticket.mode === "casual") {
    const settled = settleTicket(store, ticket, null, now);
    return withMatch(store, settled);
  }
  store.db.prepare("UPDATE tickets SET status = 'expired' WHERE id = ?").run(input.ticketId);
  return { ...(store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(input.ticketId) as Record<string, unknown>) };
}

export function withMatch(store: Store, ticket: Record<string, unknown>): Record<string, unknown> & { match?: Record<string, unknown> } {
  const out = { ...ticket } as Record<string, unknown> & { match?: Record<string, unknown> };
  if (ticket.match_id) {
    out.match = (store.db.prepare("SELECT * FROM matches WHERE id = ?").get(ticket.match_id as string) as Record<string, unknown>) ?? undefined;
  }
  return out;
}
