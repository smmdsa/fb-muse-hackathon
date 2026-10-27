// Mock compiler. Deterministic keyword drafts. No keys, no network, ever.

import { validatePolicy } from "@agent-wars/behavior-dna";
import type { AgentPolicy, BehaviorRule, DnaTraits } from "@agent-wars/behavior-dna";
import type { BattleTelemetry, CompileRequest, CompileResult, ExplainResult } from "./types.ts";

// The explainer names the top trigger per side. Every word traces to telemetry.
function topChip(chips: Record<string, number>): string {
  let best = "no chip";
  let bestN = -1;
  for (const [id, n] of Object.entries(chips)) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return bestN > 0 ? `${best} (${bestN} triggers)` : "no chip";
}

// The mock explains with a fixed template. No invention, only counts.
export async function explainMock(t: BattleTelemetry): Promise<ExplainResult> {
  const started = Date.now();
  const text = [
    `Winner ${t.winner} in ${t.ticks} ticks (receipt ${t.checksum}).`,
    `Side A leaned on ${topChip(t.chipsA)}; side B leaned on ${topChip(t.chipsB)}.`,
    t.rated ? "The bout moved AP." : "The bout moved no AP.",
  ].join(" ");
  return { provider: "mock", isMock: true, grounded: true, text, latencyMs: Date.now() - started };
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clampTrait(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

// The reader maps prompt words to trait shifts. Unknown words keep 50.
function traitsFor(prompt: string): DnaTraits {
  const p = prompt.toLowerCase();
  let aggression = 50;
  let evasion = 50;
  let preferredDistance = 50;
  let energyConservation = 50;
  if (/attack|aggress|push|rush|brave|kill/.test(p)) aggression += 30;
  if (/defen|evad|dodge|flee|run|careful|safe/.test(p)) { evasion += 30; aggression -= 10; }
  if (/close|near|melee|chase/.test(p)) preferredDistance -= 25;
  if (/far|snipe|range|kite|keep away/.test(p)) preferredDistance += 25;
  if (/save|conserve|energy|efficient|patient/.test(p)) energyConservation += 25;
  if (/dash|waste|spam|reckless/.test(p)) energyConservation -= 20;
  return {
    aggression: clampTrait(aggression),
    evasion: clampTrait(evasion),
    preferredDistance: clampTrait(preferredDistance),
    energyConservation: clampTrait(energyConservation),
  };
}

const RULE_POOL: BehaviorRule[] = [
  { id: "weak-retreat", when: { operand: "ownHpPct", op: "lt", value: 25 }, move: "RETREAT" },
  { id: "far-approach", when: { operand: "distFoe", op: "gt", value: 8 }, move: "APPROACH" },
  { id: "mid-strafe", when: { all: [{ operand: "distFoe", op: "gte", value: 4 }, { operand: "distFoe", op: "lte", value: 10 }] }, move: "STRAFE", fire: true },
  { id: "close-fire", when: { operand: "distFoe", op: "lt", value: 6 }, move: "KITE", fire: true },
  { id: "seek-center", when: { operand: "objectiveDist", op: "gt", value: 6 }, move: "CAPTURE" },
  { id: "hide-behind-cover", when: { operand: "coverDist", op: "lt", value: 3 }, move: "SEEK_COVER" },
  { id: "shield-threat", when: { operand: "projectileTti", op: "lt", value: 0.4 }, move: "STRAFE", shield: true },
  { id: "late-push", when: { operand: "timeLeft", op: "lt", value: 20 }, move: "APPROACH", fire: true, dash: true },
];

// The drafter picks three rules by prompt hash and stamps stable ids.
function draftFor(prompt: string, agentVersionId: string): AgentPolicy {
  const start = hash(prompt) % RULE_POOL.length;
  const rules = [0, 1, 2].map((k) => {
    const src = RULE_POOL[(start + k * 3) % RULE_POOL.length];
    return { ...src, when: JSON.parse(JSON.stringify(src.when)) as BehaviorRule["when"] };
  });
  return {
    schemaVersion: 1,
    agentVersionId,
    dna: traitsFor(prompt),
    rules,
  };
}

// The repairer fixes known breakage once: it trims rules and clamps traits.
export function repairOnce(policy: AgentPolicy): AgentPolicy {
  const dna = { ...policy.dna };
  for (const k of ["aggression", "evasion", "preferredDistance", "energyConservation"] as const) {
    dna[k] = clampTrait(dna[k]);
  }
  return { ...policy, dna, rules: policy.rules.slice(0, 32) };
}

// The compiler drafts, validates, repairs once, and reports honestly.
export async function compileMock(req: CompileRequest): Promise<CompileResult> {
  const started = Date.now();
  const promptTokens = req.prompt.split(/\s+/).filter(Boolean).length;
  const first = draftFor(req.prompt, req.agentVersionId);
  const check = validatePolicy(first);
  if (check.ok) {
    return {
      provider: "mock",
      isMock: true,
      policy: first,
      errors: [],
      repairAttempted: false,
      latencyMs: Date.now() - started,
      promptTokens,
    };
  }
  const fixed = repairOnce(first);
  const recheck = validatePolicy(fixed);
  return {
    provider: "mock",
    isMock: true,
    policy: recheck.ok ? fixed : null,
    errors: recheck.errors,
    repairAttempted: true,
    latencyMs: Date.now() - started,
    promptTokens,
  };
}
