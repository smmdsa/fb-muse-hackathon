import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePolicy } from "../src/index.ts";

function base() {
  return {
    schemaVersion: 1,
    agentVersionId: "v1",
    dna: { aggression: 35, evasion: 80, preferredDistance: 65, energyConservation: 70 },
    rules: [
      {
        id: "r1",
        when: { operand: "distFoe", op: "lt", value: 6 },
        move: "RETREAT",
        fire: true,
      },
    ],
  };
}

describe("validator accept", () => {
  it("passes a valid SHADOW-style draft", () => {
    const check = validatePolicy(base());
    assert.equal(check.ok, true);
    assert.deepEqual(check.errors, []);
  });
});

describe("validator reject", () => {
  it("rejects 33 rules", () => {
    const p = base();
    p.rules = Array.from({ length: 33 }, (_, i) => ({
      id: `r${i}`,
      when: { operand: "ownHpPct", op: "gte", value: 0 },
      move: "CAPTURE",
    }));
    const check = validatePolicy(p);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("at most 32")));
  });

  it("rejects depth 5", () => {
    const deep = { all: [{ all: [{ all: [{ all: [{ operand: "ownHpPct", op: "gte", value: 0 }] }] }] }] };
    const p = base();
    p.rules = [{ id: "deep", when: deep, move: "CAPTURE" }];
    const check = validatePolicy(p);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("depth")));
  });

  it("rejects 65 nodes", () => {
    const kids = Array.from({ length: 65 }, () => ({ operand: "ownHpPct", op: "gte", value: 0 }));
    const p = base();
    p.rules = [{ id: "wide", when: { all: kids }, move: "CAPTURE" }];
    const check = validatePolicy(p);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("nodes")));
  });

  it("rejects an unknown operand", () => {
    const p = base();
    p.rules = [{
      id: "bad",
      when: { operand: "enemyMood", op: "gt", value: 1 },
      move: "CAPTURE",
    }];
    const check = validatePolicy(p);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("unknown operand")));
  });

  it("rejects an unknown action", () => {
    const p = base();
    p.rules = [{ id: "bad", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "TELEPORT" }];
    const check = validatePolicy(p);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("unknown move")));
  });

  it("rejects a repeated rule id", () => {
    const p = base();
    p.rules = [...p.rules, { ...p.rules[0] }];
    const check = validatePolicy(p);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("repeats")));
  });

  it("rejects a bad trait", () => {
    const p = base();
    p.dna.aggression = 101;
    const check = validatePolicy(p);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("dna.aggression")));
  });
});
