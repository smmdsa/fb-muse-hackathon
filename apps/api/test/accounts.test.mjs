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
    assert.equal(first.json.portraitStatus, "faceless");
    keys.agent = first.json.agentId;
    const second = await call("POST", "/v1/agents", {}, keys.commander);
    assert.equal(second.status, 409);
  });

  it("marks the portrait ready when the image call lands", async () => {
    process.env.META_IMAGE_KEY = "test-image-key";
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ url: "https://cdn.example/wasp.png" }] }) });
    try {
      const s = await call("POST", "/v1/auth/session", { handle: "painter" });
      const a = await call("POST", "/v1/agents", { name: "Wasp", concept: "fast striker" }, s.json.token);
      assert.equal(a.status, 201);
      assert.equal(a.json.portraitStatus, "ready");
      assert.equal(a.json.portraitUrl, "https://cdn.example/wasp.png");
      const seen = await call("GET", `/v1/agents/${a.json.agentId}/dashboard`, null, s.json.token);
      assert.equal(seen.json.agent.portraitStatus, "ready");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.META_IMAGE_KEY;
    }
  });

  it("marks the portrait failed when the image call drops", async () => {
    process.env.META_IMAGE_KEY = "test-image-key";
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    try {
      const s = await call("POST", "/v1/auth/session", { handle: "unlucky" });
      keys.unlucky = s.json.token;
      const a = await call("POST", "/v1/agents", { name: "Rust", concept: "junk brawler" }, s.json.token);
      assert.equal(a.status, 201);
      assert.equal(a.json.portraitStatus, "failed");
      assert.equal(a.json.portraitUrl, null);
      keys.rust = a.json.agentId;
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.META_IMAGE_KEY;
    }
  });

  it("retries a failed portrait without breeding a second hero", async () => {
    process.env.META_IMAGE_KEY = "test-image-key";
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ data: [{ url: "https://cdn.example/rust.png" }] }) };
    };
    try {
      const r = await call("POST", `/v1/agents/${keys.rust}/portrait/retry`, {}, keys.unlucky);
      assert.equal(r.status, 200);
      assert.equal(r.json.retried, true);
      assert.equal(r.json.portraitStatus, "ready");
      assert.equal(r.json.portraitUrl, "https://cdn.example/rust.png");
      assert.equal(calls, 1);
      const again = await call("POST", `/v1/agents/${keys.rust}/portrait/retry`, {}, keys.unlucky);
      assert.equal(again.status, 200);
      assert.equal(again.json.retried, false);
      assert.equal(calls, 1);
      const seen = await call("GET", `/v1/agents/${keys.rust}/dashboard`, null, keys.unlucky);
      assert.equal(seen.json.agent.portraitStatus, "ready");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.META_IMAGE_KEY;
    }
  });

  it("denies a portrait retry on a foreign hero", async () => {
    const r = await call("POST", `/v1/agents/${keys.rust}/portrait/retry`, {}, keys.commander);
    assert.equal(r.status, 404);
  });

  it("walks a fresh leader through the whole breed station", async () => {
    const s = await call("POST", "/v1/auth/session", { handle: "station" });
    const before = await call("GET", "/v1/me", null, s.json.token);
    assert.ok(!before.json.agent);
    const bred = await call("POST", "/v1/agents", { name: "Station", concept: "patient holder" }, s.json.token);
    assert.equal(bred.status, 201);
    assert.equal(bred.json.portraitStatus, "faceless");
    const second = await call("POST", "/v1/agents", { name: "Clone", concept: "copy" }, s.json.token);
    assert.equal(second.status, 409);
    const after = await call("GET", "/v1/me", null, s.json.token);
    assert.equal(after.json.agent.id, bred.json.agentId);
    const dash = await call("GET", `/v1/agents/${bred.json.agentId}/dashboard`, null, s.json.token);
    assert.equal(dash.json.agent.name, "Station");
    assert.equal(dash.json.agent.concept, "patient holder");
    assert.equal(dash.json.agent.portraitStatus, "faceless");
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
    assert.deepEqual(Object.keys(r.json.versions[0].dna).sort(), ["aggression", "energyConservation", "evasion", "preferredDistance"]);
    assert.ok(r.json.versions[0].dna.aggression >= 50);
  });

  it("shows the leader summary", async () => {
    const r = await call("GET", "/v1/me", null, keys.commander);
    assert.equal(r.status, 200);
    assert.ok(r.json.agent);
    assert.equal(r.json.energy.energy, 10);
  });

  it("denies compiling on a stranger's agent", async () => {
    const other = await call("POST", "/v1/auth/session", { handle: "intruder" });
    const r = await call("POST", `/v1/agents/${keys.agent}/policies/compile`, { prompt: "rush" }, other.json.token);
    assert.equal(r.status, 404);
  });

  it("denies training on a stranger's version", async () => {
    const other = await call("POST", "/v1/auth/session", { handle: "snoop" });
    const r = await call("POST", "/v1/matches/training", { versionId: keys.version, seed: "snoop-1" }, other.json.token);
    assert.equal(r.status, 404);
  });

  it("throttles rapid compiles", async () => {
    for (let i = 0; i < 5; i += 1) {
      await call("POST", `/v1/agents/${keys.agent}/policies/compile`, { prompt: "rush" }, keys.commander);
    }
    const r = await call("POST", `/v1/agents/${keys.agent}/policies/compile`, { prompt: "rush" }, keys.commander);
    assert.equal(r.status, 429);
  });
});
