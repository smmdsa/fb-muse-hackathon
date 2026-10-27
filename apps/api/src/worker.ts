// Cloudflare Worker entry. Full API on D1: auth, publish, fights, replay.

import { hasKey, portraitFromEnv, portraitPromptFor, providerFromEnv } from "@agent-wars/ai-provider";
import { activate, draft, finishMatch, pause, refresh, refundManualMatch, spendManualMatch, startOwnerMatch, MAX_ATTACK_PER_DAY, REGEN_MS, STAMINA_MAX } from "@agent-wars/autobattle";
import type { Status } from "@agent-wars/autobattle";
import { addEntry, createEvent, lock, register as registerEntry, reportGame, seedBracket } from "@agent-wars/tournaments";
import type { Championship } from "@agent-wars/tournaments";
import { CATALOG } from "@agent-wars/economy";
import { BENCH_POLICY, BOT_PRESETS, buildReplay, fightPolicies, pickBot } from "@agent-wars/battle-core";
import { MAX_PAIR_MEETINGS, pairMeetings } from "@agent-wars/matchmaker";
import type { History } from "@agent-wars/matchmaker";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { validatePolicy } from "@agent-wars/behavior-dna";
import { checkLimit } from "./ids.ts";

// Per-route sliding windows. Memory-only per isolate.
const authHits = new Map<string, number[]>();
const compileHits = new Map<string, number[]>();
const queueHits = new Map<string, number[]>();
const trainHits = new Map<string, number[]>();

function limited(log: Map<string, number[]>, key: string, windowMs: number, max: number): boolean {
  return !checkLimit(log, key, Date.now(), windowMs, max);
}
import { createWallet, earnAc } from "@agent-wars/economy";
import { buildStandings } from "@agent-wars/leaderboard";
import { applyRanked, createLedger, rankFor, ratingFor } from "@agent-wars/ranking";

export type WorkerEnv = {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  META_SPARK_KEY?: string;
  META_IMAGE_KEY?: string;
  META_API_BASE?: string;
  AGENT_WARS_MODEL_COMPILE?: string;
  AGENT_WARS_MODEL_PORTRAIT?: string;
};

type D1Database = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      first: <T>() => Promise<T | null>;
      all: <T>() => Promise<{ results: T[] }>;
      run: () => Promise<unknown>;
    };
  };
};

function json(body: unknown, code = 200): Response {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
    },
  });
}

let counter = 0;

// IDs keep a time prefix plus 64 crypto-random bits per isolate.
function mintId(prefix: string): string {
  const buf = new Uint8Array(8);
  globalThis.crypto.getRandomValues(buf);
  const tail = [...buf].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${Date.now().toString(36)}_${tail}`;
}
function newToken(kind: string): string {
  const buf = new Uint8Array(16);
  globalThis.crypto.getRandomValues(buf);
  const tail = [...buf].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${kind}_${tail}`;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function bearer(request: Request, env: WorkerEnv): Promise<Record<string, unknown> | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  return env.DB.prepare("SELECT * FROM leaders WHERE token = ?").bind(token).first<Record<string, unknown>>();
}

// The leaderboard reads placed leaders for one season, best first.
async function leaderboard(env: WorkerEnv, seasonId: string): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT * FROM leaders").bind().all<Record<string, unknown>>();
  const rows = buildStandings(
    seasonId,
    results.map((r) => ({
      leaderId: r.id as string,
      seasonId,
      ratingMilli: r.rating_milli as number,
      ap: r.ap as number,
      placementGames: r.placement as number,
      placed: (r.placed as number) === 1,
      rankTier: rankFor(r.ap as number).tier,
      division: rankFor(r.ap as number).division,
    })),
  );
  return json({ seasonId, rows });
}

// Replay re-simulates a stored match and compares checksums.
async function replay(env: WorkerEnv, id: string): Promise<Response> {
  const match = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!match) return json({ error: "match not found" }, 404);
  const a = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(match.a_version).first<Record<string, unknown>>();
  const b =
    match.b_version === "benchmark-v1"
      ? null
      : await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(match.b_version).first<Record<string, unknown>>();
  if (!a) return json({ error: "replay unavailable: a version is gone" }, 410);
  const pa = JSON.parse(a.policy_json as string) as AgentPolicy;
  let pb: AgentPolicy;
  if ((match.b_version as string).startsWith("bot:")) {
    const preset = BOT_PRESETS.find((p) => p.id === match.b_version);
    if (!preset) return json({ error: "replay unavailable: unknown bot" }, 410);
    pb = preset.policy;
  } else if (b) {
    pb = JSON.parse(b.policy_json as string) as AgentPolicy;
  } else if (match.b_version === "benchmark-v1") {
    pb = BENCH_POLICY;
  } else {
    return json({ error: "replay unavailable: a version is gone" }, 410);
  }
  const again = fightPolicies(pa, pb, match.seed as string);
  const replay = buildReplay(pa, pb, match.seed as string);
  return json({ stored: match, recomputed: { winner: again.winner, ticks: again.ticks, checksum: again.checksum }, replay, identical: again.checksum === match.checksum });
}

// One settlement writes as one batch. Reads stay ahead; every write below
// lands atomically, so a concurrent duplicate settles zero or one fights.
async function planPay(
  env: WorkerEnv,
  leaderId: string,
  matchKey: string,
  side: string,
  kind: "win" | "loss" | "no-contest",
): Promise<{ stmts: unknown[]; credited: number }> {
  const row = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(leaderId).first<Record<string, unknown>>();
  if (!row) return { stmts: [], credited: 0 };
  const wallet = createWallet(leaderId, 0);
  wallet.ac = row.ac as number;
  wallet.rp = row.rp as number;
  const keys = await env.DB.prepare("SELECT key FROM wallet_keys WHERE wallet_id = ?").bind(leaderId).all<{ key: string }>();
  for (const k of keys.results) wallet.keys.add(k.key);
  const key = `${matchKey}-${side}`;
  const before = wallet.txns.length;
  const res = earnAc(wallet, { key, kind, suspicious: false, now: Date.now() });
  const stmts: unknown[] = [
    env.DB.prepare("INSERT OR IGNORE INTO wallet_keys (wallet_id, key) VALUES (?, ?)").bind(leaderId, key),
  ];
  for (const t of wallet.txns.slice(before)) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO wallet_txns (wallet_id, idem_key, currency, delta, reason, at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(leaderId, t.idempotencyKey, t.currency, t.delta, t.reason, t.at),
    );
  }
  stmts.push(env.DB.prepare("UPDATE leaders SET ac = ?, rp = ? WHERE id = ?").bind(wallet.ac, wallet.rp, leaderId));
  return { stmts, credited: res.credited };
}

