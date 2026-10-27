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
    const v3 = await call("POST", `/v1/agents/${me.agentId}/policies/compile`, { prompt: "evade and stay far away" }, me.token);
    await call("POST", `/v1/agents/${me.agentId}/policies/install`, { versionId: v3.json.versionId }, me.token);
    const fought = await call("DELETE", `/v1/agents/${me.agentId}/policies/${me.v1}`, null, me.token);
    assert.equal(fought.status, 422);
    assert.match(fought.json.error, /history/);
  });

  it("404s foreign heroes and ghost versions", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "stranger" });
    const foreign = await call("DELETE", `/v1/agents/${me.agentId}/policies/${me.v1}`, null, s.json.token);
    assert.equal(foreign.status, 404);
    const ghost = await call("DELETE", `/v1/agents/${me.agentId}/policies/v-ghost`, null, me.token);
    assert.equal(ghost.status, 404);
  });
});
