import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStandings } from "../src/index.ts";

function row(id, ap, milli, placed = true, season = "s1") {
  return {
    leaderId: id, seasonId: season, ratingMilli: milli, ap,
    placementGames: 5, placed, rankTier: null, division: null,
  };
}

describe("board", () => {
  it("orders by AP down", () => {
    const out = buildStandings("s1", [row("b", 480, 980000), row("a", 520, 1020000)]);
    assert.deepEqual(out.map((r) => r.leaderId), ["a", "b"]);
    assert.deepEqual(out.map((r) => r.rank), [1, 2]);
  });

  it("breaks AP ties by internal rating, then by id", () => {
    const out = buildStandings("s1", [
      row("zz", 500, 1000000),
      row("aa", 500, 1000000),
      row("mid", 500, 1001000),
    ]);
    assert.deepEqual(out.map((r) => r.leaderId), ["mid", "aa", "zz"]);
  });

  it("hides provisional leaders", () => {
    const out = buildStandings("s1", [row("new", 900, 1400000, false), row("old", 400, 900000)]);
    assert.deepEqual(out.map((r) => r.leaderId), ["old"]);
  });

  it("scopes one season and cuts top-N without shifting ranks", () => {
    const states = ["s1", "s1", "s2"].map((s, i) => row(`l${i}`, 500 + i * 10, 1000000 + i * 10000, true, s));
    const out = buildStandings("s1", states, 1);
    assert.equal(out.length, 1);
    assert.equal(out[0].leaderId, "l1");
    assert.equal(out[0].rank, 1);
  });
});
