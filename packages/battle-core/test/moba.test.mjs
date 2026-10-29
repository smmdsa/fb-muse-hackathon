import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BENCH_POLICY,
  DEFAULT_MOBA,
  STRUCTURES,
  buildMobaReplay,
  checksum,
  createBattle,
  drive,
  fightPolicies,
  isVulnerable,
  minionGold,
  mobaWorld,
  respawnCooldown,
  stepBattle,
} from "../src/index.ts";

const IDLE = {
  move: { x: 0, y: 0 },
  aim: { x: 1, y: 0 },
  fire: false,
  dash: false,
  shield: false,
  buy: null,
};

const IDLE_B = {
  move: { x: 0, y: 0 },
  aim: { x: -1, y: 0 },
  fire: false,
  dash: false,
  shield: false,
  buy: null,
};

function mobaCfg(seed, autoBuy = false) {
  return { ...DEFAULT_MOBA, world: { ...DEFAULT_MOBA.world }, agent: { ...DEFAULT_MOBA.agent }, seed, autoBuy };
}

function struct(s, id) {
  return s.moba.structures.find((k) => k.id === id);
}

function killStruct(s, id) {
  const st = struct(s, id);
  st.alive = false;
  st.hp = 0;
  st.target = null;
}

function run(s, cfg, n, mkActions) {
  for (let i = 0; i < n; i += 1) {
    const acts = mkActions ? mkActions(s) : { A: { ...IDLE }, B: { ...IDLE_B } };
    s = stepBattle(s, acts, cfg);
    if (s.over) break;
  }
  return s;
}

describe("moba world", () => {
  it("uses the 48x16 lane map with 12 structures", () => {
    const w = mobaWorld();
    assert.equal(w.width, 48);
    assert.equal(w.height, 16);
    assert.equal(w.covers.length, 4);
    assert.equal(w.maxTicks, 54000);
    const s = createBattle(mobaCfg("world-1"));
    assert.equal(s.moba.structures.length, 12);
    assert.deepEqual(s.moba.structures.map((k) => k.id), STRUCTURES);
    assert.deepEqual(s.agents.A.pos, { x: 2.8, y: 8.0 });
    assert.equal(s.agents.A.hp, 550);
    assert.equal(s.agents.A.gold, 350);
  });

  it("spawns the first wave at tick 1800 with 10 minions", () => {
    const cfg = mobaCfg("wave-1");
    let s = createBattle(cfg);
    s = run(s, cfg, 1800);
    assert.equal(s.tick, 1800);
    assert.equal(s.moba.minions.length, 10);
    assert.equal(s.moba.minions.filter((m) => m.side === "A").length, 5);
    assert.equal(s.moba.minions.filter((m) => m.kind === "melee").length, 4);
    assert.equal(s.moba.minions.filter((m) => m.kind === "caster").length, 6);
    const waves = s.moba.log.filter((e) => e.type === "wave");
    assert.equal(waves.length, 2);
  });
});

describe("T1.1 gating", () => {
  it("t2 ignores damage while t1 stands, takes damage after t1 falls", () => {
    const cfg = mobaCfg("t1-gate");
    let s = createBattle(cfg);
    s.agents.A.pos = { x: 28.0, y: 8.0 };
    s.agents.B.pos = { x: 45.2, y: 14.0 };
    const fireEast = () => ({ A: { ...IDLE, aim: { x: 1, y: 0 }, fire: true }, B: { ...IDLE_B } });
    s = run(s, cfg, 90, fireEast);
    assert.equal(struct(s, "b_t2").hp, 1500);
    killStruct(s, "b_t1");
    s = run(s, cfg, 60, fireEast);
    assert.ok(struct(s, "b_t2").hp < 1500);
  });
});

describe("T1.2 nexus rule", () => {
  it("nexus ignores damage until one nexus turret falls", () => {
    const cfg = mobaCfg("t1-nexus");
    let s = createBattle(cfg);
    for (const id of ["b_t1", "b_t2", "b_inhib"]) killStruct(s, id);
    s.agents.A.pos = { x: 36.0, y: 8.0 };
    s.agents.B.pos = { x: 45.2, y: 14.0 };
    const fireEast = () => ({ A: { ...IDLE, aim: { x: 1, y: 0 }, fire: true }, B: { ...IDLE_B } });
    assert.equal(isVulnerable(struct(s, "b_nexus"), s.moba.structures), false);
    s = run(s, cfg, 60, fireEast);
    assert.equal(struct(s, "b_nexus").hp, 1200);
    killStruct(s, "b_nt_top");
    assert.equal(isVulnerable(struct(s, "b_nexus"), s.moba.structures), true);
    s = run(s, cfg, 60, fireEast);
    assert.ok(struct(s, "b_nexus").hp < 1200);
  });
});

