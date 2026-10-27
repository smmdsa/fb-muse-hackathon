import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MUSE_SUITE,
  hasKey,
  keyFor,
  metaApiBase,
  providerFromEnv,
  resolveModel,
  taskKeyName,
} from "../src/index.ts";

describe("model registry", () => {
  it("maps compile to Spark and portraits to Muse Image", () => {
    assert.equal(resolveModel("compile", {}), MUSE_SUITE.spark.id);
    assert.equal(resolveModel("portrait", {}), MUSE_SUITE.image.id);
  });

  it("lets env switch one task without touching the other", () => {
    const env = { AGENT_WARS_MODEL_COMPILE: MUSE_SUITE.wonder.id };
    assert.equal(resolveModel("compile", env), MUSE_SUITE.wonder.id);
    assert.equal(resolveModel("portrait", env), MUSE_SUITE.image.id);
  });

  it("ignores blank overrides", () => {
    assert.equal(resolveModel("compile", { AGENT_WARS_MODEL_COMPILE: "  " }), MUSE_SUITE.spark.id);
  });

  it("defaults the API base and trims a custom one", () => {
    assert.equal(metaApiBase({}), "https://api.meta.ai/v1");
    assert.equal(metaApiBase({ META_API_BASE: "https://proxy.example/v1/" }), "https://proxy.example/v1");
  });

  it("picks mock without a key and meta with one", async () => {
    const mock = providerFromEnv({});
    assert.equal(mock.name, "mock");
    const out = await mock.compileStrategy({ prompt: "rush them down", agentVersionId: "v1" });
    assert.equal(out.isMock, true);

    const meta = providerFromEnv({ META_SPARK_KEY: "k" });
    assert.equal(meta.name, "meta");
  });

  it("splits keys per task with a shared fallback", () => {
    assert.equal(taskKeyName("compile"), "META_SPARK_KEY");
    assert.equal(taskKeyName("portrait"), "META_IMAGE_KEY");
    assert.equal(keyFor("compile", { META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }), "s");
    assert.equal(keyFor("portrait", { META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }), "i");
    assert.equal(keyFor("compile", { META_API_KEY: "shared" }), "shared");
    assert.equal(keyFor("portrait", {}), "");
  });

  it("detects each key alone", () => {
    assert.equal(hasKey("compile", {}), false);
    assert.equal(hasKey("compile", { META_IMAGE_KEY: "i" }), false);
    assert.equal(hasKey("compile", { META_SPARK_KEY: "s" }), true);
    assert.equal(hasKey("portrait", { META_SPARK_KEY: "s" }), false);
    assert.equal(hasKey("portrait", { META_IMAGE_KEY: "i" }), true);
  });
});
