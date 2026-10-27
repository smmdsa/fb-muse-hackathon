// Season rollover. Archives freeze. Fresh states reset to the start line.

import { buildStandings } from "@agent-wars/leaderboard";
import type { RatingState } from "@agent-wars/ranking";
import { START_MILLI, toAp } from "@agent-wars/ranking";

export type Archive = {
  seasonId: string;
  closedAt: number;
  rows: { rank: number; leaderId: string; ap: number }[];
};

export type Rollover = {
  archive: Archive;
  fresh: RatingState[];
};

// The closer freezes the board and resets every leader for the next season.
export function rollover(
  seasonId: string,
  nextSeasonId: string,
  states: RatingState[],
  now: number,
): Rollover {
  const rows = buildStandings(seasonId, states, states.length).map((r) => ({
    rank: r.rank,
    leaderId: r.leaderId,
    ap: r.ap,
  }));
  const fresh = states.map((s) => ({
    leaderId: s.leaderId,
    seasonId: nextSeasonId,
    ratingMilli: START_MILLI,
    ap: toAp(START_MILLI),
    placementGames: 0,
    placed: false,
    rankTier: null as RatingState["rankTier"],
    division: null as RatingState["division"],
  }));
  return { archive: { seasonId, closedAt: now, rows }, fresh };
}
