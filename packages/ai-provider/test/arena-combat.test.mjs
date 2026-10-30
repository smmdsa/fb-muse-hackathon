import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, validatePolicy } from "@agent-wars/behavior-dna";
import { compileMock, createMetaProvider } from "../src/index.ts";

const POLICY_TEXT = JSON.stringify({
  schemaVersion: 1,
  agentVersionId: "v9",
  dna: { aggression: 80, evasion: 40, preferredDistance: 25, energyConservation: 50 },
  rules: [
    { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "weak-retreat", when: { operand: "ownHpPct", op: "lt", value: 25 }, move: "RETREAT" },
  ],
});

const chatOk = (text) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: text } }] }),
});

async function systemBrief() {
  let system = "";
  const fetchFn = async (url, init) => {
    system = JSON.parse(init.body).messages.find((m) => m.role === "system").content;
    return chatOk(POLICY_TEXT)();
  };
  await createMetaProvider({ META_SPARK_KEY: "s" }, fetchFn).compileStrategy({ prompt: "rush", agentVersionId: "v9" });
  return system;
}

const ARENA_OPERANDS = [
  "ownHpPct", "energy", "distFoe", "projectileTti", "coverDist", "lineOfSight",
  "dashReady", "shieldReady", "objectiveDist", "timeLeft", "edgeDist",
  "foeHpPct", "gameTime", "foeAlive", "skillReady", "pickupDist", "pickupKind",
];

const ARENA_MOVES = ["APPROACH", "RETREAT", "STRAFE", "KITE", "CAPTURE", "SEEK_COVER", "WAIT", "COLLECT"];

describe("arena prompt contract", () => {
  it("lists every arena operand and move exactly", async () => {
    const system = await systemBrief();
    assert.ok(system.includes("Operands, exactly these:"));
    assert.ok(system.includes("Moves, exactly these:"));
    for (const op of ARENA_OPERANDS) assert.ok(system.includes(op), `system names operand ${op}`);
    for (const move of ARENA_MOVES) assert.ok(system.includes(move), `system names move ${move}`);
  });

  it("teaches the skill flag and the pickup sensors", async () => {
    const system = await systemBrief();
    for (const token of ["\"skill\"", "skillReady", "pickupDist", "pickupKind", "COLLECT", "0 none, 1 green, 2 blue, 3 red"]) {
      assert.ok(system.includes(token), `system teaches ${token}`);
    }
  });

  it("teaches exact combat facts: range, pace, energy, costs, pickups", async () => {
    const system = await systemBrief();
    for (const token of [
      "6u",
      "1.025s",
      "100",
      "5 per second",
      "25 energy",
      "0.8s",
      "4s",
      "20-damage powered shot",
      "3s lock",
      "Green heals 20 HP",
      "blue shields for 5s",
      "12% damage for 15s",
      "at most 3 live",
    ]) {
      assert.ok(system.includes(token), `system teaches ${token}`);
    }
  });
});

function flatOperands(when, out = []) {
  if (!when || typeof when !== "object") return out;
  if (when.operand) out.push(when.operand);
  for (const k of ["all", "any"]) {
    if (Array.isArray(when[k])) for (const kid of when[k]) flatOperands(kid, out);
  }
  if (when.not) flatOperands(when.not, out);
  return out;
}

describe("mock pool arena features", () => {
  async function trios() {
    const found = new Map();
    for (let i = 0; i < 500 && found.size < 8; i += 1) {
      const out = await compileMock({ prompt: `arena probe ${i}`, agentVersionId: "v1" });
      assert.equal(validatePolicy(out.policy).ok, true);
      const key = out.policy.rules.map((r) => r.id).join("+");
      if (!found.has(key)) found.set(key, out.policy);
    }
    assert.equal(found.size, 8);
    return [...found.values()];
  }

  it("drafts trios that use pickups, energy, and skill", async () => {
    const all = (await trios()).flatMap((p) => p.rules);
    assert.ok(all.some((r) => r.move === "COLLECT"), "pool walks to pickups");
    assert.ok(all.some((r) => r.skill === true), "pool fires the skill");
    const operands = all.flatMap((r) => flatOperands(r.when));
    for (const op of ["pickupDist", "pickupKind", "skillReady", "energy"]) {
      assert.ok(operands.includes(op), `pool reads ${op}`);
    }
  });

  it("matches a pickup rule on a looting tick", async () => {
    const looting = {
      ownHpPct: 55, energy: 100, distFoe: 12, projectileTti: null, coverDist: 4,
      lineOfSight: true, dashReady: true, shieldReady: true, skillReady: true, foeLastSeenAge: 0,
      objectiveDist: 8, timeLeft: 70, edgeDist: 4, foeHpPct: 90, gameTime: 12, foeAlive: true,
      pickupDist: 3, pickupKind: 1,
    };
    const all = (await trios()).flatMap((p) => p.rules);
    const grab = all.find((r) => r.id === "grab-near");
    const hurt = all.find((r) => r.id === "hurt-green");
    assert.ok(grab && hurt, "pool holds both pickup rules");
    const solo = (rule) => ({ schemaVersion: 2, agentVersionId: "v1", dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 }, rules: [rule] });
    assert.equal(evaluate(solo(grab), looting).ruleId, "grab-near");
    assert.equal(evaluate(solo(hurt), looting).ruleId, "hurt-green");
  });
});
