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

// Telemetry is the only truth an explanation may cite.
export type BattleTelemetry = {
  matchId: string;
  winner: string;
  ticks: number;
  checksum: string;
  seed: string;
  rated: boolean;
  chipsA: Record<string, number>;
  chipsB: Record<string, number>;
};

export type ExplainResult = {
  provider: ProviderName;
  isMock: boolean;
  grounded: boolean;
  text: string;
  latencyMs: number;
};

export type BattleExplainer = {
  explainBattle: (t: BattleTelemetry) => Promise<ExplainResult>;
};

export type PortraitRequest = {
  prompt: string;
  size?: string;
};

export type PortraitResult = {
  provider: ProviderName;
  url: string;
  model: string;
  latencyMs: number;
};
