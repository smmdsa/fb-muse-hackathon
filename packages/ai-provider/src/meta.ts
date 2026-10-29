// Meta provider. Talks to the Meta Model API with plain fetch.
// No SDK, no extra deps. The caller injects fetch in tests.

import { validatePolicy } from "@agent-wars/behavior-dna";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { keyFor, metaApiBase, resolveModel } from "./models.ts";
import { repairOnce } from "./mock.ts";
import { explainMock } from "./mock.ts";
import type { AiProvider, BattleTelemetry, CompileRequest, CompileResult, ExplainResult, PortraitRequest, PortraitResult } from "./types.ts";

type FetchFn = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const defaultFetch = (url: string, init: Record<string, unknown>) => {
  return (globalThis.fetch as unknown as FetchFn)(url, init);
};

// The system brief pins the exact policy JSON the model must return.
// It names every legal operand, operator, and move, because anything
// else rejects the whole draft at validation. Fights run on the MOBA
// lane, so the brief teaches that map: minions, towers, gold, shop.
const COMPILE_SYSTEM = [
  "You draft fighting-robot policies for the MOBA mode of AGENT WARS.",
  "Reply with one JSON object and nothing else.",
  "Shape: {\"schemaVersion\":2,\"agentVersionId\":\"<id>\",",
  "\"dna\":{\"aggression\":0-100,\"evasion\":0-100,\"preferredDistance\":0-100,\"energyConservation\":0-100},",
  "\"rules\":[{\"id\":\"<slug>\",\"when\":{...},\"move\":\"<MOVE>\",",
  "\"fire\":true|false,\"shield\":true|false,\"dash\":true|false,\"target\":\"<TARGET>\",\"buy\":\"<item>\"}]}.",
  "Send 2 to 6 rules. Keep every trait an integer 0-100.",
  "The brief can run paragraphs long. Read it whole, distill the overall battle plan, then mint rules that together express it.",
  "Map: one lane on a 48x16 field. Each side holds 2 towers, 1 inhibitor, 2 nexus turrets, 1 nexus in that order. Waves of 5 minions spawn every 30s from 1:00. Each tick the first matching rule wins; put emergency and specific rules before general rules. Unmatched rules fall back to pushing and automatic targeting.",
  "Operands, exactly these: ownHpPct, energy, distFoe, projectileTti, coverDist, lineOfSight, dashReady, shieldReady, foeLastSeenAge, objectiveDist, timeLeft, edgeDist, ownGold, ownDeaths, gameTime, distFoeTower, foeTowerHpPct, nearFoeMinions, nearAllyMinions, distFoeMinion, foeHpPct, buildValue, slotsFree, structLead, foeAlive.",
  "Additional MOBA operands: inFoeTowerRange and foeTowerTargetsMe are booleans; allyMinionsUnderFoeTower counts living allied minions in the nearest enemy tower's range; nearAllyMinionHp and nearFoeMinionHp sum HP within 6 units of the robot; killableFoeMinionsInRange counts visible enemy minions within attack range whose current HP is at most one attack of damage; nextWaveSeconds is seconds until the next wave; distOwnBase is distance to own nexus; ownStructureThreatened is true if any enemy minion is within 6 units of an alive allied structure. These values are unavailable outside MOBA.",
  "foeTowerTargetsAllyMinion is true when the nearest enemy tower currently targets a living allied minion.",
  "The Overseer appears at 6:00 in the north-central pit, respawns 3 minutes after defeat and grants +20% robot attack damage for 90 seconds to sides that hit it during the killing tick. It retaliates against nearby robots once per second. In new arena matches only: overseerAlive (boolean), overseerHpPct (null when absent), overseerDist, overseerSpawnSeconds, ownOverseerBuffSeconds and foeOverseerBuffSeconds. CONTEST_OVERSEER approaches its pit while alive and stops at attack range; target OVERSEER fires only at it when visible and in range. In old matches those observations are unavailable. Use these only when relevant to the player's plan.",
  "Operators, exactly these: gt, gte, lt, lte, eq. Value is a number; eq takes true or false for lineOfSight, dashReady, shieldReady, foeAlive, inFoeTowerRange, foeTowerTargetsMe, foeTowerTargetsAllyMinion, ownStructureThreatened, overseerAlive. foeLastSeenAge is not implemented: do not use it.",
  "Moves, exactly these: APPROACH, RETREAT, STRAFE, KITE, CAPTURE, SEEK_COVER, PUSH, FARM, DEFEND, WAIT, CONTEST_OVERSEER. WAIT holds position; PUSH escorts your wave, FARM hunts last hits, DEFEND guards your threatened tower, CAPTURE sieges the nearest vulnerable enemy tower.",
  "Target, optional: AUTO uses the default auto-attack targeting; FOE shoots only the enemy robot; MINION shoots only enemy minions; STRUCTURE shoots only a vulnerable enemy structure; NONE holds fire. These are strict choices: if the specified target is unavailable or out of range, no shot is fired. If omitted AUTO applies. In MOBA fire does not override target. Use target to express explicit combat instructions, and never invent actions the engine cannot perform.",
  "LAST_HIT shoots only a visible in-range enemy minion currently killable by one attack; shots can miss or arrive after other damage. WAIT with NONE holds position and fire. Tower aggro may switch after you damage the enemy robot under its tower, even if allies are present.",
  "The DNA traits are descriptive and do not change MOBA behavior; express every requested behavior in rules. Do not claim unsupported behaviors.",
  "Buy, optional: \"buy\":\"<item>\" with one of scrap_blade, cloth_weave, worn_treads, overclock_chip, hull_patch, repair_cell, tempered_edge, bulwark_plate, turbo_treads, rapid_cycler, reinforced_hull, siege_breaker, aegis_core, phantom_drive, warlord_frame. Gate buys on ownGold and buildValue. The arena also auto-buys when no buy is requested and auto-combines items; a chip cannot disable these systems.",
  "Combine tests with {\"all\":[...]} or {\"any\":[...]}. Example: {\"operand\":\"distFoe\",\"op\":\"lt\",\"value\":6}.",
  "Any other operand, operator, move, or item rejects the whole draft.",
  "Match the prompt mood: rush means high aggression,",
  "evade means high evasion, far means high preferredDistance, patient means high energyConservation.",
].join(" ");

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function textOf(body: unknown): string | null {
  const root = asRecord(body);
  const choices = Array.isArray(root?.choices) ? (root.choices as unknown[]) : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  const content = message?.content;
  if (typeof content === "string" && content.length > 0) return content;
  return null;
}