describe("T1.3 tower aggro", () => {
  it("tower switches to the robot that hits its ally within one tick", () => {
    const cfg = mobaCfg("t1-aggro");
    let s = createBattle(cfg);
    s.agents.A.pos = { x: 23.0, y: 5.5 };
    s.agents.B.pos = { x: 27.0, y: 6.0 };
    s.moba.minions.push({
      id: 1, side: "A", kind: "melee", pos: { x: 25.5, y: 10.0 },
      hp: 200, alive: true, target: null, wpIndex: 0, lastShotAt: 0,
    });
    s.moba.nextMinionId = 2;
    const fireAtB = () => ({ A: { ...IDLE, aim: { x: 4, y: 0.5 }, fire: true }, B: { ...IDLE_B } });
    s = stepBattle(s, fireAtB(), cfg);
    assert.deepEqual(struct(s, "b_t1").target, { kind: "minion", id: 1 });
    let guard = 0;
    while (s.agents.B.hp >= 550 && guard < 60) {
      s = stepBattle(s, fireAtB(), cfg);
      guard += 1;
    }
    assert.ok(s.agents.B.hp < 550, "B takes robot damage");
    s = stepBattle(s, fireAtB(), cfg);
    assert.deepEqual(struct(s, "b_t1").target, { kind: "robot", side: "A" });
  });
});

describe("T1.4 heat math", () => {
  it("tier-1 kills a naked full-HP robot on the 6th hit", () => {
    const cfg = mobaCfg("t1-heat");
    let s = createBattle(cfg);
    s.agents.A.pos = { x: 24.0, y: 8.0 };
    let guard = 0;
    while (s.agents.A.alive && guard < 300) {
      s = stepBattle(s, { A: { ...IDLE }, B: { ...IDLE_B } }, cfg);
      guard += 1;
    }
    assert.equal(s.agents.A.alive, false);
    assert.ok(s.time >= 6.5 && s.time <= 7.5, `death at ${s.time}s`);
    assert.equal(s.agents.A.deaths, 1);
    assert.equal(s.agents.B.gold, 350);
  });
});

describe("T1.5 respawn table", () => {
  it("cooldowns read 12, 18, 27, 41, 60", () => {
    const cfg = mobaCfg("t1-respawn");
    let s = createBattle(cfg);
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6].map((n) => respawnCooldown(n)),
      [12, 18, 27, 41, 60, 60],
    );
    const seen = [];
    for (let n = 0; n < 5; n += 1) {
      assert.equal(s.agents.A.alive, true);
      s.agents.A.pos = { x: 10.0, y: 8.0 };
      s.agents.A.hp = 0;
      s = stepBattle(s, { A: { ...IDLE }, B: { ...IDLE_B } }, cfg);
      assert.equal(s.agents.A.alive, false);
      seen.push(s.agents.A.respawnAt - s.time);
      s.time = s.agents.A.respawnAt;
      s = stepBattle(s, { A: { ...IDLE }, B: { ...IDLE_B } }, cfg);
      assert.equal(s.agents.A.alive, true);
      assert.equal(s.agents.A.hp, 550);
    }
    for (let i = 0; i < 5; i += 1) {
      assert.ok(Math.abs(seen[i] - [12, 18, 27, 41, 60][i]) < 1e-6, `death ${i + 1}: ${seen[i]}`);
    }
  });
});

describe("T1.6 determinism", () => {
  it("policy-driven horizons give identical checksums", () => {
    const horizon = (seed) => {
      const cfg = mobaCfg(seed, true);
      let s = createBattle(cfg);
      for (let i = 0; i < 2500 && !s.over; i += 1) {
        s = stepBattle(s, { A: drive(s, BENCH_POLICY, "A", cfg), B: drive(s, BENCH_POLICY, "B", cfg) }, cfg);
      }
      return checksum(s);
    };
    assert.equal(horizon("moba-det-1"), horizon("moba-det-1"));
    assert.equal(horizon("moba-det-2"), horizon("moba-det-2"));
  });

  it("full replays are byte-identical across runs", () => {
    const cfg = mobaCfg("moba-replay-1", true);
    const r1 = buildMobaReplay(BENCH_POLICY, BENCH_POLICY, "moba-replay-1", cfg);
    const r2 = buildMobaReplay(BENCH_POLICY, BENCH_POLICY, "moba-replay-1", cfg);
    assert.equal(JSON.stringify(r1), JSON.stringify(r2));
    assert.equal(r1.checksum, r2.checksum);
    assert.equal(r1.version, 2);
    assert.equal(r1.mode, "moba");
    assert.equal(r1.frames[0].t, 0);
    assert.ok(r1.frames.length > 10);
    const fight = fightPolicies(BENCH_POLICY, BENCH_POLICY, "moba-replay-1", cfg);
    assert.equal(r1.checksum, fight.checksum);
    assert.equal(r1.winner, fight.winner);
    assert.equal(r1.ticks, fight.ticks);
  });
});

