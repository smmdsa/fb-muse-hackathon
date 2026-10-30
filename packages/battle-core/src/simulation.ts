// Deterministic battle step. Fixed dt keeps replays identical.

import { fnv1a, mulberry32, seedFromString } from "./rng.ts";
import { createMobaAgent, createMobaState, mobaStateKey, stepMobaBattle } from "./moba.ts";
import { circleHitsBox, forgeWorld, pointInBox, segmentHitsBox } from "./world.ts";
import type {
  AgentAction,
  AgentId,
  AgentState,
  ArenaExtraState,
  BattleConfig,
  BattleState,
  PickupKind,
  Vec2,
} from "./types.ts";

export const DEFAULT_BATTLE: BattleConfig = {
  seed: "forge-001",
  world: forgeWorld(),
  agent: {
    radius: 0.35,
    speed: 4,
    maxHp: 100,
    maxEnergy: 100,
    energyRegen: 8,
  },
  mode: "duel",
};

const FIRE_INTERVAL = 0.5;
const PROJECTILE_SPEED = 14;
const PROJECTILE_DAMAGE = 10;
export const DASH_COST = 25;
export const DASH_COOLDOWN = 3;
export const DASH_MULT = 3.2;
export const SHIELD_COST = 20;
export const SHIELD_ACTIVE = 0.8;
export const SHIELD_COOLDOWN = 4;
// Arena combat. Shots fly 6u max with the bot as 1u, fire every
// 1.025s, and energy regens 5/s. The skill fires one powered shot
// for 25 energy on a 3s cooldown. Pickups spawn on a fixed clock:
// green heals 20 HP, blue shields 5s, red adds 12% damage for 15s.
export const ARENA_RANGE = 6;
export const ARENA_FIRE_INTERVAL = 1.025;
export const ARENA_SKILL_COST = 25;
export const ARENA_SKILL_COOLDOWN = 3;
export const ARENA_SKILL_DAMAGE = 20;
export const ARENA_PICKUP_FIRST_TICK = 150;
export const ARENA_PICKUP_EVERY_TICKS = 300;
export const ARENA_PICKUP_MAX = 3;
export const ARENA_PICKUP_HEAL = 20;
export const ARENA_PICKUP_SHIELD_SECS = 5;
export const ARENA_PICKUP_DMG_SECS = 15;
export const ARENA_PICKUP_DMG_MULT = 1.12;
const ARENA_PICKUP_SPOTS = [
  { x: 12, y: 8 },
  { x: 6, y: 8 },
  { x: 18, y: 8 },
  { x: 12, y: 4 },
  { x: 12, y: 12 },
];
const ARENA_PICKUP_KINDS: PickupKind[] = ["green", "blue", "red"];

// The helper clamps a vector to max length 1.
function norm(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len <= 1 || len === 0) return { x: v.x, y: v.y };
  return { x: v.x / len, y: v.y / len };
}

// The helper spawns one agent at its mirror side.
function spawn(id: AgentId, cfg: BattleConfig): AgentState {
  const w = cfg.world.width;
  const h = cfg.world.height;
  const shift = cfg.spawnShift ?? 0;
  let x = id === "A" ? 2 : w - 2;
  let y = h / 2;
  let ax = id === "A" ? 1 : -1;
  let ay = 0;
  if (shift === 1) {
    x = id === "A" ? w - 2 : 2;
    ax = id === "A" ? -1 : 1;
  } else if (shift === 2) {
    x = id === "A" ? w * 0.25 : w * 0.75;
    y = id === "A" ? h * 0.25 : h * 0.75;
    const dx = (id === "A" ? w * 0.75 : w * 0.25) - x;
    const dy = (id === "A" ? h * 0.75 : h * 0.25) - y;
    const len = Math.hypot(dx, dy) || 1;
    ax = dx / len;
    ay = dy / len;
  }
  return {
    id,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    hp: cfg.agent.maxHp,
    energy: cfg.agent.maxEnergy,
    aim: { x: ax, y: ay },
    alive: true,
    dashCooldownUntil: 0,
    shieldUntil: 0,
    shieldCooldownUntil: 0,
    lastShotAt: -10,
    damageDealt: 0,
    controlTime: 0,
  };
}

