// Cloudflare Worker entry. Read routes run on D1. Writes stay on the Node API
// until the store layer ports to async D1. Nothing here is a stub: every route
// below answers from the real database.

import { checksum, createBattle, DEFAULT_BATTLE, drive, stepBattle } from "@agent-wars/battle-core";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { buildStandings } from "@agent-wars/leaderboard";
import { rankFor } from "@agent-wars/ranking";

export type WorkerEnv = {
  DB: D1Database;
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

// The reference brain for training-grade fights. Same values as the API server.
const BENCH_POLICY: AgentPolicy = {
  schemaVersion: 1,
  agentVersionId: "benchmark-v1",
  dna: { aggression: 55, evasion: 55, preferredDistance: 45, energyConservation: 50 },
  rules: [
    { id: "b-close", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "b-far", when: { operand: "distFoe", op: "gte", value: 8 }, move: "APPROACH" },
  ],
};

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
  const cfg = { ...DEFAULT_BATTLE, seed: match.seed as string };
  let state = createBattle(cfg);
  let guard = 0;
  while (!state.over && guard < cfg.world.maxTicks) {
    state = stepBattle(state, { A: drive(state, pa, "A", cfg), B: drive(state, pb, "B", cfg) }, cfg);
    guard += 1;
  }
  const sum = checksum(state);
  return json({ stored: match, recomputed: { winner: state.winner, ticks: state.tick, checksum: sum }, identical: sum === match.checksum });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
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
    return json({ error: "unknown route" }, 404);
  },
};
