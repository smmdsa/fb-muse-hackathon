// Arena 1v1 mode wiring. New fights run mode=arena (best of 3).
// Old rows keep their sim: moba rows replay v2, rows without a
// mode read as duel and serve v1.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";
import entry from "../src/worker.ts";
import { ARENA_MOBA, BENCH_POLICY, fightPolicies } from "@agent-wars/battle-core";
import { applyRanked, createLedger, ratingFor } from "@agent-wars/ranking";

let call;
let store;
let keys = {};

async function leader(handle, prompt) {
  const s = await call("POST", "/v1/auth/session", { handle });
  const a = await call("POST", "/v1/agents", {}, s.json.token);
  const v = await call("POST", `/v1/agents/${a.json.agentId}/policies/compile`, { prompt }, s.json.token);
  await call("POST", `/v1/agents/${a.json.agentId}/policies/install`, { versionId: v.json.versionId }, s.json.token);
  return { token: s.json.token, version: v.json.versionId, agentId: a.json.agentId };
}

before(() => {
  store = openStore(":memory:");
  call = makeCaller(buildRouter({ store }));
});

describe("arena fights and replays", () => {
  it("provisions two leaders", async () => {
    keys.a = await leader("arena-alpha", "rush them down up close");
    keys.b = await leader("arena-bravo", "evade and stay far away");
    assert.ok(keys.a.version);
    assert.ok(keys.b.version);
  });

  it("training stores an arena row with a v3 checksum", async () => {
    const r = await call("POST", "/v1/matches/training", { versionId: keys.a.version, seed: "arena-t1" }, keys.a.token);
    assert.equal(r.status, 201);
    assert.equal(r.json.mode, "arena");
    assert.ok(r.json.checksum);
    assert.ok(typeof r.json.chipsA === "object");
    assert.ok(typeof r.json.score.A === "number");
    assert.ok(r.json.rounds.length === 2 || r.json.rounds.length === 3);
    const row = store.db.prepare("SELECT * FROM matches WHERE id = ?").get(r.json.matchId);
    assert.equal(row.mode, "arena-bo3");
    keys.trainId = r.json.matchId;
  });

  it("the replay route re-simulates and reports identical", async () => {
    const replay = await call("GET", `/v1/matches/${keys.trainId}/replay`, null, keys.a.token);
    assert.equal(replay.status, 200);
    assert.deepEqual(Object.keys(replay.json).sort(), ["agents", "identical", "now", "recomputed", "replay", "startedAt", "stored"]);
    assert.equal(replay.json.startedAt, replay.json.stored.created_at);
    assert.ok(replay.json.now >= replay.json.startedAt);
    assert.equal(replay.json.identical, true);
    assert.equal(replay.json.recomputed.checksum, replay.json.stored.checksum);
    const v3 = replay.json.replay;
    assert.equal(v3.version, 3);
    assert.equal(v3.mode, "arena");
    assert.equal(typeof v3.timeSec, "number");
    assert.deepEqual(Object.keys(v3.score).sort(), ["A", "B"]);
    assert.ok(v3.rounds.length === 2 || v3.rounds.length === 3);
    assert.equal(v3.rounds[0].round, 1);
    assert.ok(v3.rounds[0].frames.length > 10);
    assert.equal(v3.rounds[0].frames[0].t, 0);
    assert.equal(v3.rounds[0].frames[0].ahp, 100);
    assert.equal(v3.rounds[0].frames[0].bhp, 100);
    assert.ok(Array.isArray(v3.rounds[0].events));
    assert.equal(v3.checksum, replay.json.stored.checksum);
  });

  it("replay names both agents, human and benchmark", async () => {
    const replay = await call("GET", `/v1/matches/${keys.trainId}/replay`, null, keys.a.token);
    assert.equal(replay.status, 200);
    const me = await call("GET", "/v1/me", null, keys.a.token);
    assert.equal(replay.json.agents.a.name, me.json.agent.name);
    assert.equal(replay.json.agents.a.portrait_url, me.json.agent.portrait_url);
    assert.equal(replay.json.agents.b.name, "BENCHMARK");
    assert.equal(replay.json.agents.b.portrait_url, null);
  });

  it("one ranked fixture settles with correct AP deltas", async () => {
    const la = store.db.prepare("SELECT * FROM leaders WHERE token = ?").get(keys.a.token);
    const lb = store.db.prepare("SELECT * FROM leaders WHERE token = ?").get(keys.b.token);
    const r = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: keys.a.version, bVersionId: keys.b.version, seed: "arena-r1", key: "arena-r1" },
      keys.a.token,
    );
    assert.equal(r.status, 201);
    assert.equal(r.json.mode, "arena");
    assert.ok(r.json.rounds.length === 2 || r.json.rounds.length === 3);
    // The oracle replays the same rated result on a scratch ledger.
    const ledger = createLedger("local-s1");
    for (const row of [la, lb]) {
      const s = ratingFor(ledger, row.id);
      s.ratingMilli = row.rating_milli;
      s.placementGames = row.placement;
      s.placed = row.placed === 1;
    }
    const want = applyRanked(ledger, {
      matchId: "arena-r1-oracle",
      leaderA: la.id,
      leaderB: lb.id,
      winner: r.json.winner,
      rated: true,
    });
    assert.equal(r.json.deltaA, want.deltaA);
    assert.equal(r.json.deltaB, want.deltaB);
    const row = store.db.prepare("SELECT * FROM matches WHERE id = ?").get("arena-r1");
    assert.equal(row.mode, "arena-bo3");
    assert.equal(row.delta_a, want.deltaA);
    assert.equal(row.delta_b, want.deltaB);
    const afterA = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(la.id);
    const afterB = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(lb.id);
    assert.equal(afterA.ap, want.apA);
    assert.equal(afterB.ap, want.apB);
    assert.equal(afterA.placement, 1);
    // Payouts follow the duel table per result: win 25, loss 10, draw 0.
    const pay = (mine, foe) => (r.json.winner === mine ? 25 : r.json.winner === foe ? 10 : 0);
    assert.equal(r.json.paidA, pay("A", "B"));
    assert.equal(r.json.paidB, pay("B", "A"));
  });

  it("repeats score and rounds on an idempotent ranked retry", async () => {
    const first = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: keys.a.version, bVersionId: keys.b.version, seed: "arena-r1-retry", key: "arena-r1-retry" },
      keys.a.token,
    );
    assert.equal(first.status, 201);
    assert.ok(first.json.rounds.length === 2 || first.json.rounds.length === 3);
    const again = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: keys.a.version, bVersionId: keys.b.version, seed: "arena-r1-retry", key: "arena-r1-retry" },
      keys.a.token,
    );
    assert.equal(again.status, 201);
    assert.equal(again.json.deduped, true);
    assert.equal(again.json.mode, "arena");
    assert.deepEqual(again.json.score, first.json.score);
    assert.deepEqual(again.json.rounds, first.json.rounds);
    assert.equal(again.json.checksum, first.json.checksum);
  });

  it("reads a legacy row without a mode as duel and serves v1", async () => {
    const rush = {
      schemaVersion: 1,
      agentVersionId: "v-duel-a",
      dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
      rules: [
        { id: "close", when: { operand: "distFoe", op: "lt", value: 8 }, move: "APPROACH", fire: true },
        { id: "far", when: { operand: "distFoe", op: "gte", value: 8 }, move: "APPROACH" },
      ],
    };
    const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(keys.a.agentId);
    for (const id of ["v-duel-a", "v-duel-b"]) {
      store.db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id, agent.id, JSON.stringify({ ...rush, agentVersionId: id }), "legacy", Date.now(),
      );
    }
    const out = fightPolicies(rush, rush, "legacy-duel-1");
    store.db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    ).run("m-legacy", "legacy-duel-1", "v-duel-a", "v-duel-b", out.winner, out.ticks, out.checksum, Date.now(), "{}");
    const stored = store.db.prepare("SELECT mode FROM matches WHERE id = ?").get("m-legacy");
    assert.equal(stored.mode, "duel");
    const replay = await call("GET", "/v1/matches/m-legacy/replay", null, keys.a.token);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.identical, true);
    assert.equal("version" in replay.json.replay, false);
    assert.equal("mode" in replay.json.replay, false);
    assert.ok(replay.json.replay.frames.length > 10);
    assert.equal(typeof replay.json.replay.frames[0].ax, "number");
  });

  it("reads a legacy moba-v2 row and serves v2", async () => {
    const rush = {
      schemaVersion: 1,
      agentVersionId: "v-moba-a",
      dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
      rules: [
        { id: "close", when: { operand: "distFoe", op: "lt", value: 8 }, move: "APPROACH", fire: true },
        { id: "far", when: { operand: "distFoe", op: "gte", value: 8 }, move: "APPROACH" },
      ],
    };
    const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(keys.a.agentId);
    for (const id of ["v-moba-a", "v-moba-b"]) {
      store.db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id, agent.id, JSON.stringify({ ...rush, agentVersionId: id }), "legacy", Date.now(),
      );
    }
    const out = fightPolicies(rush, rush, "legacy-moba-1", ARENA_MOBA);
    store.db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json, mode) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'moba-v2')",
    ).run("m-legacy-moba", "legacy-moba-1", "v-moba-a", "v-moba-b", out.winner, out.ticks, out.checksum, Date.now(), "{}");
    const replay = await call("GET", "/v1/matches/m-legacy-moba/replay", null, keys.a.token);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.identical, true);
    assert.equal(replay.json.replay.version, 2);
    assert.equal(replay.json.replay.mode, "moba");
  });

  it("lists history with a mode per bout", async () => {
    const me = await call("GET", "/v1/me", null, keys.a.token);
    const dash = await call("GET", `/v1/agents/${me.json.agent.id}/dashboard`, null, keys.a.token);
    const train = dash.json.history.find((h) => h.matchId === keys.trainId);
    assert.equal(train.mode, "arena");
    const legacy = dash.json.history.find((h) => h.matchId === "m-legacy");
    assert.equal(legacy.mode, "duel");
    const lane = dash.json.history.find((h) => h.matchId === "m-legacy-moba");
    assert.equal(lane.mode, "moba");
  });
});

