// Policy driver. Compiled DNA steers one robot for one tick.

import { FALLBACK_RULE_ID, evaluate } from "@agent-wars/behavior-dna";
import type { AgentPolicy, Observation, TargetIntent } from "@agent-wars/behavior-dna";
import { BASE_ITEMS, MAX_SLOTS, RECIPE_BY_ID } from "./items.ts";
import { DEFAULT_MOBA, LANE_Y, MINION_RADIUS, ROBOT_RANGE, TOWER_RANGE, OVERSEER_RADIUS, WAVE_FIRST_TICK, WAVE_EVERY_TICKS, STRUCTURES, armorMult, isVulnerable, robotAD, segCircle } from "./moba.ts";
import { ARENA_FIRE_INTERVAL, ARENA_RANGE, ARENA_SKILL_COST, checksum, createBattle, DEFAULT_BATTLE, stepBattle } from "./simulation.ts";
import { fnv1a } from "./rng.ts";
import { arenaWorld, segmentHitsBox } from "./world.ts";
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
  shots?: { x: number; y: number; o: AgentId; p?: boolean }[];
  pickups?: { x: number; y: number; k: string }[];
  ash?: boolean; bsh?: boolean;
  abf?: boolean; bbf?: boolean;
};

export type ReplayEvent =
  | { t: number; side: AgentId; type: "hit" | "ko" }
  | { t: number; side: AgentId; type: "pickup"; kind: string }
  | { t: number; side: AgentId; type: "skill" };

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
  overseer?: { x: number; y: number; hp: number; maxHp: number; alive: boolean; spawnTick: number; buffUntil: { A: number; B: number } };
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
  structurePositions?: Record<string, Vec2>;
  rulesetVersion?: number;
  frames: ReplayV2Frame[];
  events: MobaEvent[];
};

// Replay cadences. Duel keeps 9 ticks so legacy replays stay
// byte-identical. MOBA writes every 18 ticks: the 600 ms cadence
// keeps reference fights under 1 MB, and the viewer glides.
const REPLAY_EVERY_V1 = 9;
const REPLAY_EVERY_V2 = 18;
// Arena samples every 3 ticks: the 100 ms cadence keeps shots on
// screen across frames, since a 6u shot lives about 13 ticks.
const REPLAY_EVERY_V3 = 3;

// Arena frame extras. Shots, pickups, and shield/buff flags ride
// every frame so the viewer draws live combat. Duel states carry
// no arena, so duel frames stay byte-identical.
function arenaBits(state: BattleState): Partial<ReplayFrame> {
  if (!state.arena) return {};
  const a = state.agents.A;
  const b = state.agents.B;
  return {
    shots: state.projectiles.map((p) => ({ x: r2(p.pos.x), y: r2(p.pos.y), o: p.owner, ...(p.powered ? { p: true } : {}) })),
    pickups: state.arena.pickups.map((p) => ({ x: r2(p.pos.x), y: r2(p.pos.y), k: p.kind })),
    ash: state.time <= a.shieldUntil,
    bsh: state.time <= b.shieldUntil,
    abf: state.time < (a.dmgBuffUntil ?? 0),
    bbf: state.time < (b.dmgBuffUntil ?? 0),
  };
}

function snap(state: BattleState): ReplayFrame {
  const a = state.agents.A;
  const b = state.agents.B;
  return {
    ...arenaBits(state),
    t: state.tick,
    ax: a.pos.x, ay: a.pos.y, ahp: a.hp, aen: a.energy,
    bx: b.pos.x, by: b.pos.y, bhp: b.hp, ben: b.energy,
  };
}

