import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mintId, newToken } from "../src/index.ts";

describe("ids and tokens", () => {
  it("mints unique ids with a random tail", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const id = mintId("t");
      assert.match(id, /^t_[0-9a-z]+_[0-9a-f]{16}$/);
      seen.add(id);
    }
    assert.equal(seen.size, 200);
  });

  it("mints opaque high-entropy tokens", () => {
    const a = newToken("demo");
    const b = newToken("demo");
    assert.notEqual(a, b);
    assert.match(a, /^demo_[0-9a-f]{32}$/);
  });

  it("throttles a sliding window", async () => {
    const { checkLimit } = await import("../src/index.ts");
    const log = new Map();
    for (let i = 0; i < 3; i += 1) assert.equal(checkLimit(log, "k", 1000 + i, 60_000, 3), true);
    assert.equal(checkLimit(log, "k", 1003, 60_000, 3), false);
    assert.equal(checkLimit(log, "k", 61_001, 60_000, 3), true);
    assert.equal(checkLimit(log, "other", 1003, 60_000, 3), true);
  });
});
