// AutoBattle contracts. Time is always injected. Nothing reads a live clock.

export type AutoBattleState =
  | "OFFLINE_DRAFT"
  | "ACTIVE_READY"
  | "IN_MATCH"
  | "IDLE_ENERGY"
  | "IDLE_EXPIRED"
  | "PAUSED_MANUAL"
  | "TOURNAMENT_LOCKED";

export type Status = {
  leaderId: string;
  state: AutoBattleState;
  optIn: boolean;
  published: boolean;
  leaseExpiresAt: number | null;
  stamina: number;
  staminaMax: number;
  lastStaminaAt: number;
  attackAt: number[];
  defenseAt: number[];
  lockedTournament: boolean;
};

export type Denial = { ok: false; reason: string };
export type Grant = { ok: true };
export type Guard = Grant | Denial;
