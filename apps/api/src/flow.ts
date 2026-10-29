// Engine glue. Pure packages decide. This file persists the results.

import { BENCH_POLICY, DEFAULT_MOBA, fightPolicies } from "@agent-wars/battle-core";
import type { BattleConfig } from "@agent-wars/battle-core";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { validatePolicy } from "@agent-wars/behavior-dna";
import { earnAc, createWallet } from "@agent-wars/economy";
import { applyRanked, createLedger, ratingFor } from "@agent-wars/ranking";
import { rankFor } from "@agent-wars/ranking";
import { buildStandings } from "@agent-wars/leaderboard";
import { explainerFromEnv, hasKey, portraitFromEnv, portraitPromptFor, providerFromEnv } from "@agent-wars/ai-provider";
import { activate, draft, finishMatch, pause, refresh, refundManualMatch, spendManualMatch, startOwnerMatch, DAY_MS, MAX_ATTACK_PER_DAY, REGEN_MS, STAMINA_MAX } from "@agent-wars/autobattle";
import type { Status } from "@agent-wars/autobattle";
import { addEntry, createEvent, lock, register as registerEntry, reportGame, seedBracket, transition as transitionEvent } from "@agent-wars/tournaments";
import type { EventPhase } from "@agent-wars/tournaments";
import type { Championship } from "@agent-wars/tournaments";
import { CATALOG } from "@agent-wars/economy";
import { pickBot } from "@agent-wars/battle-core";
import { MAX_DEFENSE_PER_DAY, recordDefense } from "@agent-wars/autobattle";
import { pickOpponent } from "@agent-wars/matchmaker";
import type { Candidate, History } from "@agent-wars/matchmaker";
import type { Store } from "./store.ts";
import { mintId } from "./store.ts";

export type FlowEnv = {
  META_SPARK_KEY?: string;
  META_IMAGE_KEY?: string;
  META_API_KEY?: string;
  META_API_BASE?: string;
  AGENT_WARS_MODEL_COMPILE?: string;
  AGENT_WARS_MODEL_PORTRAIT?: string;
};

export function getLeader(store: Store, token: string): Record<string, unknown> | null {
  return store.db.prepare("SELECT * FROM leaders WHERE token = ?").get(token) as Record<string, unknown> | null;
}

export function getVersion(store: Store, versionId: string): { policy: AgentPolicy; agentId: string } | null {
  const row = store.db.prepare("SELECT * FROM versions WHERE id = ?").get(versionId) as Record<string, unknown> | null;
  if (!row) return null;
  return { policy: JSON.parse(row.policy_json as string) as AgentPolicy, agentId: row.agent_id as string };
}

// New fights run MOBA. Old rows without a mode read as duel.
export type MatchMode = "duel" | "moba";

export function matchMode(row: Record<string, unknown>): MatchMode {
  return row.mode === "moba" ? "moba" : "duel";
}

// The helper maps a stored mode to its sim config. Duel passes
// undefined, so the sim keeps its byte-identical duel defaults.
export function battleConfigFor(mode: MatchMode): BattleConfig | undefined {
  return mode === "moba" ? DEFAULT_MOBA : undefined;
}

// Training settles nothing. It returns the receipt only.
export function runTraining(
  store: Store,
  input: { versionId: string; seed: string },
): { matchId: string; winner: string; ticks: number; checksum: string; mode: MatchMode } {
  const found = getVersion(store, input.versionId);
  if (!found) throw new Error("unknown version");
  const out = fightPolicies(found.policy, BENCH_POLICY, input.seed, DEFAULT_MOBA);
  const id = mintId("m");
  store.db.prepare(
    "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json, mode) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'moba')",
  ).run(id, input.seed, input.versionId, "benchmark-v1", out.winner, out.ticks, out.checksum, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB }));
  return { matchId: id, ...out, mode: "moba" };
}

// Ranked pre-checks. The route spends energy only after this passes.
export function validateRanked(
  store: Store,
  input: { aVersionId: string; bVersionId: string },
): void {
  const a = getVersion(store, input.aVersionId);
  const b = getVersion(store, input.bVersionId);
  if (!a || !b) throw new Error("unknown version");
  const aAgent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(a.agentId) as Record<string, unknown>;
  const bAgent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(b.agentId) as Record<string, unknown>;
  if (!aAgent || !bAgent) throw new Error("unknown agent");
  if (aAgent.leader_id === bAgent.leader_id) throw new Error("self match denied");
}

// Ranked settles AP and AC for both leaders. One key counts once.
export function runRanked(
  store: Store,
  input: { aVersionId: string; bVersionId: string; seed: string; key: string },
): Record<string, unknown> {
  const dup = store.db.prepare("SELECT * FROM matches WHERE id = ?").get(input.key) as Record<string, unknown> | null;
  if (dup) return settledResult(store, dup);
  const a = getVersion(store, input.aVersionId);
  const b = getVersion(store, input.bVersionId);
  if (!a || !b) throw new Error("unknown version");
  const aAgent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(a.agentId) as Record<string, unknown>;
  const bAgent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(b.agentId) as Record<string, unknown>;
  if (aAgent.leader_id === bAgent.leader_id) throw new Error("self match denied");
  const out = fightPolicies(a.policy, b.policy, input.seed, DEFAULT_MOBA);
  const winner = out.winner === "DRAW" ? "DRAW" : out.winner;
  let applied = { deltaA: 0, deltaB: 0 };
  let paidA = 0;
  let paidB = 0;
  const settle = (): void => {
  const ledger = createLedger("local-s1");
  for (const row of store.db.prepare("SELECT * FROM leaders").all() as Record<string, unknown>[]) {
    const r = ratingFor(ledger, row.id as string);
    r.ratingMilli = row.rating_milli as number;
    r.placementGames = row.placement as number;
    r.placed = (row.placed as number) === 1;
  }
  const res = applyRanked(ledger, {
    matchId: input.key,
    leaderA: aAgent.leader_id as string,
    leaderB: bAgent.leader_id as string,
    winner: winner as "A" | "B" | "DRAW",
    rated: true,
  });
  applied = { deltaA: res.deltaA, deltaB: res.deltaB };
  for (const [id, st] of ledger.ratings) {
    store.db.prepare("UPDATE leaders SET rating_milli = ?, ap = ?, placement = ?, placed = ? WHERE id = ?").run(
      st.ratingMilli, st.ap, st.placementGames, st.placed ? 1 : 0, id,
    );
  }
  paidA = creditAc(store, aAgent.leader_id as string, input.key, "a", winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest");
  paidB = creditAc(store, bAgent.leader_id as string, input.key, "b", winner === "B" ? "win" : winner === "A" ? "loss" : "no-contest");
  store.db.prepare(
    "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, delta_a, delta_b, paid_a, paid_b, created_at, chips_json, mode) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'moba')",
  ).run(input.key, input.seed, input.aVersionId, input.bVersionId, winner, out.ticks, out.checksum, applied.deltaA, applied.deltaB, paidA, paidB, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB }));
  };
  try {
    transact(store, settle);
  } catch (err) {
    const dupe = store.db.prepare("SELECT * FROM matches WHERE id = ?").get(input.key) as Record<string, unknown> | null;
    if (dupe && /constraint|UNIQUE|PRIMARY/i.test((err as Error).message)) return settledResult(store, dupe);
    throw err;
  }
  return { matchId: input.key, winner, ticks: out.ticks, checksum: out.checksum, deltaA: applied.deltaA, deltaB: applied.deltaB, paidA, paidB, mode: "moba" };
}

// A settled row replays as the original result shape, never the raw row.
function settledResult(store: Store, row: Record<string, unknown>): Record<string, unknown> {
  const credited = (side: string): number => {
    const r = store.db.prepare("SELECT SUM(delta) AS total FROM wallet_txns WHERE idem_key = ?").get(`${row.id}-${side}`) as Record<string, unknown> | null;
    return (r?.total as number) ?? 0;
  };
  return {
    matchId: row.id,
    winner: row.winner,
    ticks: row.ticks,
    checksum: row.checksum,
    deltaA: row.delta_a,
    deltaB: row.delta_b,
    paidA: credited("a"),
    paidB: credited("b"),
    mode: matchMode(row),
    deduped: true,
  };
}

