import {
  AgentError,
  type CallOptions,
  type ContentPart,
  type FinishReason,
  type GenerateResult,
  type Message,
  type NormalizedRequest,
  type Provider,
  type StreamEvent,
  type Transport,
  type Usage,
} from "@supersolutions/super-chat-core";
import { GatewayError, type InferenceGateway, type InferenceMessage, type InferenceRequest, type Usage as RouterUsage } from "@supersolutions/super-protocol";

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
};

// A gateway provider has no HTTP of its own: the gateway holds the credential and the wire.
const noTransport: Transport = {
  kind: "custom",
  credentialSafe: true,
  async fetch() {
    throw new AgentError("not-supported", "The Super Router provider does not use a Transport.");
  },
} as Transport;

function textOf(parts: ContentPart[]): { text: string; dropped: number } {
  let dropped = 0;
  const text = parts
    .map((p) => {
      if (p.type === "text") return p.text;
      if (p.type !== "reasoning") dropped += 1;
      return "";
    })
    .filter(Boolean)
    .join("\n");
  return { text, dropped };
}

function toMessages(req: NormalizedRequest): { messages: InferenceMessage[]; warnings: string[] } {
  const warnings: string[] = [];
  const messages: InferenceMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  let dropped = 0;
  for (const m of req.messages as Message[]) {
    if (m.role === "tool") {
      dropped += m.parts.length;
      continue;
    }
    const t = textOf(m.parts);
    dropped += t.dropped;
    if (t.text) messages.push({ role: m.role, content: t.text });
  }
  if (dropped) warnings.push(`${dropped} non-text part(s) were dropped: Super Router services take text messages only.`);
  if (req.tools?.length) warnings.push("Tools were ignored: Super Router services do not call tools yet.");
  if (!messages.some((m) => m.role !== "system")) throw new AgentError("invalid-request", "Super Router needs at least one user or assistant text message.");
  return { messages, warnings };
}

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
 * A text-only `Provider` that sends every call through an `InferenceGateway`.
 * `NormalizedRequest.model` is the Super Router **service** id, not a raw model name.
 */
export function createSuperRouterProvider(config: SuperRouterProviderConfig): Provider {
  const id = config.id ?? "super-router";
  const newKey = config.idempotencyKey ?? (() => globalThis.crypto.randomUUID());
  const build = (req: NormalizedRequest) => {
    const { messages, warnings } = toMessages(req);
    const request: InferenceRequest = {
      service: req.model,
      customer_id: config.customerId,
      messages,
      max_output_tokens: Math.min(8192, Math.max(1, req.maxOutputTokens ?? config.defaultMaxOutputTokens ?? 1024)),
    };
    return { request, warnings };
  };

  return {
    id,
    label: config.label ?? "Super Router",
    capabilities: {
      streaming: true, backgroundJobs: false, resumableStreams: false, tools: false, parallelToolCalls: false,
      images: false, files: false, audio: false, reasoning: false, strictJsonSchema: false, serverSideHistory: false, fileUpload: false,
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
        return {
          parts: [{ type: "text", text: result.output.content }],
          finishReason: failed ? "error" : "stop",
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
      try {
        for await (const event of config.gateway.stream(request, newKey(), opts?.signal)) {
          if (!started) {
            started = true;
            yield { type: "start", responseId: event.request_id, modelId: req.model };
          }
          if (event.type === "output.delta") yield { type: "text-delta", delta: event.text };
          else if (event.type === "request.completed" || event.type === "request.failed") {
            const ok = event.type === "request.completed" && event.execution_status === "succeeded";
            const finishReason: FinishReason = ok ? "stop" : event.execution_status === "cancelled" ? "cancelled" : "error";
            yield { type: "finish", finishReason, responseId: event.request_id };
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