// Energy reads the persisted machine, refreshes regen, and saves it back.
async function energyFor(env: WorkerEnv, leaderId: string, now = Date.now()): Promise<Status> {
  const row = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(leaderId).first<Record<string, unknown>>();
  if (!row) throw new Error("unknown leader");
  const agent = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(leaderId).first<Record<string, unknown>>();
  let st: Status = row.autobattle_json ? (JSON.parse(row.autobattle_json as string) as Status) : draft(leaderId, now);
  st = { ...st, leaderId, published: !!agent?.active_version_id };
  st = refresh(st, now);
  await env.DB.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").bind(JSON.stringify(st), leaderId).run();
  return st;
}

function energyView(st: Status, now = Date.now()): { energy: number; energyMax: number; nextRegenMs: number } {
  const nextRegenMs = st.stamina >= st.staminaMax ? 0 : Math.max(0, st.lastStaminaAt + REGEN_MS - now);
  return { energy: st.stamina, energyMax: st.staminaMax ?? STAMINA_MAX, nextRegenMs };
}

async function spendEnergy(env: WorkerEnv, leaderId: string, now = Date.now()): Promise<{ ok: boolean; reason?: string }> {
  const cur = await energyFor(env, leaderId, now);
  const r = spendManualMatch(cur, now);
  await env.DB.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").bind(JSON.stringify(r.status), leaderId).run();
  return r.guard.ok ? { ok: true } : { ok: false, reason: (r.guard as { reason: string }).reason };
}

// A canceled or expired ticket returns its charge. Settled fights keep it.
async function refundEnergy(env: WorkerEnv, leaderId: string, now = Date.now()): Promise<void> {
  const cur = await energyFor(env, leaderId, now);
  const next = refundManualMatch(cur, now);
  await env.DB.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").bind(JSON.stringify(next), leaderId).run();
}

// Explicit opt-in only. Reads never renew the lease.
async function optInAutoD1(env: WorkerEnv, leaderId: string, now: number): Promise<{ leaseExpiresAt: number; state: string }> {
  const cur = await energyFor(env, leaderId, now);
  if (!cur.published) throw new Error("install a published version first");
  const next = activate({ ...cur, optIn: true }, now);
  await env.DB.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").bind(JSON.stringify(next), leaderId).run();
  return { leaseExpiresAt: next.leaseExpiresAt as number, state: next.state };
}

async function pauseAutoD1(env: WorkerEnv, leaderId: string, now: number): Promise<{ state: string }> {
  const cur = await energyFor(env, leaderId, now);
  const next = pause(cur);
  await env.DB.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").bind(JSON.stringify(next), leaderId).run();
  return { state: next.state };
}

// One background pass. Ranked vs a live published foe, bot sparring alone.
async function autoTickD1(
  env: WorkerEnv,
  leaderId: string,
  now: number,
  max = 10,
): Promise<{ ran: number; matches: Record<string, unknown>[]; stopped: string }> {
  const matches: Record<string, unknown>[] = [];
  let ran = 0;
  for (let i = 0; i < max; i += 1) {
    const cur = await energyFor(env, leaderId, now);
    const go = startOwnerMatch(cur, now);
    await env.DB.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").bind(JSON.stringify(go.status), leaderId).run();
    if (!go.guard.ok) break;
    const agent = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(leaderId).first<Record<string, unknown>>();
    const seed = `ab-${leaderId}-${go.status.attackAt.length}`;
    const foe = await findHumanOpponent(env, leaderId, now);
    if (foe) {
      const settled = await settleRankedD1(env, { aVersionId: agent?.active_version_id as string, bVersionId: foe.versionId, seed, key: `abm-${seed}` });
      matches.push(settled as Record<string, unknown>);
    } else {
      const casual = await runCasualD1(env, { aVersionId: agent?.active_version_id as string, leaderId, useBot: true, seed });
      const row = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(casual.matchId).first<Record<string, unknown>>();
      if (row) matches.push(row);
    }
    ran += 1;
    const done = finishMatch(go.status, now);
    await env.DB.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").bind(JSON.stringify(done), leaderId).run();
  }
  return { ran, matches, stopped: await autoStopD1(env, leaderId, now) };
}

// The stop reason in plain words. Reads never change the lease.
async function autoStopD1(env: WorkerEnv, leaderId: string, now: number): Promise<string> {
  const st = await energyFor(env, leaderId, now);
  if (st.state === "PAUSED_MANUAL" || (st.optIn === false && st.leaseExpiresAt !== null)) return "paused";
  if (!st.optIn) return "opted out";
  if (st.state === "IDLE_EXPIRED" || (st.leaseExpiresAt !== null && now >= st.leaseExpiresAt)) return "lease expired";
  if (st.stamina < 1) return "energy depleted";
  if (st.attackAt.length >= MAX_ATTACK_PER_DAY) return "daily cap reached";
  if (!st.published) return "no published version";
  return "ready";
}

// The return digest: lease, energy, reason, and recent auto fights.
async function autoDigestD1(env: WorkerEnv, leaderId: string, now: number): Promise<Record<string, unknown>> {
  const st = await energyFor(env, leaderId, now);
  const safe = leaderId.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { results: rows } = await env.DB.prepare(
    "SELECT * FROM matches WHERE seed LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 10",
  ).bind(`ab-${safe}-%`).all<Record<string, unknown>>();
  const { results: vrows } = await env.DB.prepare(
    "SELECT id FROM versions WHERE agent_id IN (SELECT id FROM agents WHERE leader_id = ?)",
  ).bind(leaderId).all<Record<string, unknown>>();
  const owned = new Set(vrows.map((v) => v.id as string));
  return {
    optIn: st.optIn,
    leaseExpiresAt: st.leaseExpiresAt,
    state: st.state,
    energy: energyView(st, now),
    stopReason: await autoStopD1(env, leaderId, now),
    recent: rows.map((m) => {
      const mine = owned.has(m.a_version as string) ? "a" : "b";
      return {
        matchId: m.id,
        winner: m.winner,
        ticks: m.ticks,
        rated: m.rated,
        myDelta: mine === "a" ? m.delta_a : m.delta_b,
        myPaid: mine === "a" ? m.paid_a : m.paid_b,
        at: m.created_at,
        replay: `/v1/matches/${m.id}/replay`,
      };
    }),
  };
}

