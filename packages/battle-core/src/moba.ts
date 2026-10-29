// MOBA sim. All numbers come from specs/moba-spec.md sections 0-8.
// The duel path in simulation.ts stays untouched.

import {
  AUTO_BUY_ORDER,
  BASE_ITEMS,
  MAX_SLOTS,
  RECIPE_BY_ID,
  RECIPES,
  REPAIR_HEAL,
  coveredBases,
  planBuy,
  sumStat,
} from "./items.ts";
import { circleHitsBox, mobaWorld, segmentHitsBox } from "./world.ts";
import type {
  AgentAction,
  AgentId,
  AgentState,
  BattleConfig,
  BattleState,
  DamageEvent,
  MinionKind,
  MinionState,
  MinionTarget,
  MobaEvent,
  MobaState,
  StructureId,
  StructureKind,
  StructureState,
  TowerTarget,
  Vec2,
} from "./types.ts";

export const MOBA_START_GOLD = 350;
export const ROBOT_AD = 20;
export const ROBOT_ARMOR = 20;
export const ROBOT_RANGE = 4.0;
export const ROBOT_INTERVAL = 0.5;
export const ROBOT_MIN_INTERVAL = 0.25;
export const ROBOT_MAX_SPEED = 7.0;
export const TOWER_RANGE = 4.8;
export const TOWER_TRIGGER = 6.5;
export const TOWER_SHOT = 80;
export const HEAT_STEP = 0.25;
export const HEAT_CAP = 1.0;
export const HEAT_LOSE_SECS = 2;
export const MINION_AGGRO = 5.0;
export const MINION_STRUCT_MULT = 0.5;
// Amendment A2: minion-vs-minion damage. Waves must annihilate at
// mid faster than the 30 s spawn cadence, or survivors pile into
// a deathball that sieges towers with parked robots (T5.4).
export const MINION_VS_MINION_MULT = 2.0;
export const DEMOLISH_MULT = 1.5;
export const ARMOR_K = 100;
export const LANE_Y = 8;
export const LANE_HALF = 2.5;
export const MINION_RADIUS = 0.3;
export const WAVE_FIRST_TICK = 1800;
export const WAVE_EVERY_TICKS = 900;
export const RESPAWN_CAP = 60;
export const SPAWN_SHIELD_SECS = 2;
export const NEXUS_HEAL_PCT = 0.04;
export const NEXUS_HEAL_RANGE = 2.5;
export const AUTO_BUY_EVERY = 30;
export const AUTO_CELL_START = 20;
export const AUTO_CELL_STOP = 50;
export const PROJECTILE_SPEED = 14;
export const MELEE_GOLD = 20;
export const CASTER_GOLD = 14;
export const SUPER_GOLD = 60;
export const ROBOT_GOLD = 300;

export const DEFAULT_MOBA: BattleConfig = {
  seed: "forge-001",
  world: mobaWorld(),
  agent: {
    radius: 0.35,
    speed: 4,
    maxHp: 550,
    maxEnergy: 100,
    energyRegen: 8,
  },
  mode: "moba",
  autoBuy: true,
};

// Version 1 remains frozen for old match receipts and replays.
export const ARENA_MOBA: BattleConfig = { ...DEFAULT_MOBA, rulesetVersion: 2 };
export const OVERSEER_FIRST_TICK = 6 * 60 * 30;
export const OVERSEER_RESPAWN_TICKS = 3 * 60 * 30;
export const OVERSEER_BUFF_TICKS = 90 * 30;
export const OVERSEER_MAX_HP = 500;
export const OVERSEER_RADIUS = 0.9;

// Fixed structure order. Towers fire in this order.
export const STRUCTURES: StructureId[] = [
  "a_t1", "a_t2", "a_inhib", "a_nt_top", "a_nt_bot", "a_nexus",
  "b_t1", "b_t2", "b_inhib", "b_nt_top", "b_nt_bot", "b_nexus",
];

type StructureDef = {
  kind: StructureKind;
  hp: number;
  radius: number;
  interval: number;
};

const STRUCTURE_DEFS: Record<string, StructureDef> = {
  t1: { kind: "tower", hp: 1200, radius: 0.6, interval: 1.2 },
  t2: { kind: "tower", hp: 1500, radius: 0.6, interval: 1.2 },
  inhib: { kind: "inhibitor", hp: 800, radius: 0.6, interval: 0 },
  nt: { kind: "nexus_turret", hp: 900, radius: 0.6, interval: 1.0 },
  nexus: { kind: "nexus", hp: 1200, radius: 0.9, interval: 0 },
};

const STRUCTURE_POS: Record<string, Vec2> = {
  nexus: { x: 2.0, y: 8.0 },
  nt_top: { x: 7.0, y: 6.4 },
  nt_bot: { x: 7.0, y: 9.6 },
  inhib: { x: 12.5, y: 8.0 },
  t2: { x: 17.5, y: 8.0 },
  t1: { x: 22.5, y: 8.0 },
};

function defKey(id: StructureId): string {
  if (id.endsWith("nt_top") || id.endsWith("nt_bot")) return "nt";
  if (id.endsWith("t1")) return "t1";
  if (id.endsWith("t2")) return "t2";
  if (id.endsWith("inhib")) return "inhib";
  return "nexus";
}

function posKey(id: StructureId): string {
  return id.slice(2);
}

export function structureInterval(id: StructureId): number {
  return STRUCTURE_DEFS[defKey(id)].interval;
}

// The helper builds the 12 structures in fixed order.
export function createStructures(rulesetVersion = 1): StructureState[] {
  return STRUCTURES.map((id) => {
    const side: AgentId = id.startsWith("a_") ? "A" : "B";
    const def = STRUCTURE_DEFS[defKey(id)];
    const base = STRUCTURE_POS[posKey(id)];
    const p = rulesetVersion === 2 ? ({ ...base, x: ({ t1: 19, t2: 12, inhib: 8.5, nt_top: 5, nt_bot: 5, nexus: 2 } as Record<string, number>)[posKey(id)] }) : base;
    return {
      id,
      side,
      kind: def.kind,
      pos: { x: side === "A" ? p.x : 48 - p.x, y: p.y },
      radius: def.radius,
      hp: def.hp,
      maxHp: def.hp,
      alive: true,
      target: null,
      lastShotAt: 0,
      heatSide: null,
      heatCount: 0,
      heatOutSince: null,
    };
  });
}

export function createMobaState(rulesetVersion = 1): MobaState {
  return {
    minions: [],
    structures: createStructures(rulesetVersion),
    ...(rulesetVersion === 2 ? { overseer: { x: 24, y: 3, hp: 0, maxHp: OVERSEER_MAX_HP, alive: false, spawnTick: OVERSEER_FIRST_TICK, lastAttackTick: 0, buffUntil: { A: 0, B: 0 } } } : {}),
    nextMinionId: 1,
    lifetimeGold: { A: 0, B: 0 },
    log: [],
    dmg: [],
  };
}

