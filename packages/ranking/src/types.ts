// Ranked rating contracts. The ledger owns every AP move.

export type RankTier =
  | "PROTOTYPE"
  | "CIRCUIT"
  | "CORE"
  | "ASCENDANT"
  | "SINGULARITY";

export type Division = "III" | "II" | "I" | null;

export type RatingState = {
  leaderId: string;
  seasonId: string;
  ratingMilli: number;
  ap: number;
  placementGames: number;
  placed: boolean;
  rankTier: RankTier | null;
  division: Division;
};

export type Rank = {
  tier: RankTier | null;
  division: Division;
};

export type Winner = "A" | "B" | "DRAW";

export type MatchInput = {
  matchId: string;
  leaderA: string;
  leaderB: string;
  winner: Winner;
  rated: boolean;
};

export type AppliedMatch = {
  matchId: string;
  deltaA: number;
  deltaB: number;
  apA: number;
  apB: number;
  floorClipped: boolean;
};

export type Ledger = {
  seasonId: string;
  ratings: Map<string, RatingState>;
  matches: Set<string>;
};
