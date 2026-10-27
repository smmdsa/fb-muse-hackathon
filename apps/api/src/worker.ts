// Cloudflare Worker entry. Full API on D1: auth, publish, fights, replay.

import { providerFromEnv } from "@agent-wars/ai-provider";
import { BENCH_POLICY, fightPolicies } from "@agent-wars/battle-core";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { validatePolicy } from "@agent-wars/behavior-dna";
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
    headers: { "content-type": "application/json" },
  });
}

let counter = 0;

// IDs stay unique per isolate without any outside input.
function mintId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
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
  if (!a || (match.b_version !== "benchmark-v1" && !b)) {
    return json({ error: "replay unavailable: a version is gone" }, 410);
  }
  const pa = JSON.parse(a.policy_json as string) as AgentPolicy;
  const pb = b ? (JSON.parse(b.policy_json as string) as AgentPolicy) : BENCH_POLICY;
  const again = fightPolicies(pa, pb, match.seed as string);
  return json({ stored: match, recomputed: { winner: again.winner, ticks: again.ticks, checksum: again.checksum }, identical: again.checksum === match.checksum });
}

async function pay(
  env: WorkerEnv,
  leaderId: string,
  matchKey: string,
  side: string,
  kind: "win" | "loss" | "no-contest",
): Promise<number> {
  const row = await env.DB.prepare("SELECT * FROM leaders WHERE id = ?").bind(leaderId).first<Record<string, unknown>>();
  if (!row) return 0;
  const wallet = createWallet(leaderId, 0);
  wallet.ac = row.ac as number;
  wallet.rp = row.rp as number;
  const keys = await env.DB.prepare("SELECT key FROM wallet_keys WHERE wallet_id = ?").bind(leaderId).all<{ key: string }>();
  for (const k of keys.results) wallet.keys.add(k.key);
  const key = `${matchKey}-${side}`;
  const before = wallet.txns.length;
  const res = earnAc(wallet, { key, kind, suspicious: false, now: Date.now() });
  await env.DB.prepare("INSERT OR IGNORE INTO wallet_keys (wallet_id, key) VALUES (?, ?)").bind(leaderId, key).run();
  for (const t of wallet.txns.slice(before)) {
    await env.DB.prepare(
      "INSERT INTO wallet_txns (wallet_id, idem_key, currency, delta, reason, at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(leaderId, t.idempotencyKey, t.currency, t.delta, t.reason, t.at).run();
  }
  await env.DB.prepare("UPDATE leaders SET ac = ?, rp = ? WHERE id = ?").bind(wallet.ac, wallet.rp, leaderId).run();
  return res.credited;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    // The viewer is a static asset. Anything outside /v1/ serves the game.
    if (!url.pathname.startsWith("/v1/")) return env.ASSETS.fetch(request);
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
      const id = mintId("leader");
      const token = `demo_${id}_${Math.random().toString(36).slice(2)}`;
      await env.DB.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").bind(id, handle, token).run();
      return json({ token, leaderId: id });
    }
    const me = await bearer(request, env);
    if (!me) return json({ error: "bearer token is required: call POST /v1/auth/session first" }, 401);
    if (request.method === "GET" && url.pathname === "/v1/me") {
      const agent = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(me.id as string).first<Record<string, unknown>>();
      return json({ leader: me, agent });
    }
    if (request.method === "POST" && url.pathname === "/v1/agents") {
      const exists = await env.DB.prepare("SELECT * FROM agents WHERE leader_id = ?").bind(me.id as string).first();
      if (exists) return json({ error: "one agent per leader in this phase" }, 409);
      const id = mintId("agent");
      await env.DB.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, NULL)").bind(id, me.id as string).run();
      return json({ agentId: id }, 201);
    }
    const compileMatch = request.method === "POST" && /^\/v1\/agents\/[^/]+\/policies\/compile$/.test(url.pathname);
    if (compileMatch) {
      const agentId = url.pathname.split("/")[3];
      const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(agentId).first<Record<string, unknown>>();
      if (!agent || agent.leader_id !== me.id) return json({ error: "agent not found for this leader" }, 404);
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      if (!prompt) return json({ error: "prompt is required" }, 400);
      const versionId = mintId("v");
      const compiled = await providerFromEnv(env).compileStrategy({ prompt, agentVersionId: versionId });
      if (!compiled.policy) return json({ error: "draft failed validation", errors: compiled.errors }, 422);
      const check = validatePolicy(compiled.policy);
      if (!check.ok) return json({ error: "draft failed validation", errors: check.errors }, 422);
      const sha = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(compiled.policy)));
      const hex = [...new Uint8Array(sha)].map((x) => x.toString(16).padStart(2, "0")).join("");
      await env.DB.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").bind(
        versionId, agentId, JSON.stringify(compiled.policy), hex, Date.now(),
      ).run();
      await env.DB.prepare("UPDATE agents SET active_version_id = ? WHERE id = ?").bind(versionId, agentId).run();
      return json({ versionId }, 201);
    }
    if (request.method === "POST" && url.pathname === "/v1/matches/training") {
      const body = await readBody(request);
      if (body === null) return json({ error: "bad json" }, 400);
      const versionId = typeof body.versionId === "string" ? body.versionId : "";
      const seed = typeof body.seed === "string" && body.seed ? body.seed : `t-${Date.now().toString(36)}`;
      if (!versionId) return json({ error: "versionId is required" }, 400);
      const v = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(versionId).first<Record<string, unknown>>();
      if (!v) return json({ error: "unknown version" }, 404);
      const out = fightPolicies(JSON.parse(v.policy_json as string) as AgentPolicy, BENCH_POLICY, seed);
      const id = mintId("m");
      await env.DB.prepare(
        "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
      ).bind(id, seed, versionId, "benchmark-v1", out.winner, out.ticks, out.checksum, Date.now()).run();
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
      if (dup) return json({ ...dup, deduped: true }, 201);
      const a = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(aVersionId).first<Record<string, unknown>>();
      const b = await env.DB.prepare("SELECT * FROM versions WHERE id = ?").bind(bVersionId).first<Record<string, unknown>>();
      if (!a || !b) return json({ error: "unknown version" }, 404);
      const aAgent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(a.agent_id as string).first<Record<string, unknown>>();
      const bAgent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(b.agent_id as string).first<Record<string, unknown>>();
      if (!aAgent || !bAgent) return json({ error: "unknown agent" }, 404);
      if (aAgent.leader_id === bAgent.leader_id) return json({ error: "self match denied" }, 422);
      const out = fightPolicies(
        JSON.parse(a.policy_json as string) as AgentPolicy,
        JSON.parse(b.policy_json as string) as AgentPolicy,
        seed,
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
      let applied;
      try {
        applied = applyRanked(ledger, {
          matchId: key,
          leaderA: aAgent.leader_id as string,
          leaderB: bAgent.leader_id as string,
          winner: winner as "A" | "B" | "DRAW",
          rated: true,
        });
      } catch (err) {
        return json({ error: (err as Error).message }, 409);
      }
      for (const [id, st] of ledger.ratings) {
        await env.DB.prepare("UPDATE leaders SET rating_milli = ?, ap = ?, placement = ?, placed = ? WHERE id = ?").bind(
          st.ratingMilli, st.ap, st.placementGames, st.placed ? 1 : 0, id,
        ).run();
      }
      const paidA = await pay(env, aAgent.leader_id as string, key, "a", winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest");
      const paidB = await pay(env, bAgent.leader_id as string, key, "b", winner === "B" ? "win" : winner === "A" ? "loss" : "no-contest");
      await env.DB.prepare(
        "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, delta_a, delta_b, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
      ).bind(key, seed, aVersionId, bVersionId, winner, out.ticks, out.checksum, applied.deltaA, applied.deltaB, Date.now()).run();
      return json({ matchId: key, winner, ticks: out.ticks, checksum: out.checksum, deltaA: applied.deltaA, deltaB: applied.deltaB, paidA, paidB }, 201);
    }
    return json({ error: "unknown route" }, 404);
  },
};
