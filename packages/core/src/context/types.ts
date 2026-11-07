// Context assembly types.
//
// The thesis of this subsystem: what reaches the model must be *derived*, not
// accumulated. Most chat apps append to an array and hope. Here every turn
// rebuilds the context from named sources under a token budget, and records why
// each source was included, truncated or dropped — so "the model ignored my
// rule" becomes a question you can answer by reading the trace instead of
// guessing.

import type { Message } from "../content/types.js";
import type { TokenBudget } from "../tokens/budget.js";
import type { ResolvedSkill } from "../skills/types.js";

/** Named context layers, in the order they are assembled into the system block. */
export type LayerId = "identity" | "skills" | "skill-index" | "memory" | "environment" | "custom";

export type ContextLayer = {
  id: string;
  kind: LayerId;
  text: string;
  tokens: number;
  /** Survives budget pressure. Identity and safety rules should be pinned. */
  pinned?: boolean;
  priority: number;
};

export type ContextSourceResult = {
  layers?: ContextLayer[];
  /** Extra tool names this source unlocks (a matched skill enabling its tools). */
  tools?: string[];
};

export type ContextSourceInput = {
  messages: readonly Message[];
  /** Latest user text — what skills and memory retrieval match against. */
  query: string;
  vars: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * A named contributor to the context. Sources run in parallel, so one slow
 * retrieval does not serialize behind another.
 */
export type ContextSource = {
  id: string;
  run(input: ContextSourceInput): Promise<ContextSourceResult> | ContextSourceResult;
};

export type TraceEntry = {
  id: string;
  kind: LayerId | "history" | "source";
  status: "included" | "truncated" | "dropped" | "compacted" | "failed";
  tokens: number;
  /** Tokens before truncation/compaction, when those happened. */
  originalTokens?: number;
  detail?: string;
  ms?: number;
};

export type ContextTrace = {
  entries: TraceEntry[];
  budget: TokenBudget;
  totals: { system: number; history: number; tools: number; total: number };
  /** Estimated headroom left for the reply. Negative means we over-packed. */
  headroom: number;
  warnings: string[];
};

export type BuiltContext = {
  system: string;
  messages: Message[];
  /** Tool names allowed this turn, after skill unlocks. */
  toolNames: string[];
  trace: ContextTrace;
  skills: ResolvedSkill[];
};
