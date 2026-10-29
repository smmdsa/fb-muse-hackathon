// Policy driver. Compiled DNA steers one robot for one tick.

import { evaluate } from "@agent-wars/behavior-dna";
import type { AgentPolicy, Observation } from "@agent-wars/behavior-dna";
import { BASE_ITEMS, MAX_SLOTS, RECIPE_BY_ID } from "./items.ts";
import { DEFAULT_MOBA, LANE_Y, MINION_RADIUS, ROBOT_RANGE, STRUCTURES, isVulnerable, robotAD } from "./moba.ts";
import { checksum, createBattle, DEFAULT_BATTLE, stepBattle } from "./simulation.ts";
import { segmentHitsBox } from "./world.ts";
import type { AgentAction, AgentId, BattleConfig, BattleState, MinionState, MobaEvent, StructureState, Vec2 } from "./types.ts";

// Sparring bots. Rule-based presets near ladder bands, never AP minters.
// Bots fight unrated only; the picker below matches bots to nearby AP.
export type BotPreset = { id: string; name: string; apHint: number; policy: AgentPolicy };

// Each bot buys once when rich and poor in build. Duel gold reads
// zero, so buy rules never match there. Duel behavior stays fixed.
const AFFORD = (cost: number): AgentPolicy["rules"][number]["when"] => ({
  all: [
    { operand: "ownGold", op: "gte", value: cost },
    { operand: "buildValue", op: "lt", value: cost },
  ],
});

const BOT_SHADOW = {
  schemaVersion: 2,
  agentVersionId: "bot-shadow",
  dna: { aggression: 35, evasion: 80, preferredDistance: 65, energyConservation: 70 },
  rules: [
    { id: "s-buy", when: AFFORD(250), move: "STRAFE", buy: "cloth_weave" },
    { id: "s-hide", when: { operand: "coverDist", op: "lt", value: 3 }, move: "SEEK_COVER" },
    { id: "s-strafe", when: { all: [{ operand: "distFoe", op: "gte", value: 4 }, { operand: "distFoe", op: "lte", value: 10 }] }, move: "STRAFE", fire: true },
    { id: "s-retreat", when: { operand: "ownHpPct", op: "lt", value: 25 }, move: "RETREAT" },
    { id: "s-farm", when: { operand: "nearFoeMinions", op: "gte", value: 1 }, move: "FARM", fire: true },
    { id: "s-center", when: { operand: "objectiveDist", op: "gt", value: 6 }, move: "CAPTURE" },
  ],
} as BotPreset["policy"];

