import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_1V1,
  ARENA_FIRE_INTERVAL,
  ARENA_SKILL_COOLDOWN,
  buildArenaReplay,
  createBattle,
  DEFAULT_BATTLE,
  drive,
  observe,
  stepBattle,
} from "../src/index.ts";

const IDLE = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false, dash: false, shield: false };

function policyWith(when, move, extra = {}) {
  return {
    schemaVersion: 2,
    agentVersionId: "t-senses",
    dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 },
    rules: [{ id: "r1", when, move, ...extra }],
  };
}

describe("observe arena senses", () => {
  it("reads skillReady true on a fresh robot", () => {
    const s = createBattle(ARENA_1V1);
    assert.equal(observe(s, "A", ARENA_1V1).skillReady, true);
  });

  it("reads skillReady false without energy and during the lock", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.A.energy = 10;
    assert.equal(observe(s, "A", ARENA_1V1).skillReady, false);
    s = createBattle(ARENA_1V1);
    s = stepBattle(s, { A: { ...IDLE, skill: true }, B: IDLE }, ARENA_1V1);
    assert.equal(observe(s, "A", ARENA_1V1).skillReady, false);
    const ticks = Math.ceil(ARENA_SKILL_COOLDOWN * ARENA_1V1.world.tickHz) + 2;
    for (let t = 0; t < ticks; t += 1) s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.equal(observe(s, "A", ARENA_1V1).skillReady, true);
  });

  it("reads skillReady false inside the fire window", () => {
    let s = createBattle(ARENA_1V1);
    s = stepBattle(s, { A: { ...IDLE, fire: true }, B: IDLE }, ARENA_1V1);
    assert.equal(observe(s, "A", ARENA_1V1).skillReady, false);
    const ticks = Math.ceil(ARENA_FIRE_INTERVAL * ARENA_1V1.world.tickHz) + 2;
    for (let t = 0; t < ticks; t += 1) s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.equal(observe(s, "A", ARENA_1V1).skillReady, true);
  });

  it("reads no pickup as null distance and kind 0", () => {
    const s = createBattle(ARENA_1V1);
    const o = observe(s, "A", ARENA_1V1);
    assert.equal(o.pickupDist, null);
    assert.equal(o.pickupKind, 0);
  });

  it("reads the nearest pickup distance and kind code", () => {
    const s = createBattle(ARENA_1V1);
    s.agents.A.pos = { x: 2, y: 8 };
    s.arena.pickups.push(
      { id: 1, kind: "red", pos: { x: 12, y: 8 } },
      { id: 2, kind: "green", pos: { x: 6, y: 8 } },
      { id: 3, kind: "blue", pos: { x: 20, y: 8 } },
    );
    const o = observe(s, "A", ARENA_1V1);
    assert.equal(o.pickupDist, 4);
    assert.equal(o.pickupKind, 1);
    const b = observe(s, "B", ARENA_1V1);
    assert.equal(b.pickupKind, 2);
    assert.ok(Math.abs(b.pickupDist - 2) < 1e-9);
  });

  it("reads duel robots without skillReady and no pickups", () => {
    const s = createBattle(DEFAULT_BATTLE);
    const o = observe(s, "A", DEFAULT_BATTLE);
    assert.equal(o.skillReady, false);
    assert.equal(o.pickupDist, null);
    assert.equal(o.pickupKind, 0);
  });
});

describe("drive COLLECT", () => {
  const collect = policyWith({ operand: "ownHpPct", op: "gte", value: 0 }, "COLLECT");

  it("steers to the nearest pickup", () => {
    const s = createBattle(ARENA_1V1);
    s.agents.A.pos = { x: 10, y: 8 };
    s.arena.pickups.push({ id: 1, kind: "blue", pos: { x: 10, y: 12 } });
    const out = drive(s, collect, "A", ARENA_1V1);
    assert.ok(Math.abs(out.move.x - 0) < 1e-9);
    assert.ok(Math.abs(out.move.y - 1) < 1e-9);
  });

  it("holds position when no pickup lives", () => {
    const s = createBattle(ARENA_1V1);
    assert.deepEqual(drive(s, collect, "A", ARENA_1V1).move, { x: 0, y: 0 });
  });

  it("holds position in duel mode", () => {
    const s = createBattle(DEFAULT_BATTLE);
    assert.deepEqual(drive(s, collect, "A", DEFAULT_BATTLE).move, { x: 0, y: 0 });
  });

  it("walks a live pickup down and takes it", () => {
    const grab = policyWith({ operand: "pickupDist", op: "lt", value: 99 }, "COLLECT", { target: "NONE" });
    const wait = policyWith({ operand: "ownHpPct", op: "gte", value: 0 }, "WAIT", { target: "NONE" });
    let s = createBattle(ARENA_1V1);
    s.agents.A.pos = { x: 10, y: 8 };
    s.agents.A.hp = 50;
    s.agents.B.pos = { x: 22, y: 8 };
    s.arena.pickups.push({ id: 7, kind: "green", pos: { x: 11.5, y: 8 } });
    let took = 0;
    for (let t = 0; t < 120 && took === 0; t += 1) {
      s = stepBattle(s, { A: drive(s, grab, "A", ARENA_1V1), B: drive(s, wait, "B", ARENA_1V1) }, ARENA_1V1);
      took = s.arena.log.filter((e) => e.type === "pickup" && e.side === "A").length;
    }
    assert.equal(took, 1);
    assert.equal(s.agents.A.hp, 70);
  });
});

describe("arena replay combat events", () => {
  it("logs skill casts and shows powered shots in frames", () => {
    const skirmish = policyWith({ operand: "ownHpPct", op: "gte", value: 0 }, "APPROACH", { skill: true });
    const r = buildArenaReplay(skirmish, skirmish, "skill-visibility-1");
    const skills = r.rounds.flatMap((x) => x.events).filter((e) => e.type === "skill");
    assert.ok(skills.length > 0);
    const powered = r.rounds.flatMap((x) => x.frames).some((f) => (f.shots ?? []).some((sh) => sh.p === true));
    assert.equal(powered, true);
  });
});
