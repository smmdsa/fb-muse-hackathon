import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BENCH_DNA,
  BREAKER_DNA,
  SHADOW_DNA,
  checksum,
  createBattle,
  DEFAULT_BATTLE,
  dnaPolicy,
  stepBattle,
} from "../src/index.ts";

const CENTER = { x: 12, y: 8 };

function runFight(seed, maxTicks = 2700) {
  const cfg = { ...DEFAULT_BATTLE, seed };
  let s = createBattle(cfg);
  let guard = 0;
  while (!s.over && guard < maxTicks) {
    const a = s.agents.A;
    const b = s.agents.B;
    s = stepBattle(
      s,
      {
        A: dnaPolicy(a, b, s, SHADOW_DNA, CENTER),
        B: dnaPolicy(b, a, s, BREAKER_DNA, CENTER),
      },
      cfg,
    );
    guard += 1;
  }
  return s;
}

describe("determinism", () => {
  it("same seed gives same checksum over 100 repeats", () => {
    const first = checksum(runFight("forge-001"));
    for (let i = 0; i < 100; i += 1) {
      assert.equal(checksum(runFight("forge-001")), first);
    }
  });

  it("1000 seeded fights finish with legal state", () => {
    for (let i = 0; i < 1000; i += 1) {
      const s = runFight(`bench-${i}`, 2700);
      assert.equal(s.over, true);
      assert.ok(s.tick <= 2700);
      for (const id of ["A", "B"]) {
        const a = s.agents[id];
        assert.ok(Number.isFinite(a.pos.x));
        assert.ok(Number.isFinite(a.pos.y));
        assert.ok(a.hp >= 0 && a.hp <= 100);
        assert.ok(a.energy >= 0 && a.energy <= 100);
        assert.ok(a.pos.x >= 0 && a.pos.x <= 24);
        assert.ok(a.pos.y >= 0 && a.pos.y <= 16);
      }
      assert.ok(s.winner === "A" || s.winner === "B" || s.winner === "DRAW");
    }
  });

  it("bench policy runs without NaN", () => {
    const cfg = { ...DEFAULT_BATTLE, seed: "bench-x" };
    let s = createBattle(cfg);
    for (let t = 0; t < 600; t += 1) {
      const a = s.agents.A;
      const b = s.agents.B;
      s = stepBattle(
        s,
        {
          A: dnaPolicy(a, b, s, BENCH_DNA, CENTER),
          B: dnaPolicy(b, a, s, BENCH_DNA, CENTER),
        },
        cfg,
      );
      assert.ok(Number.isFinite(s.agents.A.pos.x));
      assert.ok(Number.isFinite(s.agents.B.pos.x));
    }
  });
});
