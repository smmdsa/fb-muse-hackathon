// Policy validator. Unknown input fails closed with named errors.

import type {
  AgentPolicy,
  BehaviorRule,
  MoveIntent,
  Operand,
  Predicate,
} from "./types.ts";

export const ABILITIES = ["AIM", "FIRE", "DASH", "SHIELD"] as const;

export const MAX_RULES = 32;
export const MAX_DEPTH = 4;
export const MAX_NODES = 64;

const MOVES: MoveIntent[] = [
  "APPROACH",
  "RETREAT",
  "KITE",
  "STRAFE",
  "SEEK_COVER",
  "CAPTURE",
  "PUSH",
  "FARM",
  "DEFEND",
];

const OPERANDS: Operand[] = [
  "ownHpPct",
  "energy",
  "distFoe",
  "projectileTti",
  "coverDist",
  "lineOfSight",
  "dashReady",
  "shieldReady",
  "foeLastSeenAge",
  "objectiveDist",
  "timeLeft",
  "edgeDist",
  "ownGold",
  "ownDeaths",
  "gameTime",
  "distFoeTower",
  "foeTowerHpPct",
  "nearFoeMinions",
  "nearAllyMinions",
  "distFoeMinion",
  "foeHpPct",
  "buildValue",
  "slotsFree",
  "structLead",
  "foeAlive",
];

// Buyable item ids. This list mirrors battle-core items.ts.
// behavior-dna cannot import battle-core, so it keeps its own copy.
export const ITEM_IDS: ReadonlySet<string> = new Set([
  "scrap_blade",
  "cloth_weave",
  "worn_treads",
  "overclock_chip",
  "hull_patch",
  "repair_cell",
  "tempered_edge",
  "bulwark_plate",
  "turbo_treads",
  "rapid_cycler",
  "reinforced_hull",
  "siege_breaker",
  "aegis_core",
  "phantom_drive",
  "warlord_frame",
]);

export type Check = { ok: boolean; errors: string[] };

// The gate checks one full policy and names every break.
export function validatePolicy(policy: AgentPolicy): Check {
  const errors: string[] = [];
  if (policy.schemaVersion !== 1 && policy.schemaVersion !== 2) {
    errors.push("schemaVersion must be 1 or 2");
  }
  if (!policy.agentVersionId || typeof policy.agentVersionId !== "string") {
    errors.push("agentVersionId must be a stable non-empty id");
  }
  checkDna(policy, errors);
  checkRules(policy, errors);
  return { ok: errors.length === 0, errors };
}

function checkDna(policy: AgentPolicy, errors: string[]): void {
  const dna = policy.dna;
  if (!dna || typeof dna !== "object") {
    errors.push("dna must hold four traits");
    return;
  }
  for (const key of ["aggression", "evasion", "preferredDistance", "energyConservation"] as const) {
    const v = dna[key];
    if (!Number.isInteger(v) || v < 0 || v > 100) {
      errors.push(`dna.${key} must be an integer from 0 to 100`);
    }
  }
}

function checkRules(policy: AgentPolicy, errors: string[]): void {
  if (!Array.isArray(policy.rules)) {
    errors.push("rules must be an array");
    return;
  }
  if (policy.rules.length === 0) {
    errors.push("rules must hold at least one rule");
  }
  if (policy.rules.length > MAX_RULES) {
    errors.push(`rules hold at most ${MAX_RULES} entries`);
  }
  const seen = new Set<string>();
  for (const rule of policy.rules) {
    checkRule(rule, errors, seen);
  }
}

function checkRule(rule: BehaviorRule, errors: string[], seen: Set<string>): void {
  if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
    errors.push("rule must be an object");
    return;
  }
  const tag = typeof rule.id === "string" ? rule.id : "?";
  if (!rule.id || typeof rule.id !== "string") {
    errors.push("rule id must be a stable non-empty id");
    return;
  }
  if (seen.has(rule.id)) {
    errors.push(`rule id ${tag} repeats`);
  }
  seen.add(rule.id);
  if (!MOVES.includes(rule.move)) {
    errors.push(`rule ${tag} names an unknown move`);
  }
  for (const key of ["fire", "dash", "shield"] as const) {
    if (rule[key] !== undefined && typeof rule[key] !== "boolean") {
      errors.push(`rule ${tag} flag ${key} must be a boolean`);
    }
  }
  if (rule.buy !== undefined) {
    if (typeof rule.buy !== "string" || !ITEM_IDS.has(rule.buy)) {
      errors.push(`rule ${tag} buy names unknown item ${String(rule.buy)}`);
    }
  }
  if (rule.target !== undefined && !["AUTO", "FOE", "MINION", "STRUCTURE", "NONE"].includes(rule.target)) {
    errors.push(`rule ${tag} names an unknown target`);
  }
  const known = new Set(["id", "when", "move", "fire", "dash", "shield", "buy", "target"]);
  for (const key of Object.keys(rule)) {
    if (!known.has(key)) {
      errors.push(`rule ${tag} holds unknown field ${key}`);
    }
  }
  const shape = measure(rule.when);
  if (!shape.valid) {
    errors.push(`rule ${tag} holds an unknown operand or operator`);
    return;
  }
  if (shape.depth > MAX_DEPTH) {
    errors.push(`rule ${tag} exceeds max depth ${MAX_DEPTH}`);
  }
  if (shape.nodes > MAX_NODES) {
    errors.push(`rule ${tag} exceeds max nodes ${MAX_NODES}`);
  }
}

type Shape = { valid: boolean; depth: number; nodes: number };

// The measurer counts depth and nodes and spots unknown leaves.
export function measure(pred: Predicate): Shape {
  if (typeof pred !== "object" || pred === null) {
    return { valid: false, depth: 0, nodes: 1 };
  }
  if ("all" in pred || "any" in pred) {
    const kids = ("all" in pred ? pred.all : pred.any) as unknown;
    if (!Array.isArray(kids) || kids.length === 0) {
      return { valid: false, depth: 0, nodes: 1 };
    }
    let depth = 0;
    let nodes = 1;
    for (const kid of kids) {
      const s = measure(kid as Predicate);
      if (!s.valid) return { valid: false, depth: 0, nodes: 1 };
      depth = Math.max(depth, s.depth);
      nodes += s.nodes;
    }
    return { valid: true, depth: depth + 1, nodes };
  }
  if ("not" in pred) {
    const s = measure((pred as { not: Predicate }).not);
    if (!s.valid) return { valid: false, depth: 0, nodes: 1 };
    return { valid: true, depth: s.depth + 1, nodes: s.nodes + 1 };
  }
  const leaf = pred as { operand?: unknown; op?: unknown; value?: unknown };
  if (
    typeof leaf.operand !== "string" ||
    !OPERANDS.includes(leaf.operand as Operand) ||
    typeof leaf.op !== "string" ||
    !["gt", "gte", "lt", "lte", "eq"].includes(leaf.op) ||
    (typeof leaf.value !== "number" && typeof leaf.value !== "boolean")
  ) {
    return { valid: false, depth: 0, nodes: 1 };
  }
  return { valid: true, depth: 1, nodes: 1 };
}
