// Cloudflare Worker entry. Full API on D1: auth, publish, fights, replay.

import { explainerFromEnv, hasKey, portraitFromEnv, portraitPromptFor, providerFromEnv } from "@agent-wars/ai-provider";
import { activate, draft, finishMatch, pause, refresh, refundManualMatch, spendManualMatch, startOwnerMatch, DAY_MS, MAX_ATTACK_PER_DAY, REGEN_MS, STAMINA_MAX } from "@agent-wars/autobattle";
import type { Status } from "@agent-wars/autobattle";
import { addEntry, createEvent, lock, register as registerEntry, reportGame, seedBracket, transition as transitionEvent } from "@agent-wars/tournaments";
import type { EventPhase } from "@agent-wars/tournaments";
import type { Championship } from "@agent-wars/tournaments";
import { CATALOG } from "@agent-wars/economy";
import { BENCH_POLICY, BOT_PRESETS, buildReplay, fightPolicies, pickBot } from "@agent-wars/battle-core";
import { MAX_DEFENSE_PER_DAY, recordDefense } from "@agent-wars/autobattle";
import { pickOpponent } from "@agent-wars/matchmaker";
import type { Candidate, History } from "@agent-wars/matchmaker";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { validatePolicy } from "@agent-wars/behavior-dna";
import { checkLimit } from "./ids.ts";

// Per-route sliding windows. Memory-only per isolate.
const authHits = new Map<string, number[]>();
const compileHits = new Map<string, number[]>();
const queueHits = new Map<string, number[]>();
const trainHits = new Map<string, number[]>();
const labHits = new Map<string, number[]>();
const analysisHits = new Map<string, number[]>();

function limited(log: Map<string, number[]>, key: string, windowMs: number, max: number): boolean {
  return !checkLimit(log, key, Date.now(), windowMs, max);
}
import { createWallet, earnAc } from "@agent-wars/economy";
import { buildStandings } from "@agent-wars/leaderboard";
import { applyRanked, createLedger, rankFor, ratingFor } from "@agent-wars/ranking";

// Brief cap. Kept in sync with MAX_PROMPT in flow.ts: paragraphs welcome, spend bounded.
const MAX_PROMPT = 2000;

