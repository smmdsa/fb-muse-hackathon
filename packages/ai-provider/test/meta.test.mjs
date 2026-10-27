import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMetaProvider, portraitFromEnv } from "../src/index.ts";

const POLICY_TEXT = JSON.stringify({
  schemaVersion: 1,
  agentVersionId: "v9",
  dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 },
  rules: [
    { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "weak-retreat", when: { operand: "ownHpPct", op: "lt", value: 25 }, move: "RETREAT" },
  ],
});

const chatOk = (text) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: text } }], usage: { total_tokens: 120 } }),
});

describe("meta provider", () => {
  it("compiles a valid draft from a chat reply", async () => {
    const seen = [];
    const fetchFn = async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return chatOk(POLICY_TEXT)();
    };
    const meta = createMetaProvider({ META_SPARK_KEY: "spark-k" }, fetchFn);
    const out = await meta.compileStrategy({ prompt: "rush them down", agentVersionId: "v9" });
    assert.equal(out.provider, "meta");
    assert.equal(out.isMock, false);
    assert.equal(out.policy.dna.aggression, 80);
    assert.equal(out.promptTokens, 120);
    assert.match(seen[0].url, /\/chat\/completions$/);
    assert.equal(seen[0].body.model, "muse-spark-1.3");
    assert.equal(seen[0].headers.authorization, "Bearer spark-k");
    assert.equal(seen[0].body.reasoning_effort, "low");
  });

  it("refuses a keyless compile without calling the network", async () => {
    let called = 0;
    const meta = createMetaProvider({}, async () => { called += 1; return chatOk(POLICY_TEXT)(); });
    const out = await meta.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    assert.equal(out.policy, null);
    assert.equal(called, 0);
    assert.match(out.errors[0], /META_SPARK_KEY/);
  });

  it("carries the image key alone on portrait calls", async () => {
    const seen = [];
    const fetchFn = async (url, init) => {
      seen.push({ headers: init.headers });
      return { ok: true, status: 200, json: async () => ({ data: [{ url: "https://cdn.example/p.png" }] }) };
    };
    const meta = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, fetchFn);
    await meta.generatePortrait({ prompt: "chrome wasp" });
    assert.equal(seen[0].headers.authorization, "Bearer i");
  });

  it("repairs a bad draft once before it gives up", async () => {
    const bad = JSON.stringify({
      schemaVersion: 1,
      agentVersionId: "v9",
      dna: { aggression: 500, evasion: 40, preferredDistance: 25, energyConservation: 50 },
      rules: [
        { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
      ],
    });
    const meta = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, chatOk(bad));
    const out = await meta.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    assert.equal(out.repairAttempted, true);
    assert.equal(out.policy.dna.aggression, 100);
  });

  it("fails honestly on non-JSON and on HTTP errors", async () => {
    const notJson = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, chatOk("hello"));
    const a = await notJson.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    assert.equal(a.policy, null);
    assert.ok(a.errors.length > 0);

    const down = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const b = await down.compileStrategy({ prompt: "rush", agentVersionId: "v9" });
    assert.equal(b.policy, null);
    assert.match(b.errors[0], /status 500/);
  });

  it("generates a portrait through the image endpoint", async () => {
    const seen = [];
    const fetchFn = async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ data: [{ url: "https://cdn.example/p1.png" }] }) };
    };
    const meta = createMetaProvider({ META_SPARK_KEY: "s", META_IMAGE_KEY: "i" }, fetchFn);
    const out = await meta.generatePortrait({ prompt: "chrome wasp robot, cyan visor" });
    assert.equal(out.url, "https://cdn.example/p1.png");
    assert.equal(out.model, "muse-image-1.0");
    assert.match(seen[0].url, /\/images\/generations$/);
  });

  it("refuses portraits without a key", () => {
    assert.throws(() => portraitFromEnv({}), /META_IMAGE_KEY/);
  });
});
