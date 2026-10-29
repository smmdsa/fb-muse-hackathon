import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BENCH_POLICY,
  BOT_PRESETS,
  DEFAULT_MOBA,
  buildMobaReplay,
  createBattle,
  drive,
  fightPolicies,
  stepBattle,
} from "../src/index.ts";

// Balance pass. Spec sections 11-12, checks T5.1-T5.4.
// Fixture seed is fixed. The reference bout pits the benchmark
// against the breaker bot: fixed policies, asymmetric styles, one
// seed pins the whole matchup. (Identical optimal policies trade
// evenly to the cap, so the mirror no longer paces the game.)
const SEED = "t5-balance";
const BREAKER = BOT_PRESETS.find((b) => b.id === "bot:breaker").policy;

function mobaCfg(seed, autoBuy = true) {
  return { ...DEFAULT_MOBA, world: { ...DEFAULT_MOBA.world }, agent: { ...DEFAULT_MOBA.agent }, seed, autoBuy };
}

function struct(s, id) {
  return s.moba.structures.find((k) => k.id === id);
}

const IDLE_A = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false, dash: false, shield: false, buy: null };
const IDLE_B = { move: { x: 0, y: 0 }, aim: { x: -1, y: 0 }, fire: false, dash: false, shield: false, buy: null };

describe("T5.1 reference bout ends in 10-20 min", () => {
  it("decisive winner with ticks in [18000, 36000]", () => {
    const cfg = mobaCfg(SEED);
    const out = fightPolicies(BENCH_POLICY, BREAKER, SEED, cfg);
    assert.ok(out.winner === "A" || out.winner === "B", `winner reads ${out.winner}`);
    assert.ok(out.ticks >= 18000 && out.ticks <= 36000, `ticks read ${out.ticks}`);
    assert.ok(out.ticks < cfg.world.maxTicks, "nexus decides, not the cap");
    assert.equal(out.winner, "A");
    assert.equal(out.ticks, 24231);
  });
});

describe("T5.2 both tier-1 towers stand at 2:30", () => {
  it("a_t1 and b_t1 alive at tick 4500", () => {
    const cfg = mobaCfg(SEED);
    let s = createBattle(cfg);
    while (!s.over && s.tick < 4500) {
      s = stepBattle(s, { A: drive(s, BENCH_POLICY, "A", cfg), B: drive(s, BREAKER, "B", cfg) }, cfg);
    }
    assert.equal(s.tick, 4500);
    assert.ok(struct(s, "a_t1").alive, "a_t1 stands at 2:30");
    assert.ok(struct(s, "b_t1").alive, "b_t1 stands at 2:30");
    assert.equal(Math.round(struct(s, "a_t1").hp), 505);
    assert.equal(Math.round(struct(s, "b_t1").hp), 606);
  });
});

describe("T5.3 T5.1 replay JSON under 1 MB", () => {
  it("byte length below 1048576", () => {
    const cfg = mobaCfg(SEED);
    const replay = buildMobaReplay(BENCH_POLICY, BREAKER, SEED, cfg);
    assert.equal(replay.winner, "A");
    assert.equal(replay.ticks, 24231);
    const bytes = JSON.stringify(replay).length;
    assert.ok(bytes < 1048576, `replay reads ${bytes} bytes`);
    assert.equal(bytes, 787947);
  });
});

describe("T5.4 minion-only stall fixture", () => {
  // Spec check: parked robots, no fallen structure by 5:00, chip
  // damage under 5%. Holds via Amendments A1-A4 (mid clash,
  // annihilation pace, no tower crossfire).
  it("no fallen structure and chip under 5% at 5:00", () => {
    const cfg = mobaCfg("t5-stall");
    let s = createBattle(cfg);
    while (!s.over && s.tick < 9000) {
      s = stepBattle(s, { A: { ...IDLE_A }, B: { ...IDLE_B } }, cfg);
    }
    assert.equal(s.tick, 9000);
    for (const k of s.moba.structures) {
      assert.ok(k.alive, `${k.id} stands at 5:00`);
      assert.ok(k.hp >= k.maxHp * 0.95, `${k.id} chip under 5%, reads ${k.hp}/${k.maxHp}`);
    }
  });
});
