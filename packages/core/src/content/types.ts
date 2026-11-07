// The normalized content model. EVERYTHING in superchat — history, tool output,
// attachments, provider replies — is expressed as `Message[]` of `ContentPart[]`.
//
// Why a normalized model at all: each provider has its own wire shape for the
// same idea (an image is `input_image` in OpenAI Responses, `image_url` in Chat
// Completions, `{type:"image", source:{...}}` in Anthropic). If the app layer
// spoke any one of those, swapping providers would rewrite the app. Adapters own
// the translation; nothing above `providers/` may reference a wire field.

/**
 * Where a binary/media payload actually lives.
 *
 * `providerFile` is the important one: large files should be uploaded once
 * (OpenAI `/v1/files`) and referenced by id, not re-encoded as base64 on every
 * turn. `provider` is recorded so an adapter can refuse a file id minted by a
 * different provider instead of sending a 400-guaranteed request.
 */
export type MediaSource =
  | { kind: "url"; url: string }
  | { kind: "base64"; data: string }
  | { kind: "providerFile"; id: string; provider: string };

/** Reason a tool call did not produce a normal result. */
export type ToolFailureKind = "execution-error" | "denied" | "invalid-input" | "timeout" | "not-found";

export type ToolCallStatus = "pending" | "awaiting-approval" | "running" | "done" | "error" | "denied";

export type ContentPart =
  /** Plain model- or user-authored prose. */
  | { type: "text"; text: string }
  /**
   * Model reasoning. `signature` carries an opaque provider token (Anthropic
   * thinking signatures, Gemini thought signatures) that MUST be echoed back on
   * the next turn or the provider rejects the request — so we keep it on the
   * part rather than dropping reasoning from history.
   */
  | { type: "reasoning"; text: string; signature?: string; redacted?: boolean }
  | { type: "image"; source: MediaSource; mediaType?: string; detail?: "auto" | "low" | "high" }
  | { type: "file"; source: MediaSource; mediaType: string; filename?: string }
  | { type: "audio"; source: MediaSource; mediaType: string; transcript?: string }
  /** A model's request to call a tool. `callId` is what correlates it to its result. */
  | {
      type: "tool-call";
      callId: string;
      name: string;
      input: unknown;
      status: ToolCallStatus;
      /** Set when the raw arguments were malformed and `repair` fixed them. */
      repaired?: boolean;
    }
  /** The outcome of a tool call, fed back to the model on the next step. */
  | {
      type: "tool-result";
      callId: string;
      name: string;
      output: unknown;
      failure?: ToolFailureKind;
      /**
       * Wall-clock duration of the call.
       *
       * Kept on the part, not just on the event: the part is what gets folded
       * into the committed message, so this is what makes a reloaded thread able
       * to show how long a step took rather than only the live run.
       */
      ms?: number;
      /**
       * Renderer key for generative UI. The UI package looks this up in its
       * renderer registry; unknown keys fall back to a JSON view, so a headless
       * host is never broken by a tool that wants a custom card.
       */
      render?: string;
    }
  /**
   * A first-class UI artifact produced outside the tool loop (a chart the host
   * computed, a diff, a form). Carried through history so a reloaded thread
   * still renders, but stripped before it reaches a provider.
   */
  | {
      type: "artifact";
      id: string;
      kind: string;
      title?: string;
      data: unknown;
      /**
       * For an interactive card: what the user answered. A sibling of `data`
       * rather than nested inside it, so history-shedding can replace the
       * payload without taking the answer with it — the answer is tiny and is
       * what makes a re-rendered card readable.
       */
      action?: unknown;
    };

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type Message = {
  id: string;
  role: MessageRole;
  parts: ContentPart[];
  createdAt?: number;
  /**
   * Branching: the message this one replies to. `null`/absent on a root.
   * A linear thread is the degenerate case (each message's parent is the
   * previous one); editing or regenerating creates a SIBLING instead of
   * rewriting history, and the active conversation is the path from a chosen
   * head back to the root. Helpers live in content/branching.ts.
   */
  parentId?: string | null;
  /** Free-form host metadata. Never sent to a provider. */
  metadata?: Record<string, unknown>;
};

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Prompt-cache hits, when the provider reports them. */
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export type FinishReason =
  | "stop"
  | "length"
  | "tool-calls"
  | "content-filter"
  | "cancelled"
  | "error"
  | "unknown";