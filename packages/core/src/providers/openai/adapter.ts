// The OpenAI provider. Speaks both dialects behind one `Provider` interface and
// implements background mode as first-class async jobs.
//
// Dialect choice: Responses is the default and the only one that supports
// background jobs, server-side history and reasoning replay. Chat Completions
// stays available because most "OpenAI-compatible" endpoints (routers, vLLM,
// Ollama, Together, NVIDIA NIM) implement only that one — pointing this adapter
// at them with `dialect: "chat"` is the whole integration.

import { AgentError, toAgentError } from "../../errors.js";
import { errorFromResponse, withRetry } from "../../transport/retry.js";
import type { RetryPolicy, Transport } from "../../transport/types.js";
import { withDefaultTimeout } from "../shared.js";
import type {
  CallOptions,
  FileUploadRequest,
  GenerateResult,
  JobHandle,
  JobSnapshot,
  ModelInfo,
  NormalizedRequest,
  Provider,
  ProviderCapabilities,
  ProviderFileRef,
  StreamEvent,
} from "../types.js";
import { buildChatRequest, buildResponsesRequest } from "./map-in.js";
import { finishFromChat, finishFromResponses, partsFromChat, partsFromResponses, usageFromChat, usageFromResponses } from "./map-out.js";
import { finalResponseFromStream, streamChat, streamResponses } from "./stream.js";
import { OPENAI_MODELS, modelCapabilities } from "./models.js";
import type { ChatResponse, ResponsesResponse } from "./wire.js";

export type OpenAIDialect = "responses" | "chat";

export type OpenAIProviderConfig = {
  transport: Transport;
  /** Defaults to "responses". Use "chat" for OpenAI-compatible third parties. */
  dialect?: OpenAIDialect;
  /** Provider id, so several instances (openai, groq, nvidia) can coexist. */
  id?: string;
  label?: string;
  retry?: RetryPolicy;
  /** Capability overrides — a compatible endpoint may lack background/reasoning. */
  capabilities?: Partial<ProviderCapabilities>;
  models?: ModelInfo[];
};

const RESPONSES_CAPS: ProviderCapabilities = {
  streaming: true,
  backgroundJobs: true,
  resumableStreams: true,
  tools: true,
  parallelToolCalls: true,
  images: true,
  files: true,
  audio: false,
  reasoning: true,
  strictJsonSchema: true,
  serverSideHistory: true,
  fileUpload: true,
};

const CHAT_CAPS: ProviderCapabilities = {
  ...RESPONSES_CAPS,
  backgroundJobs: false,
  resumableStreams: false,
  audio: true,
  serverSideHistory: false,
  // Most OpenAI-compatible routers implement /chat/completions but not /files.
  // Override via `capabilities` for the ones that do.
  fileUpload: false,
};

