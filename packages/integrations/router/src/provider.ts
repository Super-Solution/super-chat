import {
  AgentError,
  type CallOptions,
  type ContentPart,
  type FinishReason,
  type GenerateResult,
  type Message,
  type NormalizedRequest,
  type Provider,
  repairToolArguments,
  type StreamEvent,
  type Transport,
  type Usage,
} from "@supersolutions/super-chat-core";
import {
  GatewayError,
  type InferenceContentPart,
  type InferenceFinishReason,
  type InferenceGateway,
  type InferenceMessage,
  type InferenceRequest,
  type InferenceTool,
  type InferenceToolCall,
  type InferenceToolChoice,
  type StreamEvent as RouterStreamEvent,
  type Usage as RouterUsage,
} from "@supersolutions/super-protocol";

export type SuperRouterProviderConfig = {
  gateway: InferenceGateway;
  /** The customer the usage is billed to. */
  customerId: string;
  id?: string;
  label?: string;
  /** Used when the request sets no `maxOutputTokens`. Super Router allows 1..8192. */
  defaultMaxOutputTokens?: number;
  /** One key per logical call; reuse it when retrying so the call never bills twice. */
  idempotencyKey?: () => string;
  /**
   * Send tools and images to the router. Default true. Turn it off for a server
   * that predates tool calling: tools are then left out with a warning.
   */
  toolCalling?: boolean;
};

// A gateway provider has no HTTP of its own: the gateway holds the credential and the wire.
const noTransport: Transport = {
  kind: "custom",
  credentialSafe: true,
  async fetch() {
    throw new AgentError("not-supported", "The Super Router provider does not use a Transport.");
  },
} as Transport;

const MAX_TOOL_RESULT_CHARS = 256_000;
const MAX_TOOL_DESCRIPTION_CHARS = 4096;
const IMAGE_MEDIA = /^image\/(png|jpeg|gif|webp)$/;

// Super Router accepts these characters in a call id; a thread may hold ids minted by another provider.
const wireCallId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "call";

const asText = (output: unknown) => (typeof output === "string" ? output : (JSON.stringify(output) ?? "null"));

function resultText(output: unknown): string {
  const text = asText(output);
  const marker = "…[truncated]";
  return text.length > MAX_TOOL_RESULT_CHARS ? text.slice(0, MAX_TOOL_RESULT_CHARS - marker.length) + marker : text;
}

// The wire requires a JSON object; a repaired call can hold any JSON value.
function argumentsText(input: unknown): string {
  const object = typeof input === "object" && input !== null && !Array.isArray(input);
  return JSON.stringify(object ? input : input === undefined || input === null ? {} : { input });
}

function imageUrl(part: Extract<ContentPart, { type: "image" }>): string | undefined {
  const { source, mediaType } = part;
  if (source.kind === "url") return source.url.startsWith("https://") || /^data:image\/(png|jpeg|gif|webp);base64,/.test(source.url) ? source.url : undefined;
  if (source.kind === "base64" && mediaType && IMAGE_MEDIA.test(mediaType)) return `data:${mediaType};base64,${source.data}`;
  return undefined;
}

