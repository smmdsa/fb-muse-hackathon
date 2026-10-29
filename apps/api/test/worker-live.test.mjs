import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import entry from "../src/worker.ts";

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
    batch: async (stmts) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

const assetsStub = {
  fetch: async () => new Response("<!doctype html><title>Agent Wars</title>", {
    headers: { "content-type": "text/html" },
  }),
};

const MIGRATIONS = ["0001_schema", "0002_platform", "0003_matchmaking", "0004_cost_audit", "0005_portrait_status", "0006_match_payouts", "0007_tournaments", "0008_armory", "0009_season_archives", "0012_match_mode", "0013_ai_cooldowns"];

function freshDb() {
  const db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) {
    db.exec(readFileSync(new URL(`../../../migrations/${m}.sql`, import.meta.url), "utf8"));
  }
  return db;
}

const POLICY = (id) => JSON.stringify({
  schemaVersion: 1,
  agentVersionId: id,
  dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 },
  rules: [{ id: "r", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true }],
});

function seedPair(db, sfx) {
  for (const [who, other] of [["a", "b"], ["b", "a"]]) {
    void other;
    db.prepare("INSERT INTO leaders (id, handle, token) VALUES (?, ?, ?)").run(`l${sfx}${who}`, `live${sfx}${who}`, `t${sfx}${who}`);
    db.prepare("INSERT INTO agents (id, leader_id, active_version_id) VALUES (?, ?, ?)").run(`a${sfx}${who}`, `l${sfx}${who}`, `v${sfx}${who}`);
    db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at) VALUES (?, ?, ?, ?, ?)").run(
      `v${sfx}${who}`, `a${sfx}${who}`, POLICY(`v${sfx}${who}`), "shim", Date.now(),
    );
  }
}

function caller(wenv) {
  return (token) => (method, path, body) => entry.fetch(new Request(`http://local${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  }), wenv).then(async (r) => ({ status: r.status, json: await r.json() }));
}

describe("worker live matchmaking pairs", () => {
  it("pairs two queued humans at once in ranked", async () => {
    const db = freshDb();
    seedPair(db, 30);
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const as = caller(wenv);
    const qa = await as("t30a")("POST", "/v1/matchmaking/request", { versionId: "v30a", mode: "ranked" });
    assert.equal(qa.status, 201);
    assert.equal(qa.json.status, "queued");
    const qb = await as("t30b")("POST", "/v1/matchmaking/request", { versionId: "v30b", mode: "ranked" });
    assert.equal(qb.status, 201);
    assert.equal(qb.json.status, "settled");
    assert.equal(qb.json.match_id, qa.json.id);
    const back = await as("t30a")("GET", `/v1/matchmaking/${qa.json.id}`);
    assert.equal(back.status, 200);
    assert.equal(back.json.status, "settled");
    assert.ok(back.json.match);
    assert.equal(back.json.match.rated, 1);
    assert.equal(back.json.match.mode, "moba");
    const m = db.prepare("SELECT * FROM matches WHERE id = ?").get(qa.json.id);
    assert.equal(m.a_version, "v30a");
    assert.equal(m.b_version, "v30b");
    db.close();
  });

  it("pairs two queued humans in casual with both sides paid", async () => {
    const db = freshDb();
    seedPair(db, 31);
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const as = caller(wenv);
    const qa = await as("t31a")("POST", "/v1/matchmaking/request", { versionId: "v31a", mode: "casual" });
    assert.equal(qa.status, 201);
    const qb = await as("t31b")("POST", "/v1/matchmaking/request", { versionId: "v31b", mode: "casual" });
    assert.equal(qb.json.status, "settled");
    const m = db.prepare("SELECT * FROM matches WHERE id = ?").get(qa.json.id);
    assert.equal(m.rated, 0);
    assert.equal(m.b_version, "v31b");
    if (m.winner === "A") {
      assert.equal(m.paid_a, 25);
      assert.equal(m.paid_b, 10);
    } else if (m.winner === "B") {
      assert.equal(m.paid_a, 10);
      assert.equal(m.paid_b, 25);
    } else {
      assert.equal(m.paid_a, 0);
      assert.equal(m.paid_b, 0);
    }
    db.close();
  });

  it("a re-post resumes the open ticket with 200", async () => {
    const db = freshDb();
    seedPair(db, 32);
    const wenv = { DB: shim(db), ASSETS: assetsStub };
    const as = caller(wenv);
    const first = await as("t32a")("POST", "/v1/matchmaking/request", { versionId: "v32a", mode: "ranked" });
    assert.equal(first.status, 201);
    const again = await as("t32a")("POST", "/v1/matchmaking/request", { versionId: "v32a", mode: "ranked" });
    assert.equal(again.status, 200);
    assert.equal(again.json.id, first.json.id);
    assert.equal(again.json.status, "queued");
    db.close();
  });
});