// One transaction. BEGIN IMMEDIATE serializes concurrent settlers on the
// same key; the second blocks, hits the primary key, and dedupes below.
export function transact(store: Store, fn: () => void): void {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    store.db.exec("COMMIT");
  } catch (err) {
    try {
      store.db.exec("ROLLBACK");
    } catch {
      // The rollback itself failed; surface the original error.
    }
    throw err;
  }
}

// One AC credit. Idempotent per match key and side; the daily cap lives in the ledger.
export function creditAc(
  store: Store,
  leaderId: string,
  matchKey: string,
  side: string,
  kind: "win" | "loss" | "no-contest",
): number {
  const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown>;
  const wallet = createWallet(leaderId, 0);
  wallet.ac = row.ac as number;
  wallet.rp = row.rp as number;
  for (const k of store.db.prepare("SELECT key FROM wallet_keys WHERE wallet_id = ?").all(leaderId) as { key: string }[]) {
    wallet.keys.add(k.key);
  }
  const before = wallet.txns.length;
  const res = earnAc(wallet, { key: `${matchKey}-${side}`, kind, suspicious: false, now: Date.now() });
  store.db.prepare("INSERT OR IGNORE INTO wallet_keys (wallet_id, key) VALUES (?, ?)").run(leaderId, `${matchKey}-${side}`);
  for (const t of wallet.txns.slice(before)) {
    store.db.prepare("INSERT INTO wallet_txns (wallet_id, idem_key, currency, delta, reason, at) VALUES (?, ?, ?, ?, ?, ?)").run(
      leaderId, t.idempotencyKey, t.currency, t.delta, t.reason, t.at,
    );
  }
  store.db.prepare("UPDATE leaders SET ac = ?, rp = ? WHERE id = ?").run(wallet.ac, wallet.rp, leaderId);
  return res.credited;
}

// The board lists placed leaders for the local season.
export function board(store: Store, limit = 100): unknown[] {
  const rows = store.db.prepare("SELECT * FROM leaders").all() as Record<string, unknown>[];
  const agents = store.db.prepare("SELECT leader_id, name FROM agents").all() as Record<string, unknown>[];
  const names = new Map(agents.map((a) => [a.leader_id as string, a.name as string | null]));
  const handles = new Map(rows.map((r) => [r.id as string, r.handle as string]));
  return buildStandings(
    "local-s1",
    rows.map((r) => ({
      leaderId: r.id as string,
      seasonId: "local-s1",
      ratingMilli: r.rating_milli as number,
      ap: r.ap as number,
      placementGames: r.placement as number,
      placed: (r.placed as number) === 1,
      rankTier: rankFor(r.ap as number).tier,
      division: rankFor(r.ap as number).division,
    })),
    limit,
  ).map((s) => ({ ...s, handle: handles.get(s.leaderId) ?? null, agentName: names.get(s.leaderId) ?? null }));
}

// Breeding creates the hero row. With an image key it also paints the portrait
// in the locked house style. Without one the hero fights faceless, honestly.
export async function createAgent(
  store: Store,
  env: FlowEnv,
  input: { leaderId: string; name: string; concept: string },
): Promise<{ agentId: string; portraitUrl: string | null; portraitStatus: string; error: string | null }> {
  const id = mintId("agent");
  // The hero always records how breeding ended: ready, failed, or faceless.
  // Faceless means no key existed; failed means the image call dropped.
  // The reason travels with the reply so a failed paint can be diagnosed.
  let portraitUrl: string | null = null;
  let portraitStatus = "faceless";
  let error: string | null = "portraits need META_IMAGE_KEY; set the secret first";
  if (hasKey("portrait", env)) {
    try {
      const art = await portraitFromEnv(env).generatePortrait({
        prompt: portraitPromptFor(`${input.name || "arena robot"}: ${input.concept || "arena fighter"}`),
      });
      portraitUrl = art.url;
      portraitStatus = "ready";
      error = null;
    } catch (err) {
      portraitUrl = null;
      portraitStatus = "failed";
      error = err instanceof Error ? err.message : "unknown image error";
    }
  }
  store.db.prepare("INSERT INTO agents (id, leader_id, active_version_id, name, concept, portrait_url, portrait_status) VALUES (?, ?, NULL, ?, ?, ?, ?)").run(
    id, input.leaderId, input.name || null, input.concept || null, portraitUrl, portraitStatus,
  );
  return { agentId: id, portraitUrl, portraitStatus, error };
}

// Analysis explains one stored bout from its own telemetry. The model
// may phrase it, but the numbers come from the row, never the model.
export async function analyzeBattle(
  store: Store,
  env: FlowEnv,
  input: { matchId: string },
): Promise<Record<string, unknown>> {
  const row = store.db.prepare("SELECT * FROM matches WHERE id = ?").get(input.matchId) as Record<string, unknown> | null;
  if (!row) throw new Error("unknown match");
  const chips = JSON.parse((row.chips_json as string) ?? '{"a":{},"b":{}}') as { a: Record<string, number>; b: Record<string, number> };
  const telemetry = {
    matchId: row.id as string,
    winner: row.winner as string,
    ticks: row.ticks as number,
    checksum: row.checksum as string,
    seed: row.seed as string,
    rated: (row.rated as number) === 1,
    chipsA: chips.a ?? {},
    chipsB: chips.b ?? {},
  };
  const explanation = await explainerFromEnv(env).explainBattle(telemetry);
  return { ...telemetry, explanation };
}

// The Evolution Lab runs an honest A/B: both drafts fight the same benchmark
// on mirrored seeds. Small samples refuse a verdict. Drafts stay drafts.
export async function evolutionLab(
  store: Store,
  env: FlowEnv,
  input: { leaderId: string; agentId: string; promptA: string; promptB: string; bouts?: number },
): Promise<Record<string, unknown>> {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent || agent.leader_id !== input.leaderId) throw new Error("agent not found for this leader");
  const promptA = input.promptA.trim();
  const promptB = input.promptB.trim();
  if (!promptA || !promptB) throw new Error("two prompts are required");
  if (promptA.length > MAX_PROMPT || promptB.length > MAX_PROMPT) {
    throw new Error(`each prompt must stay under ${MAX_PROMPT} characters`);
  }
  const bouts = Math.min(20, Math.max(4, Math.floor(input.bouts ?? 10)));
  const runId = mintId("lab");
  const draftA = await compileAndPublish(store, env, { agentId: input.agentId, prompt: promptA });
  const draftB = await compileAndPublish(store, env, { agentId: input.agentId, prompt: promptB });
  if (!draftA.versionId) throw new Error(`draft A failed: ${draftA.errors.join("; ")}`);
  if (!draftB.versionId) throw new Error(`draft B failed: ${draftB.errors.join("; ")}`);
  const policyA = getVersion(store, draftA.versionId);
  const policyB = getVersion(store, draftB.versionId);
  if (!policyA || !policyB) throw new Error("drafts vanished");
  let winsA = 0;
  let winsB = 0;
  let drawsA = 0;
  let drawsB = 0;
  const now = Date.now();
  for (let i = 0; i < bouts; i += 1) {
    // The lab keeps the duel sim. Its bouts stay small and fast.
    const outA = fightPolicies(policyA.policy, BENCH_POLICY, `${runId}-a-${i}`);
    const idA = `${runId}-a-${i}`;
    store.db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json, mode) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'duel')",
    ).run(idA, `${runId}-a-${i}`, draftA.versionId, "benchmark-v1", outA.winner, outA.ticks, outA.checksum, now, JSON.stringify({ a: outA.chipsA, b: outA.chipsB }));
    if (outA.winner === "A") winsA += 1;
    else if (outA.winner === "DRAW") drawsA += 1;
    const outB = fightPolicies(policyB.policy, BENCH_POLICY, `${runId}-b-${i}`);
    const idB = `${runId}-b-${i}`;
    store.db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, created_at, chips_json, mode) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'duel')",
    ).run(idB, `${runId}-b-${i}`, draftB.versionId, "benchmark-v1", outB.winner, outB.ticks, outB.checksum, now, JSON.stringify({ a: outB.chipsA, b: outB.chipsB }));
    if (outB.winner === "A") winsB += 1;
    else if (outB.winner === "DRAW") drawsB += 1;
  }
  const decisive = winsA + winsB;
  let verdict = "too close to call";
  if (bouts < 10) {
    verdict = "sample too small — run 10 or more bouts before trusting the gap";
  } else if (decisive > 0 && Math.max(winsA, winsB) / decisive >= 0.7) {
    verdict = winsA > winsB ? "A leads" : "B leads";
  }
  return { runId, versionA: draftA.versionId, versionB: draftB.versionId, bouts, winsA, winsB, drawsA, drawsB, verdict };
}

