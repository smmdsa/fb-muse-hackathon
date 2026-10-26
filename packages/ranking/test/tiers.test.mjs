import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankFor } from "../src/index.ts";

describe("tiers", () => {
  const cases = [
    [0, "PROTOTYPE", "III"],
    [99, "PROTOTYPE", "III"],
    [100, "PROTOTYPE", "II"],
    [199, "PROTOTYPE", "II"],
    [200, "PROTOTYPE", "I"],
    [299, "PROTOTYPE", "I"],
    [300, "CIRCUIT", "III"],
    [499, "CIRCUIT", "II"],
    [500, "CIRCUIT", "I"],
    [599, "CIRCUIT", "I"],
    [600, "CORE", "III"],
    [799, "CORE", "II"],
    [800, "CORE", "I"],
    [899, "CORE", "I"],
    [900, "ASCENDANT", "III"],
    [1099, "ASCENDANT", "II"],
    [1100, "ASCENDANT", "I"],
    [1199, "ASCENDANT", "I"],
    [1200, "SINGULARITY", null],
    [2500, "SINGULARITY", null],
  ];
  for (const [ap, tier, division] of cases) {
    it(`maps ${ap} to ${tier} ${division}`, () => {
      assert.deepEqual(rankFor(ap), { tier, division });
    });
  }
});