// The dashboard serves one hero with chip stats per version.
async function agentDashboard(env: WorkerEnv, agentId: string, leaderId: string): Promise<Record<string, unknown>> {
  const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
  if (!agent || agent.leader_id !== leaderId) throw new Error("agent not found for this leader");
  const leader = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(leaderId).first<Record<string, unknown>>();
  if (!leader) throw new Error("leader not found");
  const rank = rankFor(leader.ap as number);
  const { results: versionRows } = await env.DB.prepare("SELECT * FROM versions WHERE agent_id = ? ORDER BY created_at").bind(agentId).all<Record<string, unknown>>();
  const versions = [];
  for (const v of versionRows) {
    const { results: fights } = await env.DB.prepare("SELECT * FROM matches WHERE a_version = ? OR b_version = ?").bind(v.id, v.id).all<Record<string, unknown>>();
    const policy = JSON.parse(v.policy_json as string) as { dna: Record<string, number>; rules: { id: string; move: string; fire?: boolean }[] };
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
    versions.push({
      versionId: v.id,
      provider: (v.provider as string) ?? "mock",
      isMock: ((v.is_mock as number) ?? 1) === 1,
      createdAt: v.created_at,
      chips: policy.rules.map((r) => ({ id: r.id, move: r.move, fire: r.fire === true, triggers: triggers[r.id] ?? 0 })),
      dna: policy.dna,
      fights: fights.length,
      wins,
      winRate: fights.length ? wins / fights.length : 0,
      avgTicks: fights.length ? Math.round(ticks / fights.length) : 0,
    });
  }
  const owned = new Set(versionRows.map((v) => v.id as string));
  const history: Record<string, unknown>[] = [];
  if (owned.size) {
    const marks = [...owned].map(() => "?").join(",");
    const ids = [...owned];
    const { results: fights } = await env.DB.prepare(
      `SELECT * FROM matches WHERE a_version IN (${marks}) OR b_version IN (${marks}) ORDER BY created_at DESC LIMIT 20`,
    ).bind(...ids, ...ids).all<Record<string, unknown>>();
    for (const m of fights) {
      const mine = owned.has(m.a_version as string) ? "a" : "b";
      history.push({
        matchId: m.id,
        seed: m.seed,
        winner: m.winner,
        ticks: m.ticks,
        checksum: m.checksum,
        rated: m.rated,
        myDelta: mine === "a" ? m.delta_a : m.delta_b,
        myPaid: mine === "a" ? m.paid_a : m.paid_b,
        foe: mine === "a" ? m.b_version : m.a_version,
        at: m.created_at,
        replay: `/v1/matches/${m.id}/replay`,
      });
    }
  }
  return {
    agent: { id: agent.id, name: agent.name ?? null, concept: agent.concept ?? null, portraitUrl: agent.portrait_url ?? null, portraitStatus: agent.portrait_status ?? "faceless", activeVersionId: agent.active_version_id ?? null },
    leader: { handle: leader.handle, ap: leader.ap, ac: leader.ac, tier: rank.tier, division: rank.division },
    energy: energyView(await energyFor(env, leaderId)),
    versions,
    history,
  };
}

export const BOT_SETTLE_MS = 30_000;
export const RANKED_TICKET_MS = 10 * 60_000;

// Nearest ELO human with a published version. Never self, never over the pair cap.
async function findHumanOpponent(env: WorkerEnv, leaderId: string, now: number): Promise<{ leaderId: string; versionId: string } | null> {
  const me = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(leaderId).first<Record<string, unknown>>();
  if (!me) return null;
  const { results: rows } = await env.DB.prepare(
    `SELECT m.created_at AS at, aa.leader_id AS a, ab.leader_id AS b FROM matches m
     JOIN versions va ON va.id = m.a_version JOIN agents aa ON aa.id = va.agent_id
     JOIN versions vb ON vb.id = m.b_version JOIN agents ab ON ab.id = vb.agent_id
     WHERE m.rated = 1`
  ).bind().all<Record<string, unknown>>();
  const history: History = { marks: rows.map((m) => ({ a: m.a as string, b: m.b as string, at: m.at as number })) };
  const { results: agents } = await env.DB.prepare("SELECT * FROM agents WHERE active_version_id IS NOT NULL").bind().all<Record<string, unknown>>();
  let best: { leaderId: string; versionId: string } | null = null;
  let bestGap = Infinity;
  for (const a of agents) {
    const other = a.leader_id as string;
    if (other === leaderId) continue;
    const row = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(other).first<Record<string, unknown>>();
    if (!row) continue;
    if (pairMeetings(history, leaderId, other, now) >= MAX_PAIR_MEETINGS) continue;
    const gap = Math.abs((row.ap as number) - (me.ap as number));
    if (gap < bestGap) {
      bestGap = gap;
      best = { leaderId: other, versionId: a.active_version_id as string };
    }
  }
  return best;
}