// The factory builds the start state for a seed.
export function createBattle(cfg: BattleConfig = DEFAULT_BATTLE): BattleState {
  if (cfg.mode === "moba") {
    return {
      tick: 0,
      time: 0,
      agents: { A: createMobaAgent("A", cfg), B: createMobaAgent("B", cfg) },
      projectiles: [],
      nextProjectileId: 1,
      over: false,
      winner: null,
      moba: createMobaState(cfg.rulesetVersion ?? 1),
    };
  }
  return {
    tick: 0,
    time: 0,
    agents: { A: spawn("A", cfg), B: spawn("B", cfg) },
    projectiles: [],
    nextProjectileId: 1,
    over: false,
    winner: null,
    ...(cfg.mode === "arena" ? { arena: { pickups: [], spawnCount: 0, nextPickupId: 1, log: [] } } : {}),
  };
}

// The resolver slides a circle out of cover boxes.
function resolveCovers(
  pos: Vec2,
  radius: number,
  cfg: BattleConfig,
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
  p.x = Math.min(Math.max(p.x, radius), cfg.world.width - radius);
  p.y = Math.min(Math.max(p.y, radius), cfg.world.height - radius);
  return p;
}

// The draw picks one arena pickup from the seed and the spawn
// index. Same seed and index give the same kind and spot.
function arenaPickupSpawn(seed: string, index: number): { kind: PickupKind; pos: { x: number; y: number } } {
  const rng = mulberry32(seedFromString(`${seed}#pickup${index}`));
  const kind = ARENA_PICKUP_KINDS[Math.floor(rng() * ARENA_PICKUP_KINDS.length)];
  const spot = ARENA_PICKUP_SPOTS[Math.floor(rng() * ARENA_PICKUP_SPOTS.length)];
  return { kind, pos: { x: spot.x, y: spot.y } };
}

