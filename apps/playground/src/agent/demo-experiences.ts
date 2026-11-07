/**
 * Browser-only scenario data for the public showcase. It deliberately models
 * the same run metadata as the local route handler, without requiring a host
 * or exposing a credential.
 */
export type DemoExperience = "legal" | "companion" | "defi";
export type DemoProvider = "openai" | "anthropic" | "oneapi";

export type DemoStage = {
  id: string;
  label: string;
  delayMs: number;
  skill: string;
  tools: string[];
  card: string;
  inputTokens: number;
  outputTokens: number;
};

export type DemoExperiencePayload = {
  runId: string;
  experience: DemoExperience;
  simulated: true;
  provider: DemoProvider;
  model: string;
  availableModels: Record<DemoProvider, string[]>;
  stages: DemoStage[];
};

export const DEMO_MODELS: Record<DemoProvider, string[]> = {
  openai: ["gpt-5.2", "gpt-4.1-mini"],
  anthropic: ["claude-sonnet-5", "claude-haiku-4-5"],
  oneapi: ["openai-compatible/model"],
};

const SCENARIOS: Record<DemoExperience, DemoStage[]> = {
  legal: [
    { id: "ingest", label: "Reading Vertex MSA", delayMs: 850, skill: "contract-review", tools: ["readDocument"], card: "document", inputTokens: 1240, outputTokens: 0 },
    { id: "analyze", label: "Tracing liability clauses", delayMs: 1050, skill: "contract-review", tools: ["readDocument", "reviewContract"], card: "citations", inputTokens: 2010, outputTokens: 184 },
    { id: "render", label: "Preparing risk brief", delayMs: 900, skill: "contract-review", tools: ["reviewContract", "visualize"], card: "comparison", inputTokens: 2840, outputTokens: 612 },
  ],
  companion: [
    { id: "listen", label: "Reading today’s check-in", delayMs: 700, skill: "supportive-companion", tools: ["recallMemory"], card: "markdown", inputTokens: 420, outputTokens: 0 },
    { id: "remember", label: "Connecting a remembered promise", delayMs: 950, skill: "supportive-companion", tools: ["recallMemory", "remember"], card: "choice", inputTokens: 680, outputTokens: 96 },
    { id: "celebrate", label: "Choosing a safe celebration", delayMs: 850, skill: "supportive-companion", tools: ["remember", "visualize"], card: "celebration", inputTokens: 910, outputTokens: 228 },
  ],
  defi: [
    { id: "inspect", label: "Reading synthetic positions", delayMs: 750, skill: "portfolio-operations", tools: ["getPositions"], card: "stats", inputTokens: 860, outputTokens: 0 },
    { id: "simulate", label: "Simulating rebalance", delayMs: 1050, skill: "portfolio-operations", tools: ["getPositions", "simulateSwap"], card: "comparison", inputTokens: 1380, outputTokens: 208 },
    { id: "approve", label: "Requesting execution authority", delayMs: 900, skill: "portfolio-operations", tools: ["simulateSwap", "executeSwap"], card: "confirm", inputTokens: 1720, outputTokens: 364 },
  ],
};

export function createDemoExperience(
  experience: DemoExperience,
  requestedProvider: DemoProvider = "openai",
  requestedModel?: string,
): DemoExperiencePayload {
  const provider = requestedProvider in DEMO_MODELS ? requestedProvider : "openai";
  const models = DEMO_MODELS[provider];
  const model = requestedModel && models.includes(requestedModel) ? requestedModel : models[0]!;

  return {
    runId: `mock_${experience}_${Date.now().toString(36)}`,
    experience,
    simulated: true,
    provider,
    model,
    availableModels: DEMO_MODELS,
    stages: SCENARIOS[experience],
  };
}
