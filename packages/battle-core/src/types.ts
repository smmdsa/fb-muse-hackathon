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
};

export type Projectile = {
  id: number;
  owner: AgentId;
  pos: Vec2;
  prev: Vec2;
  vel: Vec2;
  alive: boolean;
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

export type BattleConfig = {
  seed: string;
  world: WorldConfig;
  agent: AgentConfig;
};

export type BattleState = {
  tick: number;
  time: number;
  agents: Record<AgentId, AgentState>;
  projectiles: Projectile[];
  nextProjectileId: number;
  over: boolean;
  winner: AgentId | "DRAW" | null;
};