export function mobaSpawn(side: AgentId): Vec2 {
  return side === "A" ? { x: 2.8, y: 8.0 } : { x: 45.2, y: 8.0 };
}

// The factory builds one MOBA robot.
export function createMobaAgent(id: AgentId, cfg: BattleConfig): AgentState {
  return {
    id,
    pos: mobaSpawn(id),
    vel: { x: 0, y: 0 },
    hp: cfg.agent.maxHp,
    energy: cfg.agent.maxEnergy,
    aim: { x: id === "A" ? 1 : -1, y: 0 },
    alive: true,
    dashCooldownUntil: 0,
    shieldUntil: 0,
    shieldCooldownUntil: 0,
    lastShotAt: -10,
    damageDealt: 0,
    controlTime: 0,
    gold: MOBA_START_GOLD,
    items: [],
    deaths: 0,
    respawnAt: 0,
    spawnShieldUntil: 0,
    autoCell: false,
  };
}

// Derived robot stats. Items stack additively.
export function robotMaxHp(items: string[]): number {
  return 550 + sumStat(items, (s) => s.maxHp);
}

export function robotAD(items: string[]): number {
  return ROBOT_AD + sumStat(items, (s) => s.ad);
}

export function robotArmor(items: string[]): number {
  return ROBOT_ARMOR + sumStat(items, (s) => s.armor);
}

export function robotSpeed(items: string[], base: number): number {
  return Math.min(ROBOT_MAX_SPEED, base + sumStat(items, (s) => s.moveSpeed));
}

export function robotInterval(items: string[]): number {
  return Math.max(ROBOT_MIN_INTERVAL, ROBOT_INTERVAL / (1 + sumStat(items, (s) => s.attackSpeed)));
}

export function robotDemolish(items: string[]): boolean {
  return items.includes("siege_breaker");
}

export function armorMult(armor: number): number {
  return ARMOR_K / (ARMOR_K + armor);
}

export function heatMult(count: number): number {
  return 1 + Math.min(count, 4) * HEAT_STEP;
}

// Respawn cooldown for death n. Halves round up. Caps at 60.
export function respawnCooldown(deaths: number): number {
  return Math.min(RESPAWN_CAP, Math.round(12 * Math.pow(1.5, deaths - 1)));
}

function structById(list: StructureState[], id: StructureId): StructureState {
  const s = list.find((k) => k.id === id);
  if (!s) throw new Error(`missing structure ${id}`);
  return s;
}

function dead(list: StructureState[], id: StructureId): boolean {
  return !structById(list, id).alive;
}

// Gating chain per side: t1 -> t2 -> inhib -> nexus turrets -> nexus.
// The Nexus needs one Nexus turret down.
export function isVulnerable(s: StructureState, list: StructureState[]): boolean {
  if (!s.alive) return false;
  const p = s.side === "A" ? "a" : "b";
  const key = posKey(s.id);
  if (key === "t1") return true;
  if (key === "t2") return dead(list, `${p}_t1` as StructureId);
  if (key === "inhib") return dead(list, `${p}_t2` as StructureId);
  if (key === "nt_top" || key === "nt_bot") return dead(list, `${p}_inhib` as StructureId);
  return dead(list, `${p}_nt_top` as StructureId) || dead(list, `${p}_nt_bot` as StructureId);
}

function foe(side: AgentId): AgentId {
  return side === "A" ? "B" : "A";
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function spawnImmune(a: AgentState, time: number): boolean {
  return time < (a.spawnShieldUntil ?? 0);
}

function dir(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function norm(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len <= 1 || len === 0) return { x: v.x, y: v.y };
  return { x: v.x / len, y: v.y / len };
}

const MINION_STATS: Record<MinionKind, { hp: number; dmg: number; interval: number; range: number }> = {
  melee: { hp: 200, dmg: 12, interval: 1.0, range: 1.0 },
  caster: { hp: 100, dmg: 16, interval: 1.0, range: 2.5 },
  super: { hp: 1000, dmg: 30, interval: 1.0, range: 1.0 },
};

export function minionGold(kind: MinionKind): number {
  if (kind === "melee") return MELEE_GOLD;
  if (kind === "super") return SUPER_GOLD;
  return CASTER_GOLD;
}

// The spawner adds one full wave per side. A first, then B.
function spawnWave(moba: MobaState, time: number, tick: number): void {
  for (const side of ["A", "B"] as AgentId[]) {
    const nx = side === "A" ? 2.0 : 46.0;
    const d = side === "A" ? 1 : -1;
    const spots: { kind: MinionKind; x: number; y: number }[] = [
      { kind: "melee", x: nx + 0.8 * d, y: 7.5 },
      { kind: "melee", x: nx + 0.8 * d, y: 8.5 },
      { kind: "caster", x: nx + 0.1 * d, y: 7.3 },
      { kind: "caster", x: nx + 0.1 * d, y: 8.0 },
      { kind: "caster", x: nx + 0.1 * d, y: 8.7 },
    ];
    // Amendment A10: a fallen foe inhibitor promotes every wave with
    // one super minion. The super tanks towers while the robot
    // sieges, which closes symmetric endgames that otherwise grind
    // to the tick cap with both nexus turrets standing.
    const foeInhib = structById(moba.structures, `${side === "A" ? "b" : "a"}_inhib` as StructureId);
    if (foeInhib && !foeInhib.alive) {
      spots.push({ kind: "super", x: nx + 1.6 * d, y: 8.0 });
    }
    for (const s of spots) {
      moba.minions.push({
        id: moba.nextMinionId++,
        side,
        kind: s.kind,
        pos: { x: s.x, y: s.y },
        hp: MINION_STATS[s.kind].hp,
        alive: true,
        target: null,
        wpIndex: 0,
        lastShotAt: time,
      });
    }
    moba.log.push({ t: tick, type: "wave", side });
  }
}

function minionWaypoints(side: AgentId): Vec2[] {
  return [{ x: 24, y: 8 }, { x: side === "A" ? 46 : 2, y: 8 }];
}

// The resolver slides a circle out of covers and structures.
function resolveMoba(
  pos: Vec2,
  radius: number,
  cfg: BattleConfig,
  structures: StructureState[],
): Vec2 {
  let p = { ...pos };
  for (const box of cfg.world.covers) {
    if (!circleHitsBox(p.x, p.y, radius, box)) continue;
    const cx = Math.min(Math.max(p.x, box.minX), box.maxX);
    const cy = Math.min(Math.max(p.y, box.minY), box.maxY);
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (dx === 0 && dy === 0) {
      p = { x: p.x, y: box.maxY + radius };
      continue;
    }
    const len = Math.hypot(dx, dy) || 0.0001;
    const push = (radius - len) / len;
    p = { x: p.x + dx * push, y: p.y + dy * push };
  }
  for (const s of structures) {
    if (!s.alive) continue;
    const dx = p.x - s.pos.x;
    const dy = p.y - s.pos.y;
    const rr = radius + s.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 === 0) continue;
    const d = Math.sqrt(d2);
    p = { x: s.pos.x + (dx / d) * rr, y: s.pos.y + (dy / d) * rr };
  }
  p.x = Math.min(Math.max(p.x, radius), cfg.world.width - radius);
  p.y = Math.min(Math.max(p.y, radius), cfg.world.height - radius);
  return p;
}

