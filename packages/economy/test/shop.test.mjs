import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWallet, earnAc, purchase } from "../src/index.ts";

function rich() {
  const w = createWallet("w1", 100);
  for (let i = 0; i < 6; i += 1) {
    earnAc(w, { key: `e${i}`, kind: "win", suspicious: false, now: i });
  }
  return w;
}

describe("mock shop", () => {
  it("sells a cosmetic once per key", () => {
    const w = rich();
    assert.equal(w.ac, 150);
    const r1 = purchase(w, { key: "p1", itemId: "skin-ember", now: 10 });
    assert.equal(r1.ok, true);
    assert.equal(w.ac, 50);
    assert.deepEqual(w.owned, ["skin-ember"]);
    const r2 = purchase(w, { key: "p1", itemId: "skin-ember", now: 11 });
    assert.equal(r2.ok, true);
    assert.equal(w.ac, 50);
  });

  it("refuses a poor wallet without charge", () => {
    const w = createWallet("w1");
    const r = purchase(w, { key: "p1", itemId: "skin-ember", now: 10 });
    assert.equal(r.ok, false);
    assert.equal(w.txns.length, 0);
  });

  it("refuses an unknown item", () => {
    const w = rich();
    const r = purchase(w, { key: "p1", itemId: "nope", now: 10 });
    assert.equal(r.ok, false);
  });

  it("spends seeded mock RP", () => {
    const w = createWallet("w1", 100);
    const r = purchase(w, { key: "p1", itemId: "trail-spark", now: 10 });
    assert.equal(r.ok, true);
    assert.equal(w.rp, 80);
  });
});
