// Rule evaluator. First match wins. No match returns the safe fallback.

import type {
  AgentPolicy,
  BehaviorRule,
  Intents,
  Leaf,
  Observation,
  Predicate,
} from "./types.ts";

export const FALLBACK_RULE_ID = "fallback-safe";

// The safe policy holds the line. It never fires and walks to center.
export function fallback(): Intents {
  return { move: "CAPTURE", fire: false, dash: false, shield: false, ruleId: FALLBACK_RULE_ID };
}

// The evaluator walks rules in order and returns the first match.
export function evaluate(policy: AgentPolicy, obs: Observation): Intents {
  for (const rule of policy.rules) {
    if (test(rule.when, obs)) {
      return toIntents(rule);
    }
  }
  return fallback();
}

function toIntents(rule: BehaviorRule): Intents {
  return {
    move: rule.move,
    fire: rule.fire === true,
    dash: rule.dash === true,
    shield: rule.shield === true,
    ruleId: rule.id,
  };
}

// The tester resolves one predicate. Unknown shapes read as false.
export function test(pred: Predicate, obs: Observation): boolean {
  if (typeof pred !== "object" || pred === null) return false;
  if ("all" in pred) {
    return Array.isArray(pred.all) && pred.all.every((k) => test(k, obs));
  }
  if ("any" in pred) {
    return Array.isArray(pred.any) && pred.any.some((k) => test(k, obs));
  }
  if ("not" in pred) {
    return !test(pred.not, obs);
  }
  return leaf(pred as Leaf, obs);
}

function valueOf(operand: Leaf["operand"], obs: Observation): number | boolean | null {
  switch (operand) {
    case "ownHpPct": return obs.ownHpPct;
    case "energy": return obs.energy;
    case "distFoe": return obs.lineOfSight ? obs.distFoe : null;
    case "projectileTti": return obs.projectileTti;
    case "coverDist": return obs.coverDist;
    case "lineOfSight": return obs.lineOfSight;
    case "dashReady": return obs.dashReady;
    case "shieldReady": return obs.shieldReady;
    case "foeLastSeenAge": return obs.foeLastSeenAge;
    case "objectiveDist": return obs.objectiveDist;
    case "timeLeft": return obs.timeLeft;
    case "edgeDist": return obs.edgeDist;
  }
}

// A null reading fails closed. The leaf reads as false.
function leaf(l: Leaf, obs: Observation): boolean {
  const v = valueOf(l.operand, obs);
  if (v === null || v === undefined) return false;
  if (l.op === "eq") return v === l.value;
  if (typeof v !== "number" || typeof l.value !== "number") return false;
  if (l.op === "gt") return v > l.value;
  if (l.op === "gte") return v >= l.value;
  if (l.op === "lt") return v < l.value;
  return v <= l.value;
}