const BOT_BENCH = {
  schemaVersion: 2,
  agentVersionId: "bot-bench",
  dna: { aggression: 55, evasion: 55, preferredDistance: 45, energyConservation: 50 },
  rules: [
    { id: "n-buy", when: AFFORD(250), move: "APPROACH", buy: "scrap_blade" },
    { id: "n-close", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "n-push", when: { operand: "nearFoeMinions", op: "gte", value: 1 }, move: "PUSH", fire: true },
    { id: "n-far", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH" },
    { id: "n-center", when: { operand: "objectiveDist", op: "gt", value: 6 }, move: "CAPTURE" },
  ],
} as BotPreset["policy"];

const BOT_BREAKER = {
  schemaVersion: 2,
  agentVersionId: "bot-breaker",
  dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
  rules: [
    { id: "b-buy", when: AFFORD(250), move: "APPROACH", fire: true, buy: "scrap_blade" },
    { id: "b-rush", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH", fire: true },
    { id: "b-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "b-push", when: { operand: "nearAllyMinions", op: "gte", value: 1 }, move: "PUSH", fire: true },
    { id: "b-retreat", when: { operand: "ownHpPct", op: "lt", value: 25 }, move: "RETREAT" },
    { id: "b-center", when: { operand: "objectiveDist", op: "gt", value: 6 }, move: "CAPTURE" },
  ],
} as BotPreset["policy"];

export const BOT_PRESETS: BotPreset[] = [
  { id: "bot:shadow", name: "SHADOW-UNIT", apHint: 400, policy: BOT_SHADOW },
  { id: "bot:bench", name: "BENCH-UNIT", apHint: 550, policy: BOT_BENCH },
  { id: "bot:breaker", name: "BREAKER-UNIT", apHint: 700, policy: BOT_BREAKER },
];

// The picker returns the preset nearest the player's AP.
export function pickBot(ap: number): BotPreset {
  let best = BOT_PRESETS[0];
  for (const p of BOT_PRESETS) {
    if (Math.abs(p.apHint - ap) < Math.abs(best.apHint - ap)) best = p;
  }
  return best;
}

// A replay samples the canonical sim: one frame every 9 ticks plus the
// final frame, hit and KO events from HP transitions. Same seed gives
// byte-identical snapshots; the viewer renders these, never re-simulates.
export type ReplayFrame = {
  t: number;
  ax: number; ay: number; ahp: number; aen: number;
  bx: number; by: number; bhp: number; ben: number;
};

export type ReplayEvent = { t: number; side: AgentId; type: "hit" | "ko" };

export type Replay = {
  seed: string;
  winner: string;
  ticks: number;
  checksum: string;
  frames: ReplayFrame[];
  events: ReplayEvent[];
};

export type ReplayV2Robot = {
  x: number; y: number; hp: number; en: number; gold: number;
  alive: boolean; respawn: number; shield: number; items?: string[];
};

export type ReplayV2Minion = {
  id: number; side: AgentId; kind: string; x: number; y: number; hp: number;
};

export type ReplayV2Frame = {
  t: number;
  a: ReplayV2Robot;
  b: ReplayV2Robot;
  minions: ReplayV2Minion[];
  structs: number[] | null;
  builds: { a: string[]; b: string[] } | null;
};

export type ReplayV2 = {
  version: 2;
  mode: "moba";
  seed: string;
  winner: string;
  ticks: number;
  timeSec: number;
  checksum: string;
  structures: string[];
  frames: ReplayV2Frame[];
  events: MobaEvent[];
};

const REPLAY_EVERY = 9;

function snap(state: BattleState): ReplayFrame {
  const a = state.agents.A;
  const b = state.agents.B;
  return {
    t: state.tick,
    ax: a.pos.x, ay: a.pos.y, ahp: a.hp, aen: a.energy,
    bx: b.pos.x, by: b.pos.y, bhp: b.hp, ben: b.energy,
  };
}

export function buildReplay(a: AgentPolicy, b: AgentPolicy, seed: string): Replay;
export function buildReplay(a: AgentPolicy, b: AgentPolicy, seed: string, base: BattleConfig): Replay | ReplayV2;
export function buildReplay(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
  base?: BattleConfig,
): Replay | ReplayV2 {
  if (base?.mode === "moba") return buildMobaReplay(a, b, seed, base);
  const cfg = { ...DEFAULT_BATTLE, seed };
  let state = createBattle(cfg);
  const frames: ReplayFrame[] = [snap(state)];
  const events: ReplayEvent[] = [];
  let guard = 0;
  while (!state.over && guard < cfg.world.maxTicks) {
    const before = snap(state);
    state = stepBattle(
      state,
      { A: drive(state, a, "A", cfg), B: drive(state, b, "B", cfg) },
      cfg,
    );
    guard += 1;
    for (const [side, was, is] of [["A", before.ahp, state.agents.A.hp], ["B", before.bhp, state.agents.B.hp]] as const) {
      if (is < was) events.push({ t: state.tick, side, type: is <= 0 ? "ko" : "hit" });
    }
    if (state.tick % REPLAY_EVERY === 0 || state.over) frames.push(snap(state));
  }
  return {
    seed,
    winner: state.winner ?? "DRAW",
    ticks: state.tick,
    checksum: checksum(state),
    frames,
    events,
  };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

// The snapshot reads one MOBA frame. HP, gold, and energy round down.
function snapMoba(
  state: BattleState,
  structs: number[] | null,
  builds: { a: string[]; b: string[] } | null,
  withItems: boolean,
): ReplayV2Frame {
  const hz = DEFAULT_MOBA.world.tickHz;
  const read = (id: AgentId): ReplayV2Robot => {
    const a = state.agents[id];
    const out: ReplayV2Robot = {
      x: r2(a.pos.x),
      y: r2(a.pos.y),
      hp: Math.floor(a.hp),
      en: Math.floor(a.energy),
      gold: Math.floor(a.gold ?? 0),
      alive: a.alive,
      respawn: a.alive ? 0 : Math.max(0, Math.ceil(((a.respawnAt ?? 0) - state.time) * hz)),
      shield: Math.max(0, Math.ceil(((a.spawnShieldUntil ?? 0) - state.time) * hz)),
    };
    if (withItems) out.items = [...(a.items ?? [])];
    return out;
  };
  const minions = (state.moba?.minions ?? [])
    .filter((m) => m.alive)
    .map((m) => ({ id: m.id, side: m.side, kind: m.kind, x: r2(m.pos.x), y: r2(m.pos.y), hp: Math.floor(m.hp) }));
  return { t: state.tick, a: read("A"), b: read("B"), minions, structs, builds };
}

// The builder records a versioned MOBA replay. Same seed, same bytes.
export function buildMobaReplay(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
  base: BattleConfig = DEFAULT_MOBA,
): ReplayV2 {
  const cfg = { ...base, seed, mode: "moba" as const };
  let state = createBattle(cfg);
  let lastStructs = "";
  let lastBuilds = "";
  const structHp = (): number[] =>
    STRUCTURES.map((id) => Math.floor(state.moba?.structures.find((s) => s.id === id)?.hp ?? 0));
  const buildKey = (): string =>
    `${(state.agents.A.items ?? []).join("+")}|${(state.agents.B.items ?? []).join("+")}`;
  const take = (index: number): ReplayV2Frame => {
    const hp = structHp();
    const key = hp.join(",");
    const structs = index % 10 === 0 || key !== lastStructs ? hp : null;
    if (structs) lastStructs = key;
    const bk = buildKey();
    const changed = index === 0 || bk !== lastBuilds;
    if (changed) lastBuilds = bk;
    const builds = changed
      ? { a: [...(state.agents.A.items ?? [])], b: [...(state.agents.B.items ?? [])] }
      : null;
    return snapMoba(state, structs, builds, changed);
  };
  let index = 0;
  const frames: ReplayV2Frame[] = [take(0)];
  let guard = 0;
  while (!state.over && guard < cfg.world.maxTicks) {
    state = stepBattle(
      state,
      { A: drive(state, a, "A", cfg), B: drive(state, b, "B", cfg) },
      cfg,
    );
    guard += 1;
    if (state.tick % REPLAY_EVERY === 0 || state.over) {
      index += 1;
      frames.push(take(index));
    }
  }
  return {
    version: 2,
    mode: "moba",
    seed,
    winner: state.winner ?? "DRAW",
    ticks: state.tick,
    timeSec: r2(state.time),
    checksum: checksum(state),
    structures: [...STRUCTURES],
    frames,
    events: [...(state.moba?.log ?? [])],
  };
}

// The helper finds the nearest vulnerable enemy structure state.
export function nearestVulnerableStruct(state: BattleState, me: AgentId): StructureState | null {
  const list = state.moba?.structures ?? [];
  const enemy: AgentId = me === "A" ? "B" : "A";
  const a = state.agents[me];
  let best: StructureState | null = null;
  let bestD = Infinity;
  for (const s of list) {
    if (s.side !== enemy || !isVulnerable(s, list)) continue;
    const d = Math.hypot(s.pos.x - a.pos.x, s.pos.y - a.pos.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// The helper finds the nearest vulnerable enemy structure.
export function nearestVulnerable(state: BattleState, me: AgentId): Vec2 | null {
  return nearestVulnerableStruct(state, me)?.pos ?? null;
}

// The helper prices one item from scratch. Parts plus fees.
function totalCost(id: string): number {
  const base = BASE_ITEMS[id];
  if (base) return base.cost;
  const recipe = RECIPE_BY_ID[id];
  if (!recipe) return 0;
  let n = recipe.fee;
  for (const part of recipe.parts) n += totalCost(part);
  return n;
}

// The helper sums held build value. Unknown ids add zero.
export function buildValueOf(items: string[]): number {
  let n = 0;
  for (const id of items) n += totalCost(id);
  return n;
}

// The reference brain for training-grade fights. Both servers use this copy.
// Balance pass (spec 11-12): park at spawn until 1:29, drift to mid
// without firing until 2:30, then escort the wave, duel up close,
// and siege the nearest tower when the lane is empty. Auto-buy takes
// the first Scrap Blade. While hurt and pre-Tempered the policy dives
// and names Tempered Edge each tick. The no-op buys hold repair gold
// until the 350 combine fee lands. Every new rule fails closed in duel
// mode (distFoeTower reads null there), so duel replays stay
// byte-identical. Measured bench mirror: A wins at tick 15964;
// tier-1 towers stand at 2:30 with 1194/1157 HP.
const MOBA_ONLY: AgentPolicy["rules"][number]["when"] = {
  operand: "distFoeTower",
  op: "gte",
  value: 0,
};

export const BENCH_POLICY: AgentPolicy = {
  schemaVersion: 2,
  agentVersionId: "benchmark-v1",
  dna: { aggression: 55, evasion: 55, preferredDistance: 45, energyConservation: 50 },
  rules: [
    { id: "b-park", when: { all: [MOBA_ONLY, { operand: "gameTime", op: "lt", value: 89 }] }, move: "RETREAT" },
    { id: "b-drift", when: { all: [MOBA_ONLY, { operand: "gameTime", op: "gte", value: 89 }, { operand: "gameTime", op: "lt", value: 150 }] }, move: "KITE" },
    { id: "b-save", when: { all: [MOBA_ONLY, { operand: "ownHpPct", op: "lt", value: 50 }, { operand: "buildValue", op: "lt", value: 600 }] }, move: "CAPTURE", fire: true, buy: "tempered_edge" },
    { id: "b-farm", when: { operand: "nearFoeMinions", op: "gte", value: 1 }, move: "PUSH", fire: true },
    { id: "b-close", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "b-siege", when: MOBA_ONLY, move: "CAPTURE", fire: true },
    { id: "b-far", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH" },
  ],
};

// The runner fights two policies to the end. Same seed, same checksum.
// It tallies which chip fired each tick per side for the dashboard.
export function fightPolicies(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
  base?: BattleConfig,
): { winner: string; ticks: number; checksum: string; chipsA: Record<string, number>; chipsB: Record<string, number> } {
  const cfg = base ? { ...base, seed } : { ...DEFAULT_BATTLE, seed };
  let state = createBattle(cfg);
  const tallyA = new Map<string, number>();
  const tallyB = new Map<string, number>();
  let guard = 0;
  while (!state.over && guard < cfg.world.maxTicks) {
    state = stepBattle(
      state,
      { A: drive(state, a, "A", cfg, tallyA), B: drive(state, b, "B", cfg, tallyB) },
      cfg,
    );
    guard += 1;
  }
  return {
    winner: state.winner ?? "DRAW",
    ticks: state.tick,
    checksum: checksum(state),
    chipsA: Object.fromEntries(tallyA),
    chipsB: Object.fromEntries(tallyB),
  };
}

function dir(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// The reader builds what the robot knows. Covers block sight.
export function observe(
  state: BattleState,
  me: AgentId,
  cfg: BattleConfig,
): Observation {
  const a = state.agents[me];
  const foeId: AgentId = me === "A" ? "B" : "A";
  const f = state.agents[foeId];
  let blocked = false;
  for (const box of cfg.world.covers) {
    if (segmentHitsBox(a.pos.x, a.pos.y, f.pos.x, f.pos.y, box)) {
      blocked = true;
      break;
    }
  }
  const los = !blocked && f.alive;
  const distFoe = Math.hypot(f.pos.x - a.pos.x, f.pos.y - a.pos.y);
  let tti: number | null = null;
  for (const p of state.projectiles) {
    if (p.owner === me) continue;
    const d = Math.hypot(p.pos.x - a.pos.x, p.pos.y - a.pos.y);
    const sp = Math.hypot(p.vel.x, p.vel.y) || 1;
    const t = d / sp;
    if (tti === null || t < tti) tti = t;
  }
  let coverDist: number | null = null;
  for (const box of cfg.world.covers) {
    const cx = Math.min(Math.max(a.pos.x, box.minX), box.maxX);
    const cy = Math.min(Math.max(a.pos.y, box.minY), box.maxY);
    const d = Math.hypot(a.pos.x - cx, a.pos.y - cy);
    if (coverDist === null || d < coverDist) coverDist = d;
  }
  const center = { x: cfg.world.width / 2, y: cfg.world.height / 2 };
  const moba = cfg.mode === "moba";
  const vuln = moba ? nearestVulnerable(state, me) : null;
  const vulnStruct = moba ? nearestVulnerableStruct(state, me) : null;
  const foeSide: AgentId = me === "A" ? "B" : "A";
  let nearFoe = 0;
  let nearAlly = 0;
  let distFoeMinion: number | null = null;
  for (const m of state.moba?.minions ?? []) {
    if (!m.alive) continue;
    const d = Math.hypot(m.pos.x - a.pos.x, m.pos.y - a.pos.y);
    if (m.side === foeSide) {
      if (d <= 6.0) nearFoe += 1;
      if (distFoeMinion === null || d < distFoeMinion) distFoeMinion = d;
    } else if (d <= 6.0) {
      nearAlly += 1;
    }
  }
  const items = a.items ?? [];
  let ownAlive = 0;
  let foeAlive = 0;
  for (const s of state.moba?.structures ?? []) {
    if (!s.alive) continue;
    if (s.side === me) ownAlive += 1;
    else foeAlive += 1;
  }
  return {
    ownHpPct: (a.hp / cfg.agent.maxHp) * 100,
    energy: a.energy,
    distFoe: los ? distFoe : null,
    projectileTti: tti,
    coverDist,
    lineOfSight: los,
    dashReady: state.time >= a.dashCooldownUntil,
    shieldReady: state.time >= a.shieldCooldownUntil,
    foeLastSeenAge: 0,
    objectiveDist: vuln ? Math.hypot(vuln.x - a.pos.x, vuln.y - a.pos.y) : Math.hypot(center.x - a.pos.x, center.y - a.pos.y),
    timeLeft: moba ? 1800 - state.time : cfg.world.maxTicks / cfg.world.tickHz - state.time,
    edgeDist: Math.min(a.pos.x, a.pos.y, cfg.world.width - a.pos.x, cfg.world.height - a.pos.y),
    ownGold: a.gold ?? 0,
    ownDeaths: a.deaths ?? 0,
    gameTime: state.time,
    distFoeTower: vuln ? Math.hypot(vuln.x - a.pos.x, vuln.y - a.pos.y) : null,
    foeTowerHpPct: vulnStruct ? (vulnStruct.hp / vulnStruct.maxHp) * 100 : null,
    nearFoeMinions: nearFoe,
    nearAllyMinions: nearAlly,
    distFoeMinion,
    foeHpPct: los ? (f.hp / cfg.agent.maxHp) * 100 : null,
    buildValue: buildValueOf(items),
    slotsFree: MAX_SLOTS - items.length,
    structLead: ownAlive - foeAlive,
  };
}

function foeOf(me: AgentId): AgentId {
  return me === "A" ? "B" : "A";
}

// The helper pushes up the lane. It stops at the wave front.
function pushMove(state: BattleState, me: AgentId, cfg: BattleConfig): Vec2 {
  const a = state.agents[me];
  const center = { x: cfg.world.width / 2, y: cfg.world.height / 2 };
  if (cfg.mode !== "moba" || !state.moba) return dir(a.pos, center);
  const nexus = state.moba.structures.find((s) => s.side === foeOf(me) && s.kind === "nexus");
  const targetX = nexus ? nexus.pos.x : me === "A" ? 46 : 2;
  let front: number | null = null;
  for (const m of state.moba.minions) {
    if (m.side !== me || !m.alive) continue;
    if (front === null) front = m.pos.x;
    else if (me === "A") front = Math.max(front, m.pos.x);
    else front = Math.min(front, m.pos.x);
  }
  let x = targetX;
  if (front !== null) {
    x = me === "A" ? Math.min(targetX, front + 1.0) : Math.max(targetX, front - 1.0);
  }
  return dir(a.pos, { x, y: LANE_Y });
}

// The helper farms the nearest killable minion. Else it seeks the
// nearest enemy minion. Ties keep ascending id order.
function farmMove(state: BattleState, me: AgentId, cfg: BattleConfig): Vec2 {
  const a = state.agents[me];
  const center = { x: cfg.world.width / 2, y: cfg.world.height / 2 };
  if (cfg.mode !== "moba" || !state.moba) return dir(a.pos, center);
  const enemy = foeOf(me);
  const shot = robotAD(a.items ?? []);
  let killable: MinionState | null = null;
  let killD = Infinity;
  let near: MinionState | null = null;
  let nearD = Infinity;
  for (const m of state.moba.minions) {
    if (m.side !== enemy || !m.alive) continue;
    const d = Math.hypot(m.pos.x - a.pos.x, m.pos.y - a.pos.y);
    if (d < nearD) {
      near = m;
      nearD = d;
    }
    if (m.hp <= shot && d < killD) {
      killable = m;
      killD = d;
    }
  }
  const target = killable ?? near;
  if (!target) return dir(a.pos, center);
  return dir(a.pos, target.pos);
}

// The helper guards the most threatened own structure. It counts
// enemy minions in 6.0. Ties prefer the innermost structure.
function defendMove(state: BattleState, me: AgentId, cfg: BattleConfig): Vec2 {
  const a = state.agents[me];
  const center = { x: cfg.world.width / 2, y: cfg.world.height / 2 };
  if (cfg.mode !== "moba" || !state.moba) return dir(a.pos, center);
  const enemy = foeOf(me);
  const own = state.moba.structures.filter((s) => s.side === me && s.alive);
  if (own.length === 0) return dir(a.pos, center);
  const home = own.find((s) => s.kind === "nexus");
  const inward = (s: StructureState): number =>
    home ? Math.hypot(s.pos.x - home.pos.x, s.pos.y - home.pos.y) : 0;
  let best: StructureState | null = null;
  let bestCount = 0;
  for (const s of own) {
    let n = 0;
    for (const m of state.moba.minions) {
      if (m.side !== enemy || !m.alive) continue;
      if (Math.hypot(m.pos.x - s.pos.x, m.pos.y - s.pos.y) <= 6.0) n += 1;
    }
    if (n === 0) continue;
    if (best === null || n > bestCount || (n === bestCount && inward(s) < inward(best))) {
      best = s;
      bestCount = n;
    }
  }
  if (best) return dir(a.pos, best.pos);
  const towers = own.filter((s) => s.kind === "tower" || s.kind === "nexus_turret");
  const pool = towers.length > 0 ? towers : own;
  let near = pool[0];
  let nearD = Infinity;
  for (const s of pool) {
    const d = Math.hypot(s.pos.x - a.pos.x, s.pos.y - a.pos.y);
    if (d < nearD) {
      near = s;
      nearD = d;
    }
  }
  return dir(a.pos, near.pos);
}

// The helper aims by last-hit priority. It returns null with no
// target. Range subtracts target radius. Covers block sight, but
// structures stay visible. Ties keep ascending id order.
function pickAim(state: BattleState, me: AgentId, cfg: BattleConfig): Vec2 | null {
  const moba = state.moba;
  if (!moba) return null;
  const a = state.agents[me];
  const enemy = foeOf(me);
  const inRange = (pos: Vec2, radius: number): boolean =>
    Math.hypot(pos.x - a.pos.x, pos.y - a.pos.y) - radius <= ROBOT_RANGE;
  const sees = (pos: Vec2): boolean => {
    for (const box of cfg.world.covers) {
      if (segmentHitsBox(a.pos.x, a.pos.y, pos.x, pos.y, box)) return false;
    }
    return true;
  };
  const shot = robotAD(a.items ?? []);
  let killable: MinionState | null = null;
  let killD = Infinity;
  let near: MinionState | null = null;
  let nearD = Infinity;
  for (const m of moba.minions) {
    if (m.side !== enemy || !m.alive) continue;
    if (!inRange(m.pos, MINION_RADIUS) || !sees(m.pos)) continue;
    const d = Math.hypot(m.pos.x - a.pos.x, m.pos.y - a.pos.y);
    if (d < nearD) {
      near = m;
      nearD = d;
    }
    if (m.hp <= shot && d < killD) {
      killable = m;
      killD = d;
    }
  }
  if (killable) return { ...killable.pos };
  const f = state.agents[enemy];
  if (f.alive && inRange(f.pos, cfg.agent.radius) && sees(f.pos)) return { ...f.pos };
  if (near) return { ...near.pos };
  let struct: StructureState | null = null;
  let structD = Infinity;
  for (const s of moba.structures) {
    if (s.side !== enemy || !isVulnerable(s, moba.structures)) continue;
    if (!inRange(s.pos, s.radius)) continue;
    const d = Math.hypot(s.pos.x - a.pos.x, s.pos.y - a.pos.y);
    if (d < structD) {
      struct = s;
      structD = d;
    }
  }
  if (struct) return { ...struct.pos };
  return null;
}

// The driver turns one policy into one action set for one tick.
export function drive(
  state: BattleState,
  policy: AgentPolicy,
  me: AgentId,
  cfg: BattleConfig,
  tally?: Map<string, number>,
): AgentAction {
  const obs = observe(state, me, cfg);
  const want = evaluate(policy, obs);
  if (tally) tally.set(want.ruleId, (tally.get(want.ruleId) ?? 0) + 1);
  const a = state.agents[me];
  const foeId: AgentId = me === "A" ? "B" : "A";
  const f = state.agents[foeId];
  const center = { x: cfg.world.width / 2, y: cfg.world.height / 2 };
  const toFoe = dir(a.pos, f.pos);
  const flip = (state.tick >> 6) % 2 === 1 ? -1 : 1;
  let move: Vec2;
  switch (want.move) {
    case "APPROACH":
      move = obs.lineOfSight ? { ...toFoe } : dir(a.pos, center);
      break;
    case "RETREAT":
      move = { x: -toFoe.x, y: -toFoe.y };
      break;
    case "KITE": {
      const blend = obs.distFoe !== null && obs.distFoe < 6 ? -0.7 : 0.4;
      move = { x: toFoe.x * blend + -toFoe.y * flip, y: toFoe.y * blend + toFoe.x * flip };
      break;
    }
    case "STRAFE":
      move = { x: -toFoe.y * flip, y: toFoe.x * flip };
      break;
    case "SEEK_COVER": {
      let best: Vec2 = center;
      let bestD = Infinity;
      for (const box of cfg.world.covers) {
        const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
        const d = Math.hypot(c.x - a.pos.x, c.y - a.pos.y);
        if (d < bestD) { bestD = d; best = c; }
      }
      move = dir(a.pos, best);
      break;
    }
    case "PUSH":
      move = pushMove(state, me, cfg);
      break;
    case "FARM":
      move = farmMove(state, me, cfg);
      break;
    case "DEFEND":
      move = defendMove(state, me, cfg);
      break;
    case "CAPTURE":
    default: {
      const vuln = cfg.mode === "moba" ? nearestVulnerable(state, me) : null;
      move = dir(a.pos, vuln ?? center);
      break;
    }
  }
  let aim: Vec2;
  if (cfg.mode === "moba" && state.moba && want.fire) {
    const target = pickAim(state, me, cfg);
    aim = target ? dir(a.pos, target) : move;
  } else {
    aim = obs.lineOfSight ? { ...toFoe } : move;
  }
  return {
    move,
    aim,
    fire: want.fire,
    dash: want.dash,
    shield: want.shield,
    buy: want.buy ?? null,
  };
}