// A retry repaints one hero. It never breeds a second agent.
// A ready portrait returns untouched, with no new model call.
export async function retryPortrait(
  store: Store,
  env: FlowEnv,
  input: { agentId: string; leaderId: string },
): Promise<{ portraitUrl: string | null; portraitStatus: string; retried: boolean; error: string | null }> {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent || agent.leader_id !== input.leaderId) throw new Error("agent not found for this leader");
  if (agent.portrait_status === "ready" && agent.portrait_url) {
    return { portraitUrl: agent.portrait_url as string, portraitStatus: "ready", retried: false, error: null };
  }
  let portraitUrl: string | null = null;
  let portraitStatus = "faceless";
  let error: string | null = "portraits need META_IMAGE_KEY; set the secret first";
  if (hasKey("portrait", env)) {
    try {
      const art = await portraitFromEnv(env).generatePortrait({
        prompt: portraitPromptFor(`${(agent.name as string) || "arena robot"}: ${(agent.concept as string) || "arena fighter"}`),
      });
      portraitUrl = art.url;
      portraitStatus = "ready";
      error = null;
    } catch (err) {
      portraitUrl = null;
      portraitStatus = "failed";
      error = err instanceof Error ? err.message : "unknown image error";
    }
  }
  store.db.prepare("UPDATE agents SET portrait_url = ?, portrait_status = ? WHERE id = ?").run(portraitUrl, portraitStatus, input.agentId);
  return { portraitUrl, portraitStatus, retried: true, error };
}

// Compile saves a draft. Nothing activates until the player installs it.
// Briefs run long on purpose: paragraphs decide fights. The cap bounds
// model spend, never expression.
export const MAX_PROMPT = 2000;

export async function compileAndPublish(
  store: Store,
  env: FlowEnv,
  input: { agentId: string; prompt: string },
): Promise<{ versionId: string; errors: string[]; provider: string; isMock: boolean; tokens: number; latencyMs: number }> {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent) throw new Error("unknown agent");
  const brief = input.prompt.trim();
  if (brief.length > MAX_PROMPT) {
    return { versionId: "", errors: [`prompt must stay under ${MAX_PROMPT} characters`], provider: "mock", isMock: true, tokens: 0, latencyMs: 0 };
  }
  const versionId = mintId("v");
  const compiled = await providerFromEnv(env).compileStrategy({ prompt: brief, agentVersionId: versionId });
  // Every draft carries its spend, mock or Meta: the audit never goes blind.
  const spent = { tokens: compiled.promptTokens, latencyMs: compiled.latencyMs };
  if (!compiled.policy) return { versionId: "", errors: compiled.errors, provider: compiled.provider, isMock: compiled.isMock, ...spent };
  const check = validatePolicy(compiled.policy);
  if (!check.ok) return { versionId: "", errors: check.errors, provider: compiled.provider, isMock: compiled.isMock, ...spent };
  const crypto = await import("node:crypto");
  const sha = crypto.createHash("sha256").update(JSON.stringify(compiled.policy)).digest("hex");
  store.db.prepare("INSERT INTO versions (id, agent_id, policy_json, sha, created_at, provider, is_mock, tokens, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    versionId, input.agentId, JSON.stringify(compiled.policy), sha, Date.now(), compiled.provider, compiled.isMock ? 1 : 0,
    compiled.promptTokens, compiled.latencyMs,
  );
  return { versionId, errors: [], provider: compiled.provider, isMock: compiled.isMock, ...spent };
}

// Delete removes one draft. The active version stays, and history stays:
// a version with fights, or a seat in any event, refuses deletion.
export function deleteVersion(
  store: Store,
  input: { leaderId: string; agentId: string; versionId: string },
): { deleted: boolean } {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent || agent.leader_id !== input.leaderId) throw new Error("agent not found for this leader");
  // Read the row raw: a corrupt draft must stay deletable, never parse-gated.
  const version = store.db.prepare("SELECT * FROM versions WHERE id = ?").get(input.versionId) as Record<string, unknown> | null;
  if (!version || version.agent_id !== input.agentId) throw new Error("unknown version for this agent");
  if (agent.active_version_id === input.versionId) throw new Error("the active version fights on: install another first");
  const fights = store.db.prepare("SELECT id FROM matches WHERE a_version = ? OR b_version = ? LIMIT 1").get(input.versionId, input.versionId);
  if (fights) throw new Error("this version has fights: history keeps it");
  const seated = store.db.prepare("SELECT id FROM tournaments WHERE event_json LIKE ? LIMIT 1").get(`%${input.versionId}%`);
  if (seated) throw new Error("this version holds an event seat: it stays registered");
  store.db.prepare("DELETE FROM versions WHERE id = ?").run(input.versionId);
  return { deleted: true };
}

// Labels name drafts whatever the owner wants. Empty clears back to the id.
export function renameVersion(
  store: Store,
  input: { leaderId: string; agentId: string; versionId: string; label: string },
): { versionId: string; label: string | null } {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent || agent.leader_id !== input.leaderId) throw new Error("agent not found for this leader");
  const version = store.db.prepare("SELECT * FROM versions WHERE id = ?").get(input.versionId) as Record<string, unknown> | null;
  if (!version || version.agent_id !== input.agentId) throw new Error("unknown version for this agent");
  const label = input.label.trim().slice(0, 60);
  store.db.prepare("UPDATE versions SET label = ? WHERE id = ?").run(label || null, input.versionId);
  return { versionId: input.versionId, label: label || null };
}

// Force removes a version with fights. Match rows stay in the ledger,
// but their replays report unavailable once the policy is gone. Seats in
// live brackets stay sacred: force never breaks another player's cup.
const LIVE_PHASES = ["REGISTRATION_OPEN", "LOCKED", "SEEDED", "LIVE"];

export function forceDeleteVersion(
  store: Store,
  input: { leaderId: string; agentId: string; versionId: string },
): { deleted: boolean; clearedActive: boolean } {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent || agent.leader_id !== input.leaderId) throw new Error("agent not found for this leader");
  const version = store.db.prepare("SELECT * FROM versions WHERE id = ?").get(input.versionId) as Record<string, unknown> | null;
  if (!version || version.agent_id !== input.agentId) throw new Error("unknown version for this agent");
  const seats = store.db.prepare("SELECT event_json FROM tournaments WHERE event_json LIKE ?").all(`%${input.versionId}%`) as Record<string, unknown>[];
  for (const s of seats) {
    try {
      const phase = (JSON.parse(s.event_json as string) as { phase: string }).phase;
      if (LIVE_PHASES.includes(phase)) throw new Error("this version holds a live event seat: it stays registered");
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("this version holds")) throw err;
    }
  }
  store.db.prepare("DELETE FROM versions WHERE id = ?").run(input.versionId);
  let clearedActive = false;
  if (agent.active_version_id === input.versionId) {
    store.db.prepare("UPDATE agents SET active_version_id = NULL WHERE id = ?").run(input.agentId);
    clearedActive = true;
  }
  return { deleted: true, clearedActive };
}

