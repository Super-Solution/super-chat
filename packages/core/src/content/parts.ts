// Constructors, guards and small readers for the content model. Kept dependency
// free so both the browser bundle and a server route can use them.

import type {
  ContentPart,
  MediaSource,
  Message,
  MessageRole,
  ToolCallStatus,
  ToolFailureKind,
} from "./types.js";

let counter = 0;
/**
 * Monotonic id. Deliberately not `crypto.randomUUID()` — ids show up in test
 * snapshots and in `previous_response_id` correlation logs, and a stable,
 * readable prefix is worth more here than global uniqueness. Callers that need
 * cross-device uniqueness pass their own id.
 */
export function nextId(prefix = "msg"): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export const text = (value: string): ContentPart => ({ type: "text", text: value });

export const image = (
  source: MediaSource,
  opts: { mediaType?: string; detail?: "auto" | "low" | "high" } = {},
): ContentPart => ({ type: "image", source, ...opts });

export const file = (source: MediaSource, mediaType: string, filename?: string): ContentPart => ({
  type: "file",
  source,
  mediaType,
  ...(filename ? { filename } : {}),
});

export const toolCall = (
  callId: string,
  name: string,
  input: unknown,
  opts: { status?: ToolCallStatus; repaired?: boolean } = {},
): ContentPart => ({ type: "tool-call", callId, name, input, status: opts.status ?? "pending", ...opts });

export const toolResult = (
  callId: string,
  name: string,
  output: unknown,
  opts: { failure?: ToolFailureKind; render?: string } = {},
): ContentPart => ({ type: "tool-result", callId, name, output, ...opts });

export function message(role: MessageRole, parts: ContentPart[] | string, id?: string): Message {
  return {
    id: id ?? nextId(role === "assistant" ? "asst" : role),
    role,
    parts: typeof parts === "string" ? [text(parts)] : parts,
    createdAt: Date.now(),
  };
}

export const userMessage = (parts: ContentPart[] | string, id?: string) => message("user", parts, id);
export const assistantMessage = (parts: ContentPart[] | string, id?: string) => message("assistant", parts, id);

export const isTextPart = (p: ContentPart): p is Extract<ContentPart, { type: "text" }> => p.type === "text";
export const isToolCallPart = (p: ContentPart): p is Extract<ContentPart, { type: "tool-call" }> =>
  p.type === "tool-call";
export const isToolResultPart = (p: ContentPart): p is Extract<ContentPart, { type: "tool-result" }> =>
  p.type === "tool-result";

/** Concatenated text of a message — the "what did it actually say" reader. */
export function messageText(m: Message): string {
  return m.parts.filter(isTextPart).map((p) => p.text).join("");
}

/** Last user-authored text in a thread. Drives skill matching and intent checks. */
export function lastUserText(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === "user") return messageText(m).trim();
  }
  return "";
}

export function toolCallsIn(messages: readonly Message[]): Extract<ContentPart, { type: "tool-call" }>[] {
  return messages.flatMap((m) => m.parts.filter(isToolCallPart));
}

/**
 * Merge streamed text deltas into the trailing text part instead of appending a
 * new part per token — otherwise a 2k-token reply becomes 2k parts and every
 * React render walks all of them.
 */
export function appendText(parts: ContentPart[], delta: string): ContentPart[] {
  const last = parts[parts.length - 1];
  if (last && last.type === "text") {
    return [...parts.slice(0, -1), { type: "text", text: last.text + delta }];
  }
  return [...parts, { type: "text", text: delta }];
}

/** Same merge, for reasoning streams (which arrive interleaved with text). */
export function appendReasoning(parts: ContentPart[], delta: string, signature?: string): ContentPart[] {
  const last = parts[parts.length - 1];
  if (last && last.type === "reasoning") {
    return [
      ...parts.slice(0, -1),
      { ...last, text: last.text + delta, ...(signature ? { signature } : {}) },
    ];
  }
  return [...parts, { type: "reasoning", text: delta, ...(signature ? { signature } : {}) }];
}

/**
 * Strip parts that exist only for the UI. Artifacts are host-rendered and have
 * no provider representation; sending them would either 400 or waste tokens on
 * a JSON blob the model can't act on.
 */
export function stripUiOnlyParts(m: Message): Message {
  const parts = m.parts.filter((p) => p.type !== "artifact");
  return parts.length === m.parts.length ? m : { ...m, parts };
}