type Killer = { kind: "robot" | "tower" | "minion"; side: AgentId };

type Ctx = {
  time: number;
  tick: number;
  cfg: BattleConfig;
  agents: Record<AgentId, AgentState>;
  moba: MobaState;
  killers: Map<string, Killer>;
  overseerHits: Set<AgentId>;
};

function recordHit(
  ctx: Ctx,
  victimSide: AgentId,
  victimRobot: boolean,
  atkSide: AgentId,
  byRobot: boolean,
  pos: Vec2,
  key: string,
  kind: Killer["kind"],
): void {
  ctx.moba.dmg.push({ t: ctx.time, atkSide, victimSide, victimRobot, byRobot, x: pos.x, y: pos.y });
  ctx.killers.set(key, { kind, side: atkSide });
}

// The helper applies raw damage through armor. Immune victims take zero.
function damageRobot(
  ctx: Ctx,
  victim: AgentState,
  raw: number,
  atkSide: AgentId,
  kind: Killer["kind"],
): void {
  if (!victim.alive || spawnImmune(victim, ctx.time)) return;
  if (ctx.time <= victim.shieldUntil) return;
  const final = raw * armorMult(robotArmor(victim.items ?? []));
  victim.hp -= final;
  recordHit(ctx, victim.id, true, atkSide, kind === "robot", victim.pos, `robot:${victim.id}`, kind);
}

function damageMinion(
  ctx: Ctx,
  victim: MinionState,
  raw: number,
  atkSide: AgentId,
  kind: Killer["kind"],
): void {
  if (!victim.alive) return;
  const vsMinion = kind === "minion" && victim.kind !== "super";
  victim.hp -= raw * (vsMinion ? MINION_VS_MINION_MULT : 1);
  recordHit(ctx, victim.side, false, atkSide, kind === "robot", victim.pos, `minion:${victim.id}`, kind);
}

function damageStructure(
  ctx: Ctx,
  victim: StructureState,
  raw: number,
  atkSide: AgentId,
  kind: Killer["kind"],
): void {
  if (!victim.alive) return;
  if (!isVulnerable(victim, ctx.moba.structures)) return;
  victim.hp -= raw * armorMult(30);
  recordHit(ctx, victim.side, false, atkSide, kind === "robot", victim.pos, `struct:${victim.id}`, kind);
}

// The buyer runs one Buy action. Failures no-op with no event.
export function tryBuy(agent: AgentState, id: string, tick: number, log: MobaEvent[]): void {
  if (!agent.alive) return;
  const items = agent.items ?? [];
  const gold = agent.gold ?? 0;
  const maxHp = robotMaxHp(items);
  const healDelta = (next: string[]): void => {
    agent.hp = Math.min(robotMaxHp(next), agent.hp + (robotMaxHp(next) - maxHp));
  };
  if (id === "repair_cell") {
    if (gold < BASE_ITEMS.repair_cell.cost) return;
    agent.gold = gold - BASE_ITEMS.repair_cell.cost;
    agent.hp = Math.min(maxHp, agent.hp + REPAIR_HEAL);
    log.push({ t: tick, type: "buy", side: agent.id, item: id, gold: agent.gold ?? 0 });
    return;
  }
  const base = BASE_ITEMS[id];
  if (base) {
    if (gold < base.cost || items.length >= MAX_SLOTS) return;
    agent.gold = gold - base.cost;
    const next = [...items, id];
    agent.items = next;
    healDelta(next);
    log.push({ t: tick, type: "buy", side: agent.id, item: id, gold: agent.gold ?? 0 });
    return;
  }
  const plan = planBuy(id, items);
  if (!plan) return;
  if (gold < plan.cost || items.length - plan.consumed.length + 1 > MAX_SLOTS) return;
  agent.gold = gold - plan.cost;
  const next = [...items];
  for (const part of plan.consumed) next.splice(next.indexOf(part), 1);
  next.push(id);
  agent.items = next;
  healDelta(next);
  log.push({ t: tick, type: "buy", side: agent.id, item: id, gold: agent.gold ?? 0 });
}

// The combiner folds held parts in recipe order until stable.
export function autoCombine(agent: AgentState, tick: number, log: MobaEvent[]): void {
  if (!agent.alive) return;
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const recipe of RECIPES) {
      const items = agent.items ?? [];
      const gold = agent.gold ?? 0;
      if (gold < recipe.fee) continue;
      if (!recipe.parts.every((p) => items.includes(p))) continue;
      const maxHp = robotMaxHp(items);
      agent.gold = gold - recipe.fee;
      const next = [...items];
      for (const part of recipe.parts) next.splice(next.indexOf(part), 1);
      next.push(recipe.id);
      agent.items = next;
      agent.hp = Math.min(robotMaxHp(next), agent.hp + (robotMaxHp(next) - maxHp));
      log.push({ t: tick, type: "combine", side: agent.id, item: recipe.id });
      changed = true;
    }
    if (!changed) return;
  }
}

// Combine fee the auto-buyer keeps liquid while a base part waits
// for its upgrade. Without the reserve, parts and cells eat every
// coin, combines never land, and kill-trading grinds to the cap.
export const COMBINE_RESERVE = 350;
export const COMBINE_RESERVE_T3 = 400;

