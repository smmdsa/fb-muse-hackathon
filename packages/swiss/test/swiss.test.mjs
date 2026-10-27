import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyResults, buchholz, pairRound, standings } from "../src/index.ts";

function room(ids) {
  return ids.map((id) => ({ id, score: 0, opponents: [], byes: 0 }));
}

// The favorite wins every bout. Underdogs still deserve a clean draw.
function chalkWinners(pairs) {
  return pairs.map(([a, b]) => ({ a, b, winner: a < b ? "a" : "b" }));
}

describe("swiss pairing", () => {
  it("pairs score groups with no rematches over three rounds", () => {
    let entrants = room(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
    const seen = new Set();
    for (let round = 1; round <= 3; round += 1) {
      const out = pairRound(entrants, `swiss-${round}`);
      assert.equal(out.pairs.length, 4);
      assert.equal(out.bye, null);
      assert.equal(out.repeats, 0);
      if (round === 2) {
        for (const [a, b] of out.pairs) {
          const ea = entrants.find((e) => e.id === a);
          const eb = entrants.find((e) => e.id === b);
          assert.equal(ea.score, eb.score);
        }
      }
      for (const [a, b] of out.pairs) {
        const key = [a, b].sort().join("~");
        assert.ok(!seen.has(key), `rematch ${key} in round ${round}`);
        seen.add(key);
      }
      entrants = applyResults(entrants, chalkWinners(out.pairs), out.bye);
    }
    const total = entrants.reduce((n, e) => n + e.score, 0);
    assert.equal(total, 12);
  });

  it("rotates the bye to the weakest un-bye’d player", () => {
    let entrants = room(["q1", "q2", "q3", "q4", "q5", "q6", "q7"]);
    const byes = [];
    for (let round = 1; round <= 3; round += 1) {
      const out = pairRound(entrants, `odd-${round}`);
      assert.equal(out.pairs.length, 3);
      assert.ok(out.bye);
      assert.ok(!byes.includes(out.bye), `repeat bye ${out.bye}`);
      byes.push(out.bye);
      entrants = applyResults(entrants, chalkWinners(out.pairs), out.bye);
    }
    assert.equal(byes.length, 3);
    for (const e of entrants) assert.ok(e.byes <= 1);
  });

  it("draws the same round from the same seed", () => {
    const entrants = room(["a", "b", "c", "d", "e", "f", "g", "h"]);
    const first = pairRound(entrants, "fixed-seed");
    const second = pairRound(entrants, "fixed-seed");
    assert.deepEqual(first, second);
    const other = pairRound(entrants, "other-seed");
    assert.notDeepEqual(first.pairs, other.pairs);
  });

  it("breaks ties by Buchholz, then by id", () => {
    const entrants = [
      { id: "t1", score: 2, opponents: ["t3", "t4"], byes: 0 },
      { id: "t2", score: 2, opponents: ["t5", "t6"], byes: 0 },
      { id: "t3", score: 2, opponents: ["t1", "t5"], byes: 0 },
      { id: "t4", score: 0, opponents: ["t1", "t6"], byes: 0 },
      { id: "t5", score: 1, opponents: ["t2", "t3"], byes: 0 },
      { id: "t6", score: 0, opponents: ["t2", "t4"], byes: 0 },
    ];
    assert.ok(buchholz(entrants, "t3") > buchholz(entrants, "t1"));
    const order = standings(entrants).map((e) => e.id);
    assert.equal(order[0], "t3");
    assert.deepEqual(order.slice(0, 3).sort(), ["t1", "t2", "t3"]);
  });

  it("counts a forced repeat instead of hiding it", () => {
    // Four rivals, three rounds: every pairing is spent.
    let entrants = room(["r1", "r2", "r3", "r4"]);
    for (let round = 1; round <= 3; round += 1) {
      const out = pairRound(entrants, `rr-${round}`);
      assert.equal(out.repeats, 0);
      entrants = applyResults(entrants, chalkWinners(out.pairs), out.bye);
    }
    const forced = pairRound(entrants, "rr-4");
    assert.equal(forced.pairs.length, 2);
    assert.ok(forced.repeats > 0);
  });

  it("splits draws and never mutates the room", () => {
    const before = room(["d1", "d2"]);
    const after = applyResults(before, [{ a: "d1", b: "d2", winner: "draw" }], null);
    assert.equal(after.find((e) => e.id === "d1").score, 0.5);
    assert.equal(after.find((e) => e.id === "d2").score, 0.5);
    assert.equal(before[0].score, 0);
    assert.deepEqual(before[0].opponents, []);
  });
});
