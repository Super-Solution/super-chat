// OpenAI wire shapes, hand-typed. Only the fields superchat actually reads or
// writes — a faithful mirror of the whole API would be noise and would rot.
//
// The two dialects differ more than people expect, which is exactly why the
// mapping lives in typed builders rather than inline object literals:
//
//                        Responses API              Chat Completions
//   entry point          POST /responses            POST /chat/completions
//   history field        input[]                    messages[]
//   system              instructions (top level)    a message with role system/developer
//   user text part      { type:"input_text" }       { type:"text" }
//   image part          { type:"input_image",       { type:"image_url",
//                          image_url:"data:…" }        image_url:{ url, detail } }
//   file part           { type:"input_file" }       { type:"file", file:{...} }
//   assistant text      { type:"output_text" }      content: string
//   tool declaration    flat { type:"function",     nested { type:"function",
//                          name, parameters }          function:{ name, parameters } }
//   model tool call     input item "function_call"  assistant.tool_calls[]
//   tool output         input item                  message role:"tool"
//                         "function_call_output"       with tool_call_id
//   output cap          max_output_tokens           max_completion_tokens
//   async               background:true + polling   (none)
//
// Conflating these is the single most common source of 400s, so each builder
// below owns exactly one dialect and they share no object literals.

// ── Responses API ───────────────────────────────────────────────────────────

export type ResponsesInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url?: string; file_id?: string; detail?: "auto" | "low" | "high" }
  | { type: "input_file"; file_id?: string; filename?: string; file_data?: string }
  | { type: "output_text"; text: string };

export type ResponsesInputItem =
  | { type: "message"; role: "user" | "assistant" | "system" | "developer"; content: ResponsesInputContent[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string; id?: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | { type: "reasoning"; id: string; summary: { type: "summary_text"; text: string }[]; encrypted_content?: string };

export type ResponsesTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

export type ResponsesToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; name: string };

export type ResponsesRequest = {
  model: string;
  input: ResponsesInputItem[];
  instructions?: string;
  tools?: ResponsesTool[];
  tool_choice?: ResponsesToolChoice;
  parallel_tool_calls?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  text?: { format: { type: "text" } | { type: "json_object" } | { type: "json_schema"; name: string; schema: Record<string, unknown>; strict?: boolean } };
  reasoning?: { effort?: "minimal" | "low" | "medium" | "high"; summary?: "auto" | "concise" | "detailed" };
  background?: boolean;
  store?: boolean;
  stream?: boolean;
  previous_response_id?: string;
  metadata?: Record<string, string>;
  include?: string[];
};

export type ResponsesOutputItem =
  | {
      type: "message";
      id?: string;
      role: "assistant";
      status?: string;
      content: ({ type: "output_text"; text: string; annotations?: unknown[] } | { type: "refusal"; refusal: string })[];
    }
  | { type: "function_call"; id?: string; call_id: string; name: string; arguments: string; status?: string }
  | { type: "reasoning"; id: string; summary?: { type: "summary_text"; text: string }[]; encrypted_content?: string }
  | { type: string; [k: string]: unknown };

export type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
};

export type ResponsesResponse = {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "incomplete" | "cancelled";
  output: ResponsesOutputItem[];
  output_text?: string;
  usage?: ResponsesUsage;
  error?: { code?: string; message: string } | null;
  incomplete_details?: { reason?: string } | null;
  previous_response_id?: string | null;
};

/** Streaming envelope. Every event carries `sequence_number` — that is the cursor
 *  `starting_after` uses to resume a background stream after a disconnect. */
export type ResponsesStreamEvent = {
  type: string;
  sequence_number?: number;
  delta?: string;
  text?: string;
  item_id?: string;
  output_index?: number;
  content_index?: number;
  item?: ResponsesOutputItem;
  response?: ResponsesResponse;
  arguments?: string;
  code?: string;
  message?: string;
};

// ── Chat Completions ────────────────────────────────────────────────────────

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } }
  | { type: "file"; file: { file_id?: string; filename?: string; file_data?: string } };

export type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Present only on streamed deltas, to correlate partial calls. */
  index?: number;
};

export type ChatMessage =
  | { role: "system" | "developer"; content: string }
  | { role: "user"; content: string | ChatContentPart[] }
  | { role: "assistant"; content?: string | null; tool_calls?: ChatToolCall[]; refusal?: string | null }
  | { role: "tool"; content: string; tool_call_id: string };

export type ChatTool = {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown>; strict?: boolean };
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  parallel_tool_calls?: boolean;
  /** Newer name for max_tokens; required for reasoning models, accepted by the rest. */
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  response_format?: { type: "text" } | { type: "json_object" } | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  store?: boolean;
  metadata?: Record<string, string>;
};

export type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

export type ChatResponse = {
  id: string;
  object: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: "assistant";
      content?: string | null;
      tool_calls?: ChatToolCall[];
      refusal?: string | null;
      /**
       * Same non-standard field the streamed delta carries, and emitted by the
       * same servers — LM Studio returns it on a plain POST too. Declaring it
       * only on the stream chunk is why sync mode used to drop a reasoning
       * model's thinking entirely.
       */
      reasoning_content?: string | null;
    };
    finish_reason: string | null;
  }[];
  usage?: ChatUsage;
};

export type ChatStreamChunk = {
  id: string;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: ChatToolCall[];
      /** Non-standard but widely emitted by OpenAI-compatible routers. */
      reasoning_content?: string | null;
    };
    finish_reason: string | null;
  }[];
  usage?: ChatUsage;
};
