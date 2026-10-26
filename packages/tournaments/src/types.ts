// Championship contracts. All time is injected. Nothing touches a live clock.

export type EventPhase =
  | "DRAFT"
  | "ANNOUNCED"
  | "REGISTRATION_OPEN"
  | "LOCKED"
  | "SEEDED"
  | "LIVE"
  | "COMPLETED"
  | "CANCELLED";

export type Entry = {
  leaderId: string;
  agentVersionId: string;
  lockedVersionId: string | null;
  registeredAt: number;
};

export type Championship = {
  id: string;
  seed: string;
  maxPlayers: number;
  minAp: number;
  registrationCloseAt: number;
  phase: EventPhase;
  entries: Entry[];
  bracket: Bracket | null;
};

export type MatchSlot = {
  id: string;
  round: number;
  slotA: string | null;
  slotB: string | null;
  bestOf: number;
  winsA: number;
  winsB: number;
  winnerId: string | null;
  loserTo: string | null;
};

export type Bracket = {
  rounds: number;
  slots: MatchSlot[];
  championId: string | null;
};