// Auto-buy fallback. One buy per run. Tier 1 parts only. The fee
// reserve saves combines first: parts only spend past it, and cells
// only spend gold too poor to forge. Per-tick auto-combine then
// lands every upgrade the moment its fee goes liquid.
export function autoBuyOne(agent: AgentState, tick: number, log: MobaEvent[]): void {
  if (!agent.alive) return;
  const items = agent.items ?? [];
  const gold = agent.gold ?? 0;
  const maxHp = robotMaxHp(items);
  const hpPct = (agent.hp / maxHp) * 100;
  if (agent.autoCell) {
    if (hpPct >= AUTO_CELL_STOP) agent.autoCell = false;
  } else if (hpPct < AUTO_CELL_START) {
    agent.autoCell = true;
  }
  const holdBase = items.some((id) => BASE_ITEMS[id] && !BASE_ITEMS[id].consumable);
  const holdT2 = items.some((id) => {
    const r = RECIPE_BY_ID[id];
    return !!r && r.parts.every((p) => !!BASE_ITEMS[p]);
  });
  const reserve = holdBase ? COMBINE_RESERVE : holdT2 ? COMBINE_RESERVE_T3 : 0;
  if (items.length < MAX_SLOTS) {
    const covered = coveredBases(items);
    for (const id of AUTO_BUY_ORDER) {
      if (covered.has(id)) continue;
      if (gold < BASE_ITEMS[id].cost + reserve) continue;
      tryBuy(agent, id, tick, log);
      return;
    }
  }
  if (gold < BASE_ITEMS.scrap_blade.cost && agent.autoCell && gold >= BASE_ITEMS.repair_cell.cost) {
    tryBuy(agent, "repair_cell", tick, log);
  }
}

function towerTargetPos(ctx: Ctx, t: TowerTarget): Vec2 | null {
  if (t.kind === "robot") {
    const r = ctx.agents[t.side];
    return r.alive ? r.pos : null;
  }
  const m = ctx.moba.minions.find((k) => k.id === t.id);
  return m && m.alive ? m.pos : null;
}

function sameTowerTarget(a: TowerTarget | null, b: TowerTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "robot"
    ? (b as { side: AgentId }).side === a.side
    : (b as { id: number }).id === a.id;
}

function inTowerRange(tower: StructureState, pos: Vec2, radius: number): boolean {
  return dist(tower.pos, pos) - radius <= TOWER_RANGE;
}

// The gunner holds, acquires, and switches tower targets.
function updateTower(ctx: Ctx, st: StructureState): void {
  if (!st.alive || (st.kind !== "tower" && st.kind !== "nexus_turret")) return;
  const enemy = foe(st.side);
  const robot = ctx.agents[enemy];
  let next: TowerTarget | null = null;
  const cur = st.target;
  if (cur !== null) {
    if (cur.kind === "robot") {
      if (robot.alive && !spawnImmune(robot, ctx.time) && inTowerRange(st, robot.pos, ctx.cfg.agent.radius)) {
        next = cur;
      }
    } else {
      const m = ctx.moba.minions.find((k) => k.id === cur.id);
      if (m && m.alive && inTowerRange(st, m.pos, MINION_RADIUS)) next = cur;
    }
  }
  if (next === null) {
    for (const m of ctx.moba.minions) {
      if (m.side !== enemy || !m.alive) continue;
      if (inTowerRange(st, m.pos, MINION_RADIUS)) {
        next = { kind: "minion", id: m.id };
        break;
      }
    }
    if (next === null && robot.alive && !spawnImmune(robot, ctx.time) &&
      inTowerRange(st, robot.pos, ctx.cfg.agent.radius)) {
      next = { kind: "robot", side: enemy };
    }
  }
  const triggered = ctx.moba.dmg.some(
    (e) => e.byRobot && e.atkSide === enemy && e.victimRobot && e.victimSide === st.side &&
      dist({ x: e.x, y: e.y }, st.pos) <= TOWER_TRIGGER,
  );
  if (triggered && robot.alive && !spawnImmune(robot, ctx.time) &&
    inTowerRange(st, robot.pos, ctx.cfg.agent.radius)) {
    next = { kind: "robot", side: enemy };
  }
  if (!sameTowerTarget(st.target, next)) {
    if (next === null) {
      if (st.heatSide !== null && st.heatOutSince === null) st.heatOutSince = ctx.time;
    } else {
      const resumes = st.heatSide !== null && next.kind === "robot" && next.side === st.heatSide &&
        st.heatOutSince !== null && ctx.time - st.heatOutSince < HEAT_LOSE_SECS;
      if (!resumes) {
        st.heatSide = null;
        st.heatCount = 0;
      }
      st.heatOutSince = null;
    }
    st.target = next;
  }
  if (st.target?.kind === "robot" && st.target.side === st.heatSide) st.heatOutSince = null;
  if (st.heatSide !== null && st.heatOutSince !== null && ctx.time - st.heatOutSince >= HEAT_LOSE_SECS) {
    st.heatSide = null;
    st.heatCount = 0;
    st.heatOutSince = null;
  }
}

function minionTargetPos(ctx: Ctx, t: MinionTarget): Vec2 | null {
  if (t.kind === "robot") {
    const r = ctx.agents[t.side];
    return r.alive ? r.pos : null;
  }
  if (t.kind === "minion") {
    const m = ctx.moba.minions.find((k) => k.id === t.id);
    return m && m.alive ? m.pos : null;
  }
  const s = ctx.moba.structures.find((k) => k.id === t.id);
  return s && s.alive ? s.pos : null;
}

function minionTargetRadius(ctx: Ctx, t: MinionTarget): number {
  if (t.kind === "robot") return ctx.cfg.agent.radius;
  if (t.kind === "minion") return MINION_RADIUS;
  const s = ctx.moba.structures.find((k) => k.id === t.id);
  return s ? s.radius : 0.6;
}

// The brain validates, scans, and retaliates for one minion.
function updateMinionTarget(ctx: Ctx, m: MinionState): void {
  const enemy = foe(m.side);
  const cur = m.target;
  if (cur !== null) {
    if (cur.kind === "robot") {
      const r = ctx.agents[cur.side];
      if (r.alive && !spawnImmune(r, ctx.time) && dist(m.pos, r.pos) <= MINION_AGGRO) return;
    } else if (cur.kind === "minion") {
      const v = ctx.moba.minions.find((k) => k.id === cur.id);
      if (v && v.alive && dist(m.pos, v.pos) <= MINION_AGGRO) return;
    } else {
      // Amendment A1: a structure target stays valid only while vulnerable
      // AND no enemy minion stands in aggro radius. A minion in radius
      // falls through to the rule-2 re-scan below, so waves clash at mid
      // instead of walking past each other to the towers.
      const s = ctx.moba.structures.find((k) => k.id === cur.id);
      const foeNear = ctx.moba.minions.some(
        (v) => v.side === enemy && v.alive && dist(m.pos, v.pos) <= MINION_AGGRO,
      );
      if (s && isVulnerable(s, ctx.moba.structures) && !foeNear) return;
    }
  }
  let best: MinionState | null = null;
  for (const v of ctx.moba.minions) {
    if (v.side !== enemy || !v.alive) continue;
    if (dist(m.pos, v.pos) > MINION_AGGRO) continue;
    if (best === null || dist(m.pos, v.pos) < dist(m.pos, best.pos) ||
      (dist(m.pos, v.pos) === dist(m.pos, best.pos) && v.id < best.id)) {
      best = v;
    }
  }
  if (best) {
    m.target = { kind: "minion", id: best.id };
    return;
  }
  let bs: StructureState | null = null;
  for (const s of ctx.moba.structures) {
    if (s.side !== enemy) continue;
    if (!isVulnerable(s, ctx.moba.structures)) continue;
    if (dist(m.pos, s.pos) > MINION_AGGRO) continue;
    if (bs === null || dist(m.pos, s.pos) < dist(m.pos, bs.pos)) bs = s;
  }
  if (bs) {
    m.target = { kind: "structure", id: bs.id };
    return;
  }
  const robot = ctx.agents[enemy];
  const avenged = ctx.moba.dmg.some(
    (e) => e.byRobot && e.atkSide === enemy && e.victimSide === m.side &&
      dist({ x: e.x, y: e.y }, m.pos) <= MINION_AGGRO,
  );
  if (avenged && robot.alive && !spawnImmune(robot, ctx.time) && dist(m.pos, robot.pos) <= MINION_AGGRO) {
    m.target = { kind: "robot", side: enemy };
    return;
  }
  m.target = null;
}

