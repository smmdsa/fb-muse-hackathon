// Package entry. fromEnv picks mock until a Meta key exists.

import { compileMock } from "./mock.ts";
import type { AiProvider, CompileRequest, CompileResult } from "./types.ts";

export * from "./types.ts";
export * from "./mock.ts";

export const mockProvider: AiProvider = {
  name: "mock",
  compileStrategy: (req: CompileRequest): Promise<CompileResult> => compileMock(req),
};

// The picker returns mock when no key is set. The Meta adapter lands later.
export function providerFromEnv(env: Record<string, string | undefined>): AiProvider {
  if (env.META_API_KEY) {
    throw new Error("meta adapter is not implemented yet; unset META_API_KEY to use the mock");
  }
  return mockProvider;
}
