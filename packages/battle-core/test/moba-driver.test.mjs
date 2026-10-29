import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePolicy } from "@agent-wars/behavior-dna";
import {
  BENCH_POLICY,
  BOT_PRESETS,
  DEFAULT_MOBA,
  buildValueOf,
  createBattle,
  drive,
  observe,
  stepBattle,
} from "../src/index.ts";

// Frozen copy of the pre-T2 benchmark brain. T2.1 runs this v1
// policy to the end of a MOBA fight.
const BENCH_V1 = {
  schemaVersion: 1,
  agentVersionId: "benchmark-v1",
  dna: { aggression: 55, evasion: 55, preferredDistance: 45, energyConservation: 50 },
  rules: [
    { id: "b-close", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "b-far", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH" },
  ],
};

function mobaCfg(seed, autoBuy = true) {
  return { ...DEFAULT_MOBA, world: { ...DEFAULT_MOBA.world }, agent: { ...DEFAULT_MOBA.agent }, seed, autoBuy };
}

function struct(s, id) {
  return s.moba.structures.find((k) => k.id === id);
}

function addMinion(s, m) {
  const id = s.moba.nextMinionId++;
  s.moba.minions.push({
    id, side: "B", kind: "melee", pos: { x: 24, y: 8 },
    hp: 200, alive: true, target: null, wpIndex: 0, lastShotAt: 0, ...m, id,
  });
  return id;
}

function oneRule(move, extra = {}) {
  return {
    schemaVersion: 2,
    agentVersionId: "probe",
    dna: { aggression: 50, evasion: 50, preferredDistance: 50, energyConservation: 50 },
    rules: [{ id: "probe", when: { operand: "ownHpPct", op: "gte", value: 0 }, move, ...extra }],
  };
}

describe("T2.1 v1 compat", () => {
  it("runs a v1 policy to the end with auto-buy owning items by 5:00", () => {
    assert.equal(validatePolicy(BENCH_V1).ok, true);
    const cfg = mobaCfg("t2-v1-compat");
    let s = createBattle(cfg);
    let guard = 0;
    let itemsAt5 = null;
    while (!s.over && guard < cfg.world.maxTicks) {
      s = stepBattle(s, { A: drive(s, BENCH_V1, "A", cfg), B: drive(s, BENCH_V1, "B", cfg) }, cfg);
      guard += 1;
      if (s.tick === 9000) {
        itemsAt5 = [(s.agents.A.items ?? []).length, (s.agents.B.items ?? []).length];
      }
    }
    assert.equal(s.over, true);
    assert.ok(itemsAt5 !== null, "fight passes 5:00");
    assert.ok(itemsAt5[0] >= 1, `A owns ${itemsAt5[0]} items at 5:00`);
    assert.ok(itemsAt5[1] >= 1, `B owns ${itemsAt5[1]} items at 5:00`);
  });
});

describe("T2.2 operands", () => {
  function scripted() {
    const cfg = mobaCfg("t2-operands", false);
    const s = createBattle(cfg);
    s.time = 123.5;
    s.agents.A.pos = { x: 20, y: 8 };
    s.agents.A.gold = 500;
    s.agents.A.deaths = 2;
    s.agents.A.items = ["scrap_blade", "cloth_weave"];
    s.agents.B.pos = { x: 45.2, y: 8 };
    s.agents.B.hp = 275;
    struct(s, "b_t1").hp = 600;
    const dead = struct(s, "b_t2");
    dead.alive = false;
    dead.hp = 0;
    addMinion(s, { side: "B", kind: "caster", pos: { x: 23, y: 8 }, hp: 100 });
    addMinion(s, { side: "B", kind: "melee", pos: { x: 26, y: 8 }, hp: 200 });
    addMinion(s, { side: "B", kind: "melee", pos: { x: 27, y: 8 }, hp: 200 });
    addMinion(s, { side: "A", kind: "melee", pos: { x: 21, y: 8 }, hp: 200 });
    addMinion(s, { side: "A", kind: "caster", pos: { x: 14, y: 8 }, hp: 100 });
    return { cfg, s };
  }

  it("reads all 12 new operands with exact values", () => {
    const { cfg, s } = scripted();
    const o = observe(s, "A", cfg);
    assert.equal(o.ownGold, 500);
    assert.equal(o.ownDeaths, 2);
    assert.equal(o.gameTime, 123.5);
    assert.equal(o.distFoeTower, 5.5);
    assert.equal(o.foeTowerHpPct, 50);
    assert.equal(o.nearFoeMinions, 2);
    assert.equal(o.nearAllyMinions, 2);
    assert.equal(o.distFoeMinion, 3);
    assert.equal(o.foeHpPct, 50);
    assert.equal(o.buildValue, 500);
    assert.equal(o.slotsFree, 4);
    assert.equal(o.structLead, 1);
  });

  it("redefines objectiveDist and timeLeft for moba", () => {
    const { cfg, s } = scripted();
    const o = observe(s, "A", cfg);
    assert.equal(o.objectiveDist, 5.5);
    assert.equal(o.timeLeft, 1800 - 123.5);
  });

  it("reads structLead from the foe side as negative", () => {
    const { cfg, s } = scripted();
    assert.equal(observe(s, "B", cfg).structLead, -1);
  });

  it("reads nulls with no foe minion and no sight", () => {
    const cfg = mobaCfg("t2-operands-null", false);
    const s = createBattle(cfg);
    s.agents.A.pos = { x: 20.5, y: 8 };
    s.agents.B.pos = { x: 20.5, y: 2 };
    const o = observe(s, "A", cfg);
    assert.equal(o.distFoeMinion, null);
    assert.equal(o.nearFoeMinions, 0);
    assert.equal(o.nearAllyMinions, 0);
    assert.equal(o.lineOfSight, false);
    assert.equal(o.distFoe, null);
    assert.equal(o.foeHpPct, null);
    assert.equal(o.foeTowerHpPct, 100);
  });

  it("prices builds from parts plus fees", () => {
    assert.equal(buildValueOf([]), 0);
    assert.equal(buildValueOf(["scrap_blade", "cloth_weave"]), 500);
    assert.equal(buildValueOf(["tempered_edge"]), 600);
    assert.equal(buildValueOf(["siege_breaker"]), 1650);
    assert.equal(buildValueOf(["aegis_core"]), 1650);
    assert.equal(buildValueOf(["phantom_drive"]), 1650);
    assert.equal(buildValueOf(["warlord_frame"]), 1650);
  });
});

describe("T2.3 intents", () => {
  it("PUSH heads up the lane and stops at the wave front", () => {
    const cfg = mobaCfg("t2-push", false);
    const s = createBattle(cfg);
    s.agents.A.pos = { x: 20, y: 8 };
    addMinion(s, { side: "A", pos: { x: 22, y: 7.5 } });
    addMinion(s, { side: "A", pos: { x: 22, y: 8.5 } });
    const p = oneRule("PUSH");
    assert.deepEqual(drive(s, p, "A", cfg).move, { x: 1, y: 0 });
    s.agents.A.pos = { x: 24, y: 8 };
    const back = drive(s, p, "A", cfg).move;
    assert.deepEqual(back, { x: -1, y: 0 });
  });

  it("FARM seeks the killable minion, else the nearest", () => {
    const cfg = mobaCfg("t2-farm", false);
    const s = createBattle(cfg);
    s.agents.A.pos = { x: 20, y: 8 };
    addMinion(s, { side: "B", pos: { x: 21, y: 9 }, hp: 200 });
    const caster = addMinion(s, { side: "B", kind: "caster", pos: { x: 23, y: 8 }, hp: 15 });
    const p = oneRule("FARM");
    assert.deepEqual(drive(s, p, "A", cfg).move, { x: 1, y: 0 });
    s.moba.minions.find((m) => m.id === caster).hp = 100;
    const move = drive(s, p, "A", cfg).move;
    assert.ok(Math.abs(move.x - Math.SQRT1_2) < 1e-12);
    assert.ok(Math.abs(move.y - Math.SQRT1_2) < 1e-12);
  });

  it("DEFEND guards the threatened tower, else the nearest tower", () => {
    const cfg = mobaCfg("t2-defend", false);
    const s = createBattle(cfg);
    s.agents.A.pos = { x: 10, y: 8 };
    addMinion(s, { side: "B", pos: { x: 17.5, y: 12 }, hp: 200 });
    const p = oneRule("DEFEND");
    assert.deepEqual(drive(s, p, "A", cfg).move, { x: 1, y: 0 });
    s.moba.minions = [];
    const move = drive(s, p, "A", cfg).move;
    assert.ok(Math.abs(move.x - -3 / 3.4) < 1e-12);
    assert.ok(Math.abs(move.y - -1.6 / 3.4) < 1e-12);
  });
});

describe("T2.4 last-hit aim", () => {
  it("aims the killable caster over the foe robot", () => {
    const cfg = mobaCfg("t2-aim", false);
    const s = createBattle(cfg);
    s.agents.A.pos = { x: 24, y: 8 };
    s.agents.B.pos = { x: 24, y: 10 };
    addMinion(s, { side: "B", pos: { x: 25, y: 8 }, hp: 200 });
    addMinion(s, { side: "B", kind: "caster", pos: { x: 26, y: 8 }, hp: 15 });
    const p = oneRule("APPROACH", { fire: true });
    assert.deepEqual(drive(s, p, "A", cfg).aim, { x: 1, y: 0 });
  });

  it("falls through robot, minion, structure, then move", () => {
    const cfg = mobaCfg("t2-aim-fall", false);
    const p = oneRule("APPROACH", { fire: true });
    const s = createBattle(cfg);
    s.agents.A.pos = { x: 24, y: 8 };
    s.agents.B.pos = { x: 24, y: 10 };
    addMinion(s, { side: "B", pos: { x: 25, y: 8 }, hp: 200 });
    addMinion(s, { side: "B", kind: "caster", pos: { x: 26, y: 8 }, hp: 100 });
    assert.deepEqual(drive(s, p, "A", cfg).aim, { x: 0, y: 1 });
    s.agents.B.pos = { x: 45.2, y: 8 };
    assert.deepEqual(drive(s, p, "A", cfg).aim, { x: 1, y: 0 });
    s.moba.minions = [];
    s.agents.A.pos = { x: 22, y: 8 };
    const aimStruct = drive(s, p, "A", cfg).aim;
    assert.ok(Math.abs(aimStruct.x - 1) < 1e-12);
    assert.ok(Math.abs(aimStruct.y - 0) < 1e-12);
    s.agents.A.pos = { x: 10, y: 8 };
    const last = drive(s, p, "A", cfg);
    assert.deepEqual(last.aim, last.move);
  });
});

describe("v2 bots", () => {
  it("validates every preset and the benchmark", () => {
    assert.equal(BENCH_POLICY.schemaVersion, 2);
    assert.equal(validatePolicy(BENCH_POLICY).ok, true);
    for (const bot of BOT_PRESETS) {
      assert.equal(bot.policy.schemaVersion, 2);
      const check = validatePolicy(bot.policy);
      assert.equal(check.ok, true, `${bot.id}: ${check.errors.join("; ")}`);
    }
  });

  it("gives each bot one buy rule and one push or farm rule", () => {
    const all = [BENCH_POLICY, ...BOT_PRESETS.map((b) => b.policy)];
    for (const policy of all) {
      const buys = policy.rules.filter((r) => r.buy !== undefined);
      assert.equal(buys.length, 1, `${policy.agentVersionId} holds ${buys.length} buy rules`);
      const lanes = policy.rules.filter((r) => r.move === "PUSH" || r.move === "FARM");
      assert.equal(lanes.length, 1, `${policy.agentVersionId} holds ${lanes.length} lane rules`);
    }
    const shadow = BOT_PRESETS[0].policy.rules.find((r) => r.buy !== undefined);
    assert.equal(shadow.buy, "cloth_weave");
  });
});
