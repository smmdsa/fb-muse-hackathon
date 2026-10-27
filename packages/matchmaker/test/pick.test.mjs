import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickOpponent, recordPair, PAIR_WINDOW_MS } from "../src/index.ts";

const DAY = 24 * 60 * 60 * 1000;

function cand(id, milli = 1000000, patch = {}) {
  return { leaderId: id, ratingMilli: milli, optIn: true, published: true, leaseExpiresAt: 10 * DAY, ...patch };
}

describe("picker", () => {
  it("excludes self, expired, unpublished, and opted-out leaders", () => {
    const seeker = cand("me");
    const pool = [
      cand("me"),
      cand("old", 1000000, { leaseExpiresAt: 0 }),
      cand("draft", 1000000, { published: false }),
      cand("quiet", 1000000, { optIn: false }),
      cand("good", 1000000),
    ];
    const out = pickOpponent({ marks: [] }, seeker, pool, DAY);
    assert.equal(out.leaderId, "good");
  });

  it("picks the nearest rating with a deterministic tie-break", () => {
    const seeker = cand("me", 1000000);
    const pool = [cand("zz", 1000200), cand("aa", 1000200), cand("far", 1500000)];
    const out = pickOpponent({ marks: [] }, seeker, pool, DAY);
    assert.equal(out.leaderId, "aa");
  });

  it("returns null for an empty pool", () => {
    assert.equal(pickOpponent({ marks: [] }, cand("me"), [], DAY), null);
  });

  it("denies a third meeting inside the window", () => {
    const seeker = cand("me");
    let h = { marks: [] };
    h = recordPair(h, "me", "foe", 0);
    h = recordPair(h, "me", "foe", DAY);
    const pool = [cand("foe"), cand("fresh", 1000000)];
    const out = pickOpponent(h, seeker, pool, 2 * DAY);
    assert.equal(out.leaderId, "fresh");
  });

  it("opens the pair again after the window", () => {
    const seeker = cand("me");
    let h = { marks: [] };
    h = recordPair(h, "me", "foe", 0);
    h = recordPair(h, "me", "foe", DAY);
    const out = pickOpponent(h, seeker, [cand("foe", 1000000)], 2 * DAY + PAIR_WINDOW_MS + 1);
    assert.equal(out.leaderId, "foe");
  });

  it("counts pairs regardless of id order", () => {
    let h = { marks: [] };
    h = recordPair(h, "zebra", "apple", 0);
    const out = pickOpponent(h, cand("apple"), [cand("zebra", 1000000)], DAY);
    assert.equal(out.leaderId, "zebra");
  });
});
