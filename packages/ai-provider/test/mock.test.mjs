import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePolicy } from "@agent-wars/behavior-dna";
import { compileMock, providerFromEnv, repairOnce } from "../src/index.ts";

describe("mock compile", () => {
  it("compiles the same prompt to the same valid draft", async () => {
    const a = await compileMock({ prompt: "rush them down up close", agentVersionId: "v1" });
    const b = await compileMock({ prompt: "rush them down up close", agentVersionId: "v1" });
    assert.equal(a.provider, "mock");
    assert.equal(a.isMock, true);
    assert.deepEqual(a.policy, b.policy);
    assert.equal(validatePolicy(a.policy).ok, true);
  });

  it("moves traits with prompt words", async () => {
    const agg = await compileMock({ prompt: "attack attack push forward", agentVersionId: "v1" });
    const eva = await compileMock({ prompt: "evade and stay safe far away", agentVersionId: "v1" });
    assert.ok(agg.policy.dna.aggression > 50);
    assert.ok(eva.policy.dna.evasion > 50);
    assert.ok(eva.policy.dna.preferredDistance > agg.policy.dna.preferredDistance);
  });

  it("repairs an oversized draft once", () => {
    const big = {
      schemaVersion: 1,
      agentVersionId: "v1",
      dna: { aggression: 500, evasion: -20, preferredDistance: 50, energyConservation: 50 },
      rules: Array.from({ length: 40 }, (_, i) => ({
        id: `r${i}`,
        when: { operand: "ownHpPct", op: "gte", value: 0 },
        move: "CAPTURE",
      })),
    };
    const fixed = repairOnce(big);
    assert.equal(validatePolicy(fixed).ok, true);
  });

  it("fails loudly when repair cannot help", () => {
    const bad = {
      schemaVersion: 2,
      agentVersionId: "v1",
      dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 },
      rules: [],
    };
    const fixed = repairOnce(bad);
    assert.equal(validatePolicy(fixed).ok, false);
  });

  it("picks mock when no key is set", () => {
    assert.equal(providerFromEnv({}).name, "mock");
  });

  it("picks meta when the Spark key is set", () => {
    assert.equal(providerFromEnv({ META_SPARK_KEY: "x" }).name, "meta");
    assert.equal(providerFromEnv({ META_IMAGE_KEY: "x" }).name, "mock");
  });
});
