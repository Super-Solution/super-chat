// Anthropic Messages API wire types — hand-rolled, same stance as the OpenAI
// adapter: the wire format is the part you need to get right, and owning it
// beats trusting an SDK to.
//
// The invariants worth stating up front:
//   1. `max_tokens` is REQUIRED, and it caps thinking + response text together.
//   2. Tool results ride in USER messages as `tool_result` blocks, and every
//      `tool_use` must be answered or the request 400s — same orphan problem
//      as OpenAI, same pruning cure.
//   3. Thinking blocks replay on the SAME model only, and only UNCHANGED —
//      the `signature` is the replay token. Blocks without one are dropped.
//   4. Current models (Opus 4.7+) reject `temperature`/`top_p` and
//      `budget_tokens`; thinking is configured as `{type: "adaptive"}` and
//      depth via `output_config.effort`.

export type AnthropicImageSource =
  | { type: "base64"; media_type: string; data: string }
  | { type: "url"; url: string }
  | { type: "file"; file_id: string };

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: AnthropicImageSource }
  | { type: "document"; source: AnthropicImageSource; title?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | { type: "text"; text: string }[];
      is_error?: boolean;
    }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string };

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
};

export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
};

export type AnthropicToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
  | { type: "none" };

export type AnthropicRequest = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  thinking?: { type: "adaptive"; display?: "summarized" | "omitted" };
  output_config?: {
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    format?: { type: "json_schema"; schema: Record<string, unknown> };
  };
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: { user_id?: string };
};

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type AnthropicStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "refusal"
  | "pause_turn"
  | "model_context_window_exceeded"
  | (string & {});

export type AnthropicResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: AnthropicStopReason | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
};

// ── Streaming (SSE) ─────────────────────────────────────────────────────────

export type AnthropicStreamEvent =
  | { type: "message_start"; message: AnthropicResponse }
  | { type: "content_block_start"; index: number; content_block: AnthropicContentBlock }
  | { type: "content_block_delta"; index: number; delta: AnthropicDelta }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason?: AnthropicStopReason | null }; usage?: AnthropicUsage }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error: { type: string; message: string } };

export type AnthropicDelta =
  | { type: "text_delta"; text: string }
  | { type: "input_json_delta"; partial_json: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "signature_delta"; signature: string };
