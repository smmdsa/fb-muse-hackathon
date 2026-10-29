// Behavior DNA contracts. The validator owns every accept or reject.

export type MoveIntent =
  | "APPROACH"
  | "RETREAT"
  | "KITE"
  | "STRAFE"
  | "SEEK_COVER"
  | "CAPTURE"
  | "PUSH"
  | "FARM"
  | "DEFEND";

export type AbilityIntent = "AIM" | "FIRE" | "DASH" | "SHIELD";
export type TargetIntent = "AUTO" | "FOE" | "MINION" | "STRUCTURE" | "NONE";

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
  | "edgeDist"
  | "ownGold"
  | "ownDeaths"
  | "gameTime"
  | "distFoeTower"
  | "foeTowerHpPct"
  | "nearFoeMinions"
  | "nearAllyMinions"
  | "distFoeMinion"
  | "foeHpPct"
  | "buildValue"
  | "slotsFree"
  | "structLead"
  | "foeAlive";

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
  buy?: string;
  target?: TargetIntent;
};

export type DnaTraits = {
  aggression: number;
  evasion: number;
  preferredDistance: number;
  energyConservation: number;
};

export type AgentPolicy = {
  schemaVersion: 1 | 2;
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
  ownGold?: number;
  ownDeaths?: number;
  gameTime?: number;
  distFoeTower?: number | null;
  foeTowerHpPct?: number | null;
  nearFoeMinions?: number;
  nearAllyMinions?: number;
  distFoeMinion?: number | null;
  foeHpPct?: number | null;
  buildValue?: number;
  slotsFree?: number;
  structLead?: number;
  foeAlive: boolean;
};

export type Intents = {
  move: MoveIntent;
  fire: boolean;
  dash: boolean;
  shield: boolean;
  buy: string | null;
  ruleId: string;
  target?: TargetIntent;
};
