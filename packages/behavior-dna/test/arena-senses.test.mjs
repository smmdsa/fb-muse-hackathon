import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, test, validatePolicy } from "../src/index.ts";

function policyWith(when, move = "COLLECT", extra = {}) {
  return {
    schemaVersion: 2,
    agentVersionId: "t-arena-senses",
    dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 },
    rules: [{ id: "r1", when, move, ...extra }],
  };
}

function obs(over = {}) {
  return {
    ownHpPct: 100,
    energy: 100,
    distFoe: 10,
    projectileTti: null,
    coverDist: 3,
    lineOfSight: true,
    dashReady: true,
    shieldReady: true,
    skillReady: true,
    foeLastSeenAge: 0,
    objectiveDist: 5,
    timeLeft: 80,
    edgeDist: 4,
    foeHpPct: 90,
    gameTime: 5,
    foeAlive: true,
    pickupDist: null,
    pickupKind: 0,
    ...over,
  };
}

describe("validator arena senses", () => {
  it("accepts the new pickup and skill operands", () => {
    const whens = [
      { operand: "skillReady", op: "eq", value: true },
      { operand: "pickupDist", op: "lt", value: 5 },
      { operand: "pickupKind", op: "eq", value: 1 },
    ];
    for (const when of whens) {
      const check = validatePolicy(policyWith(when));
      assert.equal(check.ok, true, check.errors.join("; "));
    }
  });

  it("accepts the COLLECT move and the skill flag", () => {
    const p = policyWith({ operand: "pickupDist", op: "lt", value: 5 }, "COLLECT", { skill: true });
    const check = validatePolicy(p);
    assert.equal(check.ok, true, check.errors.join("; "));
  });

  it("keeps legacy policies valid", () => {
    const legacy = {
      schemaVersion: 1,
      agentVersionId: "t-legacy",
      dna: { aggression: 35, evasion: 80, preferredDistance: 65, energyConservation: 70 },
      rules: [
        { id: "farm", when: { operand: "nearFoeMinions", op: "gte", value: 1 }, move: "PUSH", fire: true, buy: "scrap_blade", target: "MINION" },
        { id: "old", when: { operand: "distFoe", op: "lt", value: 6 }, move: "RETREAT" },
      ],
    };
    const check = validatePolicy(legacy);
    assert.equal(check.ok, true, check.errors.join("; "));
  });

  it("still rejects unknown operands, moves, and fields", () => {
    assert.equal(validatePolicy(policyWith({ operand: "pickupFoo", op: "lt", value: 1 })).ok, false);
    assert.equal(validatePolicy(policyWith({ operand: "ownHpPct", op: "gte", value: 0 }, "FETCH")).ok, false);
    const bad = policyWith({ operand: "ownHpPct", op: "gte", value: 0 });
    bad.rules[0].collect = true;
    const check = validatePolicy(bad);
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("unknown field")));
  });
});

describe("evaluator arena senses", () => {
  it("reads skillReady true and false", () => {
    const when = { operand: "skillReady", op: "eq", value: true };
    assert.equal(test(when, obs({ skillReady: true })), true);
    assert.equal(test(when, obs({ skillReady: false })), false);
  });

  it("matches pickupDist only when a pickup lives", () => {
    const when = { operand: "pickupDist", op: "lt", value: 5 };
    assert.equal(test(when, obs({ pickupDist: 3 })), true);
    assert.equal(test(when, obs({ pickupDist: 9 })), false);
    assert.equal(test(when, obs({ pickupDist: null })), false);
  });

  it("matches pickupKind codes 0 to 3", () => {
    assert.equal(test({ operand: "pickupKind", op: "eq", value: 0 }, obs({ pickupKind: 0 })), true);
    assert.equal(test({ operand: "pickupKind", op: "eq", value: 1 }, obs({ pickupKind: 1 })), true);
    assert.equal(test({ operand: "pickupKind", op: "eq", value: 2 }, obs({ pickupKind: 2 })), true);
    assert.equal(test({ operand: "pickupKind", op: "eq", value: 3 }, obs({ pickupKind: 3 })), true);
    assert.equal(test({ operand: "pickupKind", op: "eq", value: 1 }, obs({ pickupKind: 2 })), false);
  });

  it("fails closed when the new readings are missing", () => {
    const bare = obs();
    delete bare.skillReady;
    delete bare.pickupDist;
    delete bare.pickupKind;
    assert.equal(test({ operand: "skillReady", op: "eq", value: true }, bare), false);
    assert.equal(test({ operand: "pickupDist", op: "lt", value: 99 }, bare), false);
    assert.equal(test({ operand: "pickupKind", op: "eq", value: 0 }, bare), false);
  });

  it("passes COLLECT and skill through to intents", () => {
    const out = evaluate(policyWith({ operand: "ownHpPct", op: "gte", value: 0 }, "COLLECT", { skill: true }), obs());
    assert.equal(out.move, "COLLECT");
    assert.equal(out.skill, true);
    assert.equal(out.ruleId, "r1");
  });
});