describe("T1.7 cap tiebreak", () => {
  it("follows structures, then gold, then draw", () => {
    const fixture = (downA, downB, goldA, goldB) => {
      const cfg = mobaCfg("t1-cap");
      let s = createBattle(cfg);
      s.tick = 53999;
      s.time = 53999 / 30;
      for (const id of downA) killStruct(s, id);
      for (const id of downB) killStruct(s, id);
      s.moba.lifetimeGold = { A: goldA, B: goldB };
      s = stepBattle(s, { A: { ...IDLE }, B: { ...IDLE_B } }, cfg);
      assert.equal(s.over, true);
      assert.equal(s.tick, 54000);
      return s.winner;
    };
    assert.equal(fixture(["a_t1"], ["b_t1", "b_t2", "b_inhib"], 0, 0), "A");
    assert.equal(fixture(["a_t1", "a_t2"], ["b_t1", "b_t2"], 1000, 2000), "B");
    assert.equal(fixture(["a_t1"], ["b_t1"], 500, 500), "DRAW");
  });
});

describe("T1.8 buy no-op", () => {
  it("poor buys change nothing and emit no event", () => {
    const cfg = mobaCfg("t1-buy");
    let s = createBattle(cfg);
    s.agents.A.gold = 0;
    const buy = (id) => ({ A: { ...IDLE, buy: id }, B: { ...IDLE_B } });
    s = stepBattle(s, buy("siege_breaker"), cfg);
    assert.equal(s.agents.A.gold, 0);
    assert.deepEqual(s.agents.A.items, []);
    assert.equal(s.moba.log.length, 0);
    s = stepBattle(s, buy("no_such_item"), cfg);
    assert.equal(s.agents.A.gold, 0);
    assert.deepEqual(s.agents.A.items, []);
    assert.equal(s.moba.log.length, 0);
  });
});

