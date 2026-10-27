import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import entry from "../src/worker.ts";
import { createBattle, DEFAULT_BATTLE, drive, stepBattle, checksum } from "@agent-wars/battle-core";

// A D1-shaped shim over node:sqlite. Same SQL, same call shape.
function shim(db) {
  return {
    prepare: (query) => ({
      bind: (...values) => ({
        first: async () => db.prepare(query).get(...values) ?? null,
        all: async () => ({ results: db.prepare(query).all(...values) }),
        run: async () => db.prepare(query).run(...values),
      }),
    }),
  };
}

let env;

before(() => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "l1", "commander", "t1", 1020000, 520, 5, 1,
  );
  env = { DB: shim(db) };
});

describe("worker reads", () => {
  it("answers health", async () => {
    const res = await entry.fetch(new Request("http://local/v1/health"), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  it("lists the board from D1 rows", async () => {
    const res = await entry.fetch(new Request("http://local/v1/leaderboard"), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.rows.map((r) => r.leaderId), ["l1"]);
  });

  it("404s unknown routes", async () => {
    const res = await entry.fetch(new Request("http://local/v1/secret"), env);
    assert.equal(res.status, 404);
  });
});

describe("worker replay", () => {
  const rush = {
    schemaVersion: 1,
    agentVersionId: "v1",
    dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
    rules: [
      { id: "close", when: { operand: "distFoe", op: "lt", value: 8 }, move: "APPROACH", fire: true },
      { id: "far", when: { operand: "distFoe", op: "gte", value: 8 }, move: "APPROACH" },
    ],
  };

  it("replays a finished match with identical checksum", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync(new URL("../../../migrations/0001_schema.sql", import.meta.url), "utf8"));
    db.prepare("INSERT INTO leaders (id, handle, token, rating_milli, ap, placement, placed) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "l9", "replay-leader", "t9", 1020000, 520, 5, 1,
    );
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run("a9", "l9", "v9");
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v9", "a9", JSON.stringify(rush), "shim", Date.now(),
    );
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "v9b", "a9", JSON.stringify(rush), "shim", Date.now(),
    );
    const cfg = { ...DEFAULT_BATTLE, seed: "replay-seed-1" };
    let state = createBattle(cfg);
    let guard = 0;
    while (!state.over && guard < cfg.world.maxTicks) {
      state = stepBattle(state, { A: drive(state, rush, "A", cfg), B: drive(state, rush, "B", cfg) }, cfg);
      guard += 1;
    }
    db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
    ).run("m9", "replay-seed-1", "v9", "v9b", state.winner ?? "DRAW", state.tick, checksum(state), Date.now());
    const shimmed = {
      prepare: (query) => ({
        bind: (...values) => ({
          first: async () => db.prepare(query).get(...values) ?? null,
          all: async () => ({ results: db.prepare(query).all(...values) }),
          run: async () => db.prepare(query).run(...values),
        }),
      }),
    };
    const res = await entry.fetch(new Request("http://local/v1/matches/m9/replay"), { DB: shimmed });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.identical, true);
    assert.equal(body.recomputed.checksum, body.stored.checksum);
    assert.equal(body.recomputed.ticks, body.stored.ticks);
  });
});
