import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollover } from "../src/index.ts";

function row(id, ap, milli, placed = true) {
  return {
    leaderId: id, seasonId: "s1", ratingMilli: milli, ap,
    placementGames: 5, placed, rankTier: null, division: null,
  };
}

describe("rollover", () => {
  it("freezes final order in the archive", () => {
    const out = rollover("s1", "s2", [row("b", 480, 980000), row("a", 520, 1020000)], 99);
    assert.equal(out.archive.seasonId, "s1");
    assert.equal(out.archive.closedAt, 99);
    assert.deepEqual(out.archive.rows.map((r) => r.leaderId), ["a", "b"]);
    assert.deepEqual(out.archive.rows.map((r) => r.rank), [1, 2]);
  });

  it("resets every leader for the next season", () => {
    const out = rollover("s1", "s2", [row("a", 520, 1020000), row("b", 480, 980000)], 99);
    for (const f of out.fresh) {
      assert.equal(f.seasonId, "s2");
      assert.equal(f.ratingMilli, 1000000);
      assert.equal(f.ap, 500);
      assert.equal(f.placementGames, 0);
      assert.equal(f.placed, false);
    }
  });

  it("excludes provisional leaders from the archive", () => {
    const out = rollover("s1", "s2", [row("new", 900, 1400000, false), row("old", 400, 900000)], 99);
    assert.deepEqual(out.archive.rows.map((r) => r.leaderId), ["old"]);
    assert.equal(out.fresh.length, 2);
  });

  it("handles an empty season", () => {
    const out = rollover("s1", "s2", [], 99);
    assert.deepEqual(out.archive.rows, []);
    assert.deepEqual(out.fresh, []);
  });
});
