// The agent loop.
//
// One async generator drives all three modes (stream / sync / background) so
// there is exactly one place where "call model → run tools → loop" lives. The
// modes differ only in HOW a step's result is obtained:
//
//   stream     — SSE, deltas surface immediately
//   sync       — one request/response
//   background — provider-side job + polling; survives a closed tab
//
// Everything after that — tool dispatch, card suspension, stop conditions,
// history append — is identical, which is the point.

import { assistantMessage, nextId } from "../content/parts.js";
import type { ContentPart, FinishReason, Message, Usage } from "../content/types.js";
import { stripCardPayload, type Card, type CardAction, type CardSpec } from "../cards/types.js";
import { makeCard } from "../cards/registry.js";
import type { ContextBuilder } from "../context/builder.js";
import { AgentError, toAgentError } from "../errors.js";
import type { GenerateResult, NormalizedRequest, Provider, StreamEvent } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { resolvePartialCard, resolveToolLoading, type ToolDefinition, type ToolResolution } from "../tools/types.js";
import { PartialJsonParser } from "../tools/partial-json.js";
import { awaitJob } from "./jobs.js";
import { executeToolCalls, type ToolCallRequest } from "./execute-tools.js";
import { EventChannel } from "./channel.js";
import type { RunEvent, RunMode } from "./events.js";
import {
  combineMeteringSources,
  deliverMetering,
  usageSource,
  type MeterSink,
  type MeteringRecord,
  type MeteringSource,
} from "./metering.js";
import { shouldStop, type StopCondition } from "./stop.js";

export type RunConfig = {
  provider: Provider;
  model: string;
  contextBuilder: ContextBuilder;
  tools: ToolRegistry;
  toolResolution: ToolResolution;
  mode?: RunMode;
  maxSteps?: number;
  stopWhen?: StopCondition[];
  vars?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: NormalizedRequest["reasoning"];
  // Pass-throughs to NormalizedRequest — the adapter implements all of these;
  // without this block no runAgent caller could ever set them.
  toolChoice?: NormalizedRequest["toolChoice"];
  /** Provider-hosted tools (web search, code interpreter), keyed by provider id. */
  providerTools?: NormalizedRequest["providerTools"];
  responseFormat?: NormalizedRequest["responseFormat"];
  topP?: number;
  stopSequences?: string[];
  /** Provider-side conversation storage opt-out (OpenAI `store`). */
  store?: boolean;
  metadata?: Record<string, string>;
  /** Usage delivery target. Pricing and persistence belong to the host. */
  meter?: MeterSink;
  /** Host-only dimensions copied onto metering records, never sent upstream. */
  meteringMetadata?: Readonly<Record<string, string>>;
  /** The per-provider escape hatch, keyed by provider id. */
  providerOptions?: NormalizedRequest["providerOptions"];
  toolTimeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Resolve an interactive card. The host shows it and returns the user's
   * answer. Absent means interactive cards auto-decline rather than hang.
   */
  onUserDecision?: (callId: string, card: Card) => Promise<CardAction>;
  /** Execute a tool that has no `execute` (browser-side capabilities). */
  onHostTool?: (call: ToolCallRequest) => Promise<unknown>;
  /** Persist a background job handle so a reload can resume it. */
  onJobHandle?: (handle: NonNullable<GenerateResult["responseId"]> extends string ? unknown : never) => void;
  /** Skills the user pinned in the UI. */
  forceSkillIds?: string[];
  /**
   * Chain via the provider's stored response instead of resending history.
   * Only used when the provider supports it; cuts input tokens dramatically on
   * long tool loops.
   */
  useServerHistory?: boolean;
};

