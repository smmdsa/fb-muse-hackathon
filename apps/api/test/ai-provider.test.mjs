// AI provider status. Reports which compiler runs: Meta with a key,
// mock without one. The key itself never leaves the server.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, buildRouter } from "../src/index.ts";
import { makeCaller } from "./harness.mjs";
import entry from "../src/worker.ts";

describe("ai provider status", () => {
  let call;

  before(() => {
    call = makeCaller(buildRouter({ store: openStore(":memory:") }));
  });

  it("reports mock on the dev server without a key", async () => {
    const saved = process.env.META_SPARK_KEY;
    delete process.env.META_SPARK_KEY;
    try {
      const r = await call("GET", "/v1/ai/provider");
      assert.equal(r.status, 200);
      assert.equal(r.json.compile.provider, "mock");
      assert.equal(r.json.compile.model, "muse-spark-1.3");
      assert.equal("keyed" in r.json.compile, false);
      assert.ok(!JSON.stringify(r.json).includes("META_"));
    } finally {
      if (saved === undefined) delete process.env.META_SPARK_KEY;
      else process.env.META_SPARK_KEY = saved;
    }
  });

  it("reports meta on the dev server with a key", async () => {
    const saved = process.env.META_SPARK_KEY;
    process.env.META_SPARK_KEY = "test-key";
    try {
      const r = await call("GET", "/v1/ai/provider");
      assert.equal(r.json.compile.provider, "meta");
      assert.equal("keyed" in r.json.compile, false);
      assert.ok(!JSON.stringify(r.json).includes("test-key"));
    } finally {
      if (saved === undefined) delete process.env.META_SPARK_KEY;
      else process.env.META_SPARK_KEY = saved;
    }
  });

  it("mirrors the status on the worker", async () => {
    const bare = { DB: null, ASSETS: { fetch: async () => new Response("") } };
    const mockRes = await entry.fetch(new Request("http://local/v1/ai/provider"), bare);
    assert.equal((await mockRes.json()).compile.provider, "mock");
    const keyed = { DB: null, META_SPARK_KEY: "test-key", ASSETS: { fetch: async () => new Response("") } };
    const metaRes = await entry.fetch(new Request("http://local/v1/ai/provider"), keyed);
    const body = await metaRes.json();
    assert.equal(body.compile.provider, "meta");
    assert.equal(body.explainer.provider, "meta");
    assert.ok(!JSON.stringify(body).includes("test-key"));
  });
});