// Install names the fighting version. Drafts stay inert until this runs.
export function installVersion(
  store: Store,
  input: { leaderId: string; agentId: string; versionId: string },
): { activeVersionId: string } {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(input.agentId) as Record<string, unknown> | null;
  if (!agent || agent.leader_id !== input.leaderId) throw new Error("agent not found for this leader");
  const version = getVersion(store, input.versionId);
  if (!version || version.agentId !== input.agentId) throw new Error("unknown version for this agent");
  store.db.prepare("UPDATE agents SET active_version_id = ? WHERE id = ?").run(input.versionId, input.agentId);
  return { activeVersionId: input.versionId };
}

// Energy reads the persisted machine, refreshes regen, and saves it back.
// The machine is the single source: stamina, caps, and next recharge.
export function energyFor(store: Store, leaderId: string, now = Date.now()): Status {
  const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown> | null;
  if (!row) throw new Error("unknown leader");
  const agent = store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(leaderId) as Record<string, unknown> | null;
  let st: Status = row.autobattle_json ? (JSON.parse(row.autobattle_json as string) as Status) : draft(leaderId, now);
  st = { ...st, leaderId, published: !!agent?.active_version_id };
  st = refresh(st, now);
  store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(st), leaderId);
  return st;
}

export function energyView(st: Status, now = Date.now()): { energy: number; energyMax: number; nextRegenMs: number } {
  const nextRegenMs = st.stamina >= st.staminaMax ? 0 : Math.max(0, st.lastStaminaAt + REGEN_MS - now);
  return { energy: st.stamina, energyMax: st.staminaMax ?? STAMINA_MAX, nextRegenMs };
}

// A canceled or expired ticket returns its charge. Settled fights keep it.
export function refundEnergy(store: Store, leaderId: string, now = Date.now()): Status {
  const cur = energyFor(store, leaderId, now);
  const next = refundManualMatch(cur, now);
  store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(next), leaderId);
  return next;
}

// A manual match spends one charge. Training never calls this function.
export function spendEnergy(store: Store, leaderId: string, now = Date.now()): { ok: boolean; reason?: string; status: Status } {
  const cur = energyFor(store, leaderId, now);
  const r = spendManualMatch(cur, now);
  store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(r.status), leaderId);
  return r.guard.ok ? { ok: true, status: r.status } : { ok: false, reason: (r.guard as { reason: string }).reason, status: r.status };
}

// The dashboard shows one hero: portrait, ELO, every version with its chips,
// and each chip with its trigger totals across all fights of that version.
// Recent fights for one hero, newest first. Replay links included.
export function fightHistory(store: Store, versionIds: string[]): Record<string, unknown>[] {
  if (!versionIds.length) return [];
  const marks = versionIds.map(() => "?").join(",");
  const rows = store.db.prepare(
    `SELECT * FROM matches WHERE a_version IN (${marks}) OR b_version IN (${marks}) ORDER BY created_at DESC LIMIT 20`,
  ).all(...versionIds, ...versionIds) as Record<string, unknown>[];
  const owned = new Set(versionIds);
  return rows.map((m) => {
    const mine = owned.has(m.a_version as string) ? "a" : "b";
    return {
      matchId: m.id,
      seed: m.seed,
      winner: m.winner,
      ticks: m.ticks,
      checksum: m.checksum,
      rated: m.rated,
      mode: matchMode(m),
      myDelta: mine === "a" ? m.delta_a : m.delta_b,
      myPaid: mine === "a" ? m.paid_a : m.paid_b,
      foe: mine === "a" ? m.b_version : m.a_version,
      at: m.created_at,
      replay: `/v1/matches/${m.id}/replay`,
    };
  });
}

export function dashboard(store: Store, agentId: string, leaderId: string): Record<string, unknown> {
  const agent = store.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as Record<string, unknown> | null;
  if (!agent || agent.leader_id !== leaderId) throw new Error("agent not found for this leader");
  const leader = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown>;
  const rank = rankFor(leader.ap as number);
  const versionRows = store.db.prepare("SELECT * FROM versions WHERE agent_id = ? ORDER BY created_at").all(agentId) as Record<string, unknown>[];
  // One unreadable draft never blanks the dashboard. It shows flagged,
  // and the owner can delete it from the same card.
  const versions = versionRows.map((v) => {
    const fights = store.db.prepare("SELECT * FROM matches WHERE a_version = ? OR b_version = ?").all(v.id, v.id) as Record<string, unknown>[];
    let policy: { dna: Record<string, number>; rules: { id: string; move: string; fire?: boolean; when: unknown }[] } | null = null;
    try {
      policy = JSON.parse(v.policy_json as string) as { dna: Record<string, number>; rules: { id: string; move: string; fire?: boolean; when: unknown }[] };
      if (!policy || !Array.isArray(policy.rules)) policy = null;
    } catch {
      policy = null;
    }
    if (!policy) {
      return {
        versionId: v.id,
        provider: v.provider ?? "mock",
        isMock: (v.is_mock ?? 1) === 1,
        createdAt: v.created_at,
        corrupt: true,
        label: (v.label as string) ?? null,
        chips: [],
        dna: null,
        fights: fights.length,
        wins: 0,
        winRate: 0,
        avgTicks: 0,
      };
    }
    const triggers: Record<string, number> = {};
    let wins = 0;
    let ticks = 0;
    for (const f of fights) {
      const side = f.a_version === v.id ? "a" : "b";
      if ((side === "a" && f.winner === "A") || (side === "b" && f.winner === "B")) wins += 1;
      ticks += f.ticks as number;
      try {
        const chips = JSON.parse((f.chips_json as string) || "{}") as Record<string, Record<string, number>>;
        for (const [chip, n] of Object.entries(chips[side] ?? {})) {
          triggers[chip] = (triggers[chip] ?? 0) + (n as number);
        }
      } catch {
        continue;
      }
    }
    return {
      versionId: v.id,
      provider: v.provider ?? "mock",
      isMock: (v.is_mock ?? 1) === 1,
      createdAt: v.created_at,
      corrupt: false,
      label: (v.label as string) ?? null,
      chips: policy.rules.map((r) => ({ id: r.id, move: r.move, fire: r.fire === true, when: r.when ?? null, triggers: triggers[r.id] ?? 0 })),
      dna: policy.dna,
      fights: fights.length,
      wins,
      winRate: fights.length ? wins / fights.length : 0,
      avgTicks: fights.length ? Math.round(ticks / fights.length) : 0,
    };
  });
  return {
    agent: { id: agent.id, name: agent.name ?? null, concept: agent.concept ?? null, portraitUrl: agent.portrait_url ?? null, portraitStatus: agent.portrait_status ?? "faceless", activeVersionId: agent.active_version_id ?? null },
    leader: { handle: leader.handle, ap: leader.ap, ac: leader.ac, tier: rank.tier, division: rank.division },
    energy: energyView(energyFor(store, leaderId)),
    versions,
    history: fightHistory(store, versionRows.map((v) => v.id as string)),
    ftue: ftueStatus(store, leaderId).stages,
  };
}

export const BOT_SETTLE_MS = 30_000;
export const RANKED_TICKET_MS = 10 * 60_000;

export type TicketMode = "casual" | "ranked";