function toMessages(req: NormalizedRequest, toolCalling: boolean): { messages: InferenceMessage[]; warnings: string[] } {
  const warnings: string[] = [];
  const messages: InferenceMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  const history = req.messages as Message[];
  // A call without a result, or a result without a call, is refused by the router: both happen in interrupted threads.
  const called = new Set(history.flatMap((m) => m.parts.flatMap((p) => (p.type === "tool-call" ? [p.callId] : []))));
  const answered = new Set(history.flatMap((m) => m.parts.flatMap((p) => (p.type === "tool-result" ? [p.callId] : []))));
  let dropped = 0;
  for (const m of history) {
    const texts: string[] = [];
    const images: InferenceContentPart[] = [];
    const calls: InferenceToolCall[] = [];
    const results: InferenceMessage[] = [];
    for (const p of m.parts) {
      if (p.type === "text") {
        if (p.text) texts.push(p.text);
      } else if (p.type === "image" && toolCalling) {
        const url = imageUrl(p);
        if (url) images.push({ type: "image", url, ...(p.detail ? { detail: p.detail } : {}) });
        else dropped += 1;
      } else if (p.type === "tool-call" && toolCalling) {
        if (answered.has(p.callId)) calls.push({ id: wireCallId(p.callId), name: p.name, arguments: argumentsText(p.input) });
      } else if (p.type === "tool-result" && toolCalling) {
        if (called.has(p.callId)) results.push({ role: "tool", tool_call_id: wireCallId(p.callId), content: resultText(p.output), ...(p.failure ? { is_error: true } : {}) });
      } else if (p.type !== "reasoning" && p.type !== "artifact") {
        dropped += 1;
      }
    }
    const text = texts.join("\n");
    if (m.role === "tool") messages.push(...results);
    else if (m.role === "assistant" && calls.length) messages.push({ role: "assistant", ...(text ? { content: text } : {}), tool_calls: calls });
    else if (m.role === "user" && images.length) messages.push({ role: "user", content: [...(text ? [{ type: "text" as const, text }] : []), ...images] });
    else if (text) messages.push({ role: m.role, content: text });
    if (m.role !== "tool") messages.push(...results);
  }
  if (dropped) warnings.push(`${dropped} part(s) were dropped: Super Router takes text, tool calls and https or base64 PNG, JPEG, GIF and WebP images.`);
  if (!toolCalling && req.tools?.length) warnings.push("Tools were ignored: tool calling is turned off for this provider.");
  if (!messages.some((m) => m.role !== "system")) throw new AgentError("invalid-request", "Super Router needs at least one user or assistant message.");
  return { messages, warnings };
}

function toTools(req: NormalizedRequest): { tools?: InferenceTool[]; tool_choice?: InferenceToolChoice } {
  const active = req.activeTools ? new Set(req.activeTools) : undefined;
  const tools = (req.tools ?? [])
    .filter((t) => !active || active.has(t.name))
    .map((t): InferenceTool => ({
      name: t.name,
      ...(t.description ? { description: t.description.slice(0, MAX_TOOL_DESCRIPTION_CHARS) } : {}),
      input_schema: { ...t.parameters, type: "object" },
    }));
  if (!tools.length) return {};
  const choice = req.toolChoice;
  if (!choice) return { tools };
  if (choice.type !== "tool") return { tools, tool_choice: choice.type };
  // Naming a tool that is not on offer this step would be refused; let the model choose instead.
  return tools.some((t) => t.name === choice.name) ? { tools, tool_choice: { name: choice.name } } : { tools };
}

const finishOf = (reason: InferenceFinishReason | undefined, hasCalls: boolean): FinishReason =>
  reason === "length" ? "length" : reason === "tool_calls" || hasCalls ? "tool-calls" : "stop";

function toUsage(u?: RouterUsage): Usage {
  if (!u) return {};
  const inputTokens = u.input + u.cached + u.cache_write;
  return { inputTokens, outputTokens: u.output, totalTokens: inputTokens + u.output, ...(u.cached ? { cachedInputTokens: u.cached } : {}) };
}

function toError(error: unknown, provider: string): AgentError {
  if (error instanceof AgentError) return error;
  if ((error as { name?: string })?.name === "AbortError") return new AgentError("cancelled", "Cancelled.", { provider, cause: error });
  if (error instanceof GatewayError) {
    const status = error.status;
    const kind = error.code === "network_error" ? "network"
      : status === 401 || status === 403 ? "auth"
      : status === 402 ? "invalid-request"
      : status === 429 ? "rate-limit"
      : status !== undefined && status >= 500 ? "overloaded"
      : status !== undefined && status >= 400 ? "invalid-request"
      : "unknown";
    return new AgentError(kind, error.requestId ? `${error.code} (request ${error.requestId})` : error.code, { ...(status ? { status } : {}), provider, cause: error });
  }
  return new AgentError("unknown", error instanceof Error ? error.message : String(error), { provider, cause: error });
}

/**
 * A `Provider` that sends every call through an `InferenceGateway`, with tool calling and images.
 * `NormalizedRequest.model` is the Super Router **service** id, not a raw model name.
 */
