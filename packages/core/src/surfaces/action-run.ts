// A tool call that a person started by pressing a button.
//
// It goes through `executeToolCall`, the function a model's call goes through, and
// emits the same run events. So a `confirm` tool asks with the same card, a card it
// returns lands in the transcript, and the next model turn can read what happened.
// There is deliberately no second, lighter path for "the user clicked it": the spec
// that put the button there was written by a model.

import { nextId } from "../content/parts.js";
import type { FinishReason } from "../content/types.js";
import { makeCard } from "../cards/registry.js";
import type { Card, CardAction, CardSpec } from "../cards/types.js";
import { EventChannel } from "../runtime/channel.js";
import type { RunEvent } from "../runtime/events.js";
import { executeToolCall, type ToolCallRequest } from "../runtime/execute-tools.js";
import { deliverMetering, type MeterSink, type MeteringRecord } from "../runtime/metering.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition, ToolResolution } from "../tools/types.js";
import { checkSchema } from "./schema-check.js";
import { SURFACE_TOOL_NAMES } from "./tools.js";

/** Tools about the conversation itself. A button has no business calling these. */
const NOT_ACTIONABLE = new Set<string>([...SURFACE_TOOL_NAMES, "visualize", "updateCard", "loadSkill"]);

/**
 * What a surface action may call right now: the presets' grant, with deny applied.
 * `allow` is left out on purpose. A skill grants relevance for a turn, not authority
 * that outlives it on a button.
 */
export function surfaceActionTools(tools: ToolRegistry, resolution: ToolResolution): ToolDefinition[] {
  return tools
    .resolve({ presets: resolution.presets, ...(resolution.deny ? { deny: resolution.deny } : {}) })
    .filter((t) => !NOT_ACTIONABLE.has(t.name));
}

export type SurfaceToolAuthorization = { ok: true; tool: ToolDefinition } | { ok: false; reason: string };

/** Decided at the moment of the press. What was allowed when the surface was drawn may not be now. */
export function authorizeSurfaceTool(name: string, args: unknown, tools: ToolRegistry, resolution: ToolResolution): SurfaceToolAuthorization {
  const tool = surfaceActionTools(tools, resolution).find((t) => t.name === name);
  if (!tool) return { ok: false, reason: `"${name}" is not permitted here.` };
  const problems = checkSchema(tool.inputSchema, args ?? {});
  if (problems.length) return { ok: false, reason: `"${name}" received invalid input: ${problems[0]!.message}` };
  return { ok: true, tool };
}

export type SurfaceToolRunConfig = {
  tool: ToolDefinition;
  args: Record<string, unknown>;
  surfaceId: string;
  componentId: string;
  provider: string;
  model: string;
  vars?: Record<string, unknown>;
  signal?: AbortSignal;
  toolTimeoutMs?: number;
  meter?: MeterSink;
  meteringMetadata?: Readonly<Record<string, string>>;
  onUserDecision?: (callId: string, card: Card) => Promise<CardAction>;
  onHostTool?: (call: ToolCallRequest) => Promise<unknown>;
};

export async function* runSurfaceToolAction(config: SurfaceToolRunConfig): AsyncGenerator<RunEvent, void, unknown> {
  const runId = nextId("run");
  const callId = nextId("call_surface");
  const startedAt = Date.now();
  yield { type: "run-start", runId, mode: "sync" };
  yield { type: "step-start", step: 0 };
  yield { type: "tool-call", callId, name: config.tool.name, input: config.args };

  const channel = new EventChannel<RunEvent>();
  const onUserDecision = config.onUserDecision;
  const running = executeToolCall(
    { callId, name: config.tool.name, input: config.args },
    {
      tools: [config.tool],
      vars: config.vars ?? {},
      signal: config.signal,
      timeoutMs: config.toolTimeoutMs,
      onCard: (card) => channel.push({ type: "card", card }),
      onHostTool: config.onHostTool,
      requestCard: onUserDecision
        ? async (id, spec: CardSpec) => {
            const card = makeCard(spec, id);
            channel.push({ type: "awaiting-user", callId: id, card });
            const action = await onUserDecision(id, card);
            channel.push({ type: "user-responded", callId: id, action });
            return action.type === "cancel" || action.type === "dismiss"
              ? { cancelled: true, reason: "The user declined." }
              : (action.value ?? { confirmed: true });
          }
        : undefined,
    },
  ).then((outcome) => {
    channel.push({
      type: "tool-result",
      callId: outcome.callId,
      name: outcome.name,
      output: outcome.output,
      ...(outcome.failure ? { failure: outcome.failure } : {}),
      ms: outcome.ms,
    });
    return outcome;
  }).finally(() => channel.close());

  for await (const event of channel) yield event;
  const outcome = await running;

  // A tool action spends no tokens, but it is still an act a host may need to
  // account for, so it produces the same terminal record as any other run.
  const finishedAt = Date.now();
  const finishReason: FinishReason = outcome.failure === "denied" && config.signal?.aborted ? "cancelled" : "stop";
  const record: MeteringRecord = {
    scope: "run",
    id: `${runId}:run`,
    runId,
    provider: config.provider,
    requestedModel: config.model,
    mode: "sync",
    status: finishReason === "cancelled" ? "cancelled" : outcome.failure ? "failed" : "completed",
    usage: {},
    source: "unavailable",
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    steps: 0,
    finishReason,
    metadata: { ...config.meteringMetadata, trigger: "surface-action", surfaceId: config.surfaceId, componentId: config.componentId, tool: config.tool.name },
  };
  await deliverMetering(config.meter, record);
  yield { type: "metering", record };
  yield { type: "run-finish", runId, finishReason, usage: {}, steps: 0 };
}