// Nearest ELO human with a published version. Never self, never over the pair cap.
export function findHumanOpponent(
  store: Store,
  leaderId: string,
  now: number,
): { leaderId: string; versionId: string; ap: number } | null {
  const me = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown> | null;
  if (!me) return null;
  const rows = store.db.prepare(
    `SELECT m.created_at AS at, aa.leader_id AS a, ab.leader_id AS b FROM matches m
     JOIN versions va ON va.id = m.a_version JOIN agents aa ON aa.id = va.agent_id
     JOIN versions vb ON vb.id = m.b_version JOIN agents ab ON ab.id = vb.agent_id
     WHERE m.rated = 1`
  ).all() as Record<string, unknown>[];
  const history: History = { marks: rows.map((m) => ({ a: m.a as string, b: m.b as string, at: m.at as number })) };
  const seeker = store.db.prepare("SELECT rating_milli FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown>;
  const seekers: Candidate = {
    leaderId,
    ratingMilli: seeker.rating_milli as number,
    optIn: true,
    published: true,
    leaseExpiresAt: now + 1,
  };
  const agents = store.db.prepare("SELECT * FROM agents WHERE active_version_id IS NOT NULL").all() as Record<string, unknown>[];
  const pool: Candidate[] = [];
  for (const a of agents) {
    const other = a.leader_id as string;
    if (other === leaderId) continue;
    const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(other) as Record<string, unknown> | null;
    if (!row) continue;
    const st: Record<string, unknown> = row.autobattle_json ? JSON.parse(row.autobattle_json as string) : {};
    const defenses = Array.isArray(st.defenseAt) ? (st.defenseAt as number[]).length : 0;
    if (defenses >= MAX_DEFENSE_PER_DAY) continue;
    pool.push({
      leaderId: other,
      ratingMilli: row.rating_milli as number,
      optIn: st.optIn === true,
      published: true,
      leaseExpiresAt: typeof st.leaseExpiresAt === "number" ? (st.leaseExpiresAt as number) : null,
    });
  }
  const foe = pickOpponent(history, seekers, pool, now);
  if (!foe) return null;
  // The picked foe takes one defense stamp. Caps turn later foes away.
  const stamped = recordDefense(energyFor(store, foe.leaderId, now), now);
  store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(stamped.status), foe.leaderId);
  const picked = store.db.prepare("SELECT ap FROM leaders WHERE id = ?").get(foe.leaderId) as Record<string, unknown>;
  const agent = store.db.prepare("SELECT active_version_id FROM agents WHERE leader_id = ?").get(foe.leaderId) as Record<string, unknown>;
  return { leaderId: foe.leaderId, versionId: agent.active_version_id as string, ap: picked.ap as number };
}

// Casual unrated fight: no AP moves, AC still pays the human side.
export function runCasual(
  store: Store,
  input: { aVersionId: string; bVersionId?: string; bBot?: string; seed: string; leaderId: string },
): { matchId: string; winner: string; ticks: number; checksum: string; foe: string; bot: boolean; paid: number; mode: MatchMode } {
  const found = getVersion(store, input.aVersionId);
  if (!found) throw new Error("unknown version");
  const bot = input.bBot ? pickBotFor(store, input.leaderId) : null;
  const foeLabel = input.bVersionId ?? (bot ? bot.id : "");
  if (!input.bVersionId && !bot) throw new Error("no opponent");
  const foePolicy = input.bVersionId
    ? (getVersion(store, input.bVersionId)?.policy ?? null)
    : (bot?.policy ?? null);
  if (!foePolicy) throw new Error("unknown foe version");
  const out = fightPolicies(found.policy, foePolicy, input.seed, DEFAULT_MOBA);
  const id = mintId("m");
  const winner = out.winner === "DRAW" ? "DRAW" : out.winner;
  // One write block: the match row and the wallet credit land together.
  let paid = 0;
  transact(store, () => {
    paid = creditAc(store, input.leaderId, id, "a", winner === "A" ? "win" : winner === "B" ? "loss" : "no-contest");
    store.db.prepare(
      "INSERT INTO matches (id, seed, a_version, b_version, winner, ticks, checksum, rated, paid_a, paid_b, created_at, chips_json, mode) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, 'moba')"
    ).run(id, input.seed, input.aVersionId, foeLabel, out.winner, out.ticks, out.checksum, paid, Date.now(), JSON.stringify({ a: out.chipsA, b: out.chipsB }));
  });
  return { matchId: id, winner, ticks: out.ticks, checksum: out.checksum, foe: foeLabel, bot: !!bot, paid, mode: "moba" };
}

function pickBotFor(store: Store, leaderId: string): { id: string; policy: import("@agent-wars/behavior-dna").AgentPolicy } {
  const row = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown> | null;
  const bot = pickBot((row?.ap as number) ?? 500);
  return { id: bot.id, policy: bot.policy };
}

function settleTicket(store: Store, ticket: Record<string, unknown>, foeVersion: string | null, now: number): Record<string, unknown> {
  const mode = ticket.mode as TicketMode;
  let matchId: string;
  let foeLabel = foeVersion ?? "";
  if (mode === "ranked" && foeVersion) {
    const settled = runRanked(store, {
      aVersionId: ticket.version_id as string,
      bVersionId: foeVersion,
      seed: `q-${ticket.id}`,
      key: ticket.id as string,
    });
    matchId = settled.matchId as string;
  } else {
    const bot = foeVersion ? null : true;
    const settled = runCasual(store, {
      aVersionId: ticket.version_id as string,
      bVersionId: foeVersion ?? undefined,
      bBot: bot ? "1" : undefined,
      seed: `q-${ticket.id}`,
      leaderId: ticket.leader_id as string,
    });
    matchId = settled.matchId;
    foeLabel = settled.foe;
  }
  store.db.prepare("UPDATE tickets SET status = 'settled', foe_version = ?, match_id = ? WHERE id = ?").run(
    foeLabel, matchId, ticket.id,
  );
  return { ...(store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id) as Record<string, unknown>) };
}

// The queue spends one energy at request time. Humans settle at once;
// casual falls back to a same-band bot after 30 seconds, ranked waits.
export function requestMatch(
  store: Store,
  input: { leaderId: string; versionId: string; mode: TicketMode },
  now = Date.now(),
): Record<string, unknown> {
  if (input.mode !== "casual" && input.mode !== "ranked") throw new Error("unknown mode");
  const owned = store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(input.leaderId) as Record<string, unknown> | null;
  const version = getVersion(store, input.versionId);
  if (!version || !owned || version.agentId !== owned.id) throw new Error("unknown version");
  if ((owned.active_version_id as string) !== input.versionId) throw new Error("queue your active version");
  const open = store.db.prepare("SELECT * FROM tickets WHERE leader_id = ? AND mode = ? AND status = 'queued'").get(input.leaderId, input.mode);
  if (open) throw new Error("ticket already open for this mode");
  const spent = spendEnergy(store, input.leaderId, now);
  if (!spent.ok) throw new Error((spent as { reason: string }).reason);
  const id = mintId("t");
  const wait = input.mode === "casual" ? BOT_SETTLE_MS : RANKED_TICKET_MS;
  store.db.prepare("INSERT INTO tickets (id, leader_id, version_id, mode, status, created_at, settle_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)").run(
    id, input.leaderId, input.versionId, input.mode, now, now + wait,
  );
  const foe = findHumanOpponent(store, input.leaderId, now);
  if (foe) {
    const row = store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as Record<string, unknown>;
    return settleTicket(store, row, foe.versionId, now);
  }
  return store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as Record<string, unknown>;
}

// Lazy settle on read. No cron: the next poll after the deadline settles.
export function readTicket(
  store: Store,
  input: { ticketId: string; leaderId: string },
  now = Date.now(),
): Record<string, unknown> & { match?: Record<string, unknown> } {
  const ticket = store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(input.ticketId) as Record<string, unknown> | null;
  if (!ticket || ticket.leader_id !== input.leaderId) throw new Error("unknown ticket");
  if (ticket.status !== "queued") {
    const out = { ...ticket } as Record<string, unknown> & { match?: Record<string, unknown> };
    if (ticket.match_id) {
      out.match = (store.db.prepare("SELECT * FROM matches WHERE id = ?").get(ticket.match_id as string) as Record<string, unknown>) ?? undefined;
    }
    return out;
  }
  if (now < (ticket.settle_at as number)) {
    if (ticket.mode === "ranked") {
      const foe = findHumanOpponent(store, input.leaderId, now);
      if (foe) {
        const settled = settleTicket(store, ticket, foe.versionId, now);
        return withMatch(store, settled);
      }
    }
    return { ...ticket };
  }
  if (ticket.mode === "casual") {
    const settled = settleTicket(store, ticket, null, now);
    return withMatch(store, settled);
  }
  // Ranked expiry with no foe: no fight started, so the charge returns.
  store.db.prepare("UPDATE tickets SET status = 'expired' WHERE id = ?").run(input.ticketId);
  refundEnergy(store, input.leaderId, now);
  return { ...(store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(input.ticketId) as Record<string, unknown>) };
}