function usageOf(body: unknown): number {
  const usage = asRecord(asRecord(body)?.usage);
  const total = usage?.total_tokens;
  return typeof total === "number" ? total : 0;
}

// Meta answers portraits two ways: a CDN url, or inline b64_json.
// The inline bytes carry no mime, so the base64 prefix names the format:
// JPEG, PNG, and GIF open with fixed magic; WebP opens with RIFF.
function sniffMime(b64: string): string | null {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("UklGR")) return "image/webp";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  return null;
}

function imageContentOf(body: unknown): string | null {
  const root = asRecord(body);
  const data = Array.isArray(root?.data) ? (root.data as unknown[]) : [];
  const first = asRecord(data[0]);
  const url = first?.url;
  if (typeof url === "string" && url.length > 0) return url;
  const b64 = first?.b64_json;
  if (typeof b64 !== "string" || b64.length === 0) return null;
  const mime = sniffMime(b64);
  if (!mime) return null;
  return `data:${mime};base64,${b64}`;
}

export type MetaEnv = {
  META_SPARK_KEY?: string;
  META_IMAGE_KEY?: string;
  META_API_KEY?: string;
  META_API_BASE?: string;
  AGENT_WARS_MODEL_COMPILE?: string;
  AGENT_WARS_MODEL_PORTRAIT?: string;
};

export type MetaProvider = AiProvider & {
  generatePortrait: (req: PortraitRequest) => Promise<PortraitResult>;
  explainBattle: (t: BattleTelemetry) => Promise<ExplainResult>;
};

// One style line keeps every agent portrait in the same art family.
// The contract fixes the canon: one full-body robot, camera-left,
// feet on one baseline, chest chip slot, navy field, no text ever.
export const PORTRAIT_STYLE =
  "one full-body fighting robot portrait, front three-quarter view facing camera-left, neutral ready stance, head arms legs and feet fully visible on one baseline, flat vector esports style, glowing visor, chest chip slot, dark navy background, no text, no watermark, no letters";

// The prompter locks the art direction. The subject changes, the style never does.
export function portraitPromptFor(subject: string): string {
  const clean = subject.trim().slice(0, 200) || "arena robot";
  return `${clean}, ${PORTRAIT_STYLE}`;
}

