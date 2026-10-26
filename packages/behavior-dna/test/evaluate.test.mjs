import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, fallback, FALLBACK_RULE_ID } from "../src/index.ts";

function obs(patch = {}) {
  return {
    ownHpPct: 80,
    energy: 60,
    distFoe: 4,
    projectileTti: null,
    coverDist: null,
    lineOfSight: true,
    dashReady: true,
    shieldReady: true,
    foeLastSeenAge: 0,
    objectiveDist: 9,
    timeLeft: 60,
    edgeDist: 5,
    ...patch,
  };
}

const POLICY = {
  schemaVersion: 1,
  agentVersionId: "v1",
  dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
  rules: [
    {
      id: "weak-retreat",
      when: { operand: "ownHpPct", op: "lt", value: 25 },
      move: "RETREAT",
      fire: false,
    },
    {
      id: "close-push",
      when: { all: [{ operand: "distFoe", op: "lt", value: 6 }] },
      move: "APPROACH",
      fire: true,
    },
  ],
};

describe("evaluator", () => {
  it("returns the first matching rule", () => {
    const out = evaluate(POLICY, obs({ ownHpPct: 10, distFoe: 3 }));
    assert.equal(out.ruleId, "weak-retreat");
    assert.equal(out.move, "RETREAT");
  });

  it("skips a false first rule and takes the second", () => {
    const out = evaluate(POLICY, obs({ ownHpPct: 90, distFoe: 3 }));
    assert.equal(out.ruleId, "close-push");
    assert.equal(out.fire, true);
  });

  it("returns the fallback when no rule matches", () => {
    const out = evaluate(POLICY, obs({ ownHpPct: 90, distFoe: 30 }));
    assert.equal(out.ruleId, FALLBACK_RULE_ID);
    assert.equal(out.move, "CAPTURE");
    assert.equal(out.fire, false);
  });

  it("reads a hidden foe as null and fails closed", () => {
    const out = evaluate(POLICY, obs({ ownHpPct: 90, distFoe: 3, lineOfSight: false }));
    assert.equal(out.ruleId, FALLBACK_RULE_ID);
  });

  it("supports any and not", () => {
    const p = {
      ...POLICY,
      rules: [{
        id: "dash-in",
        when: { any: [{ not: { operand: "dashReady", op: "eq", value: true } }, { operand: "energy", op: "gt", value: 50 }] },
        move: "APPROACH",
        dash: true,
      }],
    };
    const out = evaluate(p, obs());
    assert.equal(out.ruleId, "dash-in");
    assert.equal(out.dash, true);
  });

  it("fallback never fires", () => {
    assert.equal(fallback().fire, false);
  });
});
