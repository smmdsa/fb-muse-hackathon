// Policy driver. Compiled DNA steers one robot for one tick.

import { evaluate } from "@agent-wars/behavior-dna";
import type { AgentPolicy, Observation } from "@agent-wars/behavior-dna";
import { checksum, createBattle, DEFAULT_BATTLE, stepBattle } from "./simulation.ts";
import { segmentHitsBox } from "./world.ts";
import type { AgentAction, AgentId, BattleConfig, BattleState, Vec2 } from "./types.ts";

// Sparring bots. Rule-based presets near ladder bands, never AP minters.
// Bots fight unrated only; the picker below matches bots to nearby AP.
export type BotPreset = { id: string; name: string; apHint: number; policy: import("./types.ts").AgentPolicy };

const BOT_SHADOW = {
  schemaVersion: 1,
  agentVersionId: "bot-shadow",
  dna: { aggression: 35, evasion: 80, preferredDistance: 65, energyConservation: 70 },
  rules: [
    { id: "s-hide", when: { operand: "coverDist", op: "lt", value: 3 }, move: "SEEK_COVER" },
    { id: "s-strafe", when: { all: [{ operand: "distFoe", op: "gte", value: 4 }, { operand: "distFoe", op: "lte", value: 10 }] }, move: "STRAFE", fire: true },
    { id: "s-retreat", when: { operand: "ownHpPct", op: "lt", value: 25 }, move: "RETREAT" },
    { id: "s-center", when: { operand: "objectiveDist", op: "gt", value: 6 }, move: "CAPTURE" },
  ],
} as BotPreset["policy"];

const BOT_BENCH = {
  schemaVersion: 1,
  agentVersionId: "bot-bench",
  dna: { aggression: 55, evasion: 55, preferredDistance: 45, energyConservation: 50 },
  rules: [
    { id: "n-close", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "n-far", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH" },
    { id: "n-center", when: { operand: "objectiveDist", op: "gt", value: 6 }, move: "CAPTURE" },
  ],
} as BotPreset["policy"];

const BOT_BREAKER = {
  schemaVersion: 1,
  agentVersionId: "bot-breaker",
  dna: { aggression: 80, evasion: 30, preferredDistance: 20, energyConservation: 35 },
  rules: [
    { id: "b-rush", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH", fire: true },
    { id: "b-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
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

export function buildReplay(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
): Replay {
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

// The reference brain for training-grade fights. Both servers use this copy.
export const BENCH_POLICY: AgentPolicy = {
  schemaVersion: 1,
  agentVersionId: "benchmark-v1",
  dna: { aggression: 55, evasion: 55, preferredDistance: 45, energyConservation: 50 },
  rules: [
    { id: "b-close", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
    { id: "b-far", when: { operand: "distFoe", op: "gte", value: 6 }, move: "APPROACH" },
  ],
};

// The runner fights two policies to the end. Same seed, same checksum.
// It tallies which chip fired each tick per side for the dashboard.
export function fightPolicies(
  a: AgentPolicy,
  b: AgentPolicy,
  seed: string,
): { winner: string; ticks: number; checksum: string; chipsA: Record<string, number>; chipsB: Record<string, number> } {
  const cfg = { ...DEFAULT_BATTLE, seed };
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
    objectiveDist: Math.hypot(center.x - a.pos.x, center.y - a.pos.y),
    timeLeft: cfg.world.maxTicks / cfg.world.tickHz - state.time,
    edgeDist: Math.min(a.pos.x, a.pos.y, cfg.world.width - a.pos.x, cfg.world.height - a.pos.y),
  };
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
    case "CAPTURE":
    default:
      move = dir(a.pos, center);
      break;
  }
  return {
    move,
    aim: obs.lineOfSight ? { ...toFoe } : move,
    fire: want.fire,
    dash: want.dash,
    shield: want.shield,
  };
}
