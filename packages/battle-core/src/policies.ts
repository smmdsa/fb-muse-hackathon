// Reference policies. SHADOW evades, BREAKER pushes, BENCH holds mid.

import type { AgentAction, AgentState, BattleState, Vec2 } from "./types.ts";

export type Dna = {
  aggression: number;
  evasion: number;
  preferredDistance: number;
  conserve: number;
};

export const SHADOW_DNA: Dna = {
  aggression: 35,
  evasion: 80,
  preferredDistance: 65,
  conserve: 70,
};

export const BREAKER_DNA: Dna = {
  aggression: 80,
  evasion: 30,
  preferredDistance: 20,
  conserve: 35,
};

export const BENCH_DNA: Dna = {
  aggression: 55,
  evasion: 55,
  preferredDistance: 45,
  conserve: 50,
};

// The helper returns a unit vector from one point to the other.
function dir(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// The helper finds the nearest live projectile threat.
function threat(
  me: AgentState,
  state: BattleState,
): { pos: Vec2; time: number } | null {
  let best: { pos: Vec2; time: number } | null = null;
  for (const p of state.projectiles) {
    if (p.owner === me.id) continue;
    const dx = me.pos.x - p.pos.x;
    const dy = me.pos.y - p.pos.y;
    const dist = Math.hypot(dx, dy);
    const speed = Math.hypot(p.vel.x, p.vel.y) || 1;
    const tti = dist / speed;
    if (tti > 1.2) continue;
    if (best === null || tti < best.time) {
      best = { pos: { ...p.pos }, time: tti };
    }
  }
  return best;
}

// The policy maps one observation to one action set.
export function dnaPolicy(
  me: AgentState,
  foe: AgentState,
  state: BattleState,
  dna: Dna,
  center: Vec2,
): AgentAction {
  const toFoe = dir(me.pos, foe.pos);
  const distFoe = Math.hypot(foe.pos.x - me.pos.x, foe.pos.y - me.pos.y);
  const want = 3 + (dna.preferredDistance / 100) * 8;
  let move: Vec2 = { x: 0, y: 0 };
  if (distFoe > want + 1) {
    move = { x: toFoe.x, y: toFoe.y };
  } else if (distFoe < want - 1) {
    move = { x: -toFoe.x, y: -toFoe.y };
  } else {
    move = { x: -toFoe.y, y: toFoe.x };
    if ((state.tick >> 6) % 2 === 1) {
      move = { x: -move.x, y: -move.y };
    }
  }
  const risk = threat(me, state);
  if (risk !== null && dna.evasion > 40) {
    const away = dir(risk.pos, me.pos);
    const w = dna.evasion / 100;
    move = { x: move.x * (1 - w) + away.x * w, y: move.y * (1 - w) + away.y * w };
  }
  if (me.energy < 30 && dna.conserve > 50) {
    move = { x: move.x * 0.6, y: move.y * 0.6 };
  }
  const fire = distFoe < 12 && dna.aggression > 25;
  const dash =
    dna.aggression > 65 && me.energy > 50 && distFoe > 6 && distFoe < 10;
  const shield =
    risk !== null && risk.time < 0.35 && me.energy > 30;
  const useCenter =
    dna.aggression < 45 && Math.hypot(center.x - me.pos.x, center.y - me.pos.y) > 6;
  if (useCenter && risk === null) {
    move = dir(me.pos, center);
  }
  return { move, aim: { ...toFoe }, fire, dash, shield };
}