describe("arena worker mirror", () => {
  // A D1-shaped shim over node:sqlite. Same SQL, same call shape.
  const shim = (db) => ({
    prepare: (query) => ({
      bind: (...values) => ({
        first: async () => db.prepare(query).get(...values) ?? null,
        all: async () => ({ results: db.prepare(query).all(...values) }),
        run: async () => db.prepare(query).run(...values),
      }),
    }),
    batch: async (stmts) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  });
  const assetsStub = {
    fetch: async () => new Response("shell", { headers: { "content-type": "text/html" } }),
  };
  const rush = {
    schemaVersion: 1,
    agentVersionId: "wv-a",
    dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
    rules: [
      { id: "close", when: { operand: "distFoe", op: "lt", value: 8 }, move: "APPROACH", fire: true },
      { id: "far", when: { operand: "distFoe", op: "gte", value: 8 }, move: "APPROACH" },
    ],
  };
  let db;
  let wenv;
  let wcall;

  before(() => {
    db = new DatabaseSync(":memory:");
    for (const m of ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0010_reports", "0011_version_labels", "0012_match_mode", "0013_ai_cooldowns"]) {
      db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
    }
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("wl-a", "walpha", "wt-a");
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run("wl-b", "wbravo", "wt-b");
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("wa-a", "wl-a", "wv-a");
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("wa-b", "wl-b", "wv-b");
    for (const [id, agent] of [["wv-a", "wa-a"], ["wv-b", "wa-b"]]) {
      db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id, agent, JSON.stringify({ ...rush, agentVersionId: id }), "shim", Date.now(),
      );
    }
    wenv = { DB: shim(db), ASSETS: assetsStub };
    wcall = (method, path, body, token) => entry.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
      wenv,
    ).then(async (r) => ({ status: r.status, json: await r.json() }));
  });

  it("runs training as arena and replays v3 identically", async () => {
    const t = await wcall("POST", "/v1/matches/training", { versionId: "wv-a", seed: "wm-t1" }, "wt-a");
    assert.equal(t.status, 201);
    assert.equal(t.json.mode, "arena");
    assert.ok(t.json.rounds.length === 2 || t.json.rounds.length === 3);
    const row = db.prepare("SELECT mode FROM matches WHERE id = ?").get(t.json.matchId);
    assert.equal(row.mode, "arena-bo3");
    const replay = await wcall("GET", `/v1/matches/${t.json.matchId}/replay`, null, "wt-a");
    assert.equal(replay.status, 200);
    assert.equal(replay.json.identical, true);
    assert.equal(replay.json.replay.version, 3);
    assert.equal(replay.json.replay.mode, "arena");
    assert.equal(replay.json.replay.checksum, replay.json.stored.checksum);
  });

  it("settles ranked as arena and replays v3 identically", async () => {
    const r = await wcall("POST", "/v1/matches/ranked", { aVersionId: "wv-a", bVersionId: "wv-b", seed: "wm-r1", key: "wm-r1" }, "wt-a");
    assert.equal(r.status, 201);
    assert.equal(r.json.mode, "arena");
    assert.equal(r.json.deltaA + r.json.deltaB, 0);
    const row = db.prepare("SELECT * FROM matches WHERE id = ?").get("wm-r1");
    assert.equal(row.mode, "arena-bo3");
    assert.equal(row.rated, 1);
    const replay = await wcall("GET", "/v1/matches/wm-r1/replay", null, "wt-a");
    assert.equal(replay.status, 200);
    assert.equal(replay.json.identical, true);
    assert.equal(replay.json.replay.version, 3);
  });

  it("repeats score and rounds on a ranked retry", async () => {
    const first = await wcall("POST", "/v1/matches/ranked", { aVersionId: "wv-a", bVersionId: "wv-b", seed: "wm-r1-retry", key: "wm-r1-retry" }, "wt-a");
    assert.equal(first.status, 201);
    const again = await wcall("POST", "/v1/matches/ranked", { aVersionId: "wv-a", bVersionId: "wv-b", seed: "wm-r1-retry", key: "wm-r1-retry" }, "wt-a");
    assert.equal(again.status, 201);
    assert.equal(again.json.deduped, true);
    assert.deepEqual(again.json.score, first.json.score);
    assert.deepEqual(again.json.rounds, first.json.rounds);
  });

  it("serves v1 for a legacy duel row", async () => {
    const out = fightPolicies(rush, BENCH_POLICY, "wm-legacy-1");
    db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    ).run("wm-legacy", "wm-legacy-1", "wv-a", "benchmark-v1", out.winner, out.ticks, out.checksum, Date.now(), "{}");
    const replay = await wcall("GET", "/v1/matches/wm-legacy/replay", null, "wt-a");
    assert.equal(replay.status, 200);
    assert.equal(replay.json.identical, true);
    assert.equal("version" in replay.json.replay, false);
  });
});

it("selects the arena map for new records and keeps history for old ones", async () => {
  const { battleConfigFor, matchMode } = await import('../src/flow.ts');
  assert.equal(battleConfigFor(matchMode({ mode: 'arena-bo3' }), 'arena-bo3').mode, 'arena');
  assert.equal(battleConfigFor(matchMode({ mode: 'moba' }), 'moba').rulesetVersion ?? 1, 1);
  assert.equal(battleConfigFor(matchMode({ mode: 'moba-v2' }), 'moba-v2').rulesetVersion, 2);
});