export function buildReplay(a: AgentPolicy, b: AgentPolicy, seed: string): Replay;
export function buildReplay(a: AgentPolicy, b: AgentPolicy, seed: string, base: BattleConfig): Replay | ReplayV2 | ReplayV3;
export function buildReplay(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
  base?: BattleConfig,
): Replay | ReplayV2 | ReplayV3 {
  if (base?.mode === "moba") return buildMobaReplay(a, b, seed, base);
  if (base?.mode === "arena") return buildArenaReplay(a, b, seed, base);
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
    if (state.tick % REPLAY_EVERY_V1 === 0 || state.over) frames.push(snap(state));
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
  const o = state.moba?.overseer;
  return { t: state.tick, a: read("A"), b: read("B"), minions, structs, builds,
    ...(o ? { overseer: { x: o.x, y: o.y, hp: o.hp, maxHp: o.maxHp, alive: o.alive, spawnTick: o.spawnTick, buffUntil: { ...o.buffUntil } } } : {}) };
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
    if (state.tick % REPLAY_EVERY_V2 === 0 || state.over) {
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
    ...(cfg.rulesetVersion === 2 ? { rulesetVersion: 2, structurePositions: Object.fromEntries((state.moba?.structures ?? []).map(s => [s.id, { ...s.pos }])) } : {}),
    frames,
    events: [...(state.moba?.log ?? [])],
  };
}

// Battle Arena 1v1. Two robots face off with no lanes, minions,
// towers, gold, or shop. Rounds run on the 24x16 arena with a 90
// second cap. The series plays best of 3: first to 2 round wins.
// The bot spans 1u wide, so shots reach 6u and regen runs 5/s.
export const ARENA_1V1: BattleConfig = {
  seed: "arena-001",
  world: arenaWorld(),
  agent: {
    radius: 0.5,
    speed: 4,
    maxHp: 100,
    maxEnergy: 100,
    energyRegen: 5,
  },
  mode: "arena",
};

export type ArenaRoundSummary = {
  round: number;
  winner: string;
  ticks: number;
  checksum: string;
  damageA: number;
  damageB: number;
};

export type SeriesResult = {
  winner: string;
  ticks: number;
  checksum: string;
  score: { A: number; B: number };
  rounds: ArenaRoundSummary[];
  chipsA: Record<string, number>;
  chipsB: Record<string, number>;
};

export type ArenaRoundReplay = {
  round: number;
  seed: string;
  winner: string;
  ticks: number;
  checksum: string;
  frames: ReplayFrame[];
  events: ReplayEvent[];
};

export type ReplayV3 = {
  version: 3;
  mode: "arena";
  seed: string;
  winner: string;
  score: { A: number; B: number };
  rounds: ArenaRoundReplay[];
  ticks: number;
  timeSec: number;
  checksum: string;
};

// One round config. The seed and spawn rotate per round, so rounds
// never replay the same opening twice in a row.
function roundConfig(base: BattleConfig, seed: string, round: number): BattleConfig {
  return { ...base, seed: `${seed}#r${round}`, mode: "arena" as const, spawnShift: (round - 1) % 3 };
}

// The helper hashes one series from its rounds. Settles and
// replays share it, so identical stays exact.
function seriesChecksum(rounds: ArenaRoundSummary[]): string {
  return fnv1a(rounds.map((r) => `${r.round}:${r.winner}:${r.checksum}`).join("|"));
}

// The helper scores one finished series. Drawn rounds award
// nothing. Leftover ties break on total damage, then stand.
export function seriesWinner(scoreA: number, scoreB: number, rounds: ArenaRoundSummary[]): string {
  if (scoreA > scoreB) return "A";
  if (scoreB > scoreA) return "B";
  const dmgA = rounds.reduce((n, r) => n + r.damageA, 0);
  const dmgB = rounds.reduce((n, r) => n + r.damageB, 0);
  return dmgA === dmgB ? "DRAW" : dmgA > dmgB ? "A" : "B";
}