// Segment-circle hit. It returns the hit fraction or null.
// The driver reuses it for lane routing, so it stays exported.
export function segCircle(
  x1: number, y1: number, x2: number, y2: number,
  cx: number, cy: number, r: number,
): number | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;
  const a = dx * dx + dy * dy;
  if (a === 0) return fx * fx + fy * fy <= r * r ? 0 : null;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return 0;
  return null;
}

export type MobaStep = {
  over: boolean;
  winner: BattleState["winner"];
};

// The step advances the MOBA battle by one tick in spec phase order.
export function stepMobaBattle(
  state: BattleState,
  actions: Record<AgentId, AgentAction>,
  cfg: BattleConfig = DEFAULT_MOBA,
): BattleState {
  if (state.over) return state;
  const src = state.moba ?? createMobaState(cfg.rulesetVersion ?? 1);
  const dt = 1 / cfg.world.tickHz;
  const time = state.time + dt;
  const tick = state.tick + 1;
  const agents: Record<AgentId, AgentState> = {
    A: { ...state.agents.A, pos: { ...state.agents.A.pos }, aim: { ...state.agents.A.aim }, items: [...(state.agents.A.items ?? [])] },
    B: { ...state.agents.B, pos: { ...state.agents.B.pos }, aim: { ...state.agents.B.aim }, items: [...(state.agents.B.items ?? [])] },
  };
  const moba: MobaState = {
    minions: src.minions.map((m) => ({ ...m, pos: { ...m.pos }, target: m.target ? { ...m.target } as MinionTarget : null })),
    structures: src.structures.map((s) => ({ ...s, pos: { ...s.pos }, target: s.target ? { ...s.target } as TowerTarget : null })),
    nextMinionId: src.nextMinionId,
    lifetimeGold: { ...src.lifetimeGold },
    log: [...src.log],
    dmg: src.dmg.filter((e) => time - e.t < HEAT_LOSE_SECS),
    ...(src.overseer ? { overseer: { ...src.overseer, buffUntil: { ...src.overseer.buffUntil } } } : {}),
  };
  const ctx: Ctx = { time, tick, cfg, agents, moba, killers: new Map(), overseerHits: new Set() };

  // Phase 1: clock, waves, respawns, buys, auto-buy, combines.
  if (moba.overseer && !moba.overseer.alive && tick >= moba.overseer.spawnTick) {
    moba.overseer.alive = true;
    moba.overseer.hp = moba.overseer.maxHp;
    moba.overseer.lastAttackTick = tick;
    moba.log.push({ t: tick, type: "overseer-spawn" });
  }
  if (tick >= WAVE_FIRST_TICK && (tick - WAVE_FIRST_TICK) % WAVE_EVERY_TICKS === 0) {
    spawnWave(moba, time, tick);
  }
  for (const id of ["A", "B"] as AgentId[]) {
    const a = agents[id];
    if (!a.alive && time >= (a.respawnAt ?? 0)) {
      a.alive = true;
      a.pos = mobaSpawn(id);
      a.hp = robotMaxHp(a.items ?? []);
      a.energy = cfg.agent.maxEnergy;
      a.dashCooldownUntil = 0;
      a.shieldCooldownUntil = 0;
      a.shieldUntil = 0;
      a.lastShotAt = -10;
      a.spawnShieldUntil = time + SPAWN_SHIELD_SECS;
      moba.log.push({ t: tick, type: "respawn", side: id });
    }
  }
  for (const id of ["A", "B"] as AgentId[]) {
    const a = agents[id];
    if (!a.alive) continue;
    const nexus = moba.structures.find((s) => s.side === id && s.kind === "nexus");
    if (nexus && nexus.alive && dist(a.pos, nexus.pos) <= NEXUS_HEAL_RANGE) {
      const maxHp = robotMaxHp(a.items ?? []);
      a.hp = Math.min(maxHp, a.hp + NEXUS_HEAL_PCT * maxHp * dt);
    }
  }
  for (const id of ["A", "B"] as AgentId[]) {
    const buy = actions[id].buy;
    if (buy !== null && buy !== undefined) tryBuy(agents[id], buy, tick, moba.log);
  }
  if (cfg.autoBuy !== false && tick % AUTO_BUY_EVERY === 0) {
    for (const id of ["A", "B"] as AgentId[]) {
      if (actions[id].buy === null || actions[id].buy === undefined) {
        autoBuyOne(agents[id], tick, moba.log);
      }
    }
  }
  for (const id of ["A", "B"] as AgentId[]) autoCombine(agents[id], tick, moba.log);

  // Phase 2: movement. Robots A, B, then minions by id.
  for (const id of ["A", "B"] as AgentId[]) {
    const a = agents[id];
    if (!a.alive) continue;
    const act = actions[id];
    const move = norm(act.move);
    let speed = robotSpeed(a.items ?? [], cfg.agent.speed);
    if (act.dash && a.energy >= 25 && time >= a.dashCooldownUntil) {
      speed *= 3.2;
      a.energy -= 25;
      a.dashCooldownUntil = time + 3;
    }
    if (act.shield && a.energy >= 20 && time >= a.shieldCooldownUntil) {
      a.energy -= 20;
      a.shieldUntil = time + 0.8;
      a.shieldCooldownUntil = time + 4;
    }
    a.energy = Math.min(cfg.agent.maxEnergy, a.energy + cfg.agent.energyRegen * dt);
    const next = { x: a.pos.x + move.x * speed * dt, y: a.pos.y + move.y * speed * dt };
    a.pos = resolveMoba(next, cfg.agent.radius, cfg, moba.structures);
    const aimLen = Math.hypot(act.aim.x, act.aim.y);
    if (aimLen > 0.001) {
      a.aim = { x: act.aim.x / aimLen, y: act.aim.y / aimLen };
    }
  }
  for (const m of moba.minions) {
    if (!m.alive) continue;
    updateMinionTarget(ctx, m);
    const stats = MINION_STATS[m.kind];
    let step: Vec2 | null = null;
    if (m.target) {
      const tp = minionTargetPos(ctx, m.target);
      if (tp) {
        const rr = minionTargetRadius(ctx, m.target);
        if (dist(m.pos, tp) - rr > stats.range) step = dir(m.pos, tp);
      }
    } else if (Math.abs(m.pos.y - LANE_Y) > LANE_HALF) {
      step = dir(m.pos, { x: m.pos.x, y: LANE_Y });
    } else {
      const wps = minionWaypoints(m.side);
      while (m.wpIndex < wps.length && dist(m.pos, wps[m.wpIndex]) < 0.5) m.wpIndex += 1;
      if (m.wpIndex < wps.length) step = dir(m.pos, wps[m.wpIndex]);
    }
    if (step) {
      const next = { x: m.pos.x + step.x * 3.0 * dt, y: m.pos.y + step.y * 3.0 * dt };
      m.pos = resolveMoba(next, MINION_RADIUS, cfg, moba.structures);
    }
  }
  const aliveMinions = moba.minions.filter((m) => m.alive);
  // Simultaneous separation: pair pushes compute from a snapshot and
  // apply after, so ascending id order cannot bias either side.
  const snap = aliveMinions.map((m) => ({ x: m.pos.x, y: m.pos.y }));
  const pushes = aliveMinions.map(() => ({ x: 0, y: 0 }));
  for (let i = 0; i < aliveMinions.length; i += 1) {
    for (let j = i + 1; j < aliveMinions.length; j += 1) {
      const dx = snap[j].x - snap[i].x;
      const dy = snap[j].y - snap[i].y;
      const rr = MINION_RADIUS * 2;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) / 2 / d;
      pushes[i].x -= dx * push;
      pushes[i].y -= dy * push;
      pushes[j].x += dx * push;
      pushes[j].y += dy * push;
    }
  }
  for (let i = 0; i < aliveMinions.length; i += 1) {
    aliveMinions[i].pos = { x: snap[i].x + pushes[i].x, y: snap[i].y + pushes[i].y };
  }
  for (const m of aliveMinions) {
    for (const id of ["A", "B"] as AgentId[]) {
      const a = agents[id];
      if (!a.alive) continue;
      const dx = m.pos.x - a.pos.x;
      const dy = m.pos.y - a.pos.y;
      const rr = MINION_RADIUS + cfg.agent.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2);
      m.pos = { x: a.pos.x + (dx / d) * rr, y: a.pos.y + (dy / d) * rr };
    }
  }

  // The guardian retaliates once per second against robots in its arena.
  // Both sides are hit equally when they enter together.
  const guardian = moba.overseer;
  if (guardian?.alive && tick - guardian.lastAttackTick >= cfg.world.tickHz) {
    const targets = (["A", "B"] as AgentId[]).map(id => agents[id]).filter(a => a.alive && !spawnImmune(a, time) && Math.hypot(a.pos.x - guardian.x, a.pos.y - guardian.y) <= 5);
    if (targets.length) {
      guardian.lastAttackTick = tick;
      for (const a of targets) if (time > a.shieldUntil) a.hp -= 20 * armorMult(robotArmor(a.items ?? []));
    }
  }
  // Phase 3: attacks. Robots, towers, caster minions, melee minions.
  let projectiles = state.projectiles.map((p) => ({
    ...p,
    pos: { ...p.pos },
    prev: { ...p.prev },
    vel: { ...p.vel },
  }));
  let nextId = state.nextProjectileId;
  for (const id of ["A", "B"] as AgentId[]) {
    const a = agents[id];
    if (!a.alive) continue;
    if (actions[id].fire && time - a.lastShotAt >= robotInterval(a.items ?? [])) {
      a.lastShotAt = time;
      // Amendment A7: MOBA shots leave from the robot center. A muzzle
      // offset spawns the shot past a point-blank victim, so stacked
      // robots fire forever without damage. Duel keeps its offset, so
      // duel replays stay byte-identical.
      const muzzle = cfg.mode === "moba" ? 0 : cfg.agent.radius + 0.1;
      const sx = a.pos.x + a.aim.x * muzzle;
      const sy = a.pos.y + a.aim.y * muzzle;
      projectiles.push({
        id: nextId++,
        owner: id,
        pos: { x: sx, y: sy },
        prev: { x: sx, y: sy },
        vel: { x: a.aim.x * PROJECTILE_SPEED, y: a.aim.y * PROJECTILE_SPEED },
        alive: true,
        dmg: robotAD(a.items ?? []) * (moba.overseer && tick < moba.overseer.buffUntil[id] ? 1.2 : 1),
        srcTower: null,
        srcMinion: null,
      });
    }
  }
  for (const st of moba.structures) {
    updateTower(ctx, st);
    if (!st.alive || st.target === null) continue;
    if (st.kind !== "tower" && st.kind !== "nexus_turret") continue;
    const tp = towerTargetPos(ctx, st.target);
    if (!tp) continue;
    const interval = structureInterval(st.id);
    if (time - st.lastShotAt < interval) continue;
    st.lastShotAt = time;
    const aim = dir(st.pos, tp);
    const hot = st.target.kind === "robot" && st.heatSide === st.target.side;
    projectiles.push({
      id: nextId++,
      owner: st.side,
      pos: { ...st.pos },
      prev: { ...st.pos },
      vel: { x: aim.x * PROJECTILE_SPEED, y: aim.y * PROJECTILE_SPEED },
      alive: true,
      dmg: TOWER_SHOT * (hot ? heatMult(st.heatCount) : 1),
      srcTower: st.id,
      srcMinion: null,
    });
  }
  // Fair turn order: minion attack loops alternate the leading side by
  // tick parity, so neither side systematically strikes first. Stable id
  // order within each side keeps every tick deterministic.
  const bFirst = tick % 2 === 1;
  const minionOrder = bFirst
    ? [...moba.minions.filter((m) => m.side === "B"), ...moba.minions.filter((m) => m.side === "A")]
    : [...moba.minions];
  for (const m of minionOrder) {
    if (!m.alive || m.kind !== "caster" || !m.target) continue;
    const tp = minionTargetPos(ctx, m.target);
    if (!tp) continue;
    const rr = minionTargetRadius(ctx, m.target);
    if (dist(m.pos, tp) - rr > MINION_STATS.caster.range) continue;
    if (time - m.lastShotAt < MINION_STATS.caster.interval) continue;
    m.lastShotAt = time;
    const aim = dir(m.pos, tp);
    projectiles.push({
      id: nextId++,
      owner: m.side,
      pos: { ...m.pos },
      prev: { ...m.pos },
      vel: { x: aim.x * PROJECTILE_SPEED, y: aim.y * PROJECTILE_SPEED },
      alive: true,
      dmg: MINION_STATS.caster.dmg,
      srcTower: null,
      srcMinion: m.id,
    });
  }
  for (const m of minionOrder) {
    if (!m.alive || m.kind !== "melee" || !m.target) continue;
    const tp = minionTargetPos(ctx, m.target);
    if (!tp) continue;
    const rr = minionTargetRadius(ctx, m.target);
    if (dist(m.pos, tp) - rr > MINION_STATS.melee.range) continue;
    if (time - m.lastShotAt < MINION_STATS.melee.interval) continue;
    m.lastShotAt = time;
    hitMinionTarget(ctx, m);
  }

  // Phase 4: projectiles move and collide in ascending id order.
  for (const p of projectiles) {
    if (!p.alive) continue;
    if (p.srcTower) {
      const tower = moba.structures.find((s) => s.id === p.srcTower);
      if (!tower || !tower.alive) {
        p.alive = false;
        continue;
      }
      // Amendment A3: tower shots fizzle past tower range. Aimed
      // shots never cross the map to chip distant structures.
      if (dist(p.pos, tower.pos) > TOWER_RANGE) {
        p.alive = false;
        continue;
      }
    }
    p.prev = { ...p.pos };
    p.pos = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt };
    if (p.pos.x < 0 || p.pos.x > cfg.world.width || p.pos.y < 0 || p.pos.y > cfg.world.height) {
      p.alive = false;
      continue;
    }
    let blocked = false;
    for (const box of cfg.world.covers) {
      if (segmentHitsBox(p.prev.x, p.prev.y, p.pos.x, p.pos.y, box)) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      p.alive = false;
      continue;
    }
    collideMobaProjectile(ctx, p);
  }
  projectiles = projectiles.filter((p) => p.alive);
  if (moba.overseer?.alive && moba.overseer.hp <= 0) {
    moba.overseer.alive = false;
    moba.overseer.spawnTick = tick + OVERSEER_RESPAWN_TICKS;
    for (const side of ["A", "B"] as AgentId[]) if (ctx.overseerHits.has(side)) {
      moba.overseer.buffUntil[side] = tick + OVERSEER_BUFF_TICKS;
      moba.log.push({ t: tick, type: "overseer-defeated", side });
    }
  }

  // Phase 5: deaths in ascending entity order. Gold and credit apply.
  const order: { key: string; robot: AgentState | null; minion: MinionState | null }[] = [
    { key: "robot:A", robot: agents.A, minion: null },
    { key: "robot:B", robot: agents.B, minion: null },
    ...moba.minions.map((m) => ({ key: `minion:${m.id}`, robot: null as AgentState | null, minion: m as MinionState | null })),
  ];
  for (const e of order) {
    if (e.robot) {
      const a = e.robot;
      if (!a.alive || a.hp > 0) continue;
      a.hp = 0;
      a.alive = false;
      a.deaths = (a.deaths ?? 0) + 1;
      a.respawnAt = time + respawnCooldown(a.deaths);
      const killer = ctx.killers.get(e.key);
      if (killer && killer.kind === "robot") {
        const k = agents[killer.side];
        k.gold = (k.gold ?? 0) + ROBOT_GOLD;
        moba.lifetimeGold[killer.side] += ROBOT_GOLD;
      }
      moba.log.push({ t: tick, type: "kill", side: a.id });
    } else if (e.minion) {
      const m = e.minion;
      if (!m.alive || m.hp > 0) continue;
      m.alive = false;
      m.hp = 0;
      const killer = ctx.killers.get(e.key);
      if (killer && killer.kind === "robot") {
        const k = agents[killer.side];
        const value = minionGold(m.kind);
        k.gold = (k.gold ?? 0) + value;
        moba.lifetimeGold[killer.side] += value;
      }
    }
  }
  moba.minions = moba.minions.filter((m) => m.alive);

  // Phase 6: structure destruction applies outward-in.
  for (const side of ["A", "B"] as AgentId[]) {
    const p = side === "A" ? "a" : "b";
    const chain = [`${p}_t1`, `${p}_t2`, `${p}_inhib`, `${p}_nt_top`, `${p}_nt_bot`, `${p}_nexus`] as StructureId[];
    for (const id of chain) {
      const s = structById(moba.structures, id);
      if (!s.alive || s.hp > 0) continue;
      s.hp = 0;
      s.alive = false;
      s.target = null;
      moba.log.push({ t: tick, type: "structure", side, id });
    }
  }

  // Phase 7: win check.
  let over = false;
  let winner: BattleState["winner"] = null;
  const aNexus = structById(moba.structures, "a_nexus");
  const bNexus = structById(moba.structures, "b_nexus");
  if (!aNexus.alive || !bNexus.alive) {
    over = true;
    winner = !aNexus.alive && !bNexus.alive ? "DRAW" : !bNexus.alive ? "A" : "B";
  } else if (tick >= cfg.world.maxTicks) {
    over = true;
    winner = mobaTiebreak(moba);
  }

  return { tick, time, agents, projectiles, nextProjectileId: nextId, over, winner, moba };
}

