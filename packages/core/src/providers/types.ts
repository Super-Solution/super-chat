// The provider contract. An adapter's whole job is: normalized in → wire out →
// normalized back. Nothing above this file may know what a provider's JSON looks
// like, and nothing below it may know what a Skill or a ContextTrace is.

import type { ContentPart, FinishReason, Message, Usage } from "../content/types.js";
import type { Transport } from "../transport/types.js";

/**
 * JSON Schema, loosely typed. Plain schemas rather than zod/valibot so the core
 * carries no validation dependency and a host can bring whatever it already uses.
 *
 * `type` accepts an array because JSON Schema allows union types (`["string",
 * "number"]`), which card specs use for values that may be either.
 */
export type JSONSchema = {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema | JSONSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  additionalProperties?: boolean | JSONSchema;
  minimum?: number;
  maximum?: number;
  [k: string]: unknown;
};

/** A tool as the *provider* sees it — no execute, no presets, just the schema. */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: JSONSchema;
  /**
   * Ask the provider to guarantee schema conformance (OpenAI structured
   * outputs). Costs a schema-compile on first use and forbids some JSON Schema
   * features, so it is opt-in per tool rather than global.
   */
  strict?: boolean;
};

export type ToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "tool"; name: string };

/**
 * A tool the PROVIDER hosts and executes — web search, code interpreter,
 * computer use. Distinct from `ToolSpec` in the way that matters: there is no
 * executor here and never will be, because the call, the execution and the
 * result all happen provider-side within one response.
 *
 * The shape is deliberately opaque. These definitions are provider-specific by
 * nature (`{type: "web_search_20260209", name: "web_search"}` means nothing to
 * a different vendor), they change on the vendor's release cadence rather than
 * ours, and inventing a normalized union across vendors would be a lie that
 * needs a migration every quarter. So: keyed by provider id, appended verbatim
 * to that provider's tool array, ignored by everyone else.
 */
export type ProviderNativeTool = { type: string } & Record<string, unknown>;

export type ReasoningOptions = {
  effort?: "minimal" | "low" | "medium" | "high";
  /** Ask for a human-readable summary of hidden reasoning, where supported. */
  summary?: "auto" | "concise" | "detailed" | "none";
};

export type ResponseFormat =
  | { type: "text" }
  | { type: "json" }
  | { type: "json_schema"; name: string; schema: JSONSchema; strict?: boolean };

/**
 * The single request shape every adapter consumes. Deliberately flat and
 * provider-neutral; anything genuinely provider-specific goes in
 * `providerOptions` keyed by provider id, so an escape hatch never leaks into
 * the shared type.
 */
export type NormalizedRequest = {
  model: string;
  /** System/developer instructions, already assembled by the ContextBuilder. */
  system?: string;
  messages: Message[];
  tools?: ToolSpec[];
  /**
   * Provider-hosted tools, keyed by provider id — only the matching adapter's
   * entry is sent. They ride ALONGSIDE `tools`, never through the registry:
   * presets gate what the host's own executors can do, and a provider-hosted
   * search has no executor to gate.
   */
  providerTools?: Record<string, ProviderNativeTool[]>;
  toolChoice?: ToolChoice;
  /**
   * Names the model may call THIS step. Distinct from `tools`: the full set is
   * declared once (stable, cacheable prompt prefix) while the active set can
   * narrow per step. Undefined = all of `tools`.
   */
  activeTools?: string[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  responseFormat?: ResponseFormat;
  reasoning?: ReasoningOptions;
  /** Run server-side and poll, instead of holding a connection open. */
  background?: boolean;
  /**
   * Continue from a provider-held response instead of resending history.
   * OpenAI Responses `previous_response_id`. Adapters that cannot do this
   * ignore it and fall back to full history, so it is always safe to set.
   */
  previousResponseId?: string;
  /** Provider-side conversation storage opt-out (OpenAI `store`). */
  store?: boolean;
  metadata?: Record<string, string>;
  providerOptions?: Record<string, Record<string, unknown>>;
};

export type GenerateResult = {
  /** Normalized assistant reply. May contain text, reasoning and tool-call parts. */
  parts: ContentPart[];
  finishReason: FinishReason;
  usage: Usage;
  /** Provider-side id, needed for `previousResponseId` chaining and job polling. */
  responseId?: string;
  modelId: string;
  /** Untouched provider payload, for debugging panes. Never re-sent. */
  raw?: unknown;
  warnings?: string[];
};

/** Normalized streaming events. Adapters translate their own SSE dialect into these. */
export type StreamEvent =
  | { type: "start"; responseId?: string; modelId: string }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string; signature?: string }
  /** A tool call has begun; arguments are still streaming in. */
  | { type: "tool-call-start"; callId: string; name: string }
  | { type: "tool-call-delta"; callId: string; argsDelta: string }
  /** Arguments complete and parsed (or repaired). */
  | { type: "tool-call-end"; callId: string; name: string; input: unknown; repaired?: boolean }
  | { type: "usage"; usage: Usage }
  | { type: "finish"; finishReason: FinishReason; responseId?: string; usage?: Usage }
  | { type: "error"; error: unknown };

