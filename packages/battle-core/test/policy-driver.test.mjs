import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checksum,
  createBattle,
  DEFAULT_BATTLE,
  drive,
  stepBattle,
} from "../src/index.ts";

const RUSH = {
  schemaVersion: 1,
  agentVersionId: "v1",
  dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
  rules: [
    { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 8 }, move: "APPROACH", fire: true },
    { id: "far-push", when: { operand: "distFoe", op: "gte", value: 8 }, move: "APPROACH", fire: false },
  ],
};

const TURTLE = {
  schemaVersion: 1,
  agentVersionId: "v2",
  dna: { aggression: 30, evasion: 80, preferredDistance: 60, energyConservation: 70 },
  rules: [
    { id: "weak-hide", when: { operand: "ownHpPct", op: "lt", value: 50 }, move: "SEEK_COVER" },
    { id: "hold-mid", when: { operand: "ownHpPct", op: "gte", value: 50 }, move: "STRAFE", fire: true },
  ],
};

const NEVER = {
  schemaVersion: 1,
  agentVersionId: "v3",
  dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 },
  rules: [
    { id: "impossible", when: { operand: "ownHpPct", op: "lt", value: 0 }, move: "RETREAT" },
  ],
};

function fight(pa, pb, seed = "driver-1") {
  const cfg = { ...DEFAULT_BATTLE, seed };
  let s = createBattle(cfg);
  let guard = 0;
  while (!s.over && guard < 2700) {
    s = stepBattle(s, { A: drive(s, pa, "A", cfg), B: drive(s, pb, "B", cfg) }, cfg);
    guard += 1;
  }
  return s;
}

describe("policy driver", () => {
  it("finishes a compiled-style fight with legal state", () => {
    const s = fight(RUSH, TURTLE);
    assert.equal(s.over, true);
    assert.ok(s.tick <= 2700);
    assert.ok(["A", "B", "DRAW"].includes(s.winner));
  });

  it("gives the same checksum for the same prompt and seed", () => {
    assert.equal(checksum(fight(RUSH, TURTLE, "det-9")), checksum(fight(RUSH, TURTLE, "det-9")));
  });

  it("finishes through the fallback when no rule matches", () => {
    const s = fight(NEVER, NEVER);
    assert.equal(s.over, true);
  });

  it("drives every movement intent without NaN", () => {
    const cfg = { ...DEFAULT_BATTLE, seed: "moves" };
    const s = createBattle(cfg);
    for (const move of ["APPROACH", "RETREAT", "KITE", "STRAFE", "SEEK_COVER", "CAPTURE"]) {
      const p = { ...RUSH, rules: [{ id: "m", when: { operand: "ownHpPct", op: "gte", value: 0 }, move }] };
      const a = drive(s, p, "A", cfg);
      assert.ok(Number.isFinite(a.move.x));
      assert.ok(Number.isFinite(a.move.y));
    }
  });
});
