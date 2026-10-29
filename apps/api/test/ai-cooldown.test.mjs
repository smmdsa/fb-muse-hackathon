import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import entry from "../src/worker.ts";

let serial = 0;
function envFor() {
  const leaderId = `l${++serial}`;
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_schema.sql", "0002_platform.sql", "0003_matchmaking.sql", "0004_cost_audit.sql", "0005_portrait_status.sql", "0006_match_payouts.sql", "0007_tournaments.sql", "0008_armory.sql", "0009_season_archives.sql", "0010_reports.sql", "0011_version_labels.sql", "0012_match_mode.sql"]) db.exec(readFileSync(new URL(`../../../migrations/${f}`, import.meta.url), "utf8"));
  db.exec("CREATE TABLE ai_cooldowns (leader_id TEXT PRIMARY KEY, next_allowed_at INTEGER NOT NULL)");
  db.prepare("INSERT INTO leaders (id,handle,token) VALUES (?,'test','t1')").run(leaderId);
  db.prepare("INSERT INTO agents (id,leader_id) VALUES ('a1',?)").run(leaderId);
  const DB = { prepare: (sql) => ({ bind: (...v) => ({ first: async () => db.prepare(sql).get(...v) ?? null, all: async () => ({results: db.prepare(sql).all(...v)}), run: async () => db.prepare(sql).run(...v) }) }) };
  return { DB, testDb: db, leaderId, ASSETS: { fetch: async () => new Response("") } };
}
function req(path, method = "GET", body) { return new Request(`http://local${path}`, { method, headers: { authorization: "Bearer t1", "content-type": "application/json" }, body: body && JSON.stringify(body) }); }

describe("AI factory cooldown", () => {
  it("allows one compile and blocks immediate repeats across Worker instances", async () => {
    const env = envFor();
    const path = "/v1/agents/a1/policies/compile";
    const first = await entry.fetch(req(path, "POST", { prompt: "defend" }), env);
    assert.equal(first.status, 201);
    const second = await entry.fetch(req(path, "POST", { prompt: "attack" }), env);
    assert.equal(second.status, 429);
    const body = await second.json();
    assert.ok(body.retryAfterSeconds >= 299 && body.retryAfterSeconds <= 300);
    assert.equal(typeof body.now, "number");
    const status = await entry.fetch(req("/v1/ai/cooldown"), env);
    assert.ok((await status.json()).retryAfterSeconds > 0);
  });
  it("admits only one simultaneous compile", async () => {
    const env = envFor();
    const path = "/v1/agents/a1/policies/compile";
    const results = await Promise.all([entry.fetch(req(path,"POST",{prompt:"guard"}),env), entry.fetch(req(path,"POST",{prompt:"push"}),env)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201,429]);
  });
  it("allows a new request exactly after the persisted window expires", async () => {
    const env = envFor();
    const path = "/v1/agents/a1/policies/compile";
    assert.equal((await entry.fetch(req(path, "POST", { prompt: "defend" }), env)).status, 201);
    env.testDb.prepare("UPDATE ai_cooldowns SET next_allowed_at = ? WHERE leader_id = ?").run(Date.now() - 1, env.leaderId);
    assert.equal((await entry.fetch(req(path, "POST", { prompt: "push" }), env)).status, 201);
  });
  it("does not consume the cooldown for an invalid prompt", async () => {
    const env = envFor();
    const path = "/v1/agents/a1/policies/compile";
    assert.equal((await entry.fetch(req(path, "POST", { prompt: "x".repeat(2001) }), env)).status, 400);
    assert.equal((await entry.fetch(req(path, "POST", { prompt: "push" }), env)).status, 201);
  });
  it("blocks portrait generation after a real-provider compile attempt", async () => {
    const env = envFor();
    env.META_SPARK_KEY = "test";
    env.META_IMAGE_KEY = "test";
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: false, status: 503, json: async () => ({}) }; };
    try {
      const first = await entry.fetch(req("/v1/agents/a1/policies/compile", "POST", { prompt: "defend" }), env);
      assert.equal(first.status, 422);
      const retry = await entry.fetch(req("/v1/agents/a1/portrait/retry", "POST", {}), env);
      assert.equal(retry.status, 429);
      assert.equal(calls, 1);
    } finally { globalThis.fetch = realFetch; }
  });

});

it("does not expose the removed Evolution Lab endpoint", async () => {
  const env = envFor();
  const result = await entry.fetch(req("/v1/lab/ab", "POST", { agentId: "a1", promptA: "push", promptB: "defend" }), env);
  assert.equal(result.status, 404);
});
