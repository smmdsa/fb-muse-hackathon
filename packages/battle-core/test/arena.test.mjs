import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ARENA_1V1, BENCH_POLICY, BOT_PRESETS, buildArenaReplay, createBattle, drive, fightSeries, seriesWinner } from "../src/index.ts";

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
    assert.equal(a.checksum, "86e27f64");
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

  it("auto-attacks the visible foe, and holds fire on NONE", () => {
    const hold = {
      schemaVersion: 2,
      agentVersionId: "t-hold",
      dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 },
      rules: [{ id: "hold", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "WAIT" }],
    };
    const state = createBattle(ARENA_1V1);
    const out = drive(state, hold, "A", ARENA_1V1);
    assert.equal(out.fire, true);
    assert.deepEqual(out.aim, { x: 1, y: 0 });
    const quiet = {
      ...hold,
      rules: [{ id: "hold", when: { operand: "ownHpPct", op: "gte", value: 0 }, move: "WAIT", target: "NONE" }],
    };
    const silent = drive(state, quiet, "A", ARENA_1V1);
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