// Explicit opt-in only. Reads never call this function: the lease renews
// on a button press, never on a visit.
export function optInAutobattle(store: Store, leaderId: string, now = Date.now()): { leaseExpiresAt: number; state: string } {
  const cur = energyFor(store, leaderId, now);
  if (!cur.published) throw new Error("install a published version first");
  const next = activate({ ...cur, optIn: true }, now);
  store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(next), leaderId);
  return { leaseExpiresAt: next.leaseExpiresAt as number, state: next.state };
}

// Explicit pause only. Resume needs a fresh opt-in press.
export function pauseAutobattle(store: Store, leaderId: string, now = Date.now()): { state: string } {
  const cur = energyFor(store, leaderId, now);
  const next = pause(cur);
  store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(next), leaderId);
  return { state: next.state };
}

// One background pass. Ranked vs a live published foe, bot sparring
// alone. Bounded per call so one read never drains the day.
export function autobattleTick(
  store: Store,
  leaderId: string,
  now = Date.now(),
  max = 10,
): { ran: number; matches: Record<string, unknown>[]; stopped: string } {
  const matches: Record<string, unknown>[] = [];
  let ran = 0;
  for (let i = 0; i < max; i += 1) {
    const cur = energyFor(store, leaderId, now);
    const go = startOwnerMatch(cur, now);
    store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(go.status), leaderId);
    if (!go.guard.ok) break;
    const agent = store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(leaderId) as Record<string, unknown> | null;
    const seed = `ab-${leaderId}-${go.status.attackAt.length}`;
    const foe = findHumanOpponent(store, leaderId, now);
    const match = foe
      ? runRanked(store, { aVersionId: agent?.active_version_id as string, bVersionId: foe.versionId, seed, key: `abm-${seed}` })
      : runCasual(store, { aVersionId: agent?.active_version_id as string, bBot: true, seed, leaderId });
    matches.push(match);
    ran += 1;
    const done = finishMatch(go.status, now);
    store.db.prepare("UPDATE leaders SET autobattle_json = ? WHERE id = ?").run(JSON.stringify(done), leaderId);
  }
  return { ran, matches, stopped: autobattleStop(store, leaderId, now) };
}

// The stop reason in plain words. Reads never change the lease.
export function autobattleStop(store: Store, leaderId: string, now = Date.now()): string {
  const st = energyFor(store, leaderId, now);
  if (st.state === "PAUSED_MANUAL" || (st.optIn === false && st.leaseExpiresAt !== null)) return "paused";
  if (!st.optIn) return "opted out";
  if (st.state === "IDLE_EXPIRED" || (st.leaseExpiresAt !== null && now >= st.leaseExpiresAt)) return "lease expired";
  if (st.stamina < 1) return "energy depleted";
  if (st.attackAt.length >= MAX_ATTACK_PER_DAY) return "daily cap reached";
  if (!st.published) return "no published version";
  return "ready";
}

// The return digest: lease, energy, reason, and recent auto fights.
export function autobattleDigest(store: Store, leaderId: string, now = Date.now()): Record<string, unknown> {
  const st = energyFor(store, leaderId, now);
  const safe = leaderId.replace(/[\\%_]/g, (c) => `\\${c}`);
  const like = `ab-${safe}-%`;
  const rows = store.db.prepare(
    "SELECT * FROM matches WHERE seed LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 10",
  ).all(like) as Record<string, unknown>[];
  const owned = new Set(
    (store.db.prepare("SELECT id FROM versions WHERE agent_id IN (SELECT id FROM agents WHERE leader_id = ?)").all(leaderId) as Record<string, unknown>[]).map((v) => v.id as string),
  );
  return {
    optIn: st.optIn,
    leaseExpiresAt: st.leaseExpiresAt,
    state: st.state,
    energy: energyView(st, now),
    defense: {
      used: st.defenseAt.filter((t) => now - t < DAY_MS).length,
      max: MAX_DEFENSE_PER_DAY,
    },
    stopReason: autobattleStop(store, leaderId, now),
    recent: rows.map((m) => {
      const mine = owned.has(m.a_version as string) ? "a" : "b";
      return {
        matchId: m.id,
        winner: m.winner,
        ticks: m.ticks,
        rated: m.rated,
        mode: matchMode(m),
        myDelta: mine === "a" ? m.delta_a : m.delta_b,
        myPaid: mine === "a" ? m.paid_a : m.paid_b,
        at: m.created_at,
        replay: `/v1/matches/${m.id}/replay`,
      };
    }),
  };
}

// One open cup. Bootstrap on first read; organizers author the rest.
const CUP_ID = "s1-kickoff";

function readEventRow(store: Store, eventId: string): Record<string, unknown> | null {
  return store.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(eventId) as Record<string, unknown> | null;
}

function parseEvent(row: Record<string, unknown>): { event: Championship; games: Record<string, string[]> } {
  return {
    event: JSON.parse(row.event_json as string) as Championship,
    games: JSON.parse(row.games_json as string) as Record<string, string[]>,
  };
}

function saveEvent(store: Store, eventId: string, event: Championship, games: Record<string, string[]>): void {
  store.db.prepare("UPDATE tournaments SET event_json = ?, games_json = ? WHERE id = ?").run(JSON.stringify(event), JSON.stringify(games), eventId);
}

function eventView(name: string, event: Championship, games: Record<string, string[]>): Record<string, unknown> {
  return {
    id: event.id,
    name,
    phase: event.phase,
    maxPlayers: event.maxPlayers,
    minAp: event.minAp,
    registrationCloseAt: event.registrationCloseAt,
    entries: event.entries.map((e) => ({ leaderId: e.leaderId, lockedVersionId: e.lockedVersionId, registeredAt: e.registeredAt })),
    bracket: event.bracket,
    games,
  };
}

function bootstrapCup(store: Store): void {
  if (readEventRow(store, CUP_ID)) return;
  const now = Date.now();
  const event = createEvent({ id: CUP_ID, seed: "kickoff-s1", maxPlayers: 8, minAp: 0, registrationCloseAt: now + 30 * 24 * 60 * 60 * 1000 });
  store.db.prepare("INSERT INTO tournaments (id, name, event_json, games_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    CUP_ID, "S1 Kickoff Cup", JSON.stringify(event), "{}", now,
  );
}

export function listTournaments(store: Store): Record<string, unknown>[] {
  bootstrapCup(store);
  const rows = store.db.prepare("SELECT * FROM tournaments ORDER BY created_at ASC").all() as Record<string, unknown>[];
  return rows.map((row) => {
    const { event } = parseEvent(row);
    return { id: row.id, name: row.name, phase: event.phase, entries: event.entries.length, maxPlayers: event.maxPlayers };
  });
}

export function getTournament(store: Store, eventId: string): Record<string, unknown> {
  bootstrapCup(store);
  const row = readEventRow(store, eventId);
  if (!row) throw new Error("unknown tournament");
  const { event, games } = parseEvent(row);
  return eventView(row.name as string, event, games);
}

// Organizers author events. Brackets need a power-of-two house, so the cap is one.
export function createTournament(
  store: Store,
  input: { id: string; name: string; maxPlayers: number; minAp: number; registrationCloseAt: number },
  now = Date.now(),
): Record<string, unknown> {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(id)) throw new Error("event id must be a 3-40 char slug");
  if (readEventRow(store, id)) throw new Error(`event ${id} already exists`);
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("event name is required");
  const maxPlayers = Math.floor(input.maxPlayers);
  if (![2, 4, 8, 16, 32, 64].includes(maxPlayers)) throw new Error("maxPlayers must be a power of two from 2 to 64");
  const minAp = Math.floor(input.minAp);
  if (!(minAp >= 0)) throw new Error("minAp must be zero or more");
  if (!(input.registrationCloseAt > now)) throw new Error("registrationCloseAt must be in the future");
  const event: Championship = { ...createEvent({ id, seed: `${id}-seed`, maxPlayers, minAp, registrationCloseAt: input.registrationCloseAt }), phase: "DRAFT" };
  store.db.prepare("INSERT INTO tournaments (id, name, event_json, games_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id, name, JSON.stringify(event), "{}", now,
  );
  return eventView(name, event, {});
}

