import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ARENA_1V1, BENCH_POLICY, BOT_PRESETS, buildArenaReplay, buildReplay, createBattle, drive, fightSeries, seriesWinner, stepBattle } from "../src/index.ts";
import { validatePolicy } from "@agent-wars/behavior-dna";

const SHADOW = BOT_PRESETS[0].policy;
const BREAKER = BOT_PRESETS[2].policy;

describe("arena 1v1 series", () => {
  it("plays best of 3: first to 2 round wins ends the series", () => {
    const s = fightSeries(SHADOW, BREAKER, "matrix-0-2");
    assert.equal(s.winner, "B");
    assert.deepEqual(s.score, { A: 0, B: 2 });
    assert.equal(s.rounds.length, 2);
    assert.deepEqual(s.rounds.map((r) => r.winner), ["B", "B"]);
    assert.equal(s.ticks, s.rounds[0].ticks + s.rounds[1].ticks);
  });

  it("pins one series checksum: same seed, same bytes", () => {
    const a = fightSeries(SHADOW, BREAKER, "matrix-0-2");
    const b = fightSeries(SHADOW, BREAKER, "matrix-0-2");
    assert.equal(a.checksum, "74a8757e");
    assert.deepEqual(a, b);
  });

  it("keeps series to 2 or 3 rounds with a score that matches", () => {
    const pool = [SHADOW, BOT_PRESETS[1].policy, BREAKER, BENCH_POLICY];
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = 0; j < pool.length; j += 1) {
        if (i === j) continue;
        const s = fightSeries(pool[i], pool[j], `arena-shape-${i}-${j}`);
        assert.ok(s.rounds.length === 2 || s.rounds.length === 3);
        const wins = { A: 0, B: 0 };
        for (const r of s.rounds) {
          if (r.winner === "A") wins.A += 1;
          if (r.winner === "B") wins.B += 1;
        }
        assert.deepEqual(s.score, wins);
        if (s.rounds.length === 2) assert.ok(wins.A === 2 || wins.B === 2);
      }
    }
  });

  it("resets the arena each round and rotates spawns", () => {
    const r = buildArenaReplay(SHADOW, BREAKER, "matrix-0-2");
    assert.equal(r.version, 3);
    assert.equal(r.mode, "arena");
    assert.equal(r.rounds.length, 2);
    assert.deepEqual([r.rounds[0].frames[0].ax, r.rounds[0].frames[0].ay], [2, 8]);
    assert.deepEqual([r.rounds[1].frames[0].ax, r.rounds[1].frames[0].ay], [22, 8]);
    for (const round of r.rounds) {
      const f0 = round.frames[0];
      assert.equal(f0.t, 0);
      assert.equal(f0.ahp, 100);
      assert.equal(f0.bhp, 100);
      assert.ok(round.frames.length > 2);
      assert.equal(round.frames[round.frames.length - 1].t, round.ticks);
    }
  });

  it("shares one checksum between settle and replay", () => {
    const s = fightSeries(SHADOW, BREAKER, "matrix-0-2");
    const r = buildArenaReplay(SHADOW, BREAKER, "matrix-0-2");
    assert.equal(r.checksum, s.checksum);
    assert.equal(r.ticks, s.ticks);
    assert.equal(r.winner, s.winner);
    assert.deepEqual(r.score, s.score);
    assert.deepEqual(r.rounds.map((x) => x.winner), s.rounds.map((x) => x.winner));
  });

  it("auto-attacks the visible foe in range, and holds fire on NONE or far foes", () => {
    const hold = {
      schemaVersion: 2,
      agentVersionId: "t-hold",
      dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 },
      rules: [{ id: "hold", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "WAIT" }],
    };
    const near = createBattle(ARENA_1V1);
    near.agents.B.pos = { x: 7, y: 8 };
    const out = drive(near, hold, "A", ARENA_1V1);
    assert.equal(out.fire, true);
    assert.deepEqual(out.aim, { x: 1, y: 0 });
    const far = createBattle(ARENA_1V1);
    assert.equal(drive(far, hold, "A", ARENA_1V1).fire, false);
    const quiet = {
      ...hold,
      rules: [{ id: "hold", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "WAIT", target: "NONE" }],
    };
    const silent = drive(near, quiet, "A", ARENA_1V1);
    assert.equal(silent.fire, false);
  });

  it("draws all three rounds when neither robot acts", () => {
    const wait = {
      schemaVersion: 2,
      agentVersionId: "t-wait",
      dna: { aggression: 0, evasion: 50, preferredDistance: 50, energyConservation: 50 },
      rules: [{ id: "wait", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "WAIT", target: "NONE" }],
    };
    const s = fightSeries(wait, wait, "draw-seed-1");
    assert.equal(s.rounds.length, 3);
    assert.deepEqual(s.rounds.map((r) => r.winner), ["DRAW", "DRAW", "DRAW"]);
    assert.deepEqual(s.score, { A: 0, B: 0 });
    assert.equal(s.winner, "DRAW");
    assert.equal(s.ticks, 8100);
  });

  it("breaks tied series on total damage, then stands on draws", () => {
    const rounds = [
      { round: 1, winner: "A", ticks: 100, checksum: "a", damageA: 40, damageB: 10 },
      { round: 2, winner: "B", ticks: 100, checksum: "b", damageA: 10, damageB: 10 },
      { round: 3, winner: "DRAW", ticks: 2700, checksum: "c", damageA: 0, damageB: 0 },
    ];
    assert.equal(seriesWinner(1, 1, rounds), "A");
    assert.equal(seriesWinner(2, 0, rounds), "A");
    assert.equal(seriesWinner(0, 2, rounds), "B");
    const blanks = rounds.map((r) => ({ ...r, winner: "DRAW", damageA: 0, damageB: 0 }));
    assert.equal(seriesWinner(0, 0, blanks), "DRAW");
  });

  it("spawns diagonally on shift 2", () => {
    const s = createBattle({ ...ARENA_1V1, spawnShift: 2 });
    assert.deepEqual([s.agents.A.pos.x, s.agents.A.pos.y], [6, 4]);
    assert.deepEqual([s.agents.B.pos.x, s.agents.B.pos.y], [18, 12]);
    assert.ok(s.agents.A.aim.x > 0 && s.agents.A.aim.y > 0);
    assert.ok(s.agents.B.aim.x < 0 && s.agents.B.aim.y < 0);
  });
});


