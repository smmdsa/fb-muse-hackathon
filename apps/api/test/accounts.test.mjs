import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";

let call;
let keys = {};

before(() => {
  const store = openStore(":memory:");
  keys.store = store;
  call = makeCaller(buildRouter({ store }));
  keys.close = () => store.close();
});

describe("accounts", () => {
  it("issues a token for a handle", async () => {
    const r = await call("POST", "/v1/auth/session", { handle: "commander" });
    assert.equal(r.status, 200);
    assert.ok(r.json.token);
    keys.commander = r.json.token;
    keys.commanderId = r.json.leaderId;
  });

  it("refuses calls without a token", async () => {
    const r = await call("GET", "/v1/me");
    assert.equal(r.status, 401);
  });

  it("creates one agent, then refuses a second", async () => {
    const first = await call("POST", "/v1/agents", { name: "Wasp", concept: "fast striker" }, keys.commander);
    assert.equal(first.status, 201);
    assert.equal(first.json.portraitUrl, null);
    keys.agent = first.json.agentId;
    const second = await call("POST", "/v1/agents", {}, keys.commander);
    assert.equal(second.status, 409);
  });

  it("compiles and publishes a valid draft", async () => {
    const r = await call("POST", `/v1/agents/${keys.agent}/policies/compile`, { prompt: "rush them down up close" }, keys.commander);
    assert.equal(r.status, 201);
    assert.ok(r.json.versionId);
    assert.equal(r.json.provider, "mock");
    keys.version = r.json.versionId;
  });

  it("shows the dashboard with chips", async () => {
    const r = await call("GET", `/v1/agents/${keys.agent}/dashboard`, null, keys.commander);
    assert.equal(r.status, 200);
    assert.equal(r.json.agent.name, "Wasp");
    assert.equal(r.json.leader.ap, 500);
    assert.equal(r.json.leader.tier, "CIRCUIT");
    assert.equal(r.json.versions.length, 1);
    assert.ok(r.json.versions[0].chips.length > 0);
  });

  it("shows the leader summary", async () => {
    const r = await call("GET", "/v1/me", null, keys.commander);
    assert.equal(r.status, 200);
    assert.ok(r.json.agent);
    assert.equal(r.json.energy.energy, 10);
  });
});
