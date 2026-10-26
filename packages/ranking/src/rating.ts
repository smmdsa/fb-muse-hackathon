// AP update core. Zero-sum always. Equal size, opposite signs.

import { rankFor } from "./tiers.ts";
import type {
  AppliedMatch,
  Ledger,
  MatchInput,
  RatingState,
} from "./types.ts";

export const START_MILLI = 1000000;
export const PLACEMENT_GAMES = 5;
const K = 40;
const MIN_DELTA = 12;
const MAX_DELTA = 28;

// The factory seeds one ledger for one season.
export function createLedger(seasonId: string): Ledger {
  return { seasonId, ratings: new Map(), matches: new Set() };
}

// The lookup seeds a fresh 1000.000 rating on first use.
export function ratingFor(ledger: Ledger, leaderId: string): RatingState {
  const found = ledger.ratings.get(leaderId);
  if (found) return found;
  const fresh: RatingState = {
    leaderId,
    seasonId: ledger.seasonId,
    ratingMilli: START_MILLI,
    ap: toAp(START_MILLI),
    placementGames: 0,
    placed: false,
    rankTier: null,
    division: null,
  };
  ledger.ratings.set(leaderId, fresh);
  return fresh;
}

// AP shows the rating above the 500 base, floored at zero.
export function toAp(ratingMilli: number): number {
  return Math.max(0, Math.round(ratingMilli / 1000 - 500));
}

// The expectation follows the Elo curve on the milli ratings.
export function expectedScore(milliA: number, milliB: number): number {
  return 1 / (1 + Math.pow(10, (milliB - milliA) / 1000 / 400));
}

// The applier records one rated result exactly once.
export function applyRanked(ledger: Ledger, match: MatchInput): AppliedMatch {
  if (match.leaderA === match.leaderB) {
    throw new Error("self match denied: one leader cannot fight itself");
  }
  if (ledger.matches.has(match.matchId)) {
    throw new Error(`duplicate match denied: ${match.matchId} already counted`);
  }
  const a = ratingFor(ledger, match.leaderA);
  const b = ratingFor(ledger, match.leaderB);
  const ea = expectedScore(a.ratingMilli, b.ratingMilli);
  let deltaA: number;
  if (match.winner === "DRAW") {
    deltaA = Math.round(K * (0.5 - ea));
  } else {
    const sa = match.winner === "A" ? 1 : 0;
    const raw = K * (sa - ea);
    deltaA = Math.sign(raw) * Math.min(MAX_DELTA, Math.max(MIN_DELTA, Math.round(Math.abs(raw))));
  }
  const deltaB = -deltaA || 0;
  ledger.matches.add(match.matchId);
  const floorClipped = move(a, deltaA) || move(b, deltaB);
  return { matchId: match.matchId, deltaA, deltaB, apA: a.ap, apB: b.ap, floorClipped };
}

// The mover shifts the internal rating without a floor and shows AP floored.
function move(state: RatingState, deltaAp: number): boolean {
  state.ratingMilli += deltaAp * 1000;
  state.placementGames += 1;
  state.placed = state.placementGames >= PLACEMENT_GAMES;
  const shown = toAp(state.ratingMilli);
  const clipped = state.ratingMilli / 1000 - 500 < 0;
  state.ap = shown;
  if (state.placed) {
    const rank = rankFor(shown);
    state.rankTier = rank.tier;
    state.division = rank.division;
  }
  return clipped;
}
