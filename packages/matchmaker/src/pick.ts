// Opponent picker. Eligibility first, pair caps second, nearest rating wins.

import type { Candidate, History } from "./types.ts";

export const PAIR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PAIR_MEETINGS = 2;

// The history records one counted meeting. Order of ids never matters.
export function recordPair(history: History, a: string, b: string, now: number): History {
  const [x, y] = a < b ? [a, b] : [b, a];
  return { marks: [...history.marks, { a: x, b: y, at: now }] };
}

// The counter counts in-window meetings for one pair.
export function pairMeetings(history: History, a: string, b: string, now: number): number {
  const [x, y] = a < b ? [a, b] : [b, a];
  return history.marks.filter((m) => m.a === x && m.b === y && now - m.at < PAIR_WINDOW_MS).length;
}

// The picker returns the best foe or null. Ties break by leader id.
export function pickOpponent(
  history: History,
  seeker: Candidate,
  pool: Candidate[],
  now: number,
): Candidate | null {
  let best: Candidate | null = null;
  let bestGap = Infinity;
  for (const c of pool) {
    if (c.leaderId === seeker.leaderId) continue;
    if (!c.optIn || !c.published) continue;
    if (c.leaseExpiresAt === null || now >= c.leaseExpiresAt) continue;
    if (pairMeetings(history, seeker.leaderId, c.leaderId, now) >= MAX_PAIR_MEETINGS) continue;
    const gap = Math.abs(c.ratingMilli - seeker.ratingMilli);
    if (gap < bestGap || (gap === bestGap && best !== null && c.leaderId < best.leaderId)) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}
