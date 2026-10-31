import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleError, normalizeHandle } from "../src/index.ts";

describe("handle rules", () => {
  it("normalizes case and trims", () => {
    assert.equal(normalizeHandle("  Iron_Rider "), "iron_rider");
  });

  it("rejects non-strings and empties", () => {
    assert.equal(normalizeHandle(null), null);
    assert.equal(normalizeHandle(42), null);
    assert.equal(normalizeHandle("   "), null);
  });

  it("accepts names at both length bounds", () => {
    assert.equal(handleError("abc"), null);
    assert.equal(handleError("a123456789012345"), null);
    assert.equal(handleError("iron_rider_7"), null);
  });

  it("rejects bad shapes", () => {
    assert.ok(handleError("ab")); // too short
    assert.ok(handleError("a1234567890123456")); // too long
    assert.ok(handleError("1abc")); // must start with a letter
    assert.ok(handleError("a-bc")); // dash is out
    assert.ok(handleError("a bc")); // space is out
    assert.ok(handleError("Abc")); // raw uppercase is out
  });

  it("rejects reserved names", () => {
    for (const name of ["admin", "system", "support", "agentwars", "wallet", "api"]) {
      assert.equal(handleError(name), "that name is reserved");
    }
  });
});
