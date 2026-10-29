// MOBA mode wiring. Spec sections 8-10, 14 and checks T3.1-T3.3.
// New fights run mode=moba. Old rows without a mode read as duel.
// The replay route serves v2 for moba rows and v1 for duel rows.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";
import entry from "../src/worker.ts";
import { BENCH_POLICY, fightPolicies } from "@agent-wars/battle-core";
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

describe("moba fights and replays", () => {
  it("provisions two leaders", async () => {
    keys.a = await leader("moba-alpha", "rush them down up close");
    keys.b = await leader("moba-bravo", "evade and stay far away");
    assert.ok(keys.a.version);
    assert.ok(keys.b.version);
  });

  it("T3.1: training stores a moba row with a v2 checksum", async () => {
    const r = await call("POST", "/v1/matches/training", { versionId: keys.a.version, seed: "moba-t1" }, keys.a.token);
    assert.equal(r.status, 201);
    assert.equal(r.json.mode, "moba");
    assert.ok(r.json.checksum);
    assert.ok(typeof r.json.chipsA === "object");
    const row = store.db.prepare("SELECT * FROM matches WHERE id = ?").get(r.json.matchId);
    assert.equal(row.mode, "moba");
    keys.trainId = r.json.matchId;
  });

  it("T3.1: the replay route re-simulates and reports identical", async () => {
    const replay = await call("GET", `/v1/matches/${keys.trainId}/replay`, null, keys.a.token);
    assert.equal(replay.status, 200);
    assert.deepEqual(Object.keys(replay.json).sort(), ["agents", "identical", "now", "recomputed", "replay", "startedAt", "stored"]);
    assert.equal(replay.json.startedAt, replay.json.stored.created_at);
    assert.ok(replay.json.now >= replay.json.startedAt);
    assert.equal(replay.json.identical, true);
    assert.equal(replay.json.recomputed.checksum, replay.json.stored.checksum);
    const v2 = replay.json.replay;
    assert.equal(v2.version, 2);
    assert.equal(v2.mode, "moba");
    assert.equal(typeof v2.timeSec, "number");
    assert.equal(v2.structures.length, 12);
    assert.ok(v2.frames.length > 10);
    assert.equal(v2.frames[0].t, 0);
    assert.ok(Array.isArray(v2.frames[0].minions));
    assert.ok(Array.isArray(v2.frames[0].structs));
    assert.ok(v2.frames[0].builds === null || typeof v2.frames[0].builds === "object");
    assert.ok(Array.isArray(v2.events));
    assert.equal(v2.checksum, replay.json.stored.checksum);
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

  it("T3.3: one ranked fixture settles with correct AP deltas", async () => {
    const la = store.db.prepare("SELECT * FROM leaders WHERE token = ?").get(keys.a.token);
    const lb = store.db.prepare("SELECT * FROM leaders WHERE token = ?").get(keys.b.token);
    const r = await call(
      "POST",
      "/v1/matches/ranked",
      { aVersionId: keys.a.version, bVersionId: keys.b.version, seed: "moba-r1", key: "moba-r1" },
      keys.a.token,
    );
    assert.equal(r.status, 201);
    assert.equal(r.json.mode, "moba");
    // The oracle replays the same rated result on a scratch ledger.
    const ledger = createLedger("local-s1");
    for (const row of [la, lb]) {
      const s = ratingFor(ledger, row.id);
      s.ratingMilli = row.rating_milli;
      s.placementGames = row.placement;
      s.placed = row.placed === 1;
    }
    const want = applyRanked(ledger, {
      matchId: "moba-r1-oracle",
      leaderA: la.id,
      leaderB: lb.id,
      winner: r.json.winner,
      rated: true,
    });
    assert.equal(r.json.deltaA, want.deltaA);
    assert.equal(r.json.deltaB, want.deltaB);
    const row = store.db.prepare("SELECT * FROM matches WHERE id = ?").get("moba-r1");
    assert.equal(row.mode, "moba");
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

  it("lists history with a mode per bout", async () => {
    const me = await call("GET", "/v1/me", null, keys.a.token);
    const dash = await call("GET", `/v1/agents/${me.json.agent.id}/dashboard`, null, keys.a.token);
    const train = dash.json.history.find((h) => h.matchId === keys.trainId);
    assert.equal(train.mode, "moba");
    const legacy = dash.json.history.find((h) => h.matchId === "m-legacy");
    assert.equal(legacy.mode, "duel");
  });
});

describe("moba worker mirror", () => {
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

  it("runs training as moba and replays v2 identically", async () => {
    const t = await wcall("POST", "/v1/matches/training", { versionId: "wv-a", seed: "wm-t1" }, "wt-a");
    assert.equal(t.status, 201);
    assert.equal(t.json.mode, "moba");
    const row = db.prepare("SELECT mode FROM matches WHERE id = ?").get(t.json.matchId);
    assert.equal(row.mode, "moba");
    const replay = await wcall("GET", `/v1/matches/${t.json.matchId}/replay`, null, "wt-a");
    assert.equal(replay.status, 200);
    assert.equal(replay.json.identical, true);
    assert.equal(replay.json.replay.version, 2);
    assert.equal(replay.json.replay.mode, "moba");
    assert.equal(replay.json.replay.checksum, replay.json.stored.checksum);
  });

  it("settles ranked as moba and replays v2 identically", async () => {
    const r = await wcall("POST", "/v1/matches/ranked", { aVersionId: "wv-a", bVersionId: "wv-b", seed: "wm-r1", key: "wm-r1" }, "wt-a");
    assert.equal(r.status, 201);
    assert.equal(r.json.mode, "moba");
    assert.equal(r.json.deltaA + r.json.deltaB, 0);
    const row = db.prepare("SELECT * FROM matches WHERE id = ?").get("wm-r1");
    assert.equal(row.mode, "moba");
    assert.equal(row.rated, 1);
    const replay = await wcall("GET", "/v1/matches/wm-r1/replay", null, "wt-a");
    assert.equal(replay.status, 200);
    assert.equal(replay.json.identical, true);
    assert.equal(replay.json.replay.version, 2);
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