export function createOpenAIProvider(config: OpenAIProviderConfig): Provider {
  const dialect: OpenAIDialect = config.dialect ?? "responses";
  const id = config.id ?? "openai";
  const capabilities: ProviderCapabilities = {
    ...(dialect === "responses" ? RESPONSES_CAPS : CHAT_CAPS),
    ...config.capabilities,
  };

  /** Every HTTP call funnels through here so retry + error mapping happen once. */
  async function call(
    path: string,
    init: {
      method: "GET" | "POST" | "DELETE";
      body?: unknown;
      stream?: boolean;
      query?: Record<string, string | number | boolean | undefined>;
    },
    opts?: CallOptions,
  ): Promise<Response> {
    // A caller that never passes (or triggers) its own signal must not hang
    // forever on a stalled connection — the default timeout is a floor, not a
    // ceiling: whichever of the two signals fires first wins.
    const signal = withDefaultTimeout(opts?.signal);
    return withRetry(
      async () => {
        const res = await config.transport.fetch({
          provider: id,
          path,
          method: init.method,
          body: init.body,
          stream: init.stream,
          query: init.query,
          headers: opts?.headers,
          signal,
        });
        if (!res.ok) throw await errorFromResponse(res, id);
        return res;
      },
      { policy: config.retry, signal, provider: id },
    );
  }

  function guardRequest(req: NormalizedRequest) {
    if (req.background && !capabilities.backgroundJobs) {
      throw new AgentError(
        "not-supported",
        `Provider "${id}" (${dialect} dialect) has no background mode. Use streaming, or switch to the Responses dialect.`,
        { provider: id },
      );
    }
    if (req.tools?.length && !capabilities.tools) {
      throw new AgentError("not-supported", `Provider "${id}" does not support tools.`, { provider: id });
    }
    // Media guards: a text-only compatible endpoint should fail HERE with a
    // capability error, not upstream with an inscrutable 400. One pass over
    // every part flags all three media types together, rather than
    // rescanning the whole message list once per type; skipped entirely when
    // every media capability is already supported.
    if (!capabilities.images || !capabilities.files || !capabilities.audio) {
      let hasImage = false;
      let hasFile = false;
      let hasAudio = false;
      req.messages.some((m) =>
        m.parts.some((p) => {
          if (p.type === "image") hasImage = true;
          else if (p.type === "file") hasFile = true;
          else if (p.type === "audio") hasAudio = true;
          return hasImage && hasFile && hasAudio;
        }),
      );
      if (!capabilities.images && hasImage) {
        throw new AgentError("not-supported", `Provider "${id}" does not accept image parts.`, { provider: id });
      }
      if (!capabilities.files && hasFile) {
        throw new AgentError("not-supported", `Provider "${id}" does not accept file parts.`, { provider: id });
      }
      if (!capabilities.audio && hasAudio) {
        throw new AgentError("not-supported", `Provider "${id}" does not accept audio parts.`, { provider: id });
      }
    }
  }

  /** Apply declared capabilities to the request before it reaches a builder. */
  function applyCapabilities(req: NormalizedRequest): NormalizedRequest {
    if (capabilities.strictJsonSchema || !req.tools?.some((t) => t.strict)) return req;
    // Strict mode on an endpoint that lacks it 400s; dropping the flag keeps
    // the tool usable with plain (non-guaranteed) schema conformance.
    return { ...req, tools: req.tools.map(({ strict: _strict, ...t }) => t) };
  }

  const buildOpts = (stream?: boolean) => ({
    ...(stream ? { stream: true } : {}),
    providerId: id,
    parallelToolCalls: capabilities.parallelToolCalls,
  });

  function resultFromResponses(r: ResponsesResponse): GenerateResult {
    return {
      parts: partsFromResponses(r),
      finishReason: finishFromResponses(r),
      usage: usageFromResponses(r.usage),
      responseId: r.id,
      modelId: r.model,
      raw: r,
    };
  }

  const provider: Provider = {
    id,
    label: config.label ?? (dialect === "responses" ? "OpenAI" : "OpenAI-compatible"),
    capabilities,
    transport: config.transport,

    async generate(rawReq, opts): Promise<GenerateResult> {
      guardRequest(rawReq);
      const req = applyCapabilities(rawReq);

      if (dialect === "responses") {
        const res = await call("/responses", { method: "POST", body: buildResponsesRequest(req, buildOpts()) }, opts);
        const json = (await res.json()) as ResponsesResponse;
        if (json.status === "failed" && json.error) {
          throw new AgentError("unknown", json.error.message, { provider: id, detail: json.error });
        }
        return resultFromResponses(json);
      }

      const res = await call("/chat/completions", { method: "POST", body: buildChatRequest(req, buildOpts()) }, opts);
      const json = (await res.json()) as ChatResponse;
      return {
        parts: partsFromChat(json),
        finishReason: finishFromChat(json.choices?.[0]?.finish_reason),
        usage: usageFromChat(json.usage),
        responseId: json.id,
        modelId: json.model,
        raw: json,
      };
    },

    async *stream(rawReq, opts): AsyncIterable<StreamEvent> {
      guardRequest(rawReq);
      const req = applyCapabilities(rawReq);
      try {
        if (dialect === "responses") {
          const res = await call(
            "/responses",
            { method: "POST", body: buildResponsesRequest(req, buildOpts(true)), stream: true },
            opts,
          );
          if (!res.body) throw new AgentError("network", "Response had no body to stream.", { provider: id });
          yield* streamResponses(res.body);
          return;
        }
        const res = await call(
          "/chat/completions",
          { method: "POST", body: buildChatRequest(req, buildOpts(true)), stream: true },
          opts,
        );
        if (!res.body) throw new AgentError("network", "Response had no body to stream.", { provider: id });
        yield* streamChat(res.body);
      } catch (e) {
        // A stream that throws mid-iteration would leave the consumer's reducer
        // half-applied; emitting an error event lets it close out cleanly.
        yield { type: "error", error: toAgentError(e, id) };
      }
    },

    async startJob(rawReq, opts): Promise<JobHandle> {
      if (!capabilities.backgroundJobs) {
        throw new AgentError("not-supported", `Provider "${id}" has no background mode.`, { provider: id });
      }
      const req = applyCapabilities(rawReq);
      const body = buildResponsesRequest({ ...req, background: true }, buildOpts());
      const res = await call("/responses", { method: "POST", body }, opts);
      const json = (await res.json()) as ResponsesResponse;
      return { provider: id, id: json.id, model: json.model || req.model, createdAt: Date.now() };
    },

    async pollJob(handle, opts): Promise<JobSnapshot> {
      const res = await call(`/responses/${encodeURIComponent(handle.id)}`, { method: "GET" }, opts);
      const json = (await res.json()) as ResponsesResponse;

      if (json.status === "failed") {
        return {
          handle,
          status: "failed",
          error: { message: json.error?.message ?? "Background response failed.", code: json.error?.code },
        };
      }
      if (json.status === "completed" || json.status === "incomplete") {
        // `incomplete` still carries usable output (it hit a cap mid-answer), so
        // it resolves as a result with a `length` finish reason rather than an error.
        return { handle, status: json.status, result: resultFromResponses(json) };
      }
      return { handle, status: json.status };
    },

    async cancelJob(handle, opts): Promise<JobSnapshot> {
      const res = await call(`/responses/${encodeURIComponent(handle.id)}/cancel`, { method: "POST" }, opts);
      const json = (await res.json()) as ResponsesResponse;
      return { handle, status: json.status === "cancelled" ? "cancelled" : json.status };
    },

    async *streamJob(handle, opts): AsyncIterable<StreamEvent> {
      // Attach to a running background response. `starting_after` replays from
      // the cursor, which is what makes a reload lose nothing: we persist the
      // last sequence number and resume from it.
      let cursor = handle.cursor;
      try {
        const res = await call(
          `/responses/${encodeURIComponent(handle.id)}`,
          {
            method: "GET",
            stream: true,
            query: { stream: true, ...(cursor != null ? { starting_after: cursor } : {}) },
          },
          opts,
        );
        if (!res.body) throw new AgentError("network", "Job stream had no body.", { provider: id });
        yield* streamResponses(res.body, {
          onCursor: (seq) => {
            cursor = seq;
            handle.cursor = seq;
          },
        });
      } catch (e) {
        yield { type: "error", error: toAgentError(e, id) };
      }
    },

    async uploadFile(req: FileUploadRequest, opts?: CallOptions): Promise<ProviderFileRef> {
      if (!capabilities.fileUpload) {
        throw new AgentError("not-supported", `Provider "${id}" has no file upload endpoint.`, { provider: id });
      }
      const data =
        req.data instanceof Uint8Array
          ? req.data
          : req.data instanceof ArrayBuffer
            ? new Uint8Array(req.data)
            : new Uint8Array(await req.data.arrayBuffer());

      const res = await call(
        "/files",
        {
          method: "POST",
          body: {
            kind: "multipart",
            fields: { purpose: req.purpose ?? "user_data" },
            files: [
              {
                field: "file",
                filename: req.filename,
                ...(req.mediaType ? { mediaType: req.mediaType } : {}),
                data,
              },
            ],
          },
        },
        opts,
      );
      const json = (await res.json()) as { id: string; bytes?: number; created_at?: number; filename?: string };
      return {
        kind: "providerFile",
        id: json.id,
        provider: id,
        filename: json.filename ?? req.filename,
        ...(json.bytes != null ? { sizeBytes: json.bytes } : {}),
        ...(json.created_at != null ? { createdAt: json.created_at * 1000 } : {}),
      };
    },

    async deleteFile(fileId: string, opts?: CallOptions): Promise<void> {
      await call(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" }, opts);
    },

    async listModels(opts): Promise<ModelInfo[]> {
      if (config.models) return config.models;
      try {
        const res = await call("/models", { method: "GET" }, opts);
        const json = (await res.json()) as { data?: { id: string }[] };
        const remote = (json.data ?? []).map((m) => ({
          id: m.id,
          ...(modelCapabilities(m.id) ? { supports: modelCapabilities(m.id) } : {}),
        }));
        return remote.length ? remote : OPENAI_MODELS;
      } catch {
        // A proxy that does not allowlist /models is a normal setup, not an error.
        return OPENAI_MODELS;
      }
    },
  };

  return provider;
}

export { finalResponseFromStream };
