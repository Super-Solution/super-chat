// The event stream a run emits. This is the framework's public runtime surface:
// React state, server logs, and any host UI are all just reducers over it.
//
// Modelled as events rather than a promise because the interesting parts of an
// agent turn happen BEFORE it finishes — the context trace, the tool calls, the
// card that needs an answer. A promise-shaped API hides all of it.
//
// Ordering guarantees for a step's tools (correlate by `callId`, never by
// position):
//   1. Every `tool-call` of the step is emitted before any tool runs.
//   2. Per callId: `tool-call` → its `card` / `awaiting-user` /
//      `user-responded` → exactly one `tool-result`, failures, timeouts and
//      aborts included.
//   3. `tool-result`s arrive in COMPLETION order, not call order. `confirm`
//      tools still run one at a time after the parallel ones, so their results
//      come last.
//   4. All of a step's `tool-result`s arrive before the next `step-start`.
//   5. The `role: "tool"` message runAgent writes back to history keeps CALL
//      order.
//
// `tool-call-input-delta` comes earlier still: in stream mode, while the model
// is WRITING a call's arguments, before the step ends and before `tool-call`.
// It is a preview — a tolerant parse of the JSON so far, and the card it
// implies when the tool can say (`ToolDefinition.partialCard`). `tool-call`
// remains the authoritative, repaired input, and only the tool's own execute
// path validates and emits a real `card`. Nothing a delta carries is ever
// written to history.

import type { Card, CardAction, CardSpec } from "../cards/types.js";
import type { ContentPart, FinishReason, Usage } from "../content/types.js";
import type { ContextTrace } from "../context/types.js";
import type { JobHandle, JobStatus } from "../providers/types.js";
import type { MeteringRecord } from "./metering.js";
import type { ToolLoadingHint } from "../tools/types.js";

export type RunEvent =
  | { type: "run-start"; runId: string; mode: RunMode }
  /** Emitted before the first provider call — the whole "why did it send that" answer. */
  | { type: "context-built"; trace: ContextTrace; system: string; toolNames: string[] }
  | { type: "step-start"; step: number }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  /**
   * Live-only: a tool call's arguments as far as they have streamed. Stream
   * mode only; never sent for a kind that is interactive. `partialCard` is a
   * VALID but incomplete card, present only when the tool previews one.
   */
  | {
      type: "tool-call-input-delta";
      callId: string;
      name: string;
      partialInput: unknown;
      partialCard?: CardSpec;
      loading?: ToolLoadingHint;
    }
  | { type: "tool-call"; callId: string; name: string; input: unknown; repaired?: boolean; loading?: ToolLoadingHint }
  /** A `confirm`-side tool, or an interactive card, is waiting on the user. */
  | { type: "awaiting-user"; callId: string; card: Card }
  | { type: "user-responded"; callId: string; action: CardAction }
  | { type: "tool-result"; callId: string; name: string; output: unknown; failure?: string; ms: number }
  /** A card was produced — by a tool result, or mid-execution by a long tool. */
  | { type: "card"; card: Card }
  | { type: "card-updated"; cardId: string; spec: CardSpec }
  | { type: "step-finish"; step: number; finishReason: FinishReason; usage?: Usage }
  /** Background mode: the provider accepted the job and we are now polling. */
  | { type: "job-started"; handle: JobHandle }
  | { type: "job-status"; handle: JobHandle; status: JobStatus }
  | { type: "message"; parts: ContentPart[] }
  /** Canonical, idempotent per-step and per-run usage observation. */
  | { type: "metering"; record: MeteringRecord }
  | { type: "usage"; usage: Usage }
  | { type: "run-finish"; runId: string; finishReason: FinishReason; usage: Usage; steps: number }
  | { type: "error"; error: unknown; recoverable: boolean };

export type RunMode = "stream" | "sync" | "background";

/** Accumulated state a host can rebuild from the event stream. */
export type RunState = {
  runId: string;
  mode: RunMode;
  status: "idle" | "running" | "awaiting-user" | "done" | "error";
  parts: ContentPart[];
  cards: Card[];
  usage: Usage;
  steps: number;
  /** Live tool output slots, removed as their correlated result arrives. */
  pendingTools: Record<string, { callId: string; name: string; loading?: ToolLoadingHint }>;
  /**
   * Calls whose arguments are streaming or have streamed, keyed by callId:
   * the latest `tool-call-input-delta` for each. Kept past `tool-call` so a
   * card preview holds its place until the validated card replaces it, and
   * removed with the call's `tool-result`. Live-only — never committed.
   */
  partialTools?: Record<string, PartialToolCall>;
  trace?: ContextTrace;
  /**
   * Tool names actually exposed to the model this run — the base presets PLUS
   * anything a matched skill unlocked. Distinct from what the registry would
   * return for the presets alone, which is why it is recorded rather than
   * recomputed by the UI.
   */
  toolNames?: string[];
  job?: { handle: JobHandle; status: JobStatus };
  pendingCard?: Card;
  error?: unknown;
  finishReason?: FinishReason;
};

export type PartialToolCall = {
  callId: string;
  name: string;
  partialInput: unknown;
  partialCard?: CardSpec;
  loading?: ToolLoadingHint;
};

export function initialRunState(runId: string, mode: RunMode): RunState {
  return { runId, mode, status: "idle", parts: [], cards: [], usage: {}, steps: 0, pendingTools: {}, partialTools: {} };
}

function mergeUsage(a: Usage, b?: Usage): Usage {
  if (!b) return a;
  const add = (x?: number, y?: number) => (x == null && y == null ? undefined : (x ?? 0) + (y ?? 0));
  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    totalTokens: add(a.totalTokens, b.totalTokens),
    cachedInputTokens: add(a.cachedInputTokens, b.cachedInputTokens),
    reasoningTokens: add(a.reasoningTokens, b.reasoningTokens),
  };
}