describe("economy", () => {
  it("buys parts and auto-combines in one tick", () => {
    const cfg = mobaCfg("econ-1");
    let s = createBattle(cfg);
    s.agents.A.gold = 700;
    s = stepBattle(s, { A: { ...IDLE, buy: "scrap_blade" }, B: { ...IDLE_B } }, cfg);
    assert.deepEqual(s.agents.A.items, ["tempered_edge"]);
    assert.equal(s.agents.A.gold, 100);
    const types = s.moba.log.map((e) => e.type);
    assert.ok(types.includes("buy"));
    assert.ok(types.includes("combine"));
  });

  it("buys tier 3 directly when gold covers parts plus fees", () => {
    const cfg = mobaCfg("econ-2");
    let s = createBattle(cfg);
    s.agents.A.gold = 2000;
    s = stepBattle(s, { A: { ...IDLE, buy: "siege_breaker" }, B: { ...IDLE_B } }, cfg);
    assert.deepEqual(s.agents.A.items, ["siege_breaker"]);
    assert.equal(s.agents.A.gold, 350);
    assert.equal(s.moba.log.filter((e) => e.type === "buy").length, 1);
  });

  it("repair cells heal at once and use no slot", () => {
    const cfg = mobaCfg("econ-3");
    let s = createBattle(cfg);
    s.agents.A.hp = 400;
    s.agents.A.pos = { x: 10.0, y: 8.0 };
    s = stepBattle(s, { A: { ...IDLE, buy: "repair_cell" }, B: { ...IDLE_B } }, cfg);
    assert.equal(s.agents.A.hp, 520);
    assert.equal(s.agents.A.gold, 300);
    assert.deepEqual(s.agents.A.items, []);
  });

  it("auto-buy forges parts first and cells only when poor and critical", () => {
    const cfg = mobaCfg("econ-4", true);
    let s = createBattle(cfg);
    s.agents.A.hp = 200;
    s.agents.A.pos = { x: 10.0, y: 8.0 };
    s = run(s, cfg, 30);
    assert.deepEqual(s.agents.A.items, ["scrap_blade"]);
    assert.equal(s.agents.A.gold, 100);
    assert.equal(s.agents.A.hp, 200);
    let t = createBattle(cfg);
    t = run(t, cfg, 30);
    assert.deepEqual(t.agents.A.items, ["scrap_blade"]);
    assert.equal(t.agents.A.gold, 100);
    let u = createBattle(cfg);
    u.agents.A.hp = 100;
    u.agents.A.gold = 100;
    u.agents.A.pos = { x: 10.0, y: 8.0 };
    u = run(u, cfg, 30);
    assert.deepEqual(u.agents.A.items, []);
    assert.equal(u.agents.A.gold, 50);
    assert.equal(u.agents.A.hp, 220);
  });

  it("last hits and kills pay gold, tower kills pay nothing", () => {
    const cfg = mobaCfg("econ-5");
    let s = createBattle(cfg);
    s.agents.A.pos = { x: 24.0, y: 5.0 };
    s.agents.B.pos = { x: 45.2, y: 14.0 };
    s.moba.minions.push({
      id: 1, side: "B", kind: "caster", pos: { x: 26.0, y: 5.0 },
      hp: 5, alive: true, target: null, wpIndex: 0, lastShotAt: 0,
    });
    s.moba.nextMinionId = 2;
    const fireEast = () => ({ A: { ...IDLE, aim: { x: 1, y: 0 }, fire: true }, B: { ...IDLE_B } });
    let guard = 0;
    while (s.moba.minions.length > 0 && guard < 60) {
      s = stepBattle(s, fireEast(), cfg);
      guard += 1;
    }
    assert.equal(s.moba.minions.length, 0);
    assert.equal(s.agents.A.gold, 350 + 14);
    assert.equal(s.moba.lifetimeGold.A, 14);
  });
});

describe("A10 super minions", () => {
  it("promotes one super per wave while the foe inhibitor is down", () => {
    const cfg = mobaCfg("a10-super");
    let s = createBattle(cfg);
    const inhib = s.moba.structures.find((k) => k.id === "b_inhib");
    inhib.alive = false;
    inhib.hp = 0;
    s = run(s, cfg, 1801);
    const supersA = s.moba.minions.filter((m) => m.side === "A" && m.kind === "super");
    const supersB = s.moba.minions.filter((m) => m.side === "B" && m.kind === "super");
    assert.equal(supersA.length, 1);
    assert.equal(supersA[0].hp, 1000);
    assert.equal(supersB.length, 0);
    assert.equal(minionGold("super"), 60);
  });

  it("a super takes single damage from minions", () => {
    const cfg = mobaCfg("a10-tank");
    let s = createBattle(cfg);
    s.agents.B.pos = { x: 45.2, y: 14.0 };
    for (const id of ["a_t1", "b_t1"]) {
      const t = s.moba.structures.find((k) => k.id === id);
      t.alive = false;
      t.hp = 0;
    }
    s.moba.minions.push(
      { id: 1, side: "A", kind: "super", pos: { x: 24.0, y: 8.0 }, hp: 1000, alive: true, target: null, wpIndex: 0, lastShotAt: 0 },
      { id: 2, side: "B", kind: "melee", pos: { x: 24.8, y: 8.0 }, hp: 200, alive: true, target: null, wpIndex: 0, lastShotAt: 0 },
    );
    s.moba.nextMinionId = 3;
    s = run(s, cfg, 40);
    const tank = s.moba.minions.find((m) => m.id === 1);
    assert.equal(Math.round(tank.hp), 1000 - 12);
  });
});

describe("A7 point-blank muzzle", () => {
  it("stacked robots damage each other", () => {
    const cfg = mobaCfg("a7-stack");
    let s = createBattle(cfg);
    s.agents.A.pos = { x: 45.2, y: 13.0 };
    s.agents.B.pos = { x: 45.25, y: 13.02 };
    const spray = () => ({
      A: { ...IDLE, aim: { x: 1, y: 0 }, fire: true },
      B: { ...IDLE_B, aim: { x: -1, y: 0 }, fire: true },
    });
    s = run(s, cfg, 60, spray);
    assert.ok(s.agents.A.hp < 550, `A takes damage, reads ${s.agents.A.hp}`);
    assert.ok(s.agents.B.hp < 550, `B takes damage, reads ${s.agents.B.hp}`);
  });
});
