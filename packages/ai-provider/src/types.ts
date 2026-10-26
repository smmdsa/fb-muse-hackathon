// AI provider contracts. The mock is the default. Meta arrives later.

import type { AgentPolicy } from "@agent-wars/behavior-dna";

export type ProviderName = "mock" | "meta";

export type CompileRequest = {
  prompt: string;
  agentVersionId: string;
};

export type CompileResult = {
  provider: ProviderName;
  isMock: boolean;
  policy: AgentPolicy | null;
  errors: string[];
  repairAttempted: boolean;
  latencyMs: number;
  promptTokens: number;
};

export type AiProvider = {
  name: ProviderName;
  compileStrategy: (req: CompileRequest) => Promise<CompileResult>;
};