export async function* runAgent(
  messages: readonly Message[],
  config: RunConfig,
): AsyncGenerator<RunEvent, void, unknown> {
  const runId = nextId("run");
  const mode = config.mode ?? "stream";
  const maxSteps = config.maxSteps ?? 8;
  const vars = config.vars ?? {};
  const runStartedAt = Date.now();

  yield { type: "run-start", runId, mode };

  // Mutable accumulators: `.push()`, not `[...arr, x]` — this loop runs once
  // per step of a potentially long tool-calling turn, and re-copying the
  // whole array every step is wasted work on a long thread. Neither array is
  // returned or exposed outside this generator (see the yields below), so
  // there is no reference-equality contract to preserve.
  const history: Message[] = [...messages];
  let totalUsage: Usage = {};
  let finishReason: FinishReason = "unknown";
  let step = 0;
  let attemptedSteps = 0;
  let previousResponseId: string | undefined;
  const meteringSources: MeteringSource[] = [];
  const reportedModels = new Set<string>();

  try {
    // ── context, built once per run ────────────────────────────────────────
    // Rebuilding per step would let skills flap in and out mid-turn and would
    // break the cacheable prompt prefix. Tool RESULTS extend history within the
    // loop; the instruction block stays fixed.
    const baseTools = config.tools.resolve(config.toolResolution);
    const context = await config.contextBuilder.build({
      messages: history,
      vars,
      forceSkillIds: config.forceSkillIds,
      baseTools: baseTools.map((t) => t.name),
      signal: config.signal,
    });

    yield { type: "context-built", trace: context.trace, system: context.system, toolNames: context.toolNames };

    // Skills may have unlocked tools beyond the base presets. `let`, not
    // `const`: a loadSkill outcome can unlock more mid-run (see below).
    let unlockedNames = [...context.toolNames];
    let activeTools = config.tools.resolve({ ...config.toolResolution, allow: unlockedNames });
    let specs = config.tools.toSpecs(activeTools);

    const working: Message[] = [...context.messages];

    while (step < maxSteps) {
      if (config.signal?.aborted) throw new AgentError("cancelled", "Run was cancelled.");
      yield { type: "step-start", step };
      attemptedSteps += 1;
      const stepStartedAt = Date.now();

      const request: NormalizedRequest = {
        model: config.model,
        system: context.system,
        messages: working,
        ...(specs.length ? { tools: specs } : {}),
        ...(config.providerTools ? { providerTools: config.providerTools } : {}),
        ...(config.toolChoice ? { toolChoice: config.toolChoice } : {}),
        ...(config.temperature != null ? { temperature: config.temperature } : {}),
        ...(config.topP != null ? { topP: config.topP } : {}),
        ...(config.maxOutputTokens != null ? { maxOutputTokens: config.maxOutputTokens } : {}),
        ...(config.stopSequences?.length ? { stopSequences: config.stopSequences } : {}),
        ...(config.responseFormat ? { responseFormat: config.responseFormat } : {}),
        ...(config.store != null ? { store: config.store } : {}),
        ...(config.metadata ? { metadata: config.metadata } : {}),
        ...(config.providerOptions ? { providerOptions: config.providerOptions } : {}),
        ...(config.reasoning ? { reasoning: config.reasoning } : {}),
        ...(config.useServerHistory && previousResponseId && config.provider.capabilities.serverSideHistory
          ? { previousResponseId }
          : {}),
      };

      // ── obtain this step's result ────────────────────────────────────────
      let parts: ContentPart[] = [];
      let stepFinish: FinishReason = "unknown";
      let stepUsage: Usage | undefined;
      let responseId: string | undefined;
      let reportedModel: string | undefined;
      let streamSnapshot: (() => GenerateResult) | undefined;

      try {
        if (mode === "stream" && config.provider.capabilities.streaming) {
          const collected = collectStream(config.provider.stream(request, { signal: config.signal }));
          streamSnapshot = collected.result;
          // Arguments still being written, per call. Parsed incrementally, and
          // forwarded only when the parse visibly changed: whitespace, a key's
          // characters or an unfinished number are not worth a re-render.
          const writing = new Map<string, { name: string; tool?: ToolDefinition; parser: PartialJsonParser; seen: number }>();
          for await (const event of collected.events()) {
            if (event.type === "text-delta") yield { type: "text-delta", delta: event.delta };
            else if (event.type === "reasoning-delta") yield { type: "reasoning-delta", delta: event.delta };
            else if (event.type === "tool-call-start") {
              const tool = activeTools.find((t) => t.name === event.name);
              writing.set(event.callId, { name: event.name, tool, parser: new PartialJsonParser(), seen: 0 });
            } else if (event.type === "tool-call-delta") {
              const call = writing.get(event.callId);
              if (!call) continue;
              call.parser.push(event.argsDelta);
              if (call.parser.version === call.seen) continue;
              call.seen = call.parser.version;
              const partialInput = call.parser.snapshot();
              if (partialInput === undefined) continue;
              const partialCard = resolvePartialCard(call.tool, partialInput);
              const loading = resolveToolLoading(call.tool?.loading, partialInput);
              yield {
                type: "tool-call-input-delta",
                callId: event.callId,
                name: call.name,
                partialInput,
                ...(partialCard ? { partialCard } : {}),
                ...(loading ? { loading } : {}),
              };
            } else if (event.type === "error") throw toAgentError(event.error, config.provider.id);
          }
          const done = collected.result();
          parts = done.parts;
          stepFinish = done.finishReason;
          stepUsage = done.usage;
          responseId = done.responseId;
          reportedModel = done.modelId || undefined;
        } else if (mode === "background") {
          if (!config.provider.startJob || !config.provider.capabilities.backgroundJobs) {
            throw new AgentError(
              "not-supported",
              `Provider "${config.provider.id}" has no background mode. Use mode "stream" or "sync".`,
            );
          }
          const handle = await config.provider.startJob({ ...request, background: true }, { signal: config.signal });
          reportedModel = handle.model || undefined;
          responseId = handle.id;
          yield { type: "job-started", handle };

          // Polling, not streaming: the entire value of background mode is that it
          // survives a dropped connection, and a stream does not.
          const snapshot = await awaitJob(config.provider, handle, { signal: config.signal });
          yield { type: "job-status", handle, status: snapshot.status };

          if (snapshot.status === "cancelled") {
            throw new AgentError("cancelled", snapshot.error?.message ?? "Background job was cancelled.", {
              provider: config.provider.id,
            });
          }
          if (snapshot.status === "failed" || !snapshot.result) {
            throw new AgentError("unknown", snapshot.error?.message ?? `Background job ended as ${snapshot.status}.`, {
              provider: config.provider.id,
            });
          }
          parts = snapshot.result.parts;
          stepFinish = snapshot.result.finishReason;
          stepUsage = snapshot.result.usage;
          responseId = snapshot.result.responseId ?? responseId;
          reportedModel = snapshot.result.modelId || reportedModel;
          // Deltas never streamed, so surface the text as one block.
          const textParts = parts.filter((p) => p.type === "text");
          if (textParts.length) yield { type: "message", parts: textParts };
        } else {
          const result = await config.provider.generate(request, { signal: config.signal });
          parts = result.parts;
          stepFinish = result.finishReason;
          stepUsage = result.usage;
          responseId = result.responseId;
          reportedModel = result.modelId || undefined;
          const textParts = parts.filter((p) => p.type === "text");
          if (textParts.length) yield { type: "message", parts: textParts };
        }
      } catch (cause) {
        const error = toAgentError(cause, config.provider.id);
        const partial = streamSnapshot?.();
        stepUsage = partial?.usage ?? stepUsage ?? {};
        responseId = partial?.responseId ?? responseId;
        reportedModel = partial?.modelId || reportedModel;
        const source = usageSource(stepUsage);
        meteringSources.push(source);
        if (reportedModel) reportedModels.add(reportedModel);
        if (source !== "unavailable") {
          totalUsage = addUsage(totalUsage, stepUsage);
          yield { type: "usage", usage: stepUsage };
        }
        const finishedAt = Date.now();
        const record: MeteringRecord = {
          scope: "step",
          id: `${runId}:step:${step}`,
          runId,
          step,
          provider: config.provider.id,
          requestedModel: config.model,
          ...(reportedModel ? { reportedModel } : {}),
          mode,
          status: error.kind === "cancelled" ? "cancelled" : "failed",
          usage: stepUsage,
          source,
          startedAt: stepStartedAt,
          finishedAt,
          durationMs: finishedAt - stepStartedAt,
          ...(responseId ? { responseId } : {}),
          ...(config.meteringMetadata ? { metadata: config.meteringMetadata } : {}),
          error: { kind: error.kind, message: error.message },
        };
        await deliverMetering(config.meter, record);
        yield { type: "metering", record };
        throw error;
      }

      previousResponseId = responseId;
      if (stepUsage) {
        totalUsage = addUsage(totalUsage, stepUsage);
        yield { type: "usage", usage: stepUsage };
      }
      const source = usageSource(stepUsage ?? {});
      meteringSources.push(source);
      if (reportedModel) reportedModels.add(reportedModel);
      const finishedAt = Date.now();
      const record: MeteringRecord = {
        scope: "step",
        id: `${runId}:step:${step}`,
        runId,
        step,
        provider: config.provider.id,
        requestedModel: config.model,
        ...(reportedModel ? { reportedModel } : {}),
        mode,
        status: meteringStatus(stepFinish),
        usage: stepUsage ?? {},
        source,
        startedAt: stepStartedAt,
        finishedAt,
        durationMs: finishedAt - stepStartedAt,
        ...(responseId ? { responseId } : {}),
        finishReason: stepFinish,
        ...(config.meteringMetadata ? { metadata: config.meteringMetadata } : {}),
      };
      await deliverMetering(config.meter, record);
      yield { type: "metering", record };
      yield { type: "step-finish", step, finishReason: stepFinish, ...(stepUsage ? { usage: stepUsage } : {}) };

      const assistant = assistantMessage(parts);
      working.push(assistant);
      history.push(assistant);

      const calls: ToolCallRequest[] = parts
        .filter((p): p is Extract<ContentPart, { type: "tool-call" }> => p.type === "tool-call")
        .map((p) => ({ callId: p.callId, name: p.name, input: p.input }));

      if (!calls.length) {
        finishReason = stepFinish;
        break;
      }

      for (const call of calls) {
        const source = parts.find((p) => p.type === "tool-call" && p.callId === call.callId) as
          | Extract<ContentPart, { type: "tool-call" }>
          | undefined;
        const loading = resolveToolLoading(config.tools.get(call.name)?.loading, call.input);
        yield {
          type: "tool-call",
          callId: call.callId,
          name: call.name,
          input: call.input,
          ...(source?.repaired ? { repaired: true } : {}),
          ...(loading ? { loading } : {}),
        };
      }

      // ── run tools ────────────────────────────────────────────────────────
      // Tool execution is a plain async call and cannot yield into this loop, so
      // it pushes into a channel that we drain CONCURRENTLY. Draining afterwards
      // would deadlock the human-in-the-loop path: the tool waits on the user,
      // the user waits to see the card, and the card waits on the tool.
      //
      // Results go through the same channel, in COMPLETION order: yielding them
      // after `await running` made every result in a step land together, when
      // the slowest tool finished. History below stays in CALL order.
      const channel = new EventChannel<RunEvent>();
      const running = executeToolCalls(calls, {
        tools: activeTools,
        vars,
        signal: config.signal,
        timeoutMs: config.toolTimeoutMs,
        onCard: (card) => channel.push({ type: "card", card }),
        onOutcome: (outcome) =>
          channel.push({
            type: "tool-result",
            callId: outcome.callId,
            name: outcome.name,
            output: outcome.output,
            ...(outcome.failure ? { failure: outcome.failure } : {}),
            ms: outcome.ms,
          }),
        onHostTool: config.onHostTool,
        requestCard: config.onUserDecision
          ? async (callId, spec: CardSpec) => {
              const card = makeCard(spec, callId);
              channel.push({ type: "awaiting-user", callId, card });
              const action = await config.onUserDecision!(callId, card);
              channel.push({ type: "user-responded", callId, action });
              return action.type === "cancel" || action.type === "dismiss"
                ? { cancelled: true, reason: "The user declined." }
                : (action.value ?? { confirmed: true });
            }
          : undefined,
      }).finally(() => channel.close());

      for await (const event of channel) yield event;
      const outcomes = await running;

      // Two versions of each tool result, deliberately:
      //   • the EVENT (already sent via `onOutcome`) carries the full output,
      //     card payload included, so the UI can render it and the host can
      //     persist it;
      //   • the message fed back to the provider has the card stripped. The
      //     model already read the surrounding data, and re-sending a chart
      //     spec on every subsequent step of the same turn is pure waste.
      // No events here: every card and every result already went out through
      // the channel. Re-yielding would double-count in any host recording the
      // stream.
      const providerParts: ContentPart[] = [];
      const persistedParts: ContentPart[] = [];
      for (const outcome of outcomes) {
        const base = {
          type: "tool-result" as const,
          callId: outcome.callId,
          name: outcome.name,
          ...(outcome.failure ? { failure: outcome.failure as never } : {}),
        };
        providerParts.push({ ...base, output: stripCardPayload(outcome.output) });
        persistedParts.push({ ...base, output: outcome.output });
      }

      const createdAt = Date.now();
      const toolId = nextId("tool");
      working.push({ id: toolId, role: "tool", parts: providerParts, createdAt });
      history.push({ id: toolId, role: "tool", parts: persistedParts, createdAt });

      // loadSkill's pull half: an outcome that unlocked tools re-resolves the
      // active set so the names it announced are callable from the NEXT step.
      // This does change the declared tool block mid-run — accepted: a cache
      // miss on the remaining steps beats advertising tools that 404.
      const unlocked = outcomes.flatMap((o) => o.unlockTools ?? []).filter((n) => !unlockedNames.includes(n));
      if (unlocked.length) {
        unlockedNames = [...unlockedNames, ...unlocked];
        activeTools = config.tools.resolve({ ...config.toolResolution, allow: unlockedNames });
        specs = config.tools.toSpecs(activeTools);
      }

      step += 1;
      finishReason = stepFinish;

      const stop = shouldStop(config.stopWhen, { step, finishReason: stepFinish, outcomes, usage: totalUsage });
      if (stop) {
        finishReason = "stop";
        break;
      }
    }

    // Hitting the cap with the model still wanting to act means the answer is
    // truncated. Saying so is better than presenting half a task as finished.
    if (step >= maxSteps && finishReason === "tool-calls") {
      yield {
        type: "message",
        parts: [
          {
            type: "text",
            text: `\n\n_(Reached the ${maxSteps}-step limit while still working — this may be incomplete. Ask me to continue.)_`,
          },
        ],
      };
    }

    const finishedAt = Date.now();
    const record: MeteringRecord = {
      scope: "run",
      id: `${runId}:run`,
      runId,
      provider: config.provider.id,
      requestedModel: config.model,
      mode,
      status: meteringStatus(finishReason),
      usage: totalUsage,
      source: combineMeteringSources(meteringSources),
      startedAt: runStartedAt,
      finishedAt,
      durationMs: finishedAt - runStartedAt,
      steps: attemptedSteps,
      finishReason,
      ...(reportedModels.size ? { reportedModels: [...reportedModels] } : {}),
      ...(config.meteringMetadata ? { metadata: config.meteringMetadata } : {}),
    };
    await deliverMetering(config.meter, record);
    yield { type: "metering", record };
    yield { type: "run-finish", runId, finishReason, usage: totalUsage, steps: attemptedSteps };
  } catch (e) {
    const error = toAgentError(e, config.provider.id);
    yield { type: "error", error, recoverable: false };
    const terminalReason: FinishReason = error.kind === "cancelled" ? "cancelled" : "error";
    const finishedAt = Date.now();
    const record: MeteringRecord = {
      scope: "run",
      id: `${runId}:run`,
      runId,
      provider: config.provider.id,
      requestedModel: config.model,
      mode,
      status: error.kind === "cancelled" ? "cancelled" : "failed",
      usage: totalUsage,
      source: combineMeteringSources(meteringSources),
      startedAt: runStartedAt,
      finishedAt,
      durationMs: finishedAt - runStartedAt,
      steps: attemptedSteps,
      finishReason: terminalReason,
      ...(reportedModels.size ? { reportedModels: [...reportedModels] } : {}),
      ...(config.meteringMetadata ? { metadata: config.meteringMetadata } : {}),
      error: { kind: error.kind, message: error.message },
    };
    await deliverMetering(config.meter, record);
    yield { type: "metering", record };
    yield { type: "run-finish", runId, finishReason: terminalReason, usage: totalUsage, steps: attemptedSteps };
  }
}

