// Behavior DNA contracts. The validator owns every accept or reject.

export type MoveIntent =
  | "APPROACH"
  | "RETREAT"
  | "KITE"
  | "STRAFE"
  | "SEEK_COVER"
  | "CAPTURE";

export type AbilityIntent = "AIM" | "FIRE" | "DASH" | "SHIELD";

export type Operand =
  | "ownHpPct"
  | "energy"
  | "distFoe"
  | "projectileTti"
  | "coverDist"
  | "lineOfSight"
  | "dashReady"
  | "shieldReady"
  | "foeLastSeenAge"
  | "objectiveDist"
  | "timeLeft"
  | "edgeDist";

export type NumOp = "gt" | "gte" | "lt" | "lte";

export type Leaf =
  | { operand: Operand; op: NumOp; value: number }
  | { operand: Operand; op: "eq"; value: number | boolean };

export type Predicate =
  | Leaf
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate };

export type BehaviorRule = {
  id: string;
  when: Predicate;
  move: MoveIntent;
  fire?: boolean;
  dash?: boolean;
  shield?: boolean;
};

export type DnaTraits = {
  aggression: number;
  evasion: number;
  preferredDistance: number;
  energyConservation: number;
};

export type AgentPolicy = {
  schemaVersion: 1;
  agentVersionId: string;
  dna: DnaTraits;
  rules: BehaviorRule[];
};

export type Observation = {
  ownHpPct: number;
  energy: number;
  distFoe: number | null;
  projectileTti: number | null;
  coverDist: number | null;
  lineOfSight: boolean;
  dashReady: boolean;
  shieldReady: boolean;
  foeLastSeenAge: number;
  objectiveDist: number;
  timeLeft: number;
  edgeDist: number;
};

export type Intents = {
  move: MoveIntent;
  fire: boolean;
  dash: boolean;
  shield: boolean;
  ruleId: string;
};