async function runCasualD1(
  env: WorkerEnv,
  input: { aVersionId: string; bVersionId?: string; leaderId: string; useBot: boolean; seed: string },
): Promise<{ matchId: string; winner: string; ticks: number; checksum: string; foe: string; bot: boolean; paid: number }> {
  const v = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(input.aVersionId).first<Record<string, unknown>>();
  if (!v) throw new Error("unknown version");
  let foeLabel = input.bVersionId ?? "";
  let foePolicy: AgentPolicy | null = null;
  if (input.bVersionId) {
    const foeRow = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(input.bVersionId).first<Record<string, unknown>>();
    if (foeRow) foePolicy = JSON.parse(foeRow.policy_json as string) as AgentPolicy;
  }
  if (!foePolicy) {
    const row = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(input.leaderId).first<Record<string, unknown>>();
    const bot = pickBot((row?.ap as number) ?? 500);
    foeLabel = bot.id;
    foePolicy = bot.policy;
  }
  const out = fightPolicies(JSON.parse(v.policy_json as string) as AgentPolicy, foePolicy, input.seed);
  const id = mintId("m");
  const winner = out.winner === "DRAW" ? "DRAW" : out.winner;
  const plan = await planPay(env, input.leaderId, id, "a", winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest");
  const writes: unknown[] = [
    env.DB.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, paid_a, paid_b, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)",
    ).bind(id, input.seed, input.aVersionId, foeLabel, out.winner, out.ticks, out.checksum, plan.credited, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB })),
    ...plan.stmts,
  ];
  await env.DB.batch(writes as never[]);
  return { matchId: id, winner, ticks: out.ticks, checksum: out.checksum, foe: foeLabel, bot: !input.bVersionId, paid: plan.credited };
}

async function settleTicketD1(env: WorkerEnv, ticket: Record<string, unknown>, foeVersion: string | null): Promise<Record<string, unknown>> {
  const mode = ticket.mode as string;
  let matchId: string;
  if (mode === "ranked" && foeVersion) {
    const settled = await settleRankedD1(env, ticket, foeVersion);
    matchId = settled;
  } else {
    const settled = await runCasualD1(env, {
      aVersionId: ticket.version_id as string,
      bVersionId: foeVersion ?? undefined,
      leaderId: ticket.leader_id as string,
      useBot: !foeVersion,
      seed: `q-${ticket.id}`,
    });
    matchId = settled.matchId;
  }
  await env.DB.prepare("UPDATE tickets SET status = 'settled', foe_version = ?, match_id = ? WHERE id = ?").bind(
    foeVersion ?? `bot:${ticket.leader_id}`, matchId, ticket.id,
  ).run();
  return (await env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(ticket.id).first<Record<string, unknown>>()) as Record<string, unknown>;
}

async function settleRankedD1(
  env: WorkerEnv,
  input: { aVersionId: string; bVersionId: string; seed: string; key: string },
): Promise<Record<string, unknown>> {
  const a = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(input.aVersionId).first<Record<string, unknown>>();
  const b = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(input.bVersionId).first<Record<string, unknown>>();
  if (!a || !b) throw new Error("unknown version");
  const aAgent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(a.agent_id as string).first<Record<string, unknown>>();
  const bAgent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(b.agent_id as string).first<Record<string, unknown>>();
  if (!aAgent || !bAgent) throw new Error("unknown agent");
  if (aAgent.leader_id === bAgent.leader_id) throw new Error("self match denied");
  const out = fightPolicies(
    JSON.parse(a.policy_json as string) as AgentPolicy,
    JSON.parse(b.policy_json as string) as AgentPolicy,
    input.seed,
  );
  const winner = out.winner === "DRAW" ? "DRAW" : out.winner;
  const ledger = createLedger("local-s1");
  const rows = await env.DB.prepare("SELECT * FROM leaders").bind().all<Record<string, unknown>>();
  for (const row of rows.results) {
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
  const writes: unknown[] = [];
  for (const [id, st] of ledger.ratings) {
    writes.push(
      env.DB.prepare("UPDATE leaders SET rating_milli = ?, ap = ?, placement = ?, placed = ? WHERE id = ?").bind(
        st.ratingMilli, st.ap, st.placementGames, st.placed ? 1 : 0, id,
      ),
    );
  }
  const planA = await planPay(env, aAgent.leader_id as string, input.key, "a", winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest");
  const planB = await planPay(env, bAgent.leader_id as string, input.key, "b", winner === "B" ? "win" : winner === "A" ? "loss" : "no-contest");
  writes.push(
    ...planA.stmts,
    ...planB.stmts,
    env.DB.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, delta_a, delta_b, paid_a, paid_b, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
    ).bind(input.key, input.seed, input.aVersionId, input.bVersionId, winner, out.ticks, out.checksum, applied.deltaA, applied.deltaB, planA.credited, planB.credited, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB })),
  );
  try {
    await env.DB.batch(writes as never[]);
  } catch {
    // The row insert lost a race: this fight already settles. Rebuild the
    // stored result instead of leaving a partial duplicate.
    const stored = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(input.key).first<Record<string, unknown>>();
    if (!stored) throw new Error("settle failed");
    return settledResultD1(env, stored as Record<string, number | string>);
  }
  return { matchId: input.key, winner, ticks: out.ticks, checksum: out.checksum, deltaA: applied.deltaA, deltaB: applied.deltaB, paidA: planA.credited, paidB: planB.credited };
}

async function requestMatchD1(
  env: WorkerEnv,
  input: { leaderId: string; versionId: string; mode: string },
  now: number,
): Promise<Record<string, unknown>> {
  if (input.mode !== "casual" && input.mode !== "ranked") throw new Error("unknown mode");
  const owned = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(input.leaderId).first<Record<string, unknown>>();
  const version = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(input.versionId).first<Record<string, unknown>>();
  if (!version || !owned || version.agent_id !== owned.id) throw new Error("unknown version");
  if (owned.active_version_id !== input.versionId) throw new Error("queue your active version");
  const open = await env.DB.prepare("SELECT * FROM tickets WHERE leader_id = ? AND mode = ? AND status = 'queued'").bind(input.leaderId, input.mode).first();
  if (open) throw new Error("ticket already open for this mode");
  const spent = await spendEnergy(env, input.leaderId, now);
  if (!spent.ok) throw new Error(spent.reason ?? "energy empty");
  const id = mintId("t");
  const wait = input.mode === "casual" ? BOT_SETTLE_MS : RANKED_TICKET_MS;
  await env.DB.prepare("INSERT INTO tickets (id, leader_id, version_id, mode, status, created_at, settle_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)").bind(
    id, input.leaderId, input.versionId, input.mode, now, now + wait,
  ).run();
  const foe = await findHumanOpponent(env, input.leaderId, now);
  const row = (await env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(id).first<Record<string, unknown>>()) as Record<string, unknown>;
  if (foe) return settleTicketD1(env, row, foe.versionId);
  return row;
}