// One arena round. Fresh positions, health, and energy. The chips
// persist; the optional tallies count rule fires per side.
function playRound(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
  base: BattleConfig,
  round: number,
  tallyA?: Map<string, number>,
  tallyB?: Map<string, number>,
): { summary: ArenaRoundSummary; frames: ReplayFrame[]; events: ReplayEvent[] } {
  const cfg = roundConfig(base, seed, round);
  let state = createBattle(cfg);
  const frames: ReplayFrame[] = [snap(state)];
  const events: ReplayEvent[] = [];
  let seenLog = 0;
  let guard = 0;
  while (!state.over && guard < cfg.world.maxTicks) {
    const before = snap(state);
    state = stepBattle(
      state,
      { A: drive(state, a, "A", cfg, tallyA), B: drive(state, b, "B", cfg, tallyB) },
      cfg,
    );
    guard += 1;
    for (const [side, was, is] of [["A", before.ahp, state.agents.A.hp], ["B", before.bhp, state.agents.B.hp]] as const) {
      if (is < was) events.push({ t: state.tick, side, type: is <= 0 ? "ko" : "hit" });
    }
    const freshLog = state.arena?.log ?? [];
    for (let k = seenLog; k < freshLog.length; k += 1) {
      const e = freshLog[k];
      events.push(e.type === "pickup"
        ? { t: e.t, side: e.side, type: "pickup", kind: e.kind ?? "green" }
        : { t: e.t, side: e.side, type: "skill" });
    }
    seenLog = freshLog.length;
    if (state.tick % REPLAY_EVERY_V3 === 0 || state.over) frames.push(snap(state));
  }
  const winner = state.winner ?? "DRAW";
  return {
    summary: {
      round,
      winner,
      ticks: state.tick,
      checksum: checksum(state),
      damageA: state.agents.A.damageDealt,
      damageB: state.agents.B.damageDealt,
    },
    frames,
    events,
  };
}

// The runner plays a best-of-3 series. First to 2 round wins
// takes it, so series run 2 or 3 rounds. Same seed, same series.
export function fightSeries(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
  base: BattleConfig = ARENA_1V1,
): SeriesResult {
  const tallyA = new Map<string, number>();
  const tallyB = new Map<string, number>();
  const rounds: ArenaRoundSummary[] = [];
  let scoreA = 0;
  let scoreB = 0;
  for (let round = 1; round <= 3; round += 1) {
    const played = playRound(a, b, seed, base, round, tallyA, tallyB);
    rounds.push(played.summary);
    if (played.summary.winner === "A") scoreA += 1;
    if (played.summary.winner === "B") scoreB += 1;
    if (scoreA === 2 || scoreB === 2) break;
  }
  return {
    winner: seriesWinner(scoreA, scoreB, rounds),
    ticks: rounds.reduce((n, r) => n + r.ticks, 0),
    checksum: seriesChecksum(rounds),
    score: { A: scoreA, B: scoreB },
    rounds,
    chipsA: Object.fromEntries(tallyA),
    chipsB: Object.fromEntries(tallyB),
  };
}

