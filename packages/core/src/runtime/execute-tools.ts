// Tool execution.
//
// Two rules that matter more than they look:
//
//  1. A tool that throws returns `{ error }` to the model, not an exception to
//     the caller. A model that reads "no pool found for SUI/FOO" picks a
//     different pool; a stack trace that kills the run teaches it nothing and
//     costs the user their turn.
//
//  2. Errors are COMPACTED. A raw error can be a 40KB stack that then rides in
//     history for the rest of the conversation, crowding out the actual work.
//
//  3. `side: "confirm"` is enforced HERE, on the one path every tool call takes,
//     whether a model or a button started it. No approval means no execution.

import { AgentError, toAgentError } from "../errors.js";
import { makeCard } from "../cards/registry.js";
import { CARD_KEY, isCardCarrier, withCard, type Card, type CardSpec } from "../cards/types.js";
import type { SurfaceLedger } from "../surfaces/ledger.js";
import { approvalCard } from "../tools/approval.js";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "../tools/types.js";

export type ToolCallRequest = { callId: string; name: string; input: unknown };

export type ToolCallOutcome = {
  callId: string;
  name: string;
  output: unknown;
  card?: Card;
  failure?: string;
  /** Tool names this outcome unlocked for the rest of the run (loadSkill). */
  unlockTools?: string[];
  ms: number;
};

const MAX_ERROR_CHARS = 400;

