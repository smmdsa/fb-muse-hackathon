import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";

let call;
let store;
let me;

before(() => {
  store = openStore(":memory:");
  call = makeCaller(buildRouter({ store }));
});

describe("version management", () => {
  it("provisions a leader with a hero and two drafts", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "keeper" });
    const g = await call("POST", "/v1/agents", {}, s.json.token);
    const v1 = await call("POST", `/v1/agents/${g.json.agentId}/policies/compile`, { prompt: "rush them down up close" }, s.json.token);
    // Simulate the five-minute factory window passing.
    store.db.prepare("UPDATE ai_cooldowns SET next_allowed_at = 0").run();
    const v2 = await call("POST", `/v1/agents/${g.json.agentId}/policies/compile`, { prompt: "hold the center patiently" }, s.json.token);
    await call("POST", `/v1/agents/${g.json.agentId}/policies/install`, { versionId: v1.json.versionId }, s.json.token);
    me = { token: s.json.token, agentId: g.json.agentId, v1: v1.json.versionId, v2: v2.json.versionId };
    assert.ok(me.v1 && me.v2);
  });

  it("shows each chip with its condition", async () => {
    const dash = await call("GET", `/v1/agents/${me.agentId}/dashboard`, null, me.token);
    assert.equal(dash.status, 200);
    assert.equal(dash.json.versions.length, 2);
    for (const v of dash.json.versions) {
      assert.ok(v.chips.length > 0);
      for (const c of v.chips) {
        assert.ok(c.id && c.move && c.when);
      }
    }
  });

  it("deletes an unfought draft", async () => {
    const r = await call("DELETE", `/v1/agents/${me.agentId}/policies/${me.v2}`, null, me.token);
    assert.equal(r.status, 200);
    assert.equal(r.json.deleted, true);
    const dash = await call("GET", `/v1/agents/${me.agentId}/dashboard`, null, me.token);
    assert.equal(dash.json.versions.length, 1);
    assert.equal(dash.json.versions[0].versionId, me.v1);
  });

  it("refuses the active version and fought versions", async () => {
    const active = await call("DELETE", `/v1/agents/${me.agentId}/policies/${me.v1}`, null, me.token);
    assert.equal(active.status, 422);
    assert.match(active.json.error, /active/);
    const bout = await call("POST", "/v1/matches/training", { versionId: me.v1, seed: "keep-1" }, me.token);
    assert.equal(bout.status, 201);
    // Simulate the five-minute factory window passing.
    store.db.prepare("UPDATE ai_cooldowns SET next_allowed_at = 0").run();
    const v3 = await call("POST", `/v1/agents/${me.agentId}/policies/compile`, { prompt: "evade and stay far away" }, me.token);
    await call("POST", `/v1/agents/${me.agentId}/policies/install`, { versionId: v3.json.versionId }, me.token);
    const fought = await call("DELETE", `/v1/agents/${me.agentId}/policies/${me.v1}`, null, me.token);
    assert.equal(fought.status, 422);
    assert.match(fought.json.error, /history/);
  });

  it("flags an unreadable draft instead of blanking the dashboard", async () => {
    store.db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at, provider, is_mock, tokens, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "v-poison", me.agentId, "not-json{{{", "x", Date.now(), "meta", 0, 0, 0,
    );
    const dash = await call("GET", `/v1/agents/${me.agentId}/dashboard`, null, me.token);
    assert.equal(dash.status, 200);
    assert.ok(dash.json.versions.length >= 2);
    const bad = dash.json.versions.find((v) => v.versionId === "v-poison");
    assert.equal(bad.corrupt, true);
    assert.deepEqual(bad.chips, []);
    const del = await call("DELETE", `/v1/agents/${me.agentId}/policies/v-poison`, null, me.token);
    assert.equal(del.status, 200);
    const after = await call("GET", `/v1/agents/${me.agentId}/dashboard`, null, me.token);
    assert.ok(!after.json.versions.some((v) => v.versionId === "v-poison"));
  });

  it("renames drafts and clears on empty", async () => {
    const set = await call("POST", `/v1/agents/${me.agentId}/policies/${me.v1}/rename`, { label: "Ambusher prime" }, me.token);
    assert.equal(set.status, 200);
    assert.equal(set.json.label, "Ambusher prime");
    const dash = await call("GET", `/v1/agents/${me.agentId}/dashboard`, null, me.token);
    assert.equal(dash.json.versions.find((v) => v.versionId === me.v1).label, "Ambusher prime");
    const clear = await call("POST", `/v1/agents/${me.agentId}/policies/${me.v1}/rename`, { label: "   " }, me.token);
    assert.equal(clear.status, 200);
    assert.equal(clear.json.label, null);
    const ghost = await call("POST", `/v1/agents/${me.agentId}/policies/v-ghost/rename`, { label: "x" }, me.token);
    assert.equal(ghost.status, 404);
  });

  it("force-deletes fought versions but keeps their receipts", async () => {
    const boutBefore = store.db.prepare("SELECT * FROM matches WHERE seed = ?").get("keep-1");
    assert.ok(boutBefore);
    const gone = await call("POST", `/v1/agents/${me.agentId}/policies/${me.v1}/force-delete`, {}, me.token);
    assert.equal(gone.status, 200);
    assert.equal(gone.json.deleted, true);
    assert.equal(gone.json.clearedActive, false);
    const dash = await call("GET", `/v1/agents/${me.agentId}/dashboard`, null, me.token);
    assert.ok(!dash.json.versions.some((v) => v.versionId === me.v1));
    const boutAfter = store.db.prepare("SELECT * FROM matches WHERE seed = ?").get("keep-1");
    assert.equal(boutAfter.checksum, boutBefore.checksum);
    const rep = await call("GET", `/v1/matches/${boutAfter.id}/replay`, null, me.token);
    assert.equal(rep.status, 410);
    assert.match(rep.json.error, /gone/);
  });

  it("force on the active version clears the slot", async () => {
    // Simulate the five-minute factory window passing.
    store.db.prepare("UPDATE ai_cooldowns SET next_allowed_at = 0").run();
    const v4 = await call("POST", `/v1/agents/${me.agentId}/policies/compile`, { prompt: "hold the center patiently" }, me.token);
    await call("POST", `/v1/agents/${me.agentId}/policies/install`, { versionId: v4.json.versionId }, me.token);
    const gone = await call("POST", `/v1/agents/${me.agentId}/policies/${v4.json.versionId}/force-delete`, {}, me.token);
    assert.equal(gone.status, 200);
    assert.equal(gone.json.clearedActive, true);
    const meNow = await call("GET", "/v1/me", null, me.token);
    assert.equal(meNow.json.agent.active_version_id, null);
  });

  it("refuses force on live event seats", async () => {
    // Simulate the five-minute factory window passing.
    store.db.prepare("UPDATE ai_cooldowns SET next_allowed_at = 0").run();
    const v5 = await call("POST", `/v1/agents/${me.agentId}/policies/compile`, { prompt: "rush them down up close" }, me.token);
    store.db.prepare("INSERT INTO tournaments (id, name, event_json, games_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "locked-cup", "Locked", JSON.stringify({ id: "locked-cup", phase: "LOCKED", entries: [{ leaderId: "x", agentVersionId: v5.json.versionId }] }), "{}", Date.now(),
    );
    const denied = await call("POST", `/v1/agents/${me.agentId}/policies/${v5.json.versionId}/force-delete`, {}, me.token);
    assert.equal(denied.status, 422);
    assert.match(denied.json.error, /live event seat/);
  });

  it("404s foreign heroes and ghost versions", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "stranger" });
    const foreign = await call("DELETE", `/v1/agents/${me.agentId}/policies/${me.v1}`, null, s.json.token);
    assert.equal(foreign.status, 404);
    const ghost = await call("DELETE", `/v1/agents/${me.agentId}/policies/v-ghost`, null, me.token);
    assert.equal(ghost.status, 404);
  });
});
