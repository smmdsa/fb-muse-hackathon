// Standings board. AP orders the ladder. Ties break deterministically.

import type { RatingState } from "@agent-wars/ranking";

export type Standing = {
  rank: number;
  leaderId: string;
  ap: number;
  ratingMilli: number;
  tier: RatingState["rankTier"];
  division: RatingState["division"];
};

// The builder lists placed leaders for one season, best first.
export function buildStandings(
  seasonId: string,
  states: RatingState[],
  limit = 100,
): Standing[] {
  const rows = states
    .filter((s) => s.seasonId === seasonId && s.placed)
    .sort((a, b) => {
      if (b.ap !== a.ap) return b.ap - a.ap;
      if (b.ratingMilli !== a.ratingMilli) return b.ratingMilli - a.ratingMilli;
      return a.leaderId < b.leaderId ? -1 : a.leaderId > b.leaderId ? 1 : 0;
    })
    .slice(0, limit);
  return rows.map((s, i) => ({
    rank: i + 1,
    leaderId: s.leaderId,
    ap: s.ap,
    ratingMilli: s.ratingMilli,
    tier: s.rankTier,
    division: s.division,
  }));
}