// The builder records a versioned arena replay. Same seed, same bytes.
export function buildArenaReplay(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
  base: BattleConfig = ARENA_1V1,
): ReplayV3 {
  const summaries: ArenaRoundSummary[] = [];
  const rounds: ArenaRoundReplay[] = [];
  let scoreA = 0;
  let scoreB = 0;
  for (let round = 1; round <= 3; round += 1) {
    const played = playRound(a, b, seed, base, round);
    summaries.push(played.summary);
    rounds.push({
      round,
      seed: `${seed}#r${round}`,
      winner: played.summary.winner,
      ticks: played.summary.ticks,
      checksum: played.summary.checksum,
      frames: played.frames,
      events: played.events,
    });
    if (played.summary.winner === "A") scoreA += 1;
    if (played.summary.winner === "B") scoreB += 1;
    if (scoreA === 2 || scoreB === 2) break;
  }
  const ticks = summaries.reduce((n, r) => n + r.ticks, 0);
  return {
    version: 3,
    mode: "arena",
    seed,
    winner: seriesWinner(scoreA, scoreB, summaries),
    score: { A: scoreA, B: scoreB },
    rounds,
    ticks,
    timeSec: r2(ticks / base.world.tickHz),
    checksum: seriesChecksum(summaries),
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
// Balance pass (spec 11-12, amendments A5-A7): hold until the first
// wave marches, then escort it. Losing duels break off, won duels
// chase, and kills convert: shove with the wave while the foe is
// down, hold the nearest tower with no wave to escort. Siege needs
// health; weak robots fall back to the wave front instead of diving.
// Tempered Edge rushes when gold allows. Every MOBA_ONLY rule fails
// closed in duel mode (distFoeTower reads null there), and the three
// shared rules below never changed, so duel replays stay
// byte-identical.
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
    { id: "b-park", when: { all: [MOBA_ONLY, { operand: "gameTime", op: "lt", value: 75 }] }, move: "RETREAT" },
    { id: "b-weak", when: { all: [MOBA_ONLY, { operand: "gameTime", op: "gte", value: 300 }, { operand: "ownHpPct", op: "lt", value: 30 }] }, move: "RETREAT" },
    { id: "b-end", when: { all: [MOBA_ONLY, { operand: "buildValue", op: "gte", value: 1500 }] }, move: "CAPTURE", fire: true },
    { id: "b-losing", when: { all: [MOBA_ONLY, { operand: "gameTime", op: "gte", value: 300 }, { operand: "ownHpPct", op: "lt", value: 55 }, { operand: "foeHpPct", op: "gte", value: 60 }] }, move: "RETREAT" },
    { id: "b-chase", when: { all: [MOBA_ONLY, { operand: "foeHpPct", op: "lt", value: 35 }, { operand: "distFoeTower", op: "gte", value: 8 }] }, move: "APPROACH", fire: true },
    { id: "b-buy", when: { all: [MOBA_ONLY, { operand: "ownGold", op: "gte", value: 350 }, { operand: "buildValue", op: "lt", value: 600 }] }, move: "PUSH", fire: true, buy: "tempered_edge" },
    { id: "b-farm", when: { operand: "nearFoeMinions", op: "gte", value: 1 }, move: "PUSH", fire: true },
    { id: "b-shove", when: { all: [MOBA_ONLY, { operand: "foeAlive", op: "eq", value: false }, { operand: "nearAllyMinions", op: "gte", value: 1 }, { operand: "ownHpPct", op: "gte", value: 30 }] }, move: "PUSH", fire: true },
    { id: "b-holdfarm", when: { all: [MOBA_ONLY, { operand: "foeAlive", op: "eq", value: false }, { operand: "ownHpPct", op: "gte", value: 30 }] }, move: "FARM", fire: true },
    { id: "b-recover", when: { all: [MOBA_ONLY, { operand: "foeAlive", op: "eq", value: false }] }, move: "RETREAT" },
    { id: "b-dry", when: { all: [MOBA_ONLY, { operand: "gameTime", op: "gte", value: 300 }, { operand: "distFoe", op: "lt", value: 6 }, { operand: "nearFoeMinions", op: "lt", value: 1 }, { operand: "nearAllyMinions", op: "lt", value: 1 }] }, move: "RETREAT" },
    { id: "b-dueltower", when: { all: [MOBA_ONLY, { operand: "gameTime", op: "gte", value: 300 }, { operand: "distFoe", op: "lt", value: 6 }, { operand: "distFoeTower", op: "lt", value: 5 }, { operand: "nearAllyMinions", op: "lt", value: 1 }] }, move: "RETREAT" },
    { id: "b-close", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "b-siege", when: { all: [MOBA_ONLY, { operand: "ownHpPct", op: "gte", value: 40 }, { operand: "nearAllyMinions", op: "gte", value: 1 }] }, move: "CAPTURE", fire: true },
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

// Pickup codes. The chips read kinds as numbers: none 0,
// green 1, blue 2, red 3. Duel and MOBA states carry no
// arena, so they read none.
const PICKUP_CODES = { green: 1, blue: 2, red: 3 } as const;

// The helper finds the nearest live pickup. No pickup
// reads as null distance and kind 0.
function nearestPickup(state: BattleState, me: AgentId): { dist: number | null; kind: number } {
  const a = state.agents[me];
  let best: { dist: number | null; kind: number } = { dist: null, kind: 0 };
  for (const p of state.arena?.pickups ?? []) {
    const d = Math.hypot(p.pos.x - a.pos.x, p.pos.y - a.pos.y);
    if (best.dist === null || d < best.dist) best = { dist: d, kind: PICKUP_CODES[p.kind] };
  }
  return best;
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
  let allyHp = 0;
  let foeHp = 0;
  let killableInRange = 0;
  for (const m of state.moba?.minions ?? []) {
    if (!m.alive) continue;
    const d = Math.hypot(m.pos.x - a.pos.x, m.pos.y - a.pos.y);
    if (m.side === foeSide) {
      if (d <= 6.0) { nearFoe += 1; foeHp += m.hp; }
      const ad = robotAD(a.items ?? []) * (state.moba?.overseer && state.tick + 1 < state.moba.overseer.buffUntil[me] ? 1.2 : 1);
      if (d - MINION_RADIUS <= ROBOT_RANGE && m.hp <= ad * (cfg.rulesetVersion === 2 ? 1 : armorMult(30)) &&
          !cfg.world.covers.some(box => segmentHitsBox(a.pos.x, a.pos.y, m.pos.x, m.pos.y, box))) killableInRange += 1;
      if (distFoeMinion === null || d < distFoeMinion) distFoeMinion = d;
    } else if (d <= 6.0) {
      nearAlly += 1; allyHp += m.hp;
    }
  }
  const items = a.items ?? [];
  const structures = state.moba?.structures ?? [];
  const foeTowers = structures.filter(s => s.side === foeSide && s.alive && (s.kind === "tower" || s.kind === "nexus_turret"));
  const nearestTower = foeTowers.reduce<StructureState | null>((best, s) => !best || Math.hypot(s.pos.x - a.pos.x, s.pos.y - a.pos.y) < Math.hypot(best.pos.x - a.pos.x, best.pos.y - a.pos.y) ? s : best, null);
  const inFoeTowerRange = foeTowers.some(s => Math.hypot(s.pos.x - a.pos.x, s.pos.y - a.pos.y) - cfg.agent.radius <= TOWER_RANGE);
  const foeTowerTargetsMe = foeTowers.some(s => s.target?.kind === "robot" && s.target.side === me);
  const towerTarget = nearestTower?.target;
  const foeTowerTargetsAllyMinion = towerTarget?.kind === "minion" && (state.moba?.minions ?? []).some(m => m.id === towerTarget.id && m.alive && m.side === me);
  const allyMinionsUnderFoeTower = nearestTower ? (state.moba?.minions ?? []).filter(m => m.alive && m.side === me && Math.hypot(m.pos.x - nearestTower.pos.x, m.pos.y - nearestTower.pos.y) - MINION_RADIUS <= TOWER_RANGE).length : 0;
  const ownStructureThreatened = structures.some(s => s.side === me && s.alive && (state.moba?.minions ?? []).some(m => m.alive && m.side === foeSide && Math.hypot(m.pos.x - s.pos.x, m.pos.y - s.pos.y) <= 6));
  const home = structures.find(s => s.side === me && s.kind === "nexus");
  const nextWaveTick = state.tick < WAVE_FIRST_TICK ? WAVE_FIRST_TICK : WAVE_FIRST_TICK + (Math.floor((state.tick - WAVE_FIRST_TICK) / WAVE_EVERY_TICKS) + 1) * WAVE_EVERY_TICKS;
  let ownAlive = 0;
  let foeLive = 0;
  for (const s of state.moba?.structures ?? []) {
    if (!s.alive) continue;
    if (s.side === me) ownAlive += 1;
    else foeLive += 1;
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
    structLead: ownAlive - foeLive,
    foeAlive: f.alive,
    skillReady: state.arena ? a.energy >= ARENA_SKILL_COST && state.time >= (a.skillCooldownUntil ?? 0) && state.time - a.lastShotAt >= ARENA_FIRE_INTERVAL : false,
    pickupDist: nearestPickup(state, me).dist,
    pickupKind: nearestPickup(state, me).kind,
    ...(state.moba?.overseer ? {
      overseerAlive: state.moba.overseer.alive,
      overseerHpPct: state.moba.overseer.alive ? state.moba.overseer.hp / state.moba.overseer.maxHp * 100 : null,
      overseerDist: Math.hypot(state.moba.overseer.x - a.pos.x, state.moba.overseer.y - a.pos.y),
      overseerSpawnSeconds: state.moba.overseer.alive ? 0 : Math.max(0, (state.moba.overseer.spawnTick - state.tick) / cfg.world.tickHz),
      ownOverseerBuffSeconds: Math.max(0, (state.moba.overseer.buffUntil[me] - state.tick) / cfg.world.tickHz),
      foeOverseerBuffSeconds: Math.max(0, (state.moba.overseer.buffUntil[foeId] - state.tick) / cfg.world.tickHz),
    } : {}),
    ...(moba && state.moba ? {
      inFoeTowerRange, foeTowerTargetsMe, foeTowerTargetsAllyMinion, allyMinionsUnderFoeTower,
      nearAllyMinionHp: allyHp, nearFoeMinionHp: foeHp,
      killableFoeMinionsInRange: killableInRange,
      nextWaveSeconds: Math.max(0, (nextWaveTick - state.tick) / cfg.world.tickHz),
      distOwnBase: home ? Math.hypot(home.pos.x - a.pos.x, home.pos.y - a.pos.y) : null,
      ownStructureThreatened,
    } : {}),
  };
}

function foeOf(me: AgentId): AgentId {
  return me === "A" ? "B" : "A";
}

// Probe length ahead of the robot for lane routing.
const ROUTE_PROBE = 1.0;

// The check returns true when the probe segment touches an alive
// structure or a cover. Dead structures never block.
function routeBlocked(state: BattleState, me: AgentId, move: Vec2, cfg: BattleConfig): boolean {
  const a = state.agents[me];
  const x2 = a.pos.x + move.x * ROUTE_PROBE;
  const y2 = a.pos.y + move.y * ROUTE_PROBE;
  for (const s of state.moba?.structures ?? []) {
    if (!s.alive) continue;
    const rr = s.radius + cfg.agent.radius;
    if (Math.hypot(a.pos.x - s.pos.x, a.pos.y - s.pos.y) < rr) return true;
    if (segCircle(a.pos.x, a.pos.y, x2, y2, s.pos.x, s.pos.y, rr) !== null) return true;
  }
  for (const box of cfg.world.covers) {
    if (segmentHitsBox(a.pos.x, a.pos.y, x2, y2, box)) return true;
  }
  return false;
}

// Lane routing. A head-on walk into a tower wedges: the contact
// solver pushes straight back out, so the robot jitters in place
// forever. A blocked probe bends the step sideways instead, and the
// same bend every tick walks the wall around convex obstacles. One
// formula serves both sides, which mirrors A and B on the map.
function routeMove(state: BattleState, me: AgentId, move: Vec2, cfg: BattleConfig): Vec2 {
  if (!routeBlocked(state, me, move, cfg)) return move;
  return { x: move.x * 0.3 - move.y * 0.95, y: move.y * 0.3 + move.x * 0.95 };
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
  const shot = robotAD(a.items ?? []) * (state.moba?.overseer && state.tick + 1 < state.moba.overseer.buffUntil[me] ? 1.2 : 1);
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
// structures stay visible. Ties keep ascending id order. Executes
// come first, then farm, then the healthy foe: robots that dueled
// every healthy hero traded kills to the tick cap, so the lane
// farms and only skirmishes dry waves.
function pickAim(state: BattleState, me: AgentId, cfg: BattleConfig, target: TargetIntent = "AUTO"): Vec2 | null {
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
  const shot = robotAD(a.items ?? []) * (moba.overseer && state.tick + 1 < moba.overseer.buffUntil[me] ? 1.2 : 1);
  const f = state.agents[enemy];
  if (target === "NONE") return null;
  if (target === "OVERSEER") {
    const o = moba.overseer;
    const pos = o ? { x: o.x, y: o.y } : null;
    return o?.alive && pos && inRange(pos, OVERSEER_RADIUS) && sees(pos) ? pos : null;
  }
  const foeVisible = f.alive && inRange(f.pos, cfg.agent.radius) && sees(f.pos);
  if (target === "FOE") return foeVisible ? { ...f.pos } : null;
  if (target === "AUTO" && foeVisible && f.hp <= shot) return { ...f.pos };
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
  if (target === "LAST_HIT") {
    const lastHit = moba.minions.filter(m => m.side === enemy && m.alive && inRange(m.pos, MINION_RADIUS) && sees(m.pos) && m.hp <= shot * (cfg.rulesetVersion === 2 ? 1 : armorMult(30)))
      .sort((left, right) => Math.hypot(left.pos.x - a.pos.x, left.pos.y - a.pos.y) - Math.hypot(right.pos.x - a.pos.x, right.pos.y - a.pos.y) || left.id - right.id)[0];
    return lastHit ? { ...lastHit.pos } : null;
  }
  if (target === "AUTO" || target === "MINION") {
    if (killable) return { ...killable.pos };
    if (near) return { ...near.pos };
    if (target === "MINION") return null;
    if (foeVisible) return { ...f.pos };
  }
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
  const phase = cfg.mode === "arena" && me === "B" ? 32 : 0;
  const flip = ((state.tick + phase) >> 6) % 2 === 1 ? -1 : 1;
  let move: Vec2;
  switch (want.move) {
    case "CONTEST_OVERSEER": {
      const o = state.moba?.overseer;
      move = o?.alive && Math.hypot(o.x - a.pos.x, o.y - a.pos.y) > ROBOT_RANGE + OVERSEER_RADIUS - 0.5 ? dir(a.pos, o) : { x: 0, y: 0 };
      break;
    }
    case "WAIT":
      move = { x: 0, y: 0 };
      break;
    case "APPROACH":
      move = obs.lineOfSight ? { ...toFoe } : dir(a.pos, center);
      break;
    case "RETREAT":
      // In MOBA mode retreat walks home to the own nexus, where the
      // heal tops up. Away-from-foe steps pin robots in corners: the
      // far corner reads safe while no minion ever walks there, so
      // the lane starves. Duel keeps the legacy vector.
      if (cfg.mode === "moba" && state.moba) {
        const home = state.moba.structures.find((s) => s.side === me && s.kind === "nexus");
        move = dir(a.pos, home ? home.pos : center);
      } else {
        move = { x: -toFoe.x, y: -toFoe.y };
      }
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
    case "COLLECT": {
      // The walk heads for the nearest live pickup. No pickup
      // holds position. Duel and MOBA never spawn pickups.
      let best: Vec2 | null = null;
      let bestD = Infinity;
      for (const p of state.arena?.pickups ?? []) {
        const d = Math.hypot(p.pos.x - a.pos.x, p.pos.y - a.pos.y);
        if (d < bestD) { bestD = d; best = p.pos; }
      }
      move = best ? dir(a.pos, best) : { x: 0, y: 0 };
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
  // A chipless tick still plays the lane. When no rule matches in
  // MOBA mode the robot holds the wave front instead of diving the
  // nearest tower, and auto-attack below works the trigger.
  if (cfg.mode === "moba" && state.moba && want.ruleId === FALLBACK_RULE_ID) {
    move = pushMove(state, me, cfg);
  }
  // Lane routing bends MOBA steps around towers. Duel moves pass
  // through untouched, so duel replays stay byte-identical.
  if (cfg.mode === "moba" && state.moba) {
    move = routeMove(state, me, move, cfg);
  }
  // Amendment A5: MOBA robots auto-attack. A rule-silent robot still
  // shoots whatever pickAim sees in range, so duel-era drafts with no
  // fire rule fight instead of standing still. The chip keeps full
  // authority over movement, dash, shield, and buys. Duel keeps
  // rule-gated fire, so duel replays stay byte-identical. Arena
  // fires at the visible foe in range on its own; only target
  // NONE holds it, and the range gate below quiets rule fire too.
  let aim: Vec2;
  let fire = want.fire;
  if (cfg.mode === "moba" && state.moba) {
    const target = pickAim(state, me, cfg, want.target);
    if (target) {
      aim = dir(a.pos, target);
      fire = true;
    } else {
      aim = move;
      fire = false;
    }
  } else {
    if (cfg.mode === "arena") {
      if (want.target === "NONE") {
        aim = move;
        fire = false;
      } else if (obs.lineOfSight && Math.hypot(f.pos.x - a.pos.x, f.pos.y - a.pos.y) <= ARENA_RANGE + 1) {
        aim = { ...toFoe };
        fire = true;
      } else {
        aim = move;
      }
    } else {
      aim = obs.lineOfSight ? { ...toFoe } : move;
    }
  }
  return {
    move,
    aim,
    fire: cfg.mode === "arena" ? fire && Math.hypot(f.pos.x - a.pos.x, f.pos.y - a.pos.y) <= ARENA_RANGE + 1 : fire,
    dash: want.dash,
    shield: want.shield,
    skill: cfg.mode === "arena" ? (want.skill ?? false) && fire : (want.skill ?? false),
    buy: want.buy ?? null,
  };
}