// Organizers walk the chain one step at a time. Locks freeze versions; live seeds the bracket.
const PHASES: EventPhase[] = ["DRAFT", "ANNOUNCED", "REGISTRATION_OPEN", "LOCKED", "SEEDED", "LIVE", "COMPLETED", "CANCELLED"];

export function transitionTournament(
  store: Store,
  input: { eventId: string; to: string },
): Record<string, unknown> {
  if (!(PHASES as string[]).includes(input.to)) throw new Error(`unknown phase ${input.to}`);
  const row = readEventRow(store, input.eventId);
  if (!row) throw new Error("unknown tournament");
  let { event, games } = parseEvent(row);
  const to = input.to as EventPhase;
  if (to === "LOCKED") {
    if (event.entries.length < 2) throw new Error("lock needs at least two entries");
    event = lock(transitionEvent(event, to));
  } else {
    if (to === "LIVE" && !event.bracket) event = seedBracket(event);
    event = transitionEvent(event, to);
  }
  saveEvent(store, input.eventId, event, games);
  return eventView(row.name as string, event, games);
}

function leaderOf(event: Championship, versionId: string): string | null {
  const hit = event.entries.find((e) => e.lockedVersionId === versionId || e.agentVersionId === versionId);
  return hit ? hit.leaderId : null;
}

// One bracket game. Seed-keyed: a retry replays nothing twice.
function playCupGame(
  store: Store,
  event: Championship,
  games: Record<string, string[]>,
  slotId: string,
  gameNo: number,
): { winnerVersionId: string | null; matchId: string } {
  const slot = (event.bracket as { slots: { id: string; slotA: string | null; slotB: string | null }[] }).slots.find((s) => s.id === slotId) as { id: string; slotA: string; slotB: string };
  const seed = `tmt-${event.id}-${slotId}-g${gameNo}`;
  const prior = store.db.prepare("SELECT * FROM matches WHERE seed = ?").get(seed) as Record<string, unknown> | null;
  if (prior) {
    return { winnerVersionId: prior.winner === "A" ? slot.slotA : prior.winner === "B" ? slot.slotB : null, matchId: prior.id as string };
  }
  const leaderA = leaderOf(event, slot.slotA) as string;
  const leaderB = leaderOf(event, slot.slotB) as string;
  const fight = runCasual(store, { aVersionId: slot.slotA, bVersionId: slot.slotB, seed, leaderId: leaderA });
  const winner = fight.winner;
  creditAc(store, leaderB, fight.matchId, "b", winner === "B" ? "win" : winner === "A" ? "loss" : "no-contest");
  return { winnerVersionId: winner === "A" ? slot.slotA : winner === "B" ? slot.slotB : null, matchId: fight.matchId };
}

// The bracket runs to a champion. Draws replay; five blanks hand slot A.
function playBracket(store: Store, event: Championship, games: Record<string, string[]>): { event: Championship; games: Record<string, string[]> } {
  let ev = event;
  const slots = (ev.bracket as { slots: { id: string }[] }).slots;
  for (const slot of slots) {
    let guard = 0;
    for (;;) {
      const cur = (ev.bracket as { slots: { id: string; winnerId: string | null }[] }).slots.find((s) => s.id === slot.id) as { id: string; winnerId: string | null };
      if (cur.winnerId) break;
      guard += 1;
      const played = (games[slot.id] ?? []).length;
      const game = playCupGame(store, ev, games, slot.id, played + 1);
      games[slot.id] = [...(games[slot.id] ?? []), game.matchId];
      if (!game.winnerVersionId) {
        if (guard >= 6) {
          const first = (ev.bracket as { slots: { id: string; slotA: string }[] }).slots.find((s) => s.id === slot.id) as { id: string; slotA: string };
          ev = reportGame(ev, { slotId: slot.id, winnerVersionId: first.slotA });
        }
        continue;
      }
      ev = reportGame(ev, { slotId: slot.id, winnerVersionId: game.winnerVersionId });
    }
  }
  return { event: ev, games };
}

// Register the active version. A full house locks and seeds.
// The kickoff cup also plays to a champion on the spot.
export function registerTournament(
  store: Store,
  input: { eventId: string; leaderId: string; versionId: string; now?: number },
): { entered: boolean; started: boolean; event: Record<string, unknown> } {
  bootstrapCup(store);
  const now = input.now ?? Date.now();
  const row = readEventRow(store, input.eventId);
  if (!row) throw new Error("unknown tournament");
  let { event, games } = parseEvent(row);
  const name = row.name as string;
  const agent = store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(input.leaderId) as Record<string, unknown> | null;
  if (!agent) throw new Error("breed a hero first");
  if (agent.active_version_id !== input.versionId) throw new Error("register your active version");
  const leader = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(input.leaderId) as Record<string, unknown>;
  const outcome = registerEntry(event, { leaderId: input.leaderId, agentVersionId: input.versionId, ap: leader.ap as number, now });
  if (!outcome.ok) throw new Error(outcome.reason);
  event = addEntry(event, outcome);
  let started = false;
  if (event.entries.length >= event.maxPlayers) {
    event = seedBracket(lock(event));
    started = true;
    if (input.eventId === CUP_ID) {
      const done = playBracket(store, event, games);
      event = done.event;
      saveEvent(store, input.eventId, event, done.games);
      return { entered: true, started, event: eventView(name, event, done.games) };
    }
  }
  saveEvent(store, input.eventId, event, games);
  return { entered: true, started, event: eventView(name, event, games) };
}

// The armory sells looks, never power. Skins, trails, and banners only.
const ARMORY_SLOTS = ["skin", "trail", "banner"];

