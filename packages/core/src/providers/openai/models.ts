// A small static catalogue, used as the fallback when `/models` is not reachable
// through the proxy allowlist (a normal, deliberate configuration).
//
// This list will age. It is a convenience for populating a model picker, never a
// gate: an unknown model id is passed straight through to the provider, so a
// model released after this file was written still works.

import type { ModelInfo, ProviderCapabilities } from "../types.js";

export const OPENAI_MODELS: ModelInfo[] = [
  { id: "gpt-5.2", label: "GPT-5.2", contextWindow: 400_000, maxOutputTokens: 128_000 },
  { id: "gpt-5.2-mini", label: "GPT-5.2 mini", contextWindow: 400_000, maxOutputTokens: 128_000 },
  { id: "gpt-5.1", label: "GPT-5.1", contextWindow: 400_000, maxOutputTokens: 128_000 },
  { id: "gpt-4.1", label: "GPT-4.1", contextWindow: 1_047_576, maxOutputTokens: 32_768 },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", contextWindow: 1_047_576, maxOutputTokens: 32_768 },
  { id: "gpt-4o", label: "GPT-4o", contextWindow: 128_000, maxOutputTokens: 16_384 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", contextWindow: 128_000, maxOutputTokens: 16_384 },
  { id: "o4-mini", label: "o4-mini", contextWindow: 200_000, maxOutputTokens: 100_000 },
];

/**
 * Per-model capability deltas that matter for request building.
 *
 * The one that actually bites: reasoning models reject `temperature` and
 * `top_p`. `sanitizeForModel` below drops them rather than letting the request
 * 400 — a sampling knob is not worth failing a turn over.
 */
export function modelCapabilities(modelId: string): Partial<ProviderCapabilities> | undefined {
  const id = modelId.toLowerCase();
  if (/^(o\d|gpt-5)/.test(id)) return { reasoning: true };
  if (/gpt-4o|gpt-4\.1/.test(id)) return { reasoning: false };
  return undefined;
}

export function isReasoningModel(modelId: string): boolean {
  return /^(o\d|gpt-5)/.test(modelId.toLowerCase());
}

/** Drop parameters the target model is known to reject. */
export function sanitizeForModel<T extends { temperature?: number; topP?: number; reasoning?: unknown }>(
  req: T,
  modelId: string,
): T {
  if (!isReasoningModel(modelId)) return req;
  const { temperature: _t, topP: _p, ...rest } = req;
  return rest as T;
}