async function readTicketD1(
  env: WorkerEnv,
  input: { ticketId: string; leaderId: string },
  now: number,
): Promise<Record<string, unknown>> {
  const ticket = await env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(input.ticketId).first<Record<string, unknown>>();
  if (!ticket || ticket.leader_id !== input.leaderId) throw new Error("unknown ticket");
  if (ticket.status !== "queued") return withMatchD1(env, ticket);
  if (now < (ticket.settle_at as number)) {
    if (ticket.mode === "ranked") {
      const foe = await findHumanOpponent(env, input.leaderId, now);
      if (foe) return withMatchD1(env, await settleTicketD1(env, ticket, foe.versionId));
    }
    return { ...ticket };
  }
  if (ticket.mode === "casual") return withMatchD1(env, await settleTicketD1(env, ticket, null));
  // Ranked expiry with no foe: no fight started, so the charge returns.
  await env.DB.prepare("UPDATE tickets SET status = 'expired' WHERE id = ?").bind(input.ticketId).run();
  await refundEnergy(env, input.leaderId, now);
  return (await env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(input.ticketId).first<Record<string, unknown>>()) as Record<string, unknown>;
}

async function settledResultD1(env: WorkerEnv, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const credited = async (side: string): Promise<number> => {
    const r = await env.DB.prepare("SELECT SUM(delta) AS total FROM wallet_txns WHERE idem_key = ?").bind(`${row.id}-${side}`).first<Record<string, unknown>>();
    return (r?.total as number) ?? 0;
  };
  return {
    matchId: row.id,
    winner: row.winner,
    ticks: row.ticks,
    checksum: row.checksum,
    deltaA: row.delta_a,
    deltaB: row.delta_b,
    paidA: await credited("a"),
    paidB: await credited("b"),
    deduped: true,
  };
}