export type JobStatus = "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "incomplete";

/** Handle to a provider-side background run. Serializable so it survives reload. */
export type JobHandle = {
  provider: string;
  id: string;
  model: string;
  createdAt: number;
  /** Last SSE sequence number seen, for resumable streaming after a disconnect. */
  cursor?: number;
};

export type JobSnapshot = {
  handle: JobHandle;
  status: JobStatus;
  /** Present once terminal and successful. */
  result?: GenerateResult;
  error?: { message: string; code?: string };
};

export type ProviderCapabilities = {
  streaming: boolean;
  /** Server-side async execution with polling (OpenAI background mode). */
  backgroundJobs: boolean;
  /** Resume an interrupted stream from a sequence cursor. */
  resumableStreams: boolean;
  tools: boolean;
  parallelToolCalls: boolean;
  images: boolean;
  files: boolean;
  audio: boolean;
  reasoning: boolean;
  strictJsonSchema: boolean;
  /** Provider stores the conversation, enabling `previousResponseId`. */
  serverSideHistory: boolean;
  /** Can upload binaries and mint providerFile ids (`files` = accepts file parts). */
  fileUpload: boolean;
};

export type FileUploadRequest = {
  data: Blob | ArrayBuffer | Uint8Array;
  filename: string;
  mediaType?: string;
  /** Provider-specific purpose tag. OpenAI defaults to "user_data". */
  purpose?: string;
};

/**
 * Structurally a `MediaSource` `providerFile` variant, so an upload result
 * drops straight into `file(ref, mediaType)` / `image(ref)` with no glue.
 * `provider` is the ADAPTER's configured id — that is what `assertOwnFile`
 * checks against, so a ref minted by one provider instance is refused by
 * another instead of producing a guaranteed 400.
 */
export type ProviderFileRef = {
  kind: "providerFile";
  id: string;
  provider: string;
  filename?: string;
  sizeBytes?: number;
  createdAt?: number;
};

export type CallOptions = {
  signal?: AbortSignal;
  /** Per-call header overrides (e.g. an org id, a beta flag). */
  headers?: Record<string, string>;
};

export type Provider = {
  readonly id: string;
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  /** Adapters are constructed with a transport so they never hold a key themselves. */
  readonly transport: Transport;

  generate(req: NormalizedRequest, opts?: CallOptions): Promise<GenerateResult>;
  stream(req: NormalizedRequest, opts?: CallOptions): AsyncIterable<StreamEvent>;

  startJob?(req: NormalizedRequest, opts?: CallOptions): Promise<JobHandle>;
  pollJob?(handle: JobHandle, opts?: CallOptions): Promise<JobSnapshot>;
  cancelJob?(handle: JobHandle, opts?: CallOptions): Promise<JobSnapshot>;
  /** Attach to a running background job's event stream from `handle.cursor`. */
  streamJob?(handle: JobHandle, opts?: CallOptions): AsyncIterable<StreamEvent>;

  /** Upload a binary once and get back a reusable providerFile ref. */
  uploadFile?(req: FileUploadRequest, opts?: CallOptions): Promise<ProviderFileRef>;
  deleteFile?(fileId: string, opts?: CallOptions): Promise<void>;

  listModels?(opts?: CallOptions): Promise<ModelInfo[]>;
};

export type ModelInfo = {
  id: string;
  label?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Capability overrides for this specific model (o-series reasoning, vision, …). */
  supports?: Partial<ProviderCapabilities>;
};