/**
 * Tee a provider stream: forward deltas for live rendering while accumulating
 * the parts that become the assistant message.
 *
 * Necessary because the loop needs BOTH — the UI wants tokens as they arrive,
 * and the next step needs a complete, well-formed message.
 */
function collectStream(stream: AsyncIterable<StreamEvent>) {
  const parts: ContentPart[] = [];
  let finishReason: FinishReason = "unknown";
  let usage: Usage | undefined;
  let responseId: string | undefined;
  let modelId = "";

  async function* events(): AsyncGenerator<StreamEvent> {
    for await (const event of stream) {
      switch (event.type) {
        case "start":
          responseId = event.responseId;
          modelId = event.modelId;
          break;
        case "text-delta": {
          const last = parts[parts.length - 1];
          if (last?.type === "text") last.text += event.delta;
          else parts.push({ type: "text", text: event.delta });
          break;
        }
        case "reasoning-delta": {
          const last = parts[parts.length - 1];
          if (last?.type === "reasoning") {
            last.text += event.delta;
            // Anthropic's replay token (signature_delta) arrives at the END of
            // a thinking block — stamp it onto the accumulated part, or replay
            // never works in stream mode.
            if (event.signature) last.signature = event.signature;
          } else {
            parts.push({ type: "reasoning", text: event.delta, ...(event.signature ? { signature: event.signature } : {}) });
          }
          break;
        }
        case "tool-call-end":
          parts.push({
            type: "tool-call",
            callId: event.callId,
            name: event.name,
            input: event.input,
            status: "pending",
            ...(event.repaired ? { repaired: true } : {}),
          });
          break;
        case "usage":
          usage = event.usage;
          break;
        case "finish":
          finishReason = event.finishReason;
          if (event.usage) usage = event.usage;
          if (event.responseId) responseId = event.responseId;
          break;
        default:
          break;
      }
      yield event;
    }
  }

  return {
    events,
    result: (): GenerateResult => ({
      parts,
      finishReason,
      usage: usage ?? {},
      modelId,
      ...(responseId ? { responseId } : {}),
    }),
  };
}

function addUsage(a: Usage, b: Usage): Usage {
  const add = (x?: number, y?: number) => (x == null && y == null ? undefined : (x ?? 0) + (y ?? 0));
  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    totalTokens: add(a.totalTokens, b.totalTokens),
    cachedInputTokens: add(a.cachedInputTokens, b.cachedInputTokens),
    reasoningTokens: add(a.reasoningTokens, b.reasoningTokens),
  };
}

function meteringStatus(reason: FinishReason): "completed" | "failed" | "cancelled" {
  if (reason === "cancelled") return "cancelled";
  if (reason === "error") return "failed";
  return "completed";
}
