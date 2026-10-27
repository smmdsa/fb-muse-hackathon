// Repository: one picker per task. Mock stays default until a key exists.
// Each task resolves its own model, so compile and portraits switch alone.

import { compileMock } from "./mock.ts";
import { createMetaProvider } from "./meta.ts";
import type { MetaProvider } from "./meta.ts";
import { hasKey } from "./models.ts";
import type { AiProvider, CompileRequest, CompileResult } from "./types.ts";

export type ProviderEnv = {
  META_SPARK_KEY?: string;
  META_IMAGE_KEY?: string;
  META_API_KEY?: string;
  META_API_BASE?: string;
  AGENT_WARS_MODEL_COMPILE?: string;
  AGENT_WARS_MODEL_PORTRAIT?: string;
};

export const mockProvider: AiProvider = {
  name: "mock",
  compileStrategy: (req: CompileRequest): Promise<CompileResult> => compileMock(req),
};

// The picker returns the Meta compile provider when the Spark key exists.
// Each task stands alone: portraits can stay keyless while compile runs Meta.
export function providerFromEnv(env: ProviderEnv): AiProvider {
  if (!hasKey("compile", env)) return mockProvider;
  const meta = createMetaProvider(env);
  return { name: "meta", compileStrategy: meta.compileStrategy };
}

// Portraits need the image key. The game runs fine without them.
export function portraitFromEnv(env: ProviderEnv): Pick<MetaProvider, "generatePortrait"> {
  if (!hasKey("portrait", env)) throw new Error("portraits need META_IMAGE_KEY; set the secret first");
  return createMetaProvider(env);
}
