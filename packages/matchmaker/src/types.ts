// Matchmaker contracts. Selection is server-owned and deterministic.

export type Candidate = {
  leaderId: string;
  ratingMilli: number;
  optIn: boolean;
  published: boolean;
  leaseExpiresAt: number | null;
};

export type PairMark = {
  a: string;
  b: string;
  at: number;
};

export type History = {
  marks: PairMark[];
};
