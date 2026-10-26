import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWallet, earnAc, purchaseWithRealMoney } from "../src/index.ts";

describe("ledger earn", () => {
  it("credits 25 for a win and 10 for a loss", () => {
    const w = createWallet("w1");
    assert.deepEqual(earnAc(w, { key: "k1", kind: "win", suspicious: false, now: 0 }), { credited: 25, capped: false, keyUsed: false });
    assert.deepEqual(earnAc(w, { key: "k2", kind: "loss", suspicious: false, now: 1 }), { credited: 10, capped: false, keyUsed: false });
    assert.equal(w.ac, 35);
  });

  it("pays zero for no-contest and suspicious results", () => {
    const w = createWallet("w1");
    assert.equal(earnAc(w, { key: "k1", kind: "no-contest", suspicious: false, now: 0 }).credited, 0);
    assert.equal(earnAc(w, { key: "k2", kind: "win", suspicious: true, now: 1 }).credited, 0);
    assert.equal(w.ac, 0);
    assert.equal(w.txns.length, 2);
  });

  it("replays one key without double credit", () => {
    const w = createWallet("w1");
    earnAc(w, { key: "k1", kind: "win", suspicious: false, now: 0 });
    const again = earnAc(w, { key: "k1", kind: "win", suspicious: false, now: 0 });
    assert.equal(again.keyUsed, true);
    assert.equal(w.ac, 25);
  });

  it("caps AC at 150 per rolling day", () => {
    const w = createWallet("w1");
    let last = null;
    for (let i = 0; i < 7; i += 1) {
      last = earnAc(w, { key: `k${i}`, kind: "win", suspicious: false, now: i });
    }
    assert.equal(w.ac, 150);
    assert.equal(last.capped, true);
    assert.equal(last.credited, 0);
  });

  it("opens a fresh cap the next day", () => {
    const w = createWallet("w1");
    for (let i = 0; i < 6; i += 1) {
      earnAc(w, { key: `k${i}`, kind: "win", suspicious: false, now: i });
    }
    const next = earnAc(w, { key: "k9", kind: "win", suspicious: false, now: 24 * 60 * 60 * 1000 });
    assert.equal(next.credited, 25);
  });

  it("locks real money", () => {
    assert.throws(() => purchaseWithRealMoney(), /disabled pending legal review/);
  });
});