/** Shrink an error to something worth carrying in history. */
export function compactError(e: unknown): { error: string; kind?: string } {
  if (e instanceof AgentError) {
    return { error: e.message.slice(0, MAX_ERROR_CHARS), kind: e.kind };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { error: message.slice(0, MAX_ERROR_CHARS) || "Tool failed with no message." };
}


/**
 * Why a `side: "confirm"` tool may not start, or `undefined` when it may. Anything
 * short of an explicit yes is a no: a host that cannot ask, a dismissed card, a
 * stopped run, an answer this code does not recognise.
 */
async function confirmationRefusal(tool: ToolDefinition, call: ToolCallRequest, opts: ExecuteToolOptions): Promise<string | undefined> {
  if (!opts.requestCard) return `"${tool.name}" needs the user's approval and this host cannot ask for it.`;
  if (tool.confirmation === "tool") return undefined;
  const answer = await opts.requestCard(call.callId, approvalCard(tool, call.input));
  if (opts.signal?.aborted) return "The run was stopped before this was approved.";
  return (answer as { confirmed?: unknown } | null | undefined)?.confirmed === true ? undefined : "The user declined.";
}

const isToolResult = (v: unknown): v is ToolResult =>
  typeof v === "object" &&
  v !== null &&
  "output" in v &&
  Object.keys(v).every((k) => ["output", "card", "failure", "cardId", "unlockTools", "placement"].includes(k));

export type ExecuteToolOptions = {
  tools: readonly ToolDefinition[];
  vars: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  onCard?: (card: Card) => void;
  /** Suspend and ask the user. Supplied by the runtime; resolves on a CardAction. */
  requestCard?: (callId: string, spec: CardSpec) => Promise<unknown>;
  /** Host-executed tools (no `execute`) are delegated here. */
  onHostTool?: (call: ToolCallRequest) => Promise<unknown>;
  /**
   * `executeToolCalls` only: fires as each call settles, in COMPLETION order,
   * exactly once per call — failures and timeouts included. This is how a
   * fast result reaches the UI without waiting on the slowest call in the step.
   */
  onOutcome?: (outcome: ToolCallOutcome) => void;
  /**
   * Precomputed name→tool index. `executeToolCalls` builds this once per
   * batch and reuses it here instead of a linear `tools.find` per call; a
   * standalone `executeToolCall` caller can leave it unset and pay the scan.
   */
  toolIndex?: ReadonlyMap<string, ToolDefinition>;
  surfaces?: SurfaceLedger;
  surfaceActionTools?: readonly string[];
};

export async function executeToolCall(call: ToolCallRequest, opts: ExecuteToolOptions): Promise<ToolCallOutcome> {
  const started = Date.now();
  const tool = opts.toolIndex ? opts.toolIndex.get(call.name) : opts.tools.find((t) => t.name === call.name);

  if (!tool) {
    // Name the tools that DO exist — a model that hallucinated a name recovers
    // from a list, and loops forever without one.
    return {
      callId: call.callId,
      name: call.name,
      output: {
        error: `Unknown tool "${call.name}".`,
        availableTools: opts.tools.map((t) => t.name),
      },
      failure: "not-found",
      ms: Date.now() - started,
    };
  }

  let emittedCard: Card | undefined;
  // A timed-out tool keeps running in the background. Once its outcome is
  // decided, anything it surfaces would land AFTER its own tool-result — a
  // progress card for a finished call, or a dialog nobody is waiting on.
  let settled = false;
  const ctx: ToolExecutionContext = {
    vars: opts.vars,
    signal: opts.signal,
    callId: call.callId,
    ...(opts.surfaces ? { surfaces: opts.surfaces } : {}),
    ...(opts.surfaceActionTools ? { surfaceActionTools: opts.surfaceActionTools } : {}),
    emitCard: (spec) => {
      if (settled) return;
      const card = makeCard(spec, call.callId);
      emittedCard = card;
      opts.onCard?.(card);
    },
    ...(opts.requestCard
      ? {
          requestCard: (spec: CardSpec) =>
            settled
              ? Promise.reject(new AgentError("cancelled", `Tool "${call.name}" already finished.`))
              : opts.requestCard!(call.callId, spec),
        }
      : {}),
  };

  try {
    // Before the timeout starts: a person deciding is not a tool running slowly.
    if (tool.side === "confirm") {
      const refusal = await confirmationRefusal(tool, call, opts);
      if (refusal) return { callId: call.callId, name: call.name, output: { error: refusal }, failure: "denied", ms: Date.now() - started };
    }

    const raw = tool.execute
      ? await withTimeout(Promise.resolve(tool.execute(call.input, ctx)), opts.timeoutMs, call.name)
      : opts.onHostTool
        ? await withTimeout(opts.onHostTool(call), opts.timeoutMs, call.name)
        : (() => {
            throw new AgentError("not-supported", `Tool "${call.name}" has no executor and no host handler.`);
          })();

    const result: ToolResult = isToolResult(raw) ? raw : { output: raw };

    // A tool may attach a card three ways, and all three must work — a tool
    // author should not have to know which one the runtime happens to check:
    //   1. `ctx.emitCard(spec)`      mid-execution (progress on a long tool)
    //   2. `{ output, card: spec }`  the explicit result field
    //   3. `withCard(output, spec)`  embedded in the output under $card
    // Whichever is used, the card ends up BOTH surfaced to the UI and carried
    // inside the output — the latter so it survives persistence, since the
    // ContextBuilder strips it again before the next provider call.
    let card = emittedCard;
    let output = result.output;

    if (result.card) {
      card = makeCard(result.card, call.callId, result.cardId, result.placement === "panel" ? "panel" : undefined);
      output = withCard(asRecord(result.output), card.spec, card.id, card.placement);
      opts.onCard?.(card);
    } else if (isCardCarrier(result.output)) {
      const embedded = result.output[CARD_KEY];
      card = { ...embedded, callId: call.callId };
      opts.onCard?.(card);
    }

    return {
      callId: call.callId,
      name: call.name,
      output: explainMissingInput(tool, call.input, output, result.failure),
      ...(card ? { card } : {}),
      ...(result.failure ? { failure: result.failure } : {}),
      ...(result.unlockTools?.length ? { unlockTools: result.unlockTools } : {}),
      ms: Date.now() - started,
    };
  } catch (e) {
    const err = toAgentError(e);
    return {
      callId: call.callId,
      name: call.name,
      output: explainMissingInput(tool, call.input, compactError(err), err.kind === "cancelled" ? "denied" : err.kind === "timeout" ? "timeout" : "execution-error"),
      failure: err.kind === "cancelled" ? "denied" : "execution-error",
      ms: Date.now() - started,
    };
  } finally {
    settled = true;
  }
}

const NOT_ABOUT_INPUT = new Set(["denied", "timeout", "not-found"]);
const MAX_DESCRIBED = 200;

/**
 * A failed call that never named what the tool requires gets told exactly that.
 *
 * Models sometimes send a call with no arguments (`{}`) for a tool whose schema
 * lists required ones. The tool's own error then says something short and
 * tool-specific ("No symbol given."), and a model that does not see why often
 * sends the identical call again. When the call failed AND a top-level
 * `required` key is absent from its input, this adds `missing` (the names) and
 * `expected` (each one's type, enum and description from the tool's own
 * schema) next to whatever the tool said, so the retry has something to fill.
 *
 * Additive on purpose: only failed outputs, never a rewrite of the tool's own
 * error, and nothing is checked on a call that succeeded — a tool may fall
 * back to a default for a required key (the chart in view) and that stays its
 * decision.
 */
export function explainMissingInput(tool: ToolDefinition, input: unknown, output: unknown, failure?: string): unknown {
  if (failure && NOT_ABOUT_INPUT.has(failure)) return output;
  if (typeof output !== "object" || output === null || Array.isArray(output)) return output;
  const out = output as Record<string, unknown>;
  const failed = failure !== undefined || (typeof out.error === "string" && out.ok !== true);
  if (!failed || "missing" in out || "expected" in out) return output;

  const schema = tool.inputSchema as { required?: unknown; properties?: unknown } | undefined;
  const required = Array.isArray(schema?.required) ? schema.required.filter((k): k is string => typeof k === "string") : [];
  if (!required.length) return output;
  const given = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const missing = required.filter((k) => given[k] === undefined || given[k] === null);
  if (!missing.length) return output;

  const props = (typeof schema?.properties === "object" && schema.properties !== null ? schema.properties : {}) as Record<string, unknown>;
  const expected: Record<string, unknown> = {};
  for (const key of missing) expected[key] = describeProperty(props[key]);
  return { ...out, missing, expected };
}

function describeProperty(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {};
  const p = raw as Record<string, unknown>;
  const d: Record<string, unknown> = {};
  for (const k of ["type", "enum", "minimum", "maximum"] as const) if (p[k] !== undefined) d[k] = p[k];
  if (typeof p.description === "string") {
    d.description = p.description.length > MAX_DESCRIBED ? `${p.description.slice(0, MAX_DESCRIBED)}…` : p.description;
  }
  return d;
}

/**
 * Execute a step's calls concurrently.
 *
 * Parallel because models emit independent calls in one step and running them
 * serially triples the latency of a three-lookup turn. Two orders, on purpose:
 * `onOutcome` reports each call as it FINISHES, so a 50ms lookup is not held
 * hostage by a 900ms one; the returned array is in CALL order, since that is
 * what gets written back to history and humans read the transcript top to
 * bottom.
 */
export async function executeToolCalls(
  calls: readonly ToolCallRequest[],
  opts: ExecuteToolOptions,
): Promise<ToolCallOutcome[]> {
  // Built once for the whole batch and reused for both the interactive filter
  // below and every executeToolCall — a linear tools.find() per call, twice
  // over, is wasted work once the tool list is more than a handful long.
  const toolIndex = opts.toolIndex ?? new Map(opts.tools.map((t) => [t.name, t] as const));
  const callOpts: ExecuteToolOptions = opts.toolIndex ? opts : { ...opts, toolIndex };

  // Interactive tools must NOT run in parallel — two confirm dialogs racing for
  // the same user is not a thing a user can answer.
  const interactive = calls.filter((c) => toolIndex.get(c.name)?.side === "confirm");
  const concurrent = calls.filter((c) => !interactive.includes(c));

  // executeToolCall never rejects — every failure is already an outcome — so
  // this reports each call exactly once.
  const settle = async (c: ToolCallRequest) => {
    const outcome = await executeToolCall(c, callOpts);
    opts.onOutcome?.(outcome);
    return outcome;
  };

  const concurrentResults = await Promise.all(concurrent.map(settle));
  const serialResults: ToolCallOutcome[] = [];
  for (const c of interactive) serialResults.push(await settle(c));

  const byId = new Map([...concurrentResults, ...serialResults].map((r) => [r.callId, r]));
  return calls.map((c) => byId.get(c.callId)!).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return { result: value };
}

function withTimeout<T>(promise: Promise<T>, ms: number | undefined, name: string): Promise<T> {
  if (!ms) return promise;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new AgentError("timeout", `Tool "${name}" timed out after ${ms}ms.`)), ms),
    ),
  ]);
}
