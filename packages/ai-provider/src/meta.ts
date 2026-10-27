// Meta provider. Talks to the Meta Model API with plain fetch.
// No SDK, no extra deps. The caller injects fetch in tests.

import { validatePolicy } from "@agent-wars/behavior-dna";
import type { AgentPolicy } from "@agent-wars/behavior-dna";
import { keyFor, metaApiBase, resolveModel } from "./models.ts";
import { repairOnce } from "./mock.ts";
import type { AiProvider, CompileRequest, CompileResult, PortraitRequest, PortraitResult } from "./types.ts";

type FetchFn = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const defaultFetch = (url: string, init: Record<string, unknown>) => {
  return (globalThis.fetch as unknown as FetchFn)(url, init);
};

// The system brief pins the exact policy JSON the model must return.
const COMPILE_SYSTEM = [
  "You draft fighting-robot policies for the game AGENT WARS.",
  "Reply with one JSON object and nothing else.",
  "Shape: {\"schemaVersion\":1,\"agentVersionId\":\"<id>\",",
  "\"dna\":{\"aggression\":0-100,\"evasion\":0-100,\"preferredDistance\":0-100,\"energyConservation\":0-100},",
  "\"rules\":[{\"id\":\"<slug>\",\"when\":{...},\"move\":\"APPROACH|RETREAT|STRAFE|KITE|CAPTURE|SEEK_COVER\",",
  "\"fire\":true|false,\"shield\":true|false,\"dash\":true|false}]}.",
  "Send 2 to 6 rules. Keep every trait 0-100. Match the prompt mood: rush means high aggression,",
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

function imageUrlOf(body: unknown): string | null {
  const root = asRecord(body);
  const data = Array.isArray(root?.data) ? (root.data as unknown[]) : [];
  const first = asRecord(data[0]);
  const url = first?.url;
  if (typeof url === "string" && url.length > 0) return url;
  return null;
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
};

// One style line keeps every agent portrait in the same art family:
// three-quarter view, vector esports look, dark navy field, no text.
export const PORTRAIT_STYLE =
  "three-quarter view fighting robot portrait, flat vector esports style, glowing visor, dark navy background, no text, no letters";

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
    const policy = { ...(asRecord(draft) ?? {}), schemaVersion: 1, agentVersionId: req.agentVersionId } as AgentPolicy;
    const check = validatePolicy(policy);
    if (check.ok) {
      return { provider: "meta", isMock: false, policy, errors: [], repairAttempted: false, latencyMs: Date.now() - started, promptTokens: usageOf(raw) || promptTokens };
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
    const url = imageUrlOf(await res.json());
    if (!url) throw new Error("the meta image reply held no url");
    return { provider: "meta", url, model: resolveModel("portrait", env), latencyMs: Date.now() - started };
  };

  return { name: "meta", compileStrategy, generatePortrait };
}