// The step advances the full battle by one tick.
export function stepBattle(
  state: BattleState,
  actions: Record<AgentId, AgentAction>,
  cfg: BattleConfig = DEFAULT_BATTLE,
): BattleState {
  if (state.over) return state;
  if (cfg.mode === "moba" || state.moba) return stepMobaBattle(state, actions, cfg);
  const dt = 1 / cfg.world.tickHz;
  const time = state.time + dt;
  const tick = state.tick + 1;
  const isArena = cfg.mode === "arena";
  const agents: Record<AgentId, AgentState> = {
    A: { ...state.agents.A, pos: { ...state.agents.A.pos } },
    B: { ...state.agents.B, pos: { ...state.agents.B.pos } },
  };

  for (const id of ["A", "B"] as AgentId[]) {
    const a = agents[id];
    if (!a.alive) continue;
    const act = actions[id];
    const move = norm(act.move);
    let speed = cfg.agent.speed;
    if (act.dash && a.energy >= DASH_COST && time >= a.dashCooldownUntil) {
      speed *= DASH_MULT;
      a.energy -= DASH_COST;
      a.dashCooldownUntil = time + DASH_COOLDOWN;
    }
    if (
      act.shield &&
      a.energy >= SHIELD_COST &&
      time >= a.shieldCooldownUntil
    ) {
      a.energy -= SHIELD_COST;
      a.shieldUntil = time + SHIELD_ACTIVE;
      a.shieldCooldownUntil = time + SHIELD_COOLDOWN;
    }
    if (isArena && act.skill === true && a.energy >= ARENA_SKILL_COST && time >= (a.skillCooldownUntil ?? 0) && time - a.lastShotAt >= ARENA_FIRE_INTERVAL) {
      a.energy -= ARENA_SKILL_COST;
      a.skillCooldownUntil = time + ARENA_SKILL_COOLDOWN;
      a.lastShotAt = time;
      a.skillArmed = true;
    }
    a.energy = Math.min(cfg.agent.maxEnergy, a.energy + cfg.agent.energyRegen * dt);
    const next = {
      x: a.pos.x + move.x * speed * dt,
      y: a.pos.y + move.y * speed * dt,
    };
    a.pos = resolveCovers(next, cfg.agent.radius, cfg);
    const aimLen = Math.hypot(act.aim.x, act.aim.y);
    if (aimLen > 0.001) {
      a.aim = { x: act.aim.x / aimLen, y: act.aim.y / aimLen };
    }
    if (pointInBox(a.pos.x, a.pos.y, cfg.world.control)) {
      a.controlTime += dt;
    }
  }

  let projectiles = state.projectiles.map((p) => ({ ...p }));
  let nextId = state.nextProjectileId;
  const fireGap = isArena ? ARENA_FIRE_INTERVAL : FIRE_INTERVAL;
  const arena: ArenaExtraState | null = isArena
    ? {
      pickups: (state.arena?.pickups ?? []).map((p) => ({ ...p, pos: { ...p.pos } })),
      spawnCount: state.arena?.spawnCount ?? 0,
      nextPickupId: state.arena?.nextPickupId ?? 1,
      log: [...(state.arena?.log ?? [])],
    }
    : null;

  for (const id of ["A", "B"] as AgentId[]) {
    const a = agents[id];
    if (!a.alive) continue;
    const act = actions[id];
    if (act.fire && time - a.lastShotAt >= fireGap) {
      a.lastShotAt = time;
      const sx = a.pos.x + a.aim.x * (cfg.agent.radius + 0.1);
      const sy = a.pos.y + a.aim.y * (cfg.agent.radius + 0.1);
      projectiles.push({
        id: nextId++,
        owner: id,
        pos: { x: sx, y: sy },
        prev: { x: sx, y: sy },
        vel: { x: a.aim.x * PROJECTILE_SPEED, y: a.aim.y * PROJECTILE_SPEED },
        alive: true,
        ...(isArena
          ? { traveled: 0, dmg: PROJECTILE_DAMAGE * (time < (a.dmgBuffUntil ?? 0) ? ARENA_PICKUP_DMG_MULT : 1) }
          : {}),
      });
    }
  }

  // The skill fires one powered shot. Policy triggers it. It costs
  // 25 energy and locks for 3s. Duel never reads act.skill.
  for (const id of ["A", "B"] as AgentId[]) {
    const a = agents[id];
    if (!a.alive || !isArena || !arena) continue;
    const act = actions[id];
    if (a.skillArmed) {
      a.skillArmed = false;
      const sx = a.pos.x + a.aim.x * (cfg.agent.radius + 0.1);
      const sy = a.pos.y + a.aim.y * (cfg.agent.radius + 0.1);
      projectiles.push({
        id: nextId++,
        owner: id,
        pos: { x: sx, y: sy },
        prev: { x: sx, y: sy },
        vel: { x: a.aim.x * PROJECTILE_SPEED, y: a.aim.y * PROJECTILE_SPEED },
        alive: true,
        traveled: 0,
        dmg: ARENA_SKILL_DAMAGE * (time < (a.dmgBuffUntil ?? 0) ? ARENA_PICKUP_DMG_MULT : 1),
        powered: true,
      });
      arena.log.push({ t: tick, side: id, type: "skill" });
    }
  }

  for (const p of projectiles) {
    if (!p.alive) continue;
    p.prev = { ...p.pos };
    p.pos = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt };
    if (p.traveled !== undefined) {
      p.traveled += Math.hypot(p.pos.x - p.prev.x, p.pos.y - p.prev.y);
    }
    if (
      p.pos.x < 0 ||
      p.pos.x > cfg.world.width ||
      p.pos.y < 0 ||
      p.pos.y > cfg.world.height
    ) {
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
    const targetId: AgentId = p.owner === "A" ? "B" : "A";
    const t = agents[targetId];
    if (!t.alive) continue;
    const dx = p.pos.x - t.pos.x;
    const dy = p.pos.y - t.pos.y;
    if (dx * dx + dy * dy <= cfg.agent.radius * cfg.agent.radius) {
      p.alive = false;
      const shielded = time <= t.shieldUntil;
      if (!shielded) {
        const dmg = p.dmg ?? PROJECTILE_DAMAGE;
        t.hp -= dmg;
        const owner = agents[p.owner];
        owner.damageDealt += dmg;
        if (t.hp <= 0) {
          t.hp = 0;
          t.alive = false;
        }
      }
    }
    if (p.traveled !== undefined && p.traveled >= ARENA_RANGE) {
      p.alive = false;
    }
  }
  // Pickups spawn on a fixed clock and vanish on touch. Green
  // heals, blue shields, red boosts damage. Duel has no arena.
  if (arena) {
    if (
      tick >= ARENA_PICKUP_FIRST_TICK &&
      (tick - ARENA_PICKUP_FIRST_TICK) % ARENA_PICKUP_EVERY_TICKS === 0 &&
      arena.pickups.length < ARENA_PICKUP_MAX
    ) {
      const drawn = arenaPickupSpawn(cfg.seed, arena.spawnCount);
      arena.spawnCount += 1;
      arena.pickups.push({ id: arena.nextPickupId++, kind: drawn.kind, pos: drawn.pos });
    }
    for (const id of ["A", "B"] as AgentId[]) {
      const a = agents[id];
      if (!a.alive) continue;
      const idx = arena.pickups.findIndex(
        (p) => Math.hypot(p.pos.x - a.pos.x, p.pos.y - a.pos.y) <= cfg.agent.radius + 0.4,
      );
      if (idx === -1) continue;
      const [got] = arena.pickups.splice(idx, 1);
      if (got.kind === "green") a.hp = Math.min(cfg.agent.maxHp, a.hp + ARENA_PICKUP_HEAL);
      else if (got.kind === "blue") {
        a.shieldUntil = Math.max(a.shieldUntil, time + ARENA_PICKUP_SHIELD_SECS);
        a.shieldCooldownUntil = Math.max(a.shieldCooldownUntil, time + ARENA_PICKUP_SHIELD_SECS);
      }
      else a.dmgBuffUntil = time + ARENA_PICKUP_DMG_SECS;
      arena.log.push({ t: tick, side: id, type: "pickup", kind: got.kind });
    }
  }

  projectiles = projectiles.filter((p) => p.alive);

  const aAlive = agents.A.alive;
  const bAlive = agents.B.alive;
  let over = false;
  let winner: BattleState["winner"] = null;
  if (!aAlive || !bAlive) {
    over = true;
    winner = aAlive ? "A" : bAlive ? "B" : "DRAW";
  } else if (tick >= cfg.world.maxTicks) {
    over = true;
    winner = decideWinner(agents.A, agents.B);
  }

  return { tick, time, agents, projectiles, nextProjectileId: nextId, over, winner, ...(arena ? { arena } : {}) };
}