/**
 * The canonical reducer. React, a CLI renderer and a server-side recorder all
 * use this one function, so they can never disagree about what a run looked like.
 */
export function reduceRunEvent(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case "run-start":
      return { ...state, runId: event.runId, mode: event.mode, status: "running" };
    case "context-built":
      return { ...state, trace: event.trace, toolNames: event.toolNames };
    case "step-start":
      return { ...state, steps: event.step + 1 };
    case "text-delta": {
      const last = state.parts[state.parts.length - 1];
      const parts =
        last && last.type === "text"
          ? [...state.parts.slice(0, -1), { ...last, text: last.text + event.delta }]
          : [...state.parts, { type: "text" as const, text: event.delta }];
      return { ...state, parts };
    }
    case "reasoning-delta": {
      const last = state.parts[state.parts.length - 1];
      const parts =
        last && last.type === "reasoning"
          ? [...state.parts.slice(0, -1), { ...last, text: last.text + event.delta }]
          : [...state.parts, { type: "reasoning" as const, text: event.delta }];
      return { ...state, parts };
    }
    case "tool-call-input-delta":
      return {
        ...state,
        partialTools: {
          ...state.partialTools,
          [event.callId]: {
            callId: event.callId,
            name: event.name,
            partialInput: event.partialInput,
            ...(event.partialCard ? { partialCard: event.partialCard } : {}),
            ...(event.loading ? { loading: event.loading } : {}),
          },
        },
      };
    case "tool-call":
      return {
        ...state,
        pendingTools: {
          ...state.pendingTools,
          [event.callId]: {
            callId: event.callId,
            name: event.name,
            ...(event.loading ? { loading: event.loading } : {}),
          },
        },
        parts: [
          ...state.parts,
          { type: "tool-call", callId: event.callId, name: event.name, input: event.input, status: "running", ...(event.repaired ? { repaired: true } : {}) },
        ],
      };
    case "awaiting-user":
      return { ...state, status: "awaiting-user", pendingCard: event.card, cards: upsertCard(state.cards, event.card) };
    case "user-responded":
      // Record the answer ON the card. It is the only copy that outlives the
      // run: the renderer's local state dies when the turn commits and the card
      // re-mounts from history.
      return {
        ...state,
        status: "running",
        pendingCard: undefined,
        cards: state.cards.map((c) => (c.callId === event.callId ? { ...c, action: event.action } : c)),
      };
    case "tool-result": {
      const pendingTools = { ...state.pendingTools };
      delete pendingTools[event.callId];
      return {
        ...state,
        pendingTools,
        ...(state.partialTools?.[event.callId] ? { partialTools: without(state.partialTools, event.callId) } : {}),
        parts: [
          ...markCallDone(state.parts, event.callId, event.failure ? "error" : "done"),
          {
            type: "tool-result",
            callId: event.callId,
            name: event.name,
            output: event.output,
            ms: event.ms,
            ...(event.failure ? { failure: event.failure as never } : {}),
          },
        ],
      };
    }
    case "card":
      return { ...state, cards: upsertCard(state.cards, event.card) };
    case "card-updated":
      return {
        ...state,
        cards: state.cards.map((c) => (c.id === event.cardId ? { ...c, spec: event.spec } : c)),
      };
    case "job-started":
      return { ...state, job: { handle: event.handle, status: "queued" } };
    case "job-status":
      return { ...state, job: { handle: event.handle, status: event.status } };
    case "message":
      return { ...state, parts: [...state.parts, ...event.parts] };
    case "metering":
      // Metering is an observation event. The legacy `usage` event remains the
      // sole live accumulator so adding this event is backwards compatible and
      // cannot double-count a turn.
      return state;
    // ── usage: exactly one event accumulates ──────────────────────────────
    // runAgent reports a step's cost three times: `usage` (live), `step-finish`
    // (the same numbers again, for consumers that only watch step boundaries)
    // and `run-finish` (the running total). Adding all three counted every
    // turn 3×, which is not a rounding error — it read as context overflow on
    // a model whose window it had not come close to.
    case "usage":
      return { ...state, usage: mergeUsage(state.usage, event.usage) };
    case "step-finish":
      // Deliberately does NOT touch usage: the `usage` event above already
      // added this step. `steps` is owned by step-start.
      return state;
    case "run-finish":
      // A failed run stays failed: runAgent yields error → run-finish, and an
      // unconditional "done" here would mask the error from every consumer.
      // Cancellation maps to "done" — a user abort is an outcome, not a fault.
      return {
        ...state,
        status: event.finishReason === "error" ? "error" : "done",
        pendingTools: {},
        partialTools: {},
        finishReason: event.finishReason,
        // REPLACE, not merge. This is runAgent's own total across every step,
        // so it is the authoritative figure — and taking it wholesale also
        // repairs any drift for a consumer that fed the reducer a step-finish
        // without its paired usage event.
        usage: event.usage,
        steps: event.steps,
      };
    case "error":
      return {
        ...state,
        status: event.recoverable ? state.status : "error",
        ...(event.recoverable ? {} : { pendingTools: {}, partialTools: {} }),
        error: event.error,
      };
    default:
      return state;
  }
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function upsertCard(cards: Card[], card: Card): Card[] {
  const i = cards.findIndex((c) => c.id === card.id);
  if (i === -1) return [...cards, card];
  const next = [...cards];
  next[i] = card;
  return next;
}

function markCallDone(parts: ContentPart[], callId: string, status: "done" | "error"): ContentPart[] {
  return parts.map((p) => (p.type === "tool-call" && p.callId === callId ? { ...p, status } : p));
}