// The factory builds a provider bound to both task keys, base URL, and map.
// Each call carries its own task key so Spark spend stays apart from images.
export function createMetaProvider(env: MetaEnv, fetchFn: FetchFn = defaultFetch): MetaProvider {
  const base = metaApiBase(env);

  const callChat = async (model: string, system: string, user: string): Promise<unknown> => {
    const res = await fetchFn(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${keyFor("compile", env)}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`meta chat call failed with status ${res.status}`);
    return res.json();
  };

  const compileStrategy = async (req: CompileRequest): Promise<CompileResult> => {
    const started = Date.now();
    const promptTokens = req.prompt.split(/\s+/).filter(Boolean).length;
    const fail = (errors: string[]): CompileResult => ({
      provider: "meta",
      isMock: false,
      policy: null,
      errors,
      repairAttempted: false,
      latencyMs: Date.now() - started,
      promptTokens,
    });
    if (!keyFor("compile", env)) return fail(["compile needs META_SPARK_KEY; set the secret first"]);
    let raw: unknown;
    try {
      raw = await callChat(resolveModel("compile", env), COMPILE_SYSTEM, `agent ${req.agentVersionId}: ${req.prompt}`);
    } catch (err) {
      return fail([`the meta call failed: ${err instanceof Error ? err.message : "unknown error"}`]);
    }
    const text = textOf(raw);
    if (!text) return fail(["the meta reply held no text"]);
    let draft: unknown;
    try {
      draft = JSON.parse(text) as unknown;
    } catch {
      return fail(["the meta reply was not JSON"]);
    }
    const policy = { ...(asRecord(draft) ?? {}), schemaVersion: 2, agentVersionId: req.agentVersionId } as AgentPolicy;
    const check = validatePolicy(policy);
    if (check.ok) {
      return { provider: "meta", isMock: false, policy, errors: [], repairAttempted: false, latencyMs: Date.now() - started, promptTokens: usageOf(raw) || promptTokens };
    }
    if (!Array.isArray(policy.rules)) {
      return { provider: "meta", isMock: false, policy: null, errors: check.errors, repairAttempted: false, latencyMs: Date.now() - started, promptTokens: usageOf(raw) || promptTokens };
    }
    const fixed = repairOnce(policy);
    const recheck = validatePolicy(fixed);
    return {
      provider: "meta",
      isMock: false,
      policy: recheck.ok ? fixed : null,
      errors: recheck.errors,
      repairAttempted: true,
      latencyMs: Date.now() - started,
      promptTokens: usageOf(raw) || promptTokens,
    };
  };

  const generatePortrait = async (req: PortraitRequest): Promise<PortraitResult> => {
    const started = Date.now();
    const imageKey = keyFor("portrait", env);
    if (!imageKey) throw new Error("portraits need META_IMAGE_KEY; set the secret first");
    const res = await fetchFn(`${base}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${imageKey}` },
      body: JSON.stringify({
        model: resolveModel("portrait", env),
        prompt: req.prompt,
        size: req.size ?? "1024x1024",
      }),
    });
    if (!res.ok) throw new Error(`meta image call failed with status ${res.status}`);
    const url = imageContentOf(await res.json());
    if (!url) throw new Error("the meta image reply held no usable image");
    return { provider: "meta", url, model: resolveModel("portrait", env), latencyMs: Date.now() - started };
  };

  // The explainer grounds every claim in telemetry. The reply must echo
  // the winner and the receipt, or the call counts as ungrounded.
  const explainBattle = async (t: BattleTelemetry): Promise<ExplainResult> => {
    const started = Date.now();
    const fallback = async (grounded: boolean): Promise<ExplainResult> => {
      const mock = await explainMock(t);
      return { ...mock, provider: "meta", isMock: false, grounded, latencyMs: Date.now() - started };
    };
    if (!keyFor("compile", env)) return explainMock(t);
    let text: string | null = null;
    try {
      const res = await fetchFn(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${keyFor("compile", env)}` },
        body: JSON.stringify({
          model: resolveModel("compile", env),
          messages: [
            {
              role: "system",
              content: [
                "You explain one finished AGENT WARS fight.",
                "Use ONLY the numbers in the user message. Never invent damage, health, or events.",
                "Reply in two sentences. Name the winner, the ticks, and the top chip per side.",
                "Echo the receipt checksum exactly.",
              ].join(" "),
            },
            { role: "user", content: JSON.stringify(t) },
          ],
          temperature: 0.2,
        }),
      });
      if (res.ok) text = textOf(await res.json());
    } catch {
      text = null;
    }
    if (!text || !text.includes(t.winner) || !text.includes(t.checksum)) return fallback(false);
    return { provider: "meta", isMock: false, grounded: true, text, latencyMs: Date.now() - started };
  };

  return { name: "meta", compileStrategy, generatePortrait, explainBattle };
}