describe("arena combat: range, cooldown, energy, skill, pickups", () => {
  const IDLE = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false, dash: false, shield: false };
  const fireEast = () => ({ move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: true, dash: false, shield: false });
  const fireWest = () => ({ move: { x: 0, y: 0 }, aim: { x: -1, y: 0 }, fire: true, dash: false, shield: false });
  const SEED_CFG = { ...ARENA_1V1, seed: "pickup-seed-1" };

  it("fizzles shots past 6u and lands hits inside it", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.A.pos = { x: 2, y: 8 };
    s.agents.B.pos = { x: 20, y: 8 };
    for (let t = 0; t < 30; t += 1) s = stepBattle(s, { A: fireEast(), B: IDLE }, ARENA_1V1);
    assert.equal(s.agents.B.hp, 100);
    assert.equal(s.projectiles.length, 0);
    s.agents.B.pos = { x: 6, y: 8 };
    for (let t = 0; t < 90; t += 1) s = stepBattle(s, { A: fireEast(), B: IDLE }, ARENA_1V1);
    assert.ok(s.agents.B.hp < 100);
    assert.ok(s.agents.A.damageDealt > 0);
  });

  it("paces fire at 1.025s", () => {
    let s = createBattle(ARENA_1V1);
    for (let t = 0; t < 31; t += 1) s = stepBattle(s, { A: fireEast(), B: IDLE }, ARENA_1V1);
    assert.equal(s.nextProjectileId, 2);
    for (let t = 0; t < 4; t += 1) s = stepBattle(s, { A: fireEast(), B: IDLE }, ARENA_1V1);
    assert.equal(s.nextProjectileId, 3);
  });

  it("regenerates 5 energy per second", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.A.energy = 0;
    for (let t = 0; t < 30; t += 1) s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.ok(Math.abs(s.agents.A.energy - 5) < 1e-9);
  });

  it("fires the skill from a policy rule for 25 energy on a 3s lock", () => {
    const skill = {
      schemaVersion: 2,
      agentVersionId: "t-skill",
      dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 },
      rules: [{ id: "sk", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "WAIT", skill: true }],
    };
    assert.equal(validatePolicy(skill).ok, true);
    let s = createBattle(ARENA_1V1);
    s.agents.B.pos = { x: 6, y: 8 };
    assert.equal(drive(s, skill, "A", ARENA_1V1).skill, true);
    const before = s.agents.A.energy;
    s = stepBattle(s, { A: { ...IDLE, skill: true }, B: IDLE }, ARENA_1V1);
    assert.ok(Math.abs(s.agents.A.energy - (before - 25 + 5 / 30)) < 1e-9);
    assert.equal(s.projectiles.length, 1);
    assert.equal(s.projectiles[0].powered, true);
    assert.equal(s.projectiles[0].dmg, 20);
    assert.ok(s.agents.A.skillCooldownUntil > s.time);
    const idAfter = s.nextProjectileId;
    s = stepBattle(s, { A: { ...IDLE, skill: true }, B: IDLE }, ARENA_1V1);
    assert.equal(s.nextProjectileId, idAfter);
    for (let t = 0; t < 30; t += 1) s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.equal(s.agents.B.hp, 80);
  });

  it("spawns pickups on a fixed clock with a stable seed", () => {
    const run = () => {
      let s = createBattle(SEED_CFG);
      for (let t = 0; t < 150; t += 1) s = stepBattle(s, { A: IDLE, B: IDLE }, SEED_CFG);
      return s;
    };
    const a = run();
    const b = run();
    assert.equal(a.arena.pickups.length, 1);
    assert.deepEqual(a.arena.pickups, b.arena.pickups);
    assert.ok(["green", "blue", "red"].includes(a.arena.pickups[0].kind));
  });

  it("heals 20hp on green", () => {
    let s = createBattle(ARENA_1V1);
    s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    s.agents.A.hp = 50;
    s.agents.A.pos = { x: 12, y: 8 };
    s.arena.pickups.push({ id: 99, kind: "green", pos: { x: 12, y: 8 } });
    s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.equal(s.arena.pickups.length, 0);
    assert.equal(s.agents.A.hp, 70);
    assert.deepEqual(s.arena.log[s.arena.log.length - 1].type, "pickup");
  });

  it("blocks shots on blue shield", () => {
    let s = createBattle(ARENA_1V1);
    s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    s.agents.A.hp = 50;
    s.agents.A.pos = { x: 12, y: 8 };
    s.agents.B.pos = { x: 16, y: 8 };
    s.arena.pickups.push({ id: 99, kind: "blue", pos: { x: 12, y: 8 } });
    s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.ok(s.agents.A.shieldUntil > s.time);
    for (let t = 0; t < 15; t += 1) s = stepBattle(s, { A: IDLE, B: fireWest() }, ARENA_1V1);
    assert.equal(s.agents.A.hp, 50);
  });

  it("boosts damage 12% on red", () => {
    let s = createBattle(ARENA_1V1);
    s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    s.agents.A.pos = { x: 12, y: 8 };
    s.agents.B.pos = { x: 16, y: 8 };
    s.arena.pickups.push({ id: 99, kind: "red", pos: { x: 12, y: 8 } });
    s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    s = stepBattle(s, { A: fireEast(), B: IDLE }, ARENA_1V1);
    assert.ok(s.agents.A.dmgBuffUntil > s.time);
    for (let t = 0; t < 15; t += 1) s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.ok(Math.abs(s.agents.B.hp - 88.8) < 1e-9);
  });

  it("carries shots, pickups, and flags in arena frames", () => {
    const rush = {
      schemaVersion: 2,
      agentVersionId: "t-rush",
      dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
      rules: [{ id: "r", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "APPROACH", fire: true }],
    };
    const r = buildArenaReplay(rush, rush, "frame-carry-1");
    const f0 = r.rounds[0].frames[0];
    assert.ok(Array.isArray(f0.shots));
    assert.ok(Array.isArray(f0.pickups));
    assert.equal(typeof f0.ash, "boolean");
    assert.equal(typeof f0.bbf, "boolean");
    const all = r.rounds.flatMap((x) => x.frames);
    assert.ok(all.some((f) => (f.shots || []).length > 0));
    const wait = {
      schemaVersion: 2,
      agentVersionId: "t-wait",
      dna: { aggression: 0, evasion: 50, preferredDistance: 50, energyConservation: 50 },
      rules: [{ id: "w", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "WAIT", target: "NONE" }],
    };
    const w = buildArenaReplay(wait, wait, "frame-carry-2");
    const at150 = w.rounds[0].frames.find((f) => f.t === 150);
    assert.equal(at150.pickups.length, 1);
  });

  it("lands hits at the 6.9 edge and fizzles past the 7 gate", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.A.pos = { x: 2, y: 8 };
    s.agents.B.pos = { x: 8.9, y: 8 };
    for (let t = 0; t < 60; t += 1) s = stepBattle(s, { A: fireEast(), B: IDLE }, ARENA_1V1);
    assert.ok(s.agents.B.hp < 100);
    assert.ok(s.agents.A.damageDealt > 0);
    s.agents.B.pos = { x: 12, y: 8 };
    s.agents.B.hp = 100;
    for (let t = 0; t < 60; t += 1) s = stepBattle(s, { A: fireEast(), B: IDLE }, ARENA_1V1);
    assert.equal(s.agents.B.hp, 100);
  });

  it("shares one barrel between skill and fire", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.B.pos = { x: 6, y: 8 };
    s = stepBattle(s, { A: { ...IDLE, fire: true, skill: true }, B: IDLE }, ARENA_1V1);
    assert.equal(s.projectiles.length, 1);
    assert.equal(s.projectiles[0].powered, true);
    s = stepBattle(s, { A: { ...IDLE, fire: true }, B: IDLE }, ARENA_1V1);
    assert.equal(s.projectiles.length, 1);
  });

  it("holds the skill below 25 pre-regen energy", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.A.energy = 24.9;
    s = stepBattle(s, { A: { ...IDLE, skill: true }, B: IDLE }, ARENA_1V1);
    assert.equal(s.projectiles.length, 0);
    assert.ok(Math.abs(s.agents.A.energy - (24.9 + 5 / 30)) < 1e-9);
    assert.ok(!(s.agents.A.skillCooldownUntil > s.time));
  });

  it("boosts the powered shot 12% on red", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.A.pos = { x: 2, y: 8 };
    s.agents.B.pos = { x: 6, y: 8 };
    s.arena.pickups.push({ id: 99, kind: "red", pos: { x: 2, y: 8 } });
    s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.ok(s.agents.A.dmgBuffUntil > s.time);
    s = stepBattle(s, { A: { ...IDLE, skill: true }, B: IDLE }, ARENA_1V1);
    assert.equal(s.projectiles.length, 1);
    for (let t = 0; t < 15; t += 1) s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.ok(Math.abs(s.agents.B.hp - (100 - 20 * 1.12)) < 1e-9);
  });

  it("blocks the powered shot on shield", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.A.pos = { x: 2, y: 8 };
    s.agents.B.pos = { x: 6, y: 8 };
    s.agents.B.shieldUntil = 999;
    s = stepBattle(s, { A: { ...IDLE, skill: true }, B: IDLE }, ARENA_1V1);
    for (let t = 0; t < 15; t += 1) s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.equal(s.agents.B.hp, 100);
    assert.equal(s.projectiles.length, 0);
  });

  it("locks recasts while the blue shield lasts", () => {
    let s = createBattle(ARENA_1V1);
    s.agents.A.pos = { x: 2, y: 8 };
    s.arena.pickups.push({ id: 99, kind: "blue", pos: { x: 2, y: 8 } });
    s = stepBattle(s, { A: IDLE, B: IDLE }, ARENA_1V1);
    assert.ok(s.agents.A.shieldUntil > s.time);
    assert.ok(s.agents.A.shieldCooldownUntil > s.time);
  });

  it("keeps duel frames free of arena extras", () => {
    const duel = buildReplay(SHADOW, BREAKER, "forge-001");
    assert.ok(!("shots" in duel.frames[0]));
    assert.ok(!("pickups" in duel.frames[0]));
  });
});