// The scorer picks the winner at time expiry.
export function decideWinner(a: AgentState, b: AgentState): AgentId | "DRAW" {
  if (a.damageDealt !== b.damageDealt) {
    return a.damageDealt > b.damageDealt ? a.id : b.id;
  }
  if (a.controlTime !== b.controlTime) {
    return a.controlTime > b.controlTime ? a.id : b.id;
  }
  if (a.hp !== b.hp) return a.hp > b.hp ? a.id : b.id;
  return "DRAW";
}

// The helper serializes state for hashing.
export function stateKey(s: BattleState): string {
  if (s.moba) return mobaStateKey(s);
  const f = (n: number): string => n.toFixed(4);
  const a = s.agents.A;
  const b = s.agents.B;
  const parts = [
    s.tick,
    f(a.pos.x), f(a.pos.y), a.hp, f(a.energy),
    f(b.pos.x), f(b.pos.y), b.hp, f(b.energy),
    s.projectiles.length,
    ...s.projectiles.map((p) => `${p.id}${p.powered ? "*" : ""}:${f(p.pos.x)},${f(p.pos.y)}`),
  ];
  if (s.arena) {
    parts.push(`pk:${s.arena.spawnCount}:${s.arena.pickups.map((p) => `${p.id}${p.kind[0]}${f(p.pos.x)},${f(p.pos.y)}`).join(";")}`);
    parts.push(`sk:${f(a.skillCooldownUntil ?? 0)},${f(b.skillCooldownUntil ?? 0)},${f(a.dmgBuffUntil ?? 0)},${f(b.dmgBuffUntil ?? 0)}`);
    parts.push(`sh:${f(a.shieldUntil)},${f(b.shieldUntil)}`);
  }
  return parts.join("|");
}

// The checksum identifies one exact battle path.
export function checksum(s: BattleState): string {
  return fnv1a(stateKey(s));
}