// The striker applies one minion melee hit.
function hitMinionTarget(ctx: Ctx, m: MinionState): void {
  const t = m.target;
  if (!t) return;
  if (t.kind === "robot") {
    damageRobot(ctx, ctx.agents[t.side], MINION_STATS.melee.dmg, m.side, "minion");
  } else if (t.kind === "minion") {
    const v = ctx.moba.minions.find((k) => k.id === t.id);
    if (v) damageMinion(ctx, v, MINION_STATS.melee.dmg, m.side, "minion");
  } else {
    const s = ctx.moba.structures.find((k) => k.id === t.id);
    if (s) damageStructure(ctx, s, MINION_STATS.melee.dmg * MINION_STRUCT_MULT, m.side, "minion");
  }
}

// The resolver hits the nearest enemy along the shot segment.
function collideMobaProjectile(ctx: Ctx, p: { id: number; owner: AgentId; prev: Vec2; pos: Vec2; alive: boolean; dmg?: number; srcTower?: StructureId | null; srcMinion?: number | null }): void {
  const enemy = foe(p.owner);
  const kind: Killer["kind"] = p.srcTower ? "tower" : p.srcMinion !== null && p.srcMinion !== undefined ? "minion" : "robot";
  const raw = p.dmg ?? 10;
  let bestT = Infinity;
  let hitRobot = false;
  let hitMinion: MinionState | null = null;
  let hitStruct: StructureState | null = null;
  let hitOverseer = false;
  const robot = ctx.agents[enemy];
  if (robot.alive && !spawnImmune(robot, ctx.time)) {
    const t = segCircle(p.prev.x, p.prev.y, p.pos.x, p.pos.y, robot.pos.x, robot.pos.y, ctx.cfg.agent.radius);
    if (t !== null && t < bestT) {
      bestT = t;
      hitRobot = true;
      hitMinion = null;
      hitStruct = null;
    }
  }
  for (const m of ctx.moba.minions) {
    if (m.side !== enemy || !m.alive) continue;
    const t = segCircle(p.prev.x, p.prev.y, p.pos.x, p.pos.y, m.pos.x, m.pos.y, MINION_RADIUS);
    if (t !== null && t < bestT) {
      bestT = t;
      hitRobot = false;
      hitMinion = m;
      hitStruct = null;
    }
  }
  // Amendment A4: tower shots never damage structures. Turret
  // aggro shots strike units only (LoL rule); a dead target lets
  // the shot fly through, never splash the adjacent tower.
  for (const s of ctx.moba.structures) {
    if (s.side !== enemy || !isVulnerable(s, ctx.moba.structures)) continue;
    if (p.srcTower) continue;
    const t = segCircle(p.prev.x, p.prev.y, p.pos.x, p.pos.y, s.pos.x, s.pos.y, s.radius);
    if (t !== null && t < bestT) {
      bestT = t;
      hitRobot = false;
      hitMinion = null;
      hitStruct = s;
    }
  }
  const overseer = ctx.moba.overseer;
  if (kind === "robot" && overseer?.alive) {
    const t = segCircle(p.prev.x, p.prev.y, p.pos.x, p.pos.y, overseer.x, overseer.y, OVERSEER_RADIUS);
    if (t !== null && t < bestT) { bestT = t; hitOverseer = true; hitRobot = false; hitMinion = null; hitStruct = null; }
  }
  if (bestT === Infinity) return;
  p.alive = false;
  if (hitOverseer && overseer) {
    overseer.hp = Math.max(0, overseer.hp - raw);
    ctx.moba.log.push({ t: ctx.tick, type: "overseer-hit", side: p.owner, damage: raw });
    ctx.overseerHits.add(p.owner);
    return;
  }
  if (hitRobot) {
    if (ctx.time <= robot.shieldUntil) return;
    const before = robot.hp;
    damageRobot(ctx, robot, raw, p.owner, kind);
    if (kind === "tower" && robot.hp < before && p.srcTower) {
      const tower = ctx.moba.structures.find((s) => s.id === p.srcTower);
      if (tower) {
        if (tower.heatSide === enemy) tower.heatCount += 1;
        else {
          tower.heatSide = enemy;
          tower.heatCount = 1;
        }
        tower.heatOutSince = null;
      }
    }
    return;
  }
  if (hitMinion) {
    if (kind === "robot") damageMinion(ctx, hitMinion, raw, p.owner, kind);
    else if (kind === "tower") damageMinion(ctx, hitMinion, raw, p.owner, kind);
    else damageMinion(ctx, hitMinion, raw, p.owner, kind);
    return;
  }
  if (hitStruct) {
    let mult = 1;
    if (kind === "robot" && robotDemolish(ctx.agents[p.owner].items ?? [])) mult = DEMOLISH_MULT;
    if (kind === "minion") mult = MINION_STRUCT_MULT;
    damageStructure(ctx, hitStruct, raw * mult, p.owner, kind);
  }
}

