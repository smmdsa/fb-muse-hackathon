// Battle-core public types. The sim owns all state changes.

export type Vec2 = {
  x: number;
  y: number;
};

export type AgentId = "A" | "B";

export type MoveIntent =
  | "APPROACH"
  | "RETREAT"
  | "KITE"
  | "STRAFE"
  | "SEEK_COVER"
  | "CAPTURE";

export type AgentAction = {
  move: Vec2;
  aim: Vec2;
  fire: boolean;
  dash: boolean;
  shield: boolean;
  buy?: string | null;
};

export type AgentConfig = {
  radius: number;
  speed: number;
  maxHp: number;
  maxEnergy: number;
  energyRegen: number;
};

export type AgentState = {
  id: AgentId;
  pos: Vec2;
  vel: Vec2;
  hp: number;
  energy: number;
  aim: Vec2;
  alive: boolean;
  dashCooldownUntil: number;
  shieldUntil: number;
  shieldCooldownUntil: number;
  lastShotAt: number;
  damageDealt: number;
  controlTime: number;
  gold?: number;
  items?: string[];
  deaths?: number;
  respawnAt?: number;
  spawnShieldUntil?: number;
  autoCell?: boolean;
};

export type Projectile = {
  id: number;
  owner: AgentId;
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  alive: boolean;
  dmg?: number;
  srcTower?: StructureId | null;
  srcMinion?: number | null;
};

export type CoverBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type WorldConfig = {
  width: number;
  height: number;
  covers: CoverBox[];
  control: CoverBox;
  tickHz: number;
  maxTicks: number;
};

export type BattleMode = "duel" | "moba";

export type BattleConfig = {
  seed: string;
  world: WorldConfig;
  agent: AgentConfig;
  mode?: BattleMode;
  autoBuy?: boolean;
  rulesetVersion?: 1 | 2;
};

export type BattleState = {
  tick: number;
  time: number;
  agents: Record<AgentId, AgentState>;
  projectiles: Projectile[];
  nextProjectileId: number;
  over: boolean;
  winner: AgentId | "DRAW" | null;
  moba?: MobaState;
};

export type StructureId =
  | "a_t1" | "a_t2" | "a_inhib" | "a_nt_top" | "a_nt_bot" | "a_nexus"
  | "b_t1" | "b_t2" | "b_inhib" | "b_nt_top" | "b_nt_bot" | "b_nexus";

export type StructureKind = "tower" | "inhibitor" | "nexus_turret" | "nexus";

export type TowerTarget =
  | { kind: "robot"; side: AgentId }
  | { kind: "minion"; id: number };

export type StructureState = {
  id: StructureId;
  side: AgentId;
  kind: StructureKind;
  pos: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  target: TowerTarget | null;
  lastShotAt: number;
  heatSide: AgentId | null;
  heatCount: number;
  heatOutSince: number | null;
};

export type MinionKind = "melee" | "caster" | "super";

export type MinionTarget =
  | { kind: "robot"; side: AgentId }
  | { kind: "minion"; id: number }
  | { kind: "structure"; id: StructureId };

export type MinionState = {
  id: number;
  side: AgentId;
  kind: MinionKind;
  pos: Vec2;
  hp: number;
  alive: boolean;
  target: MinionTarget | null;
  wpIndex: number;
  lastShotAt: number;
};

export type MobaEvent =
  | { t: number; type: "wave"; side: AgentId }
  | { t: number; type: "buy"; side: AgentId; item: string; gold: number }
  | { t: number; type: "combine"; side: AgentId; item: string }
  | { t: number; type: "kill"; side: AgentId }
  | { t: number; type: "respawn"; side: AgentId }
  | { t: number; type: "structure"; side: AgentId; id: StructureId }
  | { t: number; type: "overseer-spawn" }
  | { t: number; type: "overseer-hit"; side: AgentId; damage: number }
  | { t: number; type: "overseer-defeated"; side: AgentId };

export type OverseerState = {
  x: number; y: number; hp: number; maxHp: number; alive: boolean;
  spawnTick: number; lastAttackTick: number;
  buffUntil: Record<AgentId, number>;
};

export type DamageEvent = {
  t: number;
  atkSide: AgentId;
  victimSide: AgentId;
  victimRobot: boolean;
  byRobot: boolean;
  x: number;
  y: number;
};

export type MobaState = {
  overseer?: OverseerState;
  minions: MinionState[];
  structures: StructureState[];
  nextMinionId: number;
  lifetimeGold: Record<AgentId, number>;
  log: MobaEvent[];
  dmg: DamageEvent[];
};
