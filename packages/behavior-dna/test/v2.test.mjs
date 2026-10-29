import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, fallback, validatePolicy } from "../src/index.ts";

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
    ownGold: 350,
    ownDeaths: 0,
    gameTime: 61,
    distFoeTower: 5.5,
    foeTowerHpPct: 100,
    nearFoeMinions: 2,
    nearAllyMinions: 3,
    distFoeMinion: 3,
    foeHpPct: 90,
    buildValue: 0,
    slotsFree: 6,
    structLead: 0,
    ...patch,
  };
}

function v2(rules) {
  return {
    schemaVersion: 2,
    agentVersionId: "v2",
    dna: { aggression: 55, evasion: 55, preferredDistance: 45, energyConservation: 50 },
    rules,
  };
}

describe("v2 schema", () => {
  it("accepts buy rules, new moves, and new operands", () => {
    const check = validatePolicy(v2([
      {
        id: "buy-once",
        when: { all: [{ operand: "ownGold", op: "gte", value: 250 }, { operand: "buildValue", op: "lt", value: 250 }] },
        move: "APPROACH",
        buy: "scrap_blade",
      },
      { id: "push", when: { operand: "nearFoeMinions", op: "gte", value: 1 }, move: "PUSH", fire: true },
      { id: "farm", when: { operand: "distFoeMinion", op: "lt", value: 6 }, move: "FARM", fire: true },
      { id: "guard", when: { operand: "structLead", op: "lt", value: 0 }, move: "DEFEND" },
    ]));
    assert.equal(check.ok, true);
    assert.deepEqual(check.errors, []);
  });

  it("keeps v1 policies valid with missing buy", () => {
    const check = validatePolicy({
      schemaVersion: 1,
      agentVersionId: "v1",
      dna: { aggression: 35, evasion: 80, preferredDistance: 65, energyConservation: 70 },
      rules: [{ id: "r1", when: { operand: "distFoe", op: "lt", value: 6 }, move: "RETREAT" }],
    });
    assert.equal(check.ok, true);
  });

  it("fails unknown buy ids and names the id", () => {
    const check = validatePolicy(v2([
      { id: "bad-buy", when: { operand: "ownGold", op: "gte", value: 0 }, move: "CAPTURE", buy: "doom_blade" },
    ]));
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((e) => e.includes("doom_blade")), check.errors.join("; "));
  });

  it("fails non-string buy values", () => {
    const check = validatePolicy(v2([
      { id: "bad-buy", when: { operand: "ownGold", op: "gte", value: 0 }, move: "CAPTURE", buy: 42 },
    ]));
    assert.equal(check.ok, false);
  });
});

describe("v2 evaluator", () => {
  it("passes the rule buy through to intents", () => {
    const out = evaluate(v2([
      { id: "buy-once", when: { operand: "ownGold", op: "gte", value: 250 }, move: "APPROACH", buy: "cloth_weave" },
    ]), obs());
    assert.equal(out.ruleId, "buy-once");
    assert.equal(out.buy, "cloth_weave");
  });

  it("reads missing buy as null", () => {
    const out = evaluate(v2([
      { id: "plain", when: { operand: "ownGold", op: "gte", value: 0 }, move: "APPROACH" },
    ]), obs());
    assert.equal(out.buy, null);
    assert.equal(fallback().buy, null);
  });

  it("reads missing new operands as false and never throws", () => {
    const bare = {
      ownHpPct: 80, energy: 60, distFoe: 4, projectileTti: null, coverDist: null,
      lineOfSight: true, dashReady: true, shieldReady: true, foeLastSeenAge: 0,
      objectiveDist: 9, timeLeft: 60, edgeDist: 5,
    };
    const out = evaluate(v2([
      { id: "moba-only", when: { operand: "nearFoeMinions", op: "gte", value: 1 }, move: "PUSH" },
    ]), bare);
    assert.equal(out.ruleId, "fallback-safe");
  });

  it("fails null operand reads closed", () => {
    const out = evaluate(v2([
      { id: "snipe", when: { operand: "distFoeMinion", op: "lt", value: 6 }, move: "FARM" },
    ]), obs({ distFoeMinion: null }));
    assert.equal(out.ruleId, "fallback-safe");
  });

  it("gates foeHpPct on line of sight", () => {
    const p = v2([
      { id: "duel", when: { operand: "foeHpPct", op: "lt", value: 50 }, move: "APPROACH", fire: true },
    ]);
    assert.equal(evaluate(p, obs({ foeHpPct: 20, lineOfSight: true })).ruleId, "duel");
    assert.equal(evaluate(p, obs({ foeHpPct: 20, lineOfSight: false })).ruleId, "fallback-safe");
  });
});