// Safety cap tiebreak: structures destroyed, then lifetime gold.
export function mobaTiebreak(moba: MobaState): AgentId | "DRAW" {
  const felled = (side: AgentId): number =>
    moba.structures.filter((s) => s.side === side && s.kind !== "nexus" && !s.alive).length;
  const aScore = felled("B");
  const bScore = felled("A");
  if (aScore !== bScore) return aScore > bScore ? "A" : "B";
  if (moba.lifetimeGold.A !== moba.lifetimeGold.B) {
    return moba.lifetimeGold.A > moba.lifetimeGold.B ? "A" : "B";
  }
  return "DRAW";
}

// The helper serializes MOBA state for hashing.
export function mobaStateKey(s: BattleState): string {
  const f = (n: number): string => n.toFixed(4);
  const m = s.moba ?? createMobaState();
  const parts: string[] = [`moba`, `${s.tick}`];
  for (const id of ["A", "B"] as AgentId[]) {
    const a = s.agents[id];
    parts.push([
      f(a.pos.x), f(a.pos.y), `${a.hp}`, f(a.energy),
      `${a.gold ?? 0}`, (a.items ?? []).join("+"), `${a.alive ? 1 : 0}`,
      f(a.dashCooldownUntil), f(a.shieldUntil), f(a.shieldCooldownUntil), f(a.lastShotAt),
      `${a.deaths ?? 0}`, f(a.respawnAt ?? 0), f(a.spawnShieldUntil ?? 0),
    ].join(","));
  }
  for (const v of m.minions) {
    const t = v.target === null ? "-" :
      v.target.kind === "robot" ? `r${v.target.side}` :
        v.target.kind === "minion" ? `m${v.target.id}` : `s${v.target.id}`;
    parts.push(`min${v.id}:${v.side}:${v.kind}:${f(v.pos.x)},${f(v.pos.y)}:${v.hp}:${t}`);
  }
  for (const st of m.structures) {
    const t = st.target === null ? "-" :
      st.target.kind === "robot" ? `r${st.target.side}` : `m${st.target.id}`;
    parts.push(`${st.id}:${st.alive ? 1 : 0}:${st.hp}:${t}:${st.heatSide ?? "-"}:${st.heatCount}`);
  }
  parts.push(`proj${s.projectiles.length}`);
  for (const p of s.projectiles) {
    parts.push(`${p.id}:${f(p.pos.x)},${f(p.pos.y)}:${p.dmg ?? 10}`);
  }
  parts.push(`gold${m.lifetimeGold.A},${m.lifetimeGold.B}`);
  if (m.overseer) {
    const o = m.overseer;
    parts.push(`overseer:${f(o.x)},${f(o.y)}:${o.alive ? 1 : 0}:${o.hp}:${o.spawnTick}:${o.lastAttackTick}:${o.buffUntil.A}:${o.buffUntil.B}`);
    parts.push(`positions:${m.structures.map(st => `${st.id}:${f(st.pos.x)},${f(st.pos.y)}`).join(";")}`);
  }
  return parts.join("|");
}