export function createSuperRouterProvider(config: SuperRouterProviderConfig): Provider {
  const id = config.id ?? "super-router";
  const newKey = config.idempotencyKey ?? (() => globalThis.crypto.randomUUID());
  const toolCalling = config.toolCalling !== false;
  const build = (req: NormalizedRequest) => {
    const { messages, warnings } = toMessages(req, toolCalling);
    const request: InferenceRequest = {
      service: req.model,
      customer_id: config.customerId,
      messages,
      ...(toolCalling ? toTools(req) : {}),
      max_output_tokens: Math.min(8192, Math.max(1, req.maxOutputTokens ?? config.defaultMaxOutputTokens ?? 1024)),
    };
    return { request, warnings };
  };

  return {
    id,
    label: config.label ?? "Super Router",
    capabilities: {
      streaming: true, backgroundJobs: false, resumableStreams: false, tools: toolCalling, parallelToolCalls: toolCalling,
      images: toolCalling, files: false, audio: false, reasoning: false, strictJsonSchema: false, serverSideHistory: false, fileUpload: false,
    },
    transport: noTransport,

    async generate(req: NormalizedRequest, _opts?: CallOptions): Promise<GenerateResult> {
      const { request, warnings } = build(req);
      try {
        const result = await config.gateway.infer(request, newKey());
        const failed = result.execution_status !== "succeeded";
        if (!result.output) {
          // A repeated idempotency key reads the stored request back, and completions are never stored.
          throw new AgentError("invalid-request", `This idempotency key was already used (request ${result.id}); the router does not store output, so it cannot be replayed.`, { provider: id });
        }
        const calls = result.output.tool_calls ?? [];
        const parts: ContentPart[] = [
          ...(result.output.content || !calls.length ? [{ type: "text" as const, text: result.output.content }] : []),
          ...calls.map((call): ContentPart => {
            const { value, repaired } = repairToolArguments(call.arguments);
            return { type: "tool-call", callId: call.id, name: call.name, input: value, status: "pending", ...(repaired ? { repaired } : {}) };
          }),
        ];
        return {
          parts,
          finishReason: failed ? "error" : finishOf(result.finish_reason, calls.length > 0),
          usage: toUsage(result.usage.meters),
          responseId: result.id,
          modelId: req.model,
          ...(warnings.length ? { warnings } : {}),
        };
      } catch (error) {
        throw toError(error, id);
      }
    },

    async *stream(req: NormalizedRequest, opts?: CallOptions): AsyncIterable<StreamEvent> {
      const { request } = build(req);
      let started = false;
      // Calls that have begun, by the router's index. Only `completed` makes one callable.
      const open = new Map<number, { id: string; name: string }>();
      let completed = 0;
      try {
        for await (const raw of config.gateway.stream(request, newKey(), opts?.signal)) {
          // A failed request can also say why the model stopped, which the protocol does not name yet.
          const event = raw as RouterStreamEvent & { finish_reason?: InferenceFinishReason };
          if (!started) {
            started = true;
            yield { type: "start", responseId: event.request_id, modelId: req.model };
          }
          if (event.type === "output.delta") yield { type: "text-delta", delta: event.text };
          else if (event.type === "output.tool_call.delta") {
            let call = open.get(event.index);
            if (!call) {
              if (!event.id || !event.name) throw new AgentError("unknown", "Super Router sent a tool call without an id or name.", { provider: id });
              call = { id: event.id, name: event.name };
              open.set(event.index, call);
              yield { type: "tool-call-start", callId: call.id, name: call.name };
            }
            if (event.arguments_delta) yield { type: "tool-call-delta", callId: call.id, argsDelta: event.arguments_delta };
          } else if (event.type === "output.tool_call.completed") {
            if (!open.has(event.index)) yield { type: "tool-call-start", callId: event.id, name: event.name };
            const { value, repaired } = repairToolArguments(event.arguments);
            completed += 1;
            yield { type: "tool-call-end", callId: event.id, name: event.name, input: value, repaired };
          } else if (event.type === "request.completed" || event.type === "request.failed") {
            const usage = event.usage?.meters ? toUsage(event.usage.meters) : undefined;
            if (usage) yield { type: "usage", usage };
            const ok = event.type === "request.completed" && event.execution_status === "succeeded";
            const finishReason: FinishReason = ok
              ? finishOf(event.finish_reason, completed > 0)
              : event.finish_reason === "length"
                ? "length"
                : event.execution_status === "cancelled"
                  ? "cancelled"
                  : "error";
            yield { type: "finish", finishReason, responseId: event.request_id, ...(usage ? { usage } : {}) };
          } else if (event.type === "request.replayed") {
            // The original call already ran; its result is read with the request id, never re-billed.
            throw new AgentError("invalid-request", `This idempotency key was already used (request ${event.request_id}).`, { provider: id });
          }
        }
      } catch (error) {
        yield { type: "error", error: (() => { try { throw toError(error, id); } catch (e) { return e; } })() };
      }
    },
  };
}