export type WorkerEnv = {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  META_SPARK_KEY?: string;
  META_IMAGE_KEY?: string;
  META_API_BASE?: string;
  AGENT_WARS_MODEL_COMPILE?: string;
  AGENT_WARS_MODEL_PORTRAIT?: string;
  ADMIN_KEY?: string;
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
    defense: {
      used: st.defenseAt.filter((t) => now - t < DAY_MS).length,
      max: MAX_DEFENSE_PER_DAY,
    },
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
    let policy: { dna: Record<string, number>; rules: { id: string; move: string; fire?: boolean; when: unknown }[] } | null = null;
    try {
      policy = JSON.parse(v.policy_json as string) as { dna: Record<string, number>; rules: { id: string; move: string; fire?: boolean; when: unknown }[] };
      if (!policy || !Array.isArray(policy.rules)) policy = null;
    } catch {
      policy = null;
    }
    if (!policy) {
      versions.push({
        versionId: v.id,
        provider: (v.provider as string) ?? "mock",
        isMock: ((v.is_mock as number) ?? 1) === 1,
        createdAt: v.created_at,
        corrupt: true,
        label: (v.label as string) ?? null,
        chips: [],
        dna: null,
        fights: fights.length,
        wins: 0,
        winRate: 0,
        avgTicks: 0,
      });
      continue;
    }
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
      corrupt: false,
      label: (v.label as string) ?? null,
      chips: policy.rules.map((r) => ({ id: r.id, move: r.move, fire: r.fire === true, when: r.when ?? null, triggers: triggers[r.id] ?? 0 })),
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
  const pool: Candidate[] = [];
  for (const a of agents) {
    const other = a.leader_id as string;
    if (other === leaderId) continue;
    const row = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(other).first<Record<string, unknown>>();
    if (!row) continue;
    const st: Record<string, unknown> = row.autobattle_json ? JSON.parse(row.autobattle_json as string) : {};
    const defenses = Array.isArray(st.defenseAt) ? (st.defenseAt as number[]).length : 0;
    if (defenses >= MAX_DEFENSE_PER_DAY) continue;
    pool.push({
      leaderId: other,
      ratingMilli: row.rating_milli as number,
      optIn: st.optIn === true,
      published: true,
      leaseExpiresAt: typeof st.leaseExpiresAt === "number" ? (st.leaseExpiresAt as number) : null,
    });
  }
  const foe = pickOpponent(history, {
    leaderId,
    ratingMilli: me.rating_milli as number,
    optIn: true,
    published: true,
    leaseExpiresAt: now + 1,
  }, pool, now);
  if (!foe) return null;
  const stamped = recordDefense(await energyFor(env, foe.leaderId, now), now);
  await env.DB.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").bind(JSON.stringify(stamped.status), foe.leaderId).run();
  const agent = await env.DB.prepare("SELECT active_version_id FROM agents WHERE leader_id = ?").bind(foe.leaderId).first<Record<string, unknown>>();
  return { leaderId: foe.leaderId, versionId: agent?.active_version_id as string };
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
    const pubMatch = /^\/v1\/leaders\/[^/]+\/public$/.exec(url.pathname);
    if (request.method === "GET" && pubMatch) {
      const leader = await env.DB.prepare("SELECT * FROM leaders WHERE handle = ?").bind(decodeURIComponent(pubMatch[0].split("/")[3])).first<Record<string, unknown>>();
      if (!leader) return json({ error: "unknown handle" }, 404);
      const agent = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(leader.id as string).first<Record<string, unknown>>();
      let wins = 0;
      let losses = 0;
      if (agent) {
        const { results: vrows } = await env.DB.prepare("SELECT id FROM versions WHERE agent_id = ?").bind(agent.id as string).all<Record<string, unknown>>();
        const ids = vrows.map((v) => v.id as string);
        if (ids.length) {
          const marks = ids.map(() => "?").join(",");
          const { results: bouts } = await env.DB.prepare(
            `SELECT * FROM matches WHERE a_version IN (${marks}) OR b_version IN (${marks})`,
          ).bind(...ids, ...ids).all<Record<string, unknown>>();
          const owned = new Set(ids);
          for (const m of bouts) {
            const mine = owned.has(m.a_version as string) ? "A" : "B";
            if (m.winner === mine) wins += 1;
            else if (m.winner === "A" || m.winner === "B") losses += 1;
          }
        }
      }
      const rank = rankFor(leader.ap as number);
      const equipped = JSON.parse((leader.equipped_json as string) ?? "{}") as Record<string, string | null>;
      return json({
        handle: leader.handle,
        ap: leader.ap,
        tier: rank.tier,
        division: rank.division,
        agent: agent ? {
          name: agent.name,
          portraitUrl: agent.portrait_url,
          equippedSkin: equipped.skin ?? null,
          wins,
          losses,
        } : null,
      }, 200);
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
    const adminOk = (given: string): boolean => {
      const expected = (env as WorkerEnv).ADMIN_KEY ?? "";
      if (!expected || given.length !== expected.length) return false;
      let diff = 0;
      for (let i = 0; i < given.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
      return diff === 0;
    };
    const adminGate = (): Response | null => {
      if (!((env as WorkerEnv).ADMIN_KEY)) return json({ error: "admin console is disabled: set ADMIN_KEY first" }, 503);
      return null;
    };
    if (request.method === "POST" && url.pathname === "/v1/admin/events") {
      const closed = adminGate();
      if (closed) return closed;
      if (!adminOk(request.headers.get("x-admin-key") ?? "")) return json({ error: "admin sign-in required" }, 401);
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const id = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      const maxPlayers = typeof body.maxPlayers === "number" ? Math.floor(body.maxPlayers) : 0;
      const minAp = typeof body.minAp === "number" ? Math.floor(body.minAp) : 0;
      const registrationCloseAt = typeof body.registrationCloseAt === "number" ? body.registrationCloseAt : 0;
      if (!/^[a-z0-9-]{3,40}$/.test(id)) return json({ error: "event id must be a 3-40 char slug" }, 422);
      if (!name) return json({ error: "event name is required" }, 422);
      if (![2, 4, 8, 16, 32, 64].includes(maxPlayers)) return json({ error: "maxPlayers must be a power of two from 2 to 64" }, 422);
      if (!(minAp >= 0)) return json({ error: "minAp must be zero or more" }, 422);
      if (!(registrationCloseAt > Date.now())) return json({ error: "registrationCloseAt must be in the future" }, 422);
      const dup = await env.DB.prepare("SELECT id FROM tournaments WHERE id = ?").bind(id).first<Record<string, unknown>>();
      if (dup) return json({ error: `event ${id} already exists` }, 422);
      const event: Championship = { ...createEvent({ id, seed: `${id}-seed`, maxPlayers, minAp, registrationCloseAt }), phase: "DRAFT" };
      await env.DB.prepare("INSERT INTO tournaments (id, name, event_json, games_json, created_at) VALUES (?, ?, ?, ?, ?)").bind(
        id, name, JSON.stringify(event), "{}", Date.now(),
      ).run();
      return json({ id: event.id, name, phase: event.phase, maxPlayers: event.maxPlayers, minAp: event.minAp, registrationCloseAt: event.registrationCloseAt, entries: [], bracket: null, games: {} }, 201);
    }
    const adminTransMatch = request.method === "POST" && /^\/v1\/admin\/events\/[^/]+\/transition$/.exec(url.pathname);
    if (adminTransMatch) {
      const closed = adminGate();
      if (closed) return closed;
      if (!adminOk(request.headers.get("x-admin-key") ?? "")) return json({ error: "admin sign-in required" }, 401);
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const to = typeof body.to === "string" ? body.to : "";
      const phases: EventPhase[] = ["DRAFT", "ANNOUNCED", "REGISTRATION_OPEN", "LOCKED", "SEEDED", "LIVE", "COMPLETED", "CANCELLED"];
      if (!(phases as string[]).includes(to)) return json({ error: `unknown phase ${to}` }, 422);
      const row = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(decodeURIComponent(adminTransMatch[0].split("/")[4])).first<Record<string, unknown>>();
      if (!row) return json({ error: "unknown tournament" }, 404);
      let event = JSON.parse(row.event_json as string) as Championship;
      const games = JSON.parse(row.games_json as string) as Record<string, string[]>;
      try {
        if (to === "LOCKED") {
          if (event.entries.length < 2) return json({ error: "lock needs at least two entries" }, 422);
          event = lock(transitionEvent(event, to as EventPhase));
        } else {
          if (to === "LIVE" && !event.bracket) event = seedBracket(event);
          event = transitionEvent(event, to as EventPhase);
        }
      } catch (err) {
        return json({ error: (err as Error).message }, 422);
      }
      await env.DB.prepare("UPDATE tournaments SET event_json = ?, games_json = ? WHERE id = ?").bind(JSON.stringify(event), JSON.stringify(games), row.id as string).run();
      return json({
        id: event.id,
        name: row.name,
        phase: event.phase,
        entries: event.entries.map((e) => ({ leaderId: e.leaderId, lockedVersionId: e.lockedVersionId, registeredAt: e.registeredAt })),
        bracket: event.bracket,
        games,
      }, 200);
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
      let breedError: string | null = "portraits need META_IMAGE_KEY; set the secret first";
      if (hasKey("portrait", env)) {
        try {
          const art = await portraitFromEnv(env).generatePortrait({
            prompt: portraitPromptFor(`${name || "arena robot"}: ${concept || "arena fighter"}`),
          });
          portraitUrl = art.url;
          portraitStatus = "ready";
          breedError = null;
        } catch (err) {
          portraitUrl = null;
          portraitStatus = "failed";
          breedError = err instanceof Error ? err.message : "unknown image error";
        }
      }
      const id = mintId("agent");
      await env.DB.prepare(
        "INSERT INTO agents (id, leader_id, active_version_id, name, concept, portrait_url, portrait_status) VALUES (?, ?, NULL, ?, ?, ?, ?)",
      ).bind(id, me.id as string, name || null, concept || null, portraitUrl, portraitStatus).run();
      return json({ agentId: id, portraitUrl, portraitStatus, error: breedError }, 201);
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
        return json({ portraitUrl: target.portrait_url, portraitStatus: "ready", retried: false, error: null }, 200);
      }
      let portraitUrl: string | null = null;
      let portraitStatus = "faceless";
      let retryError: string | null = "portraits need META_IMAGE_KEY; set the secret first";
      if (hasKey("portrait", env)) {
        try {
          const art = await portraitFromEnv(env).generatePortrait({
            prompt: portraitPromptFor(`${(target.name as string) || "arena robot"}: ${(target.concept as string) || "arena fighter"}`),
          });
          portraitUrl = art.url;
          retryError = null;
          portraitStatus = "ready";
        } catch (err) {
          portraitUrl = null;
          portraitStatus = "failed";
          retryError = err instanceof Error ? err.message : "unknown image error";
        }
      }
      await env.DB.prepare("UPDATE agents SET portrait_url = ?, portrait_status = ? WHERE id = ?").bind(portraitUrl, portraitStatus, agentId).run();
      return json({ portraitUrl, portraitStatus, retried: true, error: retryError }, 200);
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
      if (prompt.trim().length > MAX_PROMPT) return json({ error: `prompt must stay under ${MAX_PROMPT} characters` }, 400);
      const versionId = mintId("v");
      const compiled = await providerFromEnv(env).compileStrategy({ prompt: prompt.trim(), agentVersionId: versionId });
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
    const deleteMatch = request.method === "DELETE" && /^\/v1\/agents\/[^/]+\/policies\/[^/]+$/.exec(url.pathname);
    if (deleteMatch) {
      try {
        const agentId = url.pathname.split("/")[3];
        const versionId = decodeURIComponent(deleteMatch[0].split("/")[5]);
        const target = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
        if (!target || target.leader_id !== me.id) return json({ error: "agent not found for this leader" }, 404);
        const version = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first<Record<string, unknown>>();
        if (!version || version.agent_id !== agentId) return json({ error: "unknown version for this agent" }, 404);
        if (target.active_version_id === versionId) return json({ error: "the active version fights on: install another first" }, 422);
        const bout = await env.DB.prepare("SELECT id FROM matches WHERE a_version = ? OR b_version = ? LIMIT 1").bind(versionId, versionId).first<Record<string, unknown>>();
        if (bout) return json({ error: "this version has fights: history keeps it" }, 422);
        const seated = await env.DB.prepare("SELECT id FROM tournaments WHERE event_json LIKE ? LIMIT 1").bind(`%${versionId}%`).first<Record<string, unknown>>();
        if (seated) return json({ error: "this version holds an event seat: it stays registered" }, 422);
        await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(versionId).run();
        return json({ deleted: true }, 200);
      } catch (err) {
        return json({ error: `server error: ${(err as Error).message}` }, 500);
      }
    }
    const renameMatch = request.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/[^/]+\/rename$/.exec(url.pathname);
    if (renameMatch) {
      try {
        const agentId = url.pathname.split("/")[3];
        const versionId = decodeURIComponent(renameMatch[0].split("/")[5]);
        const target = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
        if (!target || target.leader_id !== me.id) return json({ error: "agent not found for this leader" }, 404);
        const version = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first<Record<string, unknown>>();
        if (!version || version.agent_id !== agentId) return json({ error: "unknown version for this agent" }, 404);
        const body = await readBody(request);
        if (body === null) return json({ error: "bad json" }, 400);
        const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
        await env.DB.prepare("UPDATE versions SET label = ? WHERE id = ?").bind(label || null, versionId).run();
        return json({ versionId, label: label || null }, 200);
      } catch (err) {
        return json({ error: `server error: ${(err as Error).message}` }, 500);
      }
    }
    const forceMatch = request.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/[^/]+\/force-delete$/.exec(url.pathname);
    if (forceMatch) {
      try {
        const agentId = url.pathname.split("/")[3];
        const versionId = decodeURIComponent(forceMatch[0].split("/")[5]);
        const target = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
        if (!target || target.leader_id !== me.id) return json({ error: "agent not found for this leader" }, 404);
        const version = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first<Record<string, unknown>>();
        if (!version || version.agent_id !== agentId) return json({ error: "unknown version for this agent" }, 404);
        const { results: seats } = await env.DB.prepare("SELECT event_json FROM tournaments WHERE event_json LIKE ?").bind(`%${versionId}%`).all<Record<string, unknown>>();
        for (const s of seats) {
          try {
            const phase = (JSON.parse(s.event_json as string) as { phase: string }).phase;
            if (["REGISTRATION_OPEN", "LOCKED", "SEEDED", "LIVE"].includes(phase)) {
              return json({ error: "this version holds a live event seat: it stays registered" }, 422);
            }
          } catch (err) {
            if (err instanceof Error && err.message.startsWith("this version holds")) throw err;
          }
        }
        await env.DB.prepare("DELETE FROM versions WHERE id = ?").bind(versionId).run();
        let clearedActive = false;
        if (target.active_version_id === versionId) {
          await env.DB.prepare("UPDATE agents SET active_version_id = NULL WHERE id = ?").bind(agentId).run();
          clearedActive = true;
        }
        return json({ deleted: true, clearedActive }, 200);
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
    const analysisMatch = request.method === "POST" && /^\/v1\/battles\/[^/]+\/analysis$/.exec(url.pathname);
    if (analysisMatch) {
      if (limited(analysisHits, me.id as string, 60_000, 10)) return json({ error: "rate limited, retry later" }, 429);
      const row = await env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(decodeURIComponent(analysisMatch[0].split("/")[3])).first<Record<string, unknown>>();
      if (!row) return json({ error: "unknown match" }, 404);
      const chips = JSON.parse((row.chips_json as string) ?? '{"a":{},"b":{}}') as { a: Record<string, number>; b: Record<string, number> };
      const telemetry = {
        matchId: row.id as string,
        winner: row.winner as string,
        ticks: row.ticks as number,
        checksum: row.checksum as string,
        seed: row.seed as string,
        rated: (row.rated as number) === 1,
        chipsA: chips.a ?? {},
        chipsB: chips.b ?? {},
      };
      const explanation = await explainerFromEnv(env).explainBattle(telemetry);
      return json({ ...telemetry, explanation }, 200);
    }
    if (request.method === "POST" && url.pathname === "/v1/lab/ab") {
      if (limited(labHits, me.id as string, 60_000, 6)) return json({ error: "rate limited, retry later" }, 429);
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const agentId = typeof body.agentId === "string" ? body.agentId : "";
      const promptA = typeof body.promptA === "string" ? body.promptA : "";
      const promptB = typeof body.promptB === "string" ? body.promptB : "";
      const bouts = Math.min(20, Math.max(4, Math.floor(typeof body.bouts === "number" ? body.bouts : 10)));
      if (!agentId || !promptA || !promptB) return json({ error: "agentId, promptA, and promptB are required" }, 400);
      if (promptA.trim().length > MAX_PROMPT || promptB.trim().length > MAX_PROMPT) {
        return json({ error: `each prompt must stay under ${MAX_PROMPT} characters` }, 400);
      }
      const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
      if (!agent || agent.leader_id !== me.id) return json({ error: "agent not found for this leader" }, 404);
      const runId = mintId("lab");
      const drafts: string[] = [];
      for (const prompt of [promptA.trim(), promptB.trim()]) {
        const versionId = mintId("v");
        const compiled = await providerFromEnv(env).compileStrategy({ prompt, agentVersionId: versionId });
        if (!compiled.policy) return json({ error: `draft failed: ${compiled.errors.join("; ")}` }, 422);
        const sha = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(compiled.policy)));
        const hex = [...new Uint8Array(sha)].map((x) => x.toString(16).padStart(2, "0")).join("");
        await env.DB.prepare(
          "INSERT INTO versions (id, agent_id, policy_json, sha, created_at, provider, is_mock, tokens, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(versionId, agentId, JSON.stringify(compiled.policy), hex, Date.now(), compiled.provider, compiled.isMock ? 1 : 0, compiled.promptTokens, compiled.latencyMs).run();
        drafts.push(versionId);
      }
      const policies: AgentPolicy[] = [];
      for (const draft of drafts) {
        const v = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(draft).first<Record<string, unknown>>();
        policies.push(JSON.parse((v as Record<string, unknown>).policy_json as string) as AgentPolicy);
      }
      let winsA = 0;
      let winsB = 0;
      let drawsA = 0;
      let drawsB = 0;
      const now = Date.now();
      for (let i = 0; i < bouts; i += 1) {
        const outA = fightPolicies(policies[0], BENCH_POLICY, `${runId}-a-${i}`);
        await env.DB.prepare(
          "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        ).bind(`${runId}-a-${i}`, `${runId}-a-${i}`, drafts[0], "benchmark-v1", outA.winner, outA.ticks, outA.checksum, now, JSON.stringify({ a: outA.chipsA, b: outA.chipsB })).run();
        if (outA.winner === "A") winsA += 1;
        else if (outA.winner === "DRAW") drawsA += 1;
        const outB = fightPolicies(policies[1], BENCH_POLICY, `${runId}-b-${i}`);
        await env.DB.prepare(
          "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        ).bind(`${runId}-b-${i}`, `${runId}-b-${i}`, drafts[1], "benchmark-v1", outB.winner, outB.ticks, outB.checksum, now, JSON.stringify({ a: outB.chipsA, b: outB.chipsB })).run();
        if (outB.winner === "A") winsB += 1;
        else if (outB.winner === "DRAW") drawsB += 1;
      }
      const decisive = winsA + winsB;
      let verdict = "too close to call";
      if (bouts < 10) verdict = "sample too small — run 10 or more bouts before trusting the gap";
      else if (decisive > 0 && Math.max(winsA, winsB) / decisive >= 0.7) verdict = winsA > winsB ? "A leads" : "B leads";
      return json({ runId, versionA: drafts[0], versionB: drafts[1], bouts, winsA, winsB, drawsA, drawsB, verdict }, 201);
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
    const cupView = (name: string, event: Championship, games: Record<string, string[]>): Record<string, unknown> => ({
      id: event.id,
      name,
      phase: event.phase,
      maxPlayers: event.maxPlayers,
      minAp: event.minAp,
      registrationCloseAt: event.registrationCloseAt,
      entries: event.entries.map((e) => ({ leaderId: e.leaderId, lockedVersionId: e.lockedVersionId, registeredAt: e.registeredAt })),
      bracket: event.bracket,
      games,
    });
    const readEvent = async (eventId: string): Promise<{ name: string; event: Championship; games: Record<string, string[]> } | null> => {
      const row = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(eventId).first<Record<string, unknown>>();
      if (!row) return null;
      return {
        name: row.name as string,
        event: JSON.parse(row.event_json as string) as Championship,
        games: JSON.parse(row.games_json as string) as Record<string, string[]>,
      };
    };
    const bootstrapCup = async (): Promise<void> => {
      const row = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(CUP_ID).first<Record<string, unknown>>();
      if (row) return;
      const now = Date.now();
      const fresh = createEvent({ id: CUP_ID, seed: "kickoff-s1", maxPlayers: 8, minAp: 0, registrationCloseAt: now + 30 * 24 * 60 * 60 * 1000 });
      await env.DB.prepare("INSERT INTO tournaments (id, name, event_json, games_json, created_at) VALUES (?, ?, ?, ?, ?)").bind(
        CUP_ID, "S1 Kickoff Cup", JSON.stringify(fresh), "{}", now,
      ).run();
    };
    const saveEvent = async (eventId: string, event: Championship, games: Record<string, string[]>): Promise<void> => {
      await env.DB.prepare("UPDATE tournaments SET event_json = ?, games_json = ? WHERE id = ?").bind(JSON.stringify(event), JSON.stringify(games), eventId).run();
    };
    if (request.method === "GET" && url.pathname === "/v1/tournaments") {
      await bootstrapCup();
      const { results: rows } = await env.DB.prepare("SELECT * FROM tournaments ORDER BY created_at ASC").bind().all<Record<string, unknown>>();
      return json({
        tournaments: rows.map((row) => {
          const event = JSON.parse(row.event_json as string) as Championship;
          return { id: row.id, name: row.name, phase: event.phase, entries: event.entries.length, maxPlayers: event.maxPlayers };
        }),
      });
    }
    const tournMatch = request.method === "GET" && /^\/v1\/tournaments\/[^/]+$/.exec(url.pathname);
    if (tournMatch) {
      await bootstrapCup();
      const found = await readEvent(url.pathname.split("/")[3]);
      if (!found) return json({ error: "unknown tournament" }, 404);
      return json(cupView(found.name, found.event, found.games));
    }
    const regMatch = request.method === "POST" && /^\/v1\/tournaments\/[^/]+\/register$/.test(url.pathname);
    if (regMatch) {
      try {
      const eventId = url.pathname.split("/")[3];
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const versionId = typeof body.versionId === "string" ? body.versionId : "";
      if (!versionId) return json({ error: "versionId is required" }, 400);
      await bootstrapCup();
      const found = await readEvent(eventId);
      if (!found) return json({ error: "unknown tournament" }, 404);
      let event = found.event;
      const games = found.games;
      const name = found.name;
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
        if (eventId !== CUP_ID) {
          await saveEvent(eventId, event, games);
          return json({ entered: true, started, event: cupView(name, event, games) }, 201);
        }
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
      await saveEvent(eventId, event, games);
      return json({ entered: true, started, event: cupView(name, event, games) }, 201);
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
    const repMatch = /^\/v1\/leaders\/[^/]+\/report$/.exec(url.pathname);
    if (request.method === "POST" && repMatch) {
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const handle = decodeURIComponent(repMatch[0].split("/")[3]);
      const found = await env.DB.prepare("SELECT id FROM leaders WHERE handle = ?").bind(handle).first<Record<string, unknown>>();
      if (!found) return json({ error: "unknown handle" }, 404);
      const reason = typeof body.reason === "string" ? body.reason.slice(0, 280) : "";
      if (!reason) return json({ error: "reason is required" }, 400);
      await env.DB.prepare("INSERT INTO reports (id, handle, reason, created_at) VALUES (?, ?, ?, ?)").bind(mintId("r"), handle, reason, Date.now()).run();
      return json({ received: true }, 200);
    }
    if (request.method === "GET" && url.pathname === "/v1/seasons") {
      const { results: seasons } = await env.DB.prepare("SELECT * FROM season_archives ORDER BY closed_at DESC").bind().all<Record<string, unknown>>();
      return json({
        seasons: seasons.map((r) => ({
          seasonId: r.season_id,
          closedAt: r.closed_at,
          ...((JSON.parse(r.archive_json as string) as object) ?? {}),
        })),
      }, 200);
    }
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
