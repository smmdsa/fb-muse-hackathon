// Policy driver. Compiled DNA steers one robot for one tick.

import { evaluate } from "@agent-wars/behavior-dna";
import type { AgentPolicy, Observation } from "@agent-wars/behavior-dna";
import { segmentHitsBox } from "./world.ts";
import type { AgentAction, AgentId, BattleConfig, BattleState, Vec2 } from "./types.ts";

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
): AgentAction {
  const obs = observe(state, me, cfg);
  const want = evaluate(policy, obs);
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
