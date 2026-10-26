import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyRanked, createLedger, toAp } from "../src/index.ts";

function duel(winnerA) {
  const ledger = createLedger("s1");
  const out = applyRanked(ledger, {
    matchId: "m1",
    leaderA: "a",
    leaderB: "b",
    winner: winnerA,
    rated: true,
  });
  return { ledger, out };
}

describe("formula", () => {
  it("moves +20 and -20 at equal ratings", () => {
    const { out } = duel("A");
    assert.equal(out.deltaA, 20);
    assert.equal(out.deltaB, -20);
    assert.equal(out.apA, 520);
    assert.equal(out.apB, 480);
  });

  it("counts the result exactly once", () => {
    const { ledger } = duel("A");
    assert.throws(() => applyRanked(ledger, {
      matchId: "m1",
      leaderA: "a",
      leaderB: "b",
      winner: "B",
      rated: true,
    }), /duplicate match/);
    assert.equal(ledger.ratings.get("a").ap, 520);
  });

  it("denies a self match", () => {
    const ledger = createLedger("s1");
    assert.throws(() => applyRanked(ledger, {
      matchId: "m9",
      leaderA: "a",
      leaderB: "a",
      winner: "A",
      rated: true,
    }), /self match/);
  });

  it("moves +12 for a favored winner at a 200 gap", () => {
    const ledger = createLedger("s1");
    ledger.ratings.set("a", {
      leaderId: "a", seasonId: "s1", ratingMilli: 1200000, ap: 700,
      placementGames: 5, placed: true, rankTier: "CORE", division: "II",
    });
    const out = applyRanked(ledger, {
      matchId: "m2", leaderA: "a", leaderB: "b", winner: "A", rated: true,
    });
    assert.equal(out.deltaA, 12);
    assert.equal(out.deltaB, -12);
  });

  it("moves +28 for an underdog winner at a 200 gap", () => {
    const ledger = createLedger("s1");
    ledger.ratings.set("b", {
      leaderId: "b", seasonId: "s1", ratingMilli: 1200000, ap: 700,
      placementGames: 5, placed: true, rankTier: "CORE", division: "II",
    });
    const out = applyRanked(ledger, {
      matchId: "m3", leaderA: "a", leaderB: "b", winner: "A", rated: true,
    });
    assert.equal(out.deltaA, 28);
    assert.equal(out.deltaB, -28);
  });

  it("scores a draw 0 and 0 at equal ratings", () => {
    const { out } = duel("DRAW");
    assert.equal(out.deltaA, 0);
    assert.equal(out.deltaB, 0);
  });

  it("clips AP at zero but keeps the internal rating", () => {
    const ledger = createLedger("s1");
    ledger.ratings.set("a", {
      leaderId: "a", seasonId: "s1", ratingMilli: 505000, ap: 5,
      placementGames: 5, placed: true, rankTier: "PROTOTYPE", division: "III",
    });
    const out = applyRanked(ledger, {
      matchId: "m4", leaderA: "a", leaderB: "b", winner: "B", rated: true,
    });
    assert.equal(out.apA, 0);
    assert.equal(out.floorClipped, true);
    assert.ok(ledger.ratings.get("a").ratingMilli < 505000);
  });

  it("gates the badge behind 5 placement games", () => {
    const ledger = createLedger("s1");
    for (let i = 0; i < 4; i += 1) {
      applyRanked(ledger, { matchId: `p${i}`, leaderA: "a", leaderB: `x${i}`, winner: "A", rated: true });
    }
    assert.equal(ledger.ratings.get("a").placed, false);
    applyRanked(ledger, { matchId: "p4", leaderA: "a", leaderB: "x9", winner: "A", rated: true });
    assert.equal(ledger.ratings.get("a").placed, true);
  });

  it("derives AP from the milli rating", () => {
    assert.equal(toAp(1000000), 500);
    assert.equal(toAp(400000), 0);
  });
});
