// Muse suite catalog and per-task registry. One table picks the model.
// Env vars switch models without code changes.

export type ModelTask = "compile" | "portrait";

export type ModelEntry = {
  id: string;
  use: string;
  price: string;
  endpoint: "chat" | "images";
};

// The suite as of 2026-10. Confirm ids in the Meta developer console.
// META_API_BASE overrides the base URL if Meta moves it.
export const MUSE_SUITE = {
  spark: { id: "muse-spark-1.3", use: "agent logic", price: "$1.25 in / $4.25 out per 1M tokens", endpoint: "chat" },
  wonder: { id: "muse-wonder-1.0", use: "hard drafts", price: "$4 in / $20 out per 1M tokens", endpoint: "chat" },
  image: { id: "muse-image-1.0", use: "agent art", price: "$0.01 per image", endpoint: "images" },
} as const satisfies Record<string, ModelEntry>;

export const META_API_DEFAULT_BASE = "https://api.meta.ai/v1";

// Each task names its model. Compile runs hot and cheap on Spark.
// Portraits render once per agent or skin on Muse Image, then cache.
// Ranked and AutoBattle never call a model; the sim settles fights.
export const TASK_MODELS: Record<ModelTask, string> = {
  compile: MUSE_SUITE.spark.id,
  portrait: MUSE_SUITE.image.id,
};

const TASK_MODEL_KEYS: Record<ModelTask, string> = {
  compile: "AGENT_WARS_MODEL_COMPILE",
  portrait: "AGENT_WARS_MODEL_PORTRAIT",
};

// One key per task, so the dashboard shows Spark spend apart from image spend.
// META_API_KEY still works as a fallback for both when set.
const TASK_KEY_KEYS: Record<ModelTask, string> = {
  compile: "META_SPARK_KEY",
  portrait: "META_IMAGE_KEY",
};

// The resolver reads the registry, then an env override wins per task.
export function resolveModel(task: ModelTask, env: Record<string, string | undefined>): string {
  const custom = env[TASK_MODEL_KEYS[task]];
  if (custom && custom.trim().length > 0) return custom.trim();
  return TASK_MODELS[task];
}

// The key reader prefers the task key, then the shared fallback.
export function keyFor(task: ModelTask, env: Record<string, string | undefined>): string {
  const direct = env[TASK_KEY_KEYS[task]];
  if (direct && direct.length > 0) return direct;
  const shared = env.META_API_KEY;
  if (shared && shared.length > 0) return shared;
  return "";
}

export function hasKey(task: ModelTask, env: Record<string, string | undefined>): boolean {
  return keyFor(task, env).length > 0;
}

export function metaApiBase(env: Record<string, string | undefined>): string {
  const custom = env.META_API_BASE;
  if (custom && custom.trim().length > 0) return custom.trim().replace(/\/+$/, "");
  return META_API_DEFAULT_BASE;
}

export function taskKeyName(task: ModelTask): string {
  return TASK_KEY_KEYS[task];
}
