import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BREAKER_DNA,
  checksum,
  createBattle,
  DEFAULT_BATTLE,
  dnaPolicy,
  SHADOW_DNA,
  stepBattle,
} from "../src/index.ts";

const CENTER = { x: 12, y: 8 };

// Mirror check: swap sides and seeds, results must mirror.
describe("mirror and cover", () => {
  it("spawn sides stay mirrored at tick 0", () => {
    const s = createBattle(DEFAULT_BATTLE);
    const ax = s.agents.A.pos.x;
    const bx = s.agents.B.pos.x;
    assert.ok(Math.abs(ax + bx - DEFAULT_BATTLE.world.width) < 1e-9);
    assert.equal(s.agents.A.pos.y, s.agents.B.pos.y);
  });

  it("cover boxes are symmetric", () => {
    const covers = DEFAULT_BATTLE.world.covers;
    assert.equal(covers.length, 4);
    for (const c of covers) {
      const mx1 = DEFAULT_BATTLE.world.width - c.maxX;
      const mx2 = DEFAULT_BATTLE.world.width - c.minX;
      const found = covers.some(
        (o) =>
          Math.abs(o.minX - mx1) < 1e-9 && Math.abs(o.maxX - mx2) < 1e-9,
      );
      assert.equal(found, true);
    }
  });

  it("agents can move and aim in the same tick", () => {
    let s = createBattle(DEFAULT_BATTLE);
    const before = { ...s.agents.A.pos };
    s = stepBattle(
      s,
      {
        A: { move: { x: 1, y: 0 }, aim: { x: 0, y: 1 }, fire: true, dash: false, shield: false },
        B: { move: { x: 0, y: 0 }, aim: { x: -1, y: 0 }, fire: false, dash: false, shield: false },
      },
      DEFAULT_BATTLE,
    );
    assert.ok(s.agents.A.pos.x !== before.x || s.agents.A.pos.y !== before.y);
    assert.equal(s.agents.A.aim.x, 0);
    assert.equal(s.agents.A.aim.y, 1);
  });

  it("swapped policies give mirrored checksum path", () => {
    const run = (flip) => {
      const cfg = { ...DEFAULT_BATTLE, seed: "mirror-1" };
      let s = createBattle(cfg);
      for (let t = 0; t < 300; t += 1) {
        const a = s.agents.A;
        const b = s.agents.B;
        const pa = flip
          ? dnaPolicy(a, b, s, BREAKER_DNA, CENTER)
          : dnaPolicy(a, b, s, SHADOW_DNA, CENTER);
        const pb = flip
          ? dnaPolicy(b, a, s, SHADOW_DNA, CENTER)
          : dnaPolicy(b, a, s, BREAKER_DNA, CENTER);
        s = stepBattle(s, { A: pa, B: pb }, cfg);
      }
      return checksum(s);
    };
    assert.notEqual(run(false), run(true));
  });
});
