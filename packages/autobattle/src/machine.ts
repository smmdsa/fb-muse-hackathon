// AutoBattle state machine. Pure transitions on an injected clock.
// Fights cost nothing: the 24h lease plus the manual daily cap
// bound play. Stamina fields stay on Status so old stored rows
// still parse; the machine never reads them.

import type { AutoBattleState, Guard, Status } from "./types.ts";

export const LEASE_MS = 24 * 60 * 60 * 1000;
export const STAMINA_MAX = 10;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_ATTACK_PER_DAY = 10;
export const MAX_DEFENSE_PER_DAY = 3;

// The factory builds a fresh draft. Time starts at the given instant.
export function draft(leaderId: string, now: number): Status {
  return {
    leaderId,
    state: "OFFLINE_DRAFT",
    optIn: false,
    published: false,
    leaseExpiresAt: null,
    autoMode: null,
    stamina: STAMINA_MAX,
    staminaMax: STAMINA_MAX,
    lastStaminaAt: now,
    attackAt: [],
    defenseAt: [],
    lockedTournament: false,
  };
}

// Explicit activation only. Reads never call this function.
export function activate(status: Status, now: number, mode: "casual" | "ranked" = "casual"): Status {
  const next = { ...status, attackAt: [...status.attackAt], defenseAt: [...status.defenseAt] };
  next.optIn = true;
  next.autoMode = mode;
  next.leaseExpiresAt = now + LEASE_MS;
  next.lastStaminaAt = next.lastStaminaAt ?? now;
  next.state = restState(next, now);
  return next;
}

// Explicit pause only. Resume needs activate.
export function pause(status: Status): Status {
  if (status.state === "IN_MATCH") return status;
  return { ...status, state: "PAUSED_MANUAL" };
}

// A read refreshes derived values but never extends the lease.
export function refresh(status: Status, now: number): Status {
  const next: Status = {
    ...status,
    attackAt: prune(status.attackAt, now),
    defenseAt: prune(status.defenseAt, now),
  };
  if (next.state !== "IN_MATCH" && next.state !== "PAUSED_MANUAL" && next.state !== "TOURNAMENT_LOCKED") {
    next.state = restState(next, now);
  } else if (next.state === "TOURNAMENT_LOCKED" && !next.lockedTournament) {
    next.state = restState(next, now);
  }
  return next;
}

// Owner-initiated match. Free while the lease runs: no stamina,
// no daily cap. Manual matches keep their own cap elsewhere.
export function startOwnerMatch(status: Status, now: number): { status: Status; guard: Guard } {
  const cur = refresh(status, now);
  if (!cur.published) {
    return { status: cur, guard: { ok: false, reason: "no published version" } };
  }
  if (cur.state !== "ACTIVE_READY") {
    return { status: cur, guard: { ok: false, reason: `state ${cur.state} blocks matches` } };
  }
  const next: Status = { ...cur, state: "IN_MATCH" };
  return { status: next, guard: { ok: true } };
}

// Manual match. Free too, but the daily cap still guards live play.
// Auto ticks never append here, so the cap counts manual fights only.
export function spendManualMatch(status: Status, now: number): { status: Status; guard: Guard } {
  const cur = refresh(status, now);
  if (!cur.published) {
    return { status: cur, guard: { ok: false, reason: "no published version" } };
  }
  if (cur.attackAt.length >= MAX_ATTACK_PER_DAY) {
    return { status: cur, guard: { ok: false, reason: "daily match cap reached" } };
  }
  const next: Status = { ...cur, attackAt: [...cur.attackAt, now] };
  return { status: next, guard: { ok: true } };
}

// Refund. A reservation that never started leaves the daily count.
export function refundManualMatch(status: Status, now: number): Status {
  const cur = refresh(status, now);
  const attackAt = cur.attackAt.slice(0, -1);
  return { ...cur, attackAt };
}

// Match end. Expiry wins over a return to ready.
export function finishMatch(status: Status, now: number): Status {
  if (status.state !== "IN_MATCH") return refresh(status, now);
  const next = refresh({ ...status, state: "ACTIVE_READY" }, now);
  return next;
}

// Defense pick. The first three per day count; the rest run unranked.
export function recordDefense(status: Status, now: number): { status: Status; credited: boolean } {
  const cur = refresh(status, now);
  const eligible = cur.leaseExpiresAt !== null && now < cur.leaseExpiresAt && cur.optIn;
  const underCap = cur.defenseAt.filter((t) => now - t < DAY_MS).length < MAX_DEFENSE_PER_DAY;
  const credited = eligible && underCap;
  const next: Status = { ...cur, defenseAt: [...cur.defenseAt, now] };
  return { status: next, credited };
}

// Tournament freeze and release. Tournaments skip the daily cap.
export function enterTournament(status: Status, now: number): Status {
  const cur = refresh(status, now);
  return { ...cur, lockedTournament: true, state: "TOURNAMENT_LOCKED" };
}

export function exitTournament(status: Status, now: number): Status {
  const cur = refresh({ ...status, lockedTournament: false }, now);
  if (cur.state === "TOURNAMENT_LOCKED") {
    cur.state = restState(cur, now);
  }
  return cur;
}

// The rest state derives from lease, opt-in, and flags.
function restState(status: Status, now: number): AutoBattleState {
  if (!status.optIn || !status.published) return "OFFLINE_DRAFT";
  if (status.lockedTournament) return "TOURNAMENT_LOCKED";
  if (status.leaseExpiresAt === null || now >= status.leaseExpiresAt) return "IDLE_EXPIRED";
  return "ACTIVE_READY";
}

function prune(marks: number[], now: number): number[] {
  return marks.filter((t) => now - t < DAY_MS);
}
