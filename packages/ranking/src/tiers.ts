// Tier lookup. Thresholds stay configurable in one table.

import type { Division, Rank, RankTier } from "./types.ts";

type Band = { min: number; tier: RankTier; division: Division };

const BANDS: Band[] = [
  { min: 1200, tier: "SINGULARITY", division: null },
  { min: 1100, tier: "ASCENDANT", division: "I" },
  { min: 1000, tier: "ASCENDANT", division: "II" },
  { min: 900, tier: "ASCENDANT", division: "III" },
  { min: 800, tier: "CORE", division: "I" },
  { min: 700, tier: "CORE", division: "II" },
  { min: 600, tier: "CORE", division: "III" },
  { min: 500, tier: "CIRCUIT", division: "I" },
  { min: 400, tier: "CIRCUIT", division: "II" },
  { min: 300, tier: "CIRCUIT", division: "III" },
  { min: 200, tier: "PROTOTYPE", division: "I" },
  { min: 100, tier: "PROTOTYPE", division: "II" },
  { min: 0, tier: "PROTOTYPE", division: "III" },
];

// The lookup walks bands from the top and returns the first fit.
export function rankFor(ap: number): Rank {
  for (const band of BANDS) {
    if (ap >= band.min) {
      return { tier: band.tier, division: band.division };
    }
  }
  return { tier: "PROTOTYPE", division: "III" };
}