function readCloset(store: Store, leaderId: string): { leader: Record<string, unknown>; owned: string[]; equipped: Record<string, string | null> } {
  const leader = store.db.prepare("SELECT * FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown> | null;
  if (!leader) throw new Error("unknown leader");
  return {
    leader,
    owned: JSON.parse((leader.owned_json as string) ?? "[]") as string[],
    equipped: JSON.parse((leader.equipped_json as string) ?? "{}") as Record<string, string | null>,
  };
}

export function armoryView(store: Store, leaderId: string): Record<string, unknown> {
  const { leader, owned, equipped } = readCloset(store, leaderId);
  return {
    ac: leader.ac,
    rp: leader.rp,
    equipped,
    catalog: CATALOG.map((c) => ({ ...c, owned: owned.includes(c.id) })),
  };
}

// One charge per item, ever. A replayed buy grants without charging.
export function buyItem(store: Store, leaderId: string, itemId: string, now = Date.now()): Record<string, unknown> {
  const item = CATALOG.find((c) => c.id === itemId);
  if (!item) throw new Error(`unknown item ${itemId}`);
  const { leader, owned } = readCloset(store, leaderId);
  if (owned.includes(itemId)) return armoryView(store, leaderId);
  const balance = item.currency === "AC" ? (leader.ac as number) : (leader.rp as number);
  if (balance < item.price) throw new Error(`insufficient ${item.currency}`);
  const key = `shop:${itemId}`;
  const res = store.db.prepare("INSERT OR IGNORE INTO wallet_keys (wallet_id, key) VALUES (?, ?)").run(leaderId, key) as { changes: number };
  if (res.changes > 0) {
    const column = item.currency === "AC" ? "ac" : "rp";
    store.db.prepare(`UPDATE leaders SET ${column} = ${column} - ? WHERE id = ?`).run(item.price, leaderId);
    store.db.prepare("INSERT INTO wallet_txns (wallet_id, idem_key, currency, delta, reason, at) VALUES (?, ?, ?, ?, ?, ?)").run(
      leaderId, key, item.currency, -item.price, `buy ${itemId}`, now,
    );
  }
  owned.push(itemId);
  store.db.prepare("UPDATE leaders SET owned_json = ? WHERE id = ?").run(JSON.stringify(owned), leaderId);
  return armoryView(store, leaderId);
}

// Equip owns-first. No stats change anywhere in this file.
export function equipItem(store: Store, leaderId: string, slot: string, itemId: string): Record<string, unknown> {
  if (!ARMORY_SLOTS.includes(slot)) throw new Error(`unknown slot ${slot}`);
  const { owned, equipped } = readCloset(store, leaderId);
  if (!owned.includes(itemId)) throw new Error(`not owned ${itemId}`);
  const next = { ...equipped, [slot]: itemId };
  store.db.prepare("UPDATE leaders SET equipped_json = ? WHERE id = ?").run(JSON.stringify(next), leaderId);
  return armoryView(store, leaderId);
}

// Guided first session. Three acts, one AC reward each. The client shows
// progress; the server owns the truth and pays each stage once.
export const FTUE_REWARD_AC = 200;
export const FTUE_STAGES = [
  { stage: 1, id: "create", title: "Create agent", hint: "Identity and portrait." },
  { stage: 2, id: "program", title: "Program chip", hint: "Words become behavior." },
  { stage: 3, id: "arena", title: "Enter arena", hint: "Queue and climb." },
];

function ftueAgent(store: Store, leaderId: string): Record<string, unknown> | null {
  return store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(leaderId) as Record<string, unknown> | null;
}

function ftueDone(store: Store, leaderId: string, stage: number): boolean {
  const agent = ftueAgent(store, leaderId);
  if (!agent) return false;
  if (stage === 1) return true;
  if (stage === 2) return agent.active_version_id != null;
  if (stage === 3) {
    const bout = store.db.prepare(
      "SELECT 1 FROM matches m JOIN versions v ON v.id IN (m.a_version, m.b_version) WHERE v.agent_id = ? LIMIT 1",
    ).get(agent.id as string);
    return bout != null;
  }
  return false;
}

export function ftueStatus(store: Store, leaderId: string): Record<string, unknown> {
  const keys = new Set(
    (store.db.prepare("SELECT key FROM wallet_keys WHERE wallet_id = ?").all(leaderId) as { key: string }[]).map((k) => k.key),
  );
  return {
    reward: FTUE_REWARD_AC,
    stages: FTUE_STAGES.map((s) => ({
      ...s,
      done: ftueDone(store, leaderId, s.stage),
      claimed: keys.has(`ftue:${s.stage}`),
    })),
  };
}

// One payout per stage, ever. A replayed claim reports without paying.
export function claimFtue(store: Store, leaderId: string, stage: number, now = Date.now()): Record<string, unknown> {
  const def = FTUE_STAGES.find((s) => s.stage === stage);
  if (!def) throw new Error(`unknown ftue stage ${stage}`);
  if (!ftueDone(store, leaderId, stage)) throw new Error(`ftue stage ${stage} is not complete yet`);
  const key = `ftue:${stage}`;
  const res = store.db.prepare("INSERT OR IGNORE INTO wallet_keys (wallet_id, key) VALUES (?, ?)").run(leaderId, key) as { changes: number };
  let rewarded = false;
  if (res.changes > 0) {
    store.db.prepare("UPDATE leaders SET ac = ac + ? WHERE id = ?").run(FTUE_REWARD_AC, leaderId);
    store.db.prepare("INSERT INTO wallet_txns (wallet_id, idem_key, currency, delta, reason, at) VALUES (?, ?, ?, ?, ?, ?)").run(
      leaderId, key, "AC", FTUE_REWARD_AC, `ftue stage ${stage}`, now,
    );
    rewarded = true;
  }
  const leader = store.db.prepare("SELECT ac FROM leaders WHERE id = ?").get(leaderId) as Record<string, unknown>;
  return { stage, id: def.id, reward: FTUE_REWARD_AC, rewarded, ac: leader.ac, stages: (ftueStatus(store, leaderId).stages as unknown[]) };
}

// Past seasons, newest first. Rollover writes; this only reads.
export function seasonHistory(store: Store): Record<string, unknown>[] {
  const rows = store.db.prepare("SELECT * FROM season_archives ORDER BY closed_at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    seasonId: r.season_id,
    closedAt: r.closed_at,
    ...((JSON.parse(r.archive_json as string) as object) ?? {}),
  }));
}

// Public cards show the career, never the wallet. Allowlist, not filter.
export function publicProfile(store: Store, handle: string): Record<string, unknown> {
  const leader = store.db.prepare("SELECT * FROM leaders WHERE handle = ?").get(handle) as Record<string, unknown> | null;
  if (!leader) throw new Error("unknown handle");
  const agent = store.db.prepare("SELECT * FROM agents WHERE leader_id = ?").get(leader.id as string) as Record<string, unknown> | null;
  let wins = 0;
  let losses = 0;
  if (agent) {
    const vrows = store.db.prepare("SELECT id FROM versions WHERE agent_id = ?").all(agent.id as string) as Record<string, unknown>[];
    const ids = vrows.map((v) => v.id as string);
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      const bouts = store.db.prepare(
        `SELECT * FROM matches WHERE a_version IN (${marks}) OR b_version IN (${marks})`,
      ).all(...ids, ...ids) as Record<string, unknown>[];
      const owned = new Set(ids);
      for (const m of bouts) {
        const mine = owned.has(m.a_version as string) ? "A" : "B";
        if (m.winner === mine) wins += 1;
        else if (m.winner === "A" || m.winner === "B") losses += 1;
      }
    }
  }
  const rank = rankFor(leader.ap as number);
  const equipped = JSON.parse((leader.equipped_json as string) ?? "{}") as Record<string, string | null>;
  return {
    handle: leader.handle,
    ap: leader.ap,
    tier: rank.tier,
    division: rank.division,
    agent: agent ? {
      name: agent.name,
      portraitUrl: agent.portrait_url,
      equippedSkin: equipped.skin ?? null,
      wins,
      losses,
    } : null,
  };
}

// Abuse reports land in a private box. No public listing, ever.
export function reportLeader(store: Store, handle: string, reason: string, now = Date.now()): { received: boolean } {
  const leader = store.db.prepare("SELECT id FROM leaders WHERE handle = ?").get(handle) as Record<string, unknown> | null;
  if (!leader) throw new Error("unknown handle");
  const clean = reason.slice(0, 280);
  if (!clean) throw new Error("reason is required");
  store.db.prepare("INSERT INTO reports (id, handle, reason, created_at) VALUES (?, ?, ?, ?)").run(mintId("r"), handle, clean, now);
  return { received: true };
}

// Cancel drops a queued ticket and returns its charge. Settled stays final.
export function cancelTicket(
  store: Store,
  input: { ticketId: string; leaderId: string },
  now = Date.now(),
): Record<string, unknown> {
  const ticket = store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(input.ticketId) as Record<string, unknown> | null;
  if (!ticket || ticket.leader_id !== input.leaderId) throw new Error("unknown ticket");
  if (ticket.status !== "queued") throw new Error(`ticket is ${ticket.status}, nothing to cancel`);
  store.db.prepare("UPDATE tickets SET status = 'canceled' WHERE id = ?").run(input.ticketId);
  refundEnergy(store, input.leaderId, now);
  return store.db.prepare("SELECT * FROM tickets WHERE id = ?").get(input.ticketId) as Record<string, unknown>;
}

export function withMatch(store: Store, ticket: Record<string, unknown>): Record<string, unknown> & { match?: Record<string, unknown> } {
  const out = { ...ticket } as Record<string, unknown> & { match?: Record<string, unknown> };
  if (ticket.match_id) {
    out.match = (store.db.prepare("SELECT * FROM matches WHERE id = ?").get(ticket.match_id as string) as Record<string, unknown>) ?? undefined;
  }
  return out;
}
