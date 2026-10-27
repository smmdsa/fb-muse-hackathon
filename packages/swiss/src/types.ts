// Swiss pairing contracts. All time is injected. Nothing touches a live clock.

export type Entrant = {
  id: string;
  score: number;
  opponents: string[];
  byes: number;
};

export type RoundResult = {
  a: string;
  b: string;
  winner: "a" | "b" | "draw";
};

export type RoundPairing = {
  pairs: [string, string][];
  bye: string | null;
  repeats: number;
};