async function withMatchD1(env: WorkerEnv, ticket: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...ticket };
  if (ticket.match_id) {
    out.match = (await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(ticket.match_id as string).first<Record<string, unknown>>()) ?? undefined;
  }
  return out;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    // The viewer is a static asset. Anything outside /v1/ serves the game.
    if (!url.pathname.startsWith("/v1/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/health") {
      return json({ ok: true, worker: "agent-wars-api" });
    }
    if (request.method === "GET" && url.pathname === "/v1/leaderboard") {
      return leaderboard(env, url.searchParams.get("seasonId") ?? "local-s1");
    }
    const replayMatch = /^\/v1\/matches\/[^/]+\/replay$/.exec(url.pathname);
    if (request.method === "GET" && replayMatch) {
      return replay(env, decodeURIComponent(replayMatch[0].split("/")[3]));
    }
    if (request.method === "POST" && url.pathname === "/v1/auth/session") {
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const handle = typeof body.handle === "string" ? body.handle.trim() : "";
      if (!handle) return json({ error: "handle is required" }, 400);
      const found = await env.DB.prepare("SELECT * FROM leaders WHERE handle = ?").bind(handle).first<Record<string, unknown>>();
      if (found) return json({ token: found.token, leaderId: found.id });
      if (limited(authHits, handle, 60_000, 10)) return json({ error: "rate limited, retry later" }, 429);
      const id = mintId("leader");
      const token = newToken("demo");
      await env.DB.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").bind(id, handle, token).run();
      return json({ token, leaderId: id });
    }
    const me = await bearer(request, env);
    if (!me) return json({ error: "bearer token is required: call POST /v1/auth/session first" }, 401);
    if (request.method === "GET" && url.pathname === "/v1/me") {
      const agent = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(me.id as string).first<Record<string, unknown>>();
      const auto = await autoTickD1(env, me.id as string, Date.now());
      const st = await energyFor(env, me.id as string);
      const energy = energyView(st, Date.now());
      return json({ leader: me, agent, energy, auto: { optIn: st.optIn, leaseExpiresAt: st.leaseExpiresAt, state: st.state, ran: auto.ran } }, 200);
    }
    if (request.method === "POST" && url.pathname === "/v1/autobattle/opt-in") {
      try {
        const opt = await optInAutoD1(env, me.id as string, Date.now());
        const tick = await autoTickD1(env, me.id as string, Date.now(), 3);
        return json({ ...opt, ran: tick.ran, matches: tick.matches }, 200);
      } catch (err) {
        return json({ error: (err as Error).message }, 404);
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/autobattle/pause") {
      return json(await pauseAutoD1(env, me.id as string, Date.now()), 200);
    }
    if (request.method === "GET" && url.pathname === "/v1/autobattle/digest") {
      return json(await autoDigestD1(env, me.id as string, Date.now()), 200);
    }
    if (request.method === "POST" && url.pathname === "/v1/agents") {
      try {
      const exists = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(me.id as string).first();
      if (exists) return json({ error: "one agent per leader in this phase" }, 409);
      const created = await readBody(request);
      if (created === null) return json({ error: "bad json" }, 400);
      const name = typeof created.name === "string" ? created.name.slice(0, 60) : "";
      const concept = typeof created.concept === "string" ? created.concept.slice(0, 280) : "";
      let portraitUrl: string | null = null;
      let portraitStatus = "faceless";
      if (hasKey("portrait", env)) {
        try {
          const art = await portraitFromEnv(env).generatePortrait({
            prompt: portraitPromptFor(`${name || "arena robot"}: ${concept || "arena fighter"}`),
          });
          portraitUrl = art.url;
          portraitStatus = "ready";
        } catch {
          portraitUrl = null;
          portraitStatus = "failed";
        }
      }
      const id = mintId("agent");
      await env.DB.prepare(
        "INSERT INTO agents (id, leader_id, active_version_id, name, concept, portrait_url, portrait_status) VALUES (?, ?, NULL, ?, ?, ?, ?)",
      ).bind(id, me.id as string, name || null, concept || null, portraitUrl, portraitStatus).run();
      return json({ agentId: id, portraitUrl, portraitStatus }, 201);
      } catch (err) {
        return json({ error: `server error: ${(err as Error).message}` }, 500);
      }
    }
    const retryMatch = request.method === "POST" && /^\/v1\/agents\/[^/]+\/portrait\/retry$/.exec(url.pathname);
    if (retryMatch) {
      try {
      const agentId = url.pathname.split("/")[3];
      const target = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
      if (!target || target.leader_id !== me.id) return json({ error: "agent not found for this leader" }, 404);
      if (target.portrait_status === "ready" && target.portrait_url) {
        return json({ portraitUrl: target.portrait_url, portraitStatus: "ready", retried: false }, 200);
      }
      let portraitUrl: string | null = null;
      let portraitStatus = "faceless";
      if (hasKey("portrait", env)) {
        try {
          const art = await portraitFromEnv(env).generatePortrait({
            prompt: portraitPromptFor(`${(target.name as string) || "arena robot"}: ${(target.concept as string) || "arena fighter"}`),
          });
          portraitUrl = art.url;
          portraitStatus = "ready";
        } catch {
          portraitUrl = null;
          portraitStatus = "failed";
        }
      }
      await env.DB.prepare("UPDATE agents SET portrait_url = ?, portrait_status = ? WHERE id = ?").bind(portraitUrl, portraitStatus, agentId).run();
      return json({ portraitUrl, portraitStatus, retried: true }, 200);
      } catch (err) {
        return json({ error: `server error: ${(err as Error).message}` }, 500);
      }
    }
    const dashMatch = request.method === "GET" && /^\/v1\/agents\/[^/]+\/dashboard$/.exec(url.pathname);
    if (dashMatch) {
      const agentId = url.pathname.split("/")[3];
      try {
        return json(await agentDashboard(env, agentId, me.id as string));
      } catch (err) {
        return json({ error: (err as Error).message }, 404);
      }
    }
    const compileMatch = request.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/compile$/.test(url.pathname);
    if (compileMatch) {
      if (limited(compileHits, me.id as string, 60_000, 6)) return json({ error: "rate limited, retry later" }, 429);
      try {
      const agentId = url.pathname.split("/")[3];
      const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
      if (!agent || agent.leader_id !== me.id) return json({ error: "agent not found for this leader" }, 404);
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      if (!prompt) return json({ error: "prompt is required" }, 400);
      const versionId = mintId("v");
      const compiled = await providerFromEnv(env).compileStrategy({ prompt, agentVersionId: versionId });
      const spent = { tokens: compiled.promptTokens, latencyMs: compiled.latencyMs };
      if (!compiled.policy) return json({ error: "draft failed validation", errors: compiled.errors, provider: compiled.provider, isMock: compiled.isMock, ...spent }, 422);
      const check = validatePolicy(compiled.policy);
      if (!check.ok) return json({ error: "draft failed validation", errors: check.errors, provider: compiled.provider, isMock: compiled.isMock, ...spent }, 422);
      const sha = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(compiled.policy)));
      const hex = [...new Uint8Array(sha)].map((x) => x.toString(16).padStart(2, "0")).join("");
      await env.DB.prepare(
        "INSERT INTO versions (id, agent_id, policy_json, sha, created_at, provider, is_mock, tokens, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(versionId, agentId, JSON.stringify(compiled.policy), hex, Date.now(), compiled.provider, compiled.isMock ? 1 : 0, compiled.promptTokens, compiled.latencyMs).run();
      return json({ versionId, provider: compiled.provider, isMock: compiled.isMock, ...spent }, 201);
      } catch (err) {
        return json({ error: `server error: ${(err as Error).message}` }, 500);
      }
    }
    const installMatch = request.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/install$/.test(url.pathname);
    if (installMatch) {
      try {
      const agentId = url.pathname.split("/")[3];
      const target = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
      if (!target || target.leader_id !== me.id) return json({ error: "agent not found for this leader" }, 404);
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const versionId = typeof body.versionId === "string" ? body.versionId : "";
      if (!versionId) return json({ error: "versionId is required" }, 400);
      const version = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first<Record<string, unknown>>();
      if (!version || version.agent_id !== agentId) return json({ error: "unknown version for this agent" }, 404);
      await env.DB.prepare("UPDATE agents SET active_version_id = ? WHERE id = ?").bind(versionId, agentId).run();
      return json({ activeVersionId: versionId }, 200);
      } catch (err) {
        return json({ error: `server error: ${(err as Error).message}` }, 500);
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/matches/training") {
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const versionId = typeof body.versionId === "string" ? body.versionId : "";
      const seed = typeof body.seed === "string" && body.seed ? body.seed : `t-${Date.now().toString(36)}`;
      if (!versionId) return json({ error: "versionId is required" }, 400);
      if (limited(trainHits, me.id as string, 60_000, 20)) return json({ error: "rate limited, retry later" }, 429);
      const owned = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first<Record<string, unknown>>();
      if (!owned) return json({ error: "unknown version" }, 404);
      const owner = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(owned.agent_id as string).first<Record<string, unknown>>();
      if (!owner || owner.leader_id !== me.id) return json({ error: "version not found for this leader" }, 404);
      const v = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first<Record<string, unknown>>();
      if (!v) return json({ error: "unknown version" }, 404);
      const out = fightPolicies(JSON.parse(v.policy_json as string) as AgentPolicy, BENCH_POLICY, seed);
      const id = mintId("m");
      await env.DB.prepare(
        "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
      ).bind(id, seed, versionId, "benchmark-v1", out.winner, out.ticks, out.checksum, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB })).run();
      return json({ matchId: id, ...out }, 201);
    }
    if (request.method === "POST" && url.pathname === "/v1/matches/ranked") {
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const aVersionId = typeof body.aVersionId === "string" ? body.aVersionId : "";
      const bVersionId = typeof body.bVersionId === "string" ? body.bVersionId : "";
      const seed = typeof body.seed === "string" && body.seed ? body.seed : `r-${Date.now().toString(36)}`;
      const key = typeof body.key === "string" && body.key ? body.key : mintId("m");
      if (!aVersionId || !bVersionId) return json({ error: "aVersionId and bVersionId are required" }, 400);
      const dup = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(key).first<Record<string, unknown>>();
      if (dup) return json(await settledResultD1(env, dup), 201);
      const a = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(aVersionId).first<Record<string, unknown>>();
      const b = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(bVersionId).first<Record<string, unknown>>();
      if (!a || !b) return json({ error: "unknown version" }, 404);
      const aAgent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(a.agent_id as string).first<Record<string, unknown>>();
      const bAgent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(b.agent_id as string).first<Record<string, unknown>>();
      if (!aAgent || !bAgent) return json({ error: "unknown agent" }, 404);
      if (aAgent.leader_id === bAgent.leader_id) return json({ error: "self match denied" }, 422);
      const spent = await spendEnergy(env, me.id as string);
      if (!spent.ok) return json({ error: spent.reason }, 409);
      try {
        return json(await settleRankedD1(env, { aVersionId, bVersionId, seed, key }), 201);
      } catch (err) {
        return json({ error: (err as Error).message }, 409);
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/matchmaking/request") {
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const versionId = typeof body.versionId === "string" ? body.versionId : "";
      const mode = typeof body.mode === "string" ? body.mode : "";
      if (!versionId || (mode !== "casual" && mode !== "ranked")) {
        return json({ error: "versionId and mode casual|ranked are required" }, 400);
      }
      if (limited(queueHits, me.id as string, 60_000, 6)) return json({ error: "rate limited, retry later" }, 429);
      try {
        const ticket = await requestMatchD1(env, { leaderId: me.id as string, versionId, mode }, Date.now());
        return json(await withMatchD1(env, ticket), 201);
      } catch (err) {
        return json({ error: (err as Error).message }, 409);
      }
    }
    const ticketRead = request.method === "GET" && /^\/v1\/matchmaking\/[^/]+$/.exec(url.pathname);
    if (ticketRead) {
      const ticketId = url.pathname.split("/")[3];
      try {
        return json(await readTicketD1(env, { ticketId, leaderId: me.id as string }, Date.now()));
      } catch (err) {
        return json({ error: (err as Error).message }, 404);
      }
    }
    const CUP_ID = "s1-kickoff";
    const cupView = (event: Championship, games: Record<string, string[]>): Record<string, unknown> => ({
      id: event.id,
      name: "S1 Kickoff Cup",
      phase: event.phase,
      maxPlayers: event.maxPlayers,
      minAp: event.minAp,
      registrationCloseAt: event.registrationCloseAt,
      entries: event.entries.map((e) => ({ leaderId: e.leaderId, lockedVersionId: e.lockedVersionId, registeredAt: e.registeredAt })),
      bracket: event.bracket,
      games,
    });
    const readCup = async (): Promise<{ event: Championship; games: Record<string, string[]> }> => {
      let row = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(CUP_ID).first<Record<string, unknown>>();
      if (!row) {
        const now = Date.now();
        const fresh = createEvent({ id: CUP_ID, seed: "kickoff-s1", maxPlayers: 8, minAp: 0, registrationCloseAt: now + 30 * 24 * 60 * 60 * 1000 });
        await env.DB.prepare("INSERT INTO tournaments (id, name, event_json, games_json, created_at) VALUES (?, ?, ?, ?, ?)").bind(
          CUP_ID, "S1 Kickoff Cup", JSON.stringify(fresh), "{}", now,
        ).run();
        row = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(CUP_ID).first<Record<string, unknown>>();
      }
      return {
        event: JSON.parse((row as Record<string, unknown>).event_json as string) as Championship,
        games: JSON.parse((row as Record<string, unknown>).games_json as string) as Record<string, string[]>,
      };
    };
    if (request.method === "GET" && url.pathname === "/v1/tournaments") {
      const { event } = await readCup();
      return json({ tournaments: [{ id: CUP_ID, name: "S1 Kickoff Cup", phase: event.phase, entries: event.entries.length, maxPlayers: event.maxPlayers }] });
    }
    const tournMatch = request.method === "GET" && /^\/v1\/tournaments\/[^/]+$/.exec(url.pathname);
    if (tournMatch) {
      if (url.pathname.split("/")[3] !== CUP_ID) return json({ error: "unknown tournament" }, 404);
      const { event, games } = await readCup();
      return json(cupView(event, games));
    }
    const regMatch = request.method === "POST" && /^\/v1\/tournaments\/[^/]+\/register$/.test(url.pathname);
    if (regMatch) {
      try {
      if (url.pathname.split("/")[3] !== CUP_ID) return json({ error: "unknown tournament" }, 404);
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const versionId = typeof body.versionId === "string" ? body.versionId : "";
      if (!versionId) return json({ error: "versionId is required" }, 400);
      let { event, games } = await readCup();
      const agent = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(me.id as string).first<Record<string, unknown>>();
      if (!agent) return json({ error: "breed a hero first" }, 404);
      if (agent.active_version_id !== versionId) return json({ error: "register your active version" }, 404);
      const leader = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(me.id as string).first<Record<string, unknown>>();
      const outcome = registerEntry(event, { leaderId: me.id as string, agentVersionId: versionId, ap: (leader as Record<string, unknown>).ap as number, now: Date.now() });
      if (!outcome.ok) return json({ error: outcome.reason }, 404);
      event = addEntry(event, outcome);
      let started = false;
      if (event.entries.length >= event.maxPlayers) {
        event = seedBracket(lock(event));
        started = true;
        const leaderOf = (version: string): string | null => {
          const hit = event.entries.find((e) => e.lockedVersionId === version || e.agentVersionId === version);
          return hit ? hit.leaderId : null;
        };
        for (const slot of (event.bracket as { slots: { id: string }[] }).slots) {
          let guard = 0;
          for (;;) {
            const cur = (event.bracket as { slots: { id: string; slotA: string; slotB: string; winnerId: string | null }[] }).slots.find((s) => s.id === slot.id) as { id: string; slotA: string; slotB: string; winnerId: string | null };
            if (cur.winnerId) break;
            guard += 1;
            const seed = `tmt-${event.id}-${slot.id}-g${(games[slot.id] ?? []).length + 1}`;
            const prior = await env.DB.prepare("SELECT * FROM matches WHERE seed = ?").bind(seed).first<Record<string, unknown>>();
            let winnerVersion: string | null = null;
            let matchId = prior?.id as string | undefined;
            if (prior) {
              winnerVersion = prior.winner === "A" ? cur.slotA : prior.winner === "B" ? cur.slotB : null;
            } else {
              const fight = await runCasualD1(env, { aVersionId: cur.slotA, bVersionId: cur.slotB, leaderId: leaderOf(cur.slotA) as string, useBot: false, seed });
              matchId = fight.matchId;
              const plan = await planPay(env, leaderOf(cur.slotB) as string, fight.matchId, "b", fight.winner === "B" ? "win" : fight.winner === "A" ? "loss" : "no-contest");
              await env.DB.batch(plan.stmts as never[]);
              winnerVersion = fight.winner === "A" ? cur.slotA : fight.winner === "B" ? cur.slotB : null;
            }
            games[slot.id] = [...(games[slot.id] ?? []), matchId as string];
            if (!winnerVersion) {
              if (guard >= 6) event = reportGame(event, { slotId: slot.id, winnerVersionId: cur.slotA });
              continue;
            }
            event = reportGame(event, { slotId: slot.id, winnerVersionId: winnerVersion });
          }
        }
      }
      await env.DB.prepare("UPDATE tournaments SET event_json = ?, games_json = ? WHERE id = ?").bind(JSON.stringify(event), JSON.stringify(games), CUP_ID).run();
      return json({ entered: true, started, event: cupView(event, games) }, 201);
      } catch (err) {
        return json({ error: (err as Error).message }, 404);
      }
    }
    const ARMORY_SLOTS = ["skin", "trail", "banner"];
    const readCloset = async (): Promise<{ leader: Record<string, unknown>; owned: string[]; equipped: Record<string, string | null> }> => {
      const leader = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(me.id as string).first<Record<string, unknown>>();
      if (!leader) throw new Error("unknown leader");
      return {
        leader,
        owned: JSON.parse((leader.owned_json as string) ?? "[]") as string[],
        equipped: JSON.parse((leader.equipped_json as string) ?? "{}") as Record<string, string | null>,
      };
    };
    const armoryJson = (leader: Record<string, unknown>, owned: string[], equipped: Record<string, string | null>): Record<string, unknown> => ({
      ac: leader.ac,
      rp: leader.rp,
      equipped,
      catalog: CATALOG.map((c) => ({ ...c, owned: owned.includes(c.id) })),
    });
    if (request.method === "GET" && url.pathname === "/v1/armory") {
      const { leader, owned, equipped } = await readCloset();
      return json(armoryJson(leader, owned, equipped), 200);
    }
    if (request.method === "POST" && url.pathname === "/v1/armory/buy") {
      try {
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      if (!itemId) return json({ error: "itemId is required" }, 400);
      const item = CATALOG.find((c) => c.id === itemId);
      if (!item) return json({ error: `unknown item ${itemId}` }, 404);
      const { leader, owned } = await readCloset();
      if (!owned.includes(itemId)) {
        const balance = item.currency === "AC" ? (leader.ac as number) : (leader.rp as number);
        if (balance < item.price) return json({ error: `insufficient ${item.currency}` }, 422);
        const key = `shop:${itemId}`;
        const column = item.currency === "AC" ? "ac" : "rp";
        const writes: unknown[] = [
          env.DB.prepare("INSERT OR IGNORE INTO wallet_keys (wallet_id, key) VALUES (?, ?)").bind(me.id as string, key),
        ];
        const claimed = await env.DB.batch(writes as never[]) as { changes?: number; meta?: { changes?: number } }[];
        const first = claimed[0] ?? {};
        const inserted = (first.changes ?? first.meta?.changes ?? 0) > 0;
        if (inserted) {
          await env.DB.prepare(`UPDATE leaders SET ${column} = ${column} - ? WHERE id = ?`).bind(item.price, me.id as string).run();
          await env.DB.prepare("INSERT OR IGNORE INTO wallet_txns (wallet_id, idem_key, currency, delta, reason, at) VALUES (?, ?, ?, ?, ?, ?)").bind(
            me.id as string, key, item.currency, -item.price, `buy ${itemId}`, Date.now(),
          ).run();
        }
        owned.push(itemId);
        await env.DB.prepare("UPDATE leaders SET owned_json = ? WHERE id = ?").bind(JSON.stringify(owned), me.id as string).run();
      }
      const fresh = await readCloset();
      return json(armoryJson(fresh.leader, fresh.owned, fresh.equipped), 200);
      } catch (err) {
        return json({ error: (err as Error).message }, 422);
      }
    }
    if (request.method === "POST" && url.pathname === "/v1/armory/equip") {
      try {
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const slot = typeof body.slot === "string" ? body.slot : "";
      const itemId = typeof body.itemId === "string" ? body.itemId : "";
      if (!slot || !itemId) return json({ error: "slot and itemId are required" }, 400);
      if (!ARMORY_SLOTS.includes(slot)) return json({ error: `unknown slot ${slot}` }, 422);
      const { owned, equipped } = await readCloset();
      if (!owned.includes(itemId)) return json({ error: `not owned ${itemId}` }, 404);
      const next = { ...equipped, [slot]: itemId };
      await env.DB.prepare("UPDATE leaders SET equipped_json = ? WHERE id = ?").bind(JSON.stringify(next), me.id as string).run();
      const fresh = await readCloset();
      return json(armoryJson(fresh.leader, fresh.owned, fresh.equipped), 200);
      } catch (err) {
        return json({ error: (err as Error).message }, 422);
      }
    }
    const cancelMatch = request.method === "POST" && /^\/v1\/matchmaking\/[^/]+\/cancel$/.test(url.pathname);
    if (cancelMatch) {
      const ticketId = url.pathname.split("/")[3];
      try {
        const ticket = await env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(ticketId).first<Record<string, unknown>>();
        if (!ticket || ticket.leader_id !== me.id) return json({ error: "unknown ticket" }, 404);
        if (ticket.status !== "queued") return json({ error: `ticket is ${ticket.status}, nothing to cancel` }, 404);
        await env.DB.prepare("UPDATE tickets SET status = 'canceled' WHERE id = ?").bind(ticketId).run();
        await refundEnergy(env, me.id as string, Date.now());
        const row = await env.DB.prepare("SELECT * FROM tickets WHERE id = ?").bind(ticketId).first<Record<string, unknown>>();
        return json(row, 200);
      } catch (err) {
        return json({ error: (err as Error).message }, 404);
      }
    }
    return json({ error: "unknown route" }, 404);
  },
};
