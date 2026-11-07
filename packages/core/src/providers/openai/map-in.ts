// Normalized request → OpenAI wire. Two independent builders, one per dialect.
//
// The invariants worth stating, because breaking any of them yields a 400 that
// reads like a model problem:
//   1. Every `function_call` MUST be followed (eventually) by a
//      `function_call_output` with the same call_id, or the next request 400s
//      with "No tool output found". We never emit an orphan.
//   2. Tool results are strings on the wire. Objects get JSON.stringified here,
//      once, so callers can return plain objects from `execute`.
//   3. `activeTools` narrows tool_choice, not the tool list: the declared tools
//      stay stable across steps so the cached prompt prefix survives.
//   4. Reasoning parts are echoed back only when they carry a provider id —
//      a summary without its item id is not a valid input item.

import type { ContentPart, Message } from "../../content/types.js";
import type { NormalizedRequest, ToolSpec } from "../types.js";
import { collectAnsweredIds, dropUnanswered, filterNativeTools, foreignFileText } from "../shared.js";
import type {
  ChatContentPart,
  ChatMessage,
  ChatRequest,
  ChatTool,
  ChatToolCall,
  ResponsesInputContent,
  ResponsesInputItem,
  ResponsesRequest,
  ResponsesTool,
} from "./wire.js";

/** Data URL for an inline binary. Both dialects accept this form for images. */
function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

// Compared against the ADAPTER's configured id, not a hardcoded "openai" — with
// several instances (openai, groq, nvidia, demo) a file id minted by one is
// meaningless to the others.
const ownFile = (source: { provider: string }, providerId: string): boolean => source.provider === providerId;

const stringifyOutput = (output: unknown): string =>
  typeof output === "string" ? output : JSON.stringify(output ?? null);

// ── Responses API ───────────────────────────────────────────────────────────

function toResponsesContent(part: ContentPart, role: "user" | "assistant", providerId: string): ResponsesInputContent | null {
  switch (part.type) {
    case "text":
      // Assistant turns replay as output_text; user turns as input_text. Sending
      // input_text on an assistant message is rejected.
      return role === "assistant" ? { type: "output_text", text: part.text } : { type: "input_text", text: part.text };
    case "image": {
      const s = part.source;
      if (s.kind === "url") return { type: "input_image", image_url: s.url, ...(part.detail ? { detail: part.detail } : {}) };
      if (s.kind === "base64") {
        return {
          type: "input_image",
          image_url: dataUrl(part.mediaType ?? "image/png", s.data),
          ...(part.detail ? { detail: part.detail } : {}),
        };
      }
      if (!ownFile(s, providerId)) return { type: "input_text", text: foreignFileText("image", undefined, s) };
      return { type: "input_image", file_id: s.id, ...(part.detail ? { detail: part.detail } : {}) };
    }
    case "file": {
      const s = part.source;
      if (s.kind === "providerFile") {
        if (!ownFile(s, providerId)) return { type: "input_text", text: foreignFileText("file", part.filename, s) };
        return { type: "input_file", file_id: s.id };
      }
      if (s.kind === "base64") {
        return {
          type: "input_file",
          file_data: dataUrl(part.mediaType, s.data),
          filename: part.filename ?? "attachment",
        };
      }
      // A bare URL has no Responses representation — inline the reference as text
      // rather than dropping the user's attachment silently.
      return { type: "input_text", text: `[file] ${part.filename ?? s.url} (${s.url})` };
    }
    case "audio":
      // Responses has no audio input part on the text models; surface the
      // transcript if we have one so the turn still carries the content.
      return part.transcript ? { type: "input_text", text: part.transcript } : null;
    default:
      return null;
  }
}

export function toResponsesInput(messages: readonly Message[], providerId = "openai"): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      // System content is hoisted to `instructions` by buildResponsesRequest;
      // any that reaches here is a mid-thread system note, which Responses
      // accepts as a developer message.
      const text = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
      if (text) items.push({ type: "message", role: "developer", content: [{ type: "input_text", text }] });
      continue;
    }

    const role = m.role === "assistant" ? "assistant" : "user";
    const content: ResponsesInputContent[] = [];

    for (const part of m.parts) {
      if (part.type === "tool-call") {
        // Flush any prose accumulated before the call so ordering is preserved.
        if (content.length) {
          items.push({ type: "message", role, content: [...content] });
          content.length = 0;
        }
        items.push({
          type: "function_call",
          call_id: part.callId,
          name: part.name,
          arguments: typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {}),
        });
        continue;
      }
      if (part.type === "tool-result") {
        if (content.length) {
          items.push({ type: "message", role, content: [...content] });
          content.length = 0;
        }
        items.push({ type: "function_call_output", call_id: part.callId, output: stringifyOutput(part.output) });
        continue;
      }
      if (part.type === "reasoning") {
        // Only replayable with its provider item id; a summary alone is invalid input.
        if (part.signature) {
          items.push({
            type: "reasoning",
            id: part.signature,
            summary: part.text ? [{ type: "summary_text", text: part.text }] : [],
          });
        }
        continue;
      }
      const mapped = toResponsesContent(part, role, providerId);
      if (mapped) content.push(mapped);
    }

    if (content.length) items.push({ type: "message", role, content });
  }

  return dropOrphanToolCalls(items);
}

/**
 * Drop `function_call` items with no matching `function_call_output`.
 *
 * This happens for real: a turn is cancelled mid-tool, or the user reloads while
 * a tool is running. Replaying that history unfixed makes OpenAI reject the
 * whole request, so the thread becomes permanently unusable. Dropping the
 * dangling call costs one lost step and keeps the thread alive.
 */
export function dropOrphanToolCalls(items: ResponsesInputItem[]): ResponsesInputItem[] {
  const answered = collectAnsweredIds(items, (i) => (i.type === "function_call_output" ? i.call_id : undefined));
  return dropUnanswered(items, answered, (i) => (i.type === "function_call" ? i.call_id : undefined));
}

function toResponsesTools(tools: readonly ToolSpec[]): ResponsesTool[] {
  // NOTE the flat shape — name/parameters at the top level, NOT nested under a
  // `function` key. That nesting is the Chat Completions form and 400s here.
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters as Record<string, unknown>,
    ...(t.strict ? { strict: true } : {}),
  }));
}

export type BuildOptions = {
  stream?: boolean;
  providerId?: string;
  /** Declared capability; when false the flag is omitted from the wire. */
  parallelToolCalls?: boolean;
};

export function buildResponsesRequest(req: NormalizedRequest, opts: BuildOptions = {}): ResponsesRequest {
  // Hoist leading system messages into `instructions`; that is where Responses
  // wants them and it keeps them out of the cacheable input array.
  const systemFromMessages = req.messages
    .filter((m) => m.role === "system")
    .flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text))
    .join("\n\n");
  const instructions = [req.system, systemFromMessages].filter(Boolean).join("\n\n") || undefined;

  // With previousResponseId the provider already holds everything up to that
  // response — resending it would duplicate the history and double the bill.
  const messages = req.previousResponseId ? tailAfterLastAssistant(req.messages) : req.messages;

  const out: ResponsesRequest = {
    model: req.model,
    input: toResponsesInput(messages.filter((m) => m.role !== "system"), opts.providerId),
  };
  if (instructions && !req.previousResponseId) out.instructions = instructions;
  // Provider-hosted tools ride in the SAME array as function tools — they are
  // declarations, not executors — and are appended verbatim: the vendor owns
  // this shape and versions it on their cadence, not ours.
  const nativeTools = filterNativeTools(req.providerTools?.[opts.providerId ?? "openai"]);
  if (req.tools?.length || nativeTools.length) {
    out.tools = [...(req.tools?.length ? toResponsesTools(req.tools) : []), ...nativeTools] as ResponsesTool[];
    if (req.tools?.length) out.tool_choice = toResponsesToolChoice(req);
    if (opts.parallelToolCalls !== false) out.parallel_tool_calls = true;
  }
  if (req.maxOutputTokens != null) out.max_output_tokens = req.maxOutputTokens;
  if (req.temperature != null) out.temperature = req.temperature;
  if (req.topP != null) out.top_p = req.topP;
  if (req.responseFormat) out.text = { format: toResponsesFormat(req.responseFormat) };
  if (req.reasoning) {
    out.reasoning = {
      ...(req.reasoning.effort ? { effort: req.reasoning.effort } : {}),
      ...(req.reasoning.summary && req.reasoning.summary !== "none" ? { summary: req.reasoning.summary } : {}),
    };
  }
  if (req.previousResponseId) out.previous_response_id = req.previousResponseId;
  if (req.metadata) out.metadata = req.metadata;
  if (opts.stream) out.stream = true;
  if (req.background) {
    out.background = true;
    // Background execution is polled by id, which requires server-side storage.
    // Forcing store:false here would produce a job that can never be read back.
    out.store = true;
  } else if (req.store != null) {
    out.store = req.store;
  }
  mergeProviderOptions(out as Record<string, unknown>, req, opts.providerId);
  return out;
}

/**
 * `providerOptions[providerId]` is THE escape hatch: fields the normalized
 * request has no name for are merged verbatim onto the wire object, last, so
 * they can also override anything the builder chose.
 */
function mergeProviderOptions(out: Record<string, unknown>, req: NormalizedRequest, providerId = "openai"): void {
  const extra = req.providerOptions?.[providerId];
  if (extra) Object.assign(out, extra);
}

/** With `previous_response_id` set, only messages after the last assistant turn are new. */
function tailAfterLastAssistant(messages: readonly Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") return messages.slice(i + 1);
  }
  return [...messages];
}

function toResponsesToolChoice(req: NormalizedRequest): ResponsesRequest["tool_choice"] {
  // `activeTools` narrows via tool_choice rather than by removing declarations,
  // so the tool block (and its prompt-cache prefix) stays byte-identical.
  if (req.activeTools?.length === 1 && req.tools && req.tools.length > 1) {
    return { type: "function", name: req.activeTools[0]! };
  }
  if (req.activeTools?.length === 0) return "none";
  switch (req.toolChoice?.type) {
    case "none":
      return "none";
    case "required":
      return "required";
    case "tool":
      return { type: "function", name: req.toolChoice.name };
    default:
      return "auto";
  }
}

function toResponsesFormat(f: NonNullable<NormalizedRequest["responseFormat"]>): NonNullable<ResponsesRequest["text"]>["format"] {
  if (f.type === "json") return { type: "json_object" };
  if (f.type === "json_schema") {
    return { type: "json_schema", name: f.name, schema: f.schema as Record<string, unknown>, strict: f.strict ?? true };
  }
  return { type: "text" };
}

// ── Chat Completions ────────────────────────────────────────────────────────

function toChatContent(part: ContentPart, providerId: string): ChatContentPart | null {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image": {
      const s = part.source;
      const url =
        s.kind === "url" ? s.url : s.kind === "base64" ? dataUrl(part.mediaType ?? "image/png", s.data) : null;
      if (!url) {
        const pf = s as { kind: "providerFile"; id: string; provider: string };
        if (!ownFile(pf, providerId)) return { type: "text", text: foreignFileText("image", undefined, pf) };
        // Chat Completions has no image-by-file_id form; the file part does.
        return { type: "file", file: { file_id: pf.id } };
      }
      return { type: "image_url", image_url: { url, ...(part.detail ? { detail: part.detail } : {}) } };
    }
    case "file": {
      const s = part.source;
      if (s.kind === "providerFile") {
        if (!ownFile(s, providerId)) return { type: "text", text: foreignFileText("file", part.filename, s) };
        return { type: "file", file: { file_id: s.id } };
      }
      if (s.kind === "base64") {
        return { type: "file", file: { filename: part.filename ?? "attachment", file_data: dataUrl(part.mediaType, s.data) } };
      }
      return { type: "text", text: `[file] ${part.filename ?? s.url} (${s.url})` };
    }
    case "audio": {
      const s = part.source;
      if (s.kind === "base64") {
        const format = part.mediaType.includes("mp3") ? "mp3" : "wav";
        return { type: "input_audio", input_audio: { data: s.data, format } };
      }
      return part.transcript ? { type: "text", text: part.transcript } : null;
    }
    default:
      return null;
  }
}

export function toChatMessages(messages: readonly Message[], system?: string, providerId = "openai"): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    if (m.role === "system") {
      const text = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
      if (text) out.push({ role: "system", content: text });
      continue;
    }

    if (m.role === "assistant") {
      const text = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
      const calls: ChatToolCall[] = m.parts
        .filter((p): p is Extract<ContentPart, { type: "tool-call" }> => p.type === "tool-call")
        .map((p) => ({
          id: p.callId,
          type: "function",
          function: { name: p.name, arguments: typeof p.input === "string" ? p.input : JSON.stringify(p.input ?? {}) },
        }));

      // An assistant message with neither text nor tool calls is rejected;
      // skip it rather than sending an empty turn.
      if (text || calls.length) {
        out.push({
          role: "assistant",
          ...(text ? { content: text } : { content: null }),
          ...(calls.length ? { tool_calls: calls } : {}),
        });
      }

      // Tool results ride in their own `role:"tool"` messages, which must come
      // directly after the assistant message that requested them.
      for (const p of m.parts) {
        if (p.type === "tool-result") {
          out.push({ role: "tool", tool_call_id: p.callId, content: stringifyOutput(p.output) });
        }
      }
      continue;
    }

    // role === "user" | "tool"
    const toolResults = m.parts.filter((p): p is Extract<ContentPart, { type: "tool-result" }> => p.type === "tool-result");
    for (const p of toolResults) {
      out.push({ role: "tool", tool_call_id: p.callId, content: stringifyOutput(p.output) });
    }

    const content = m.parts.map((p) => toChatContent(p, providerId)).filter((c): c is ChatContentPart => c !== null);
    if (content.length) {
      // Collapse a lone text part to a bare string — the shape every
      // OpenAI-compatible router understands, including older ones.
      const only = content.length === 1 && content[0]?.type === "text" ? (content[0] as { text: string }).text : null;
      out.push({ role: "user", content: only ?? content });
    }
  }

  return dropOrphanChatToolCalls(out);
}

/** Same orphan problem as Responses: an assistant tool_call with no `role:"tool"` reply 400s. */
export function dropOrphanChatToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const answered = collectAnsweredIds(messages, (m) => (m.role === "tool" ? m.tool_call_id : undefined));
  return messages
    .map((m) => {
      if (m.role !== "assistant" || !m.tool_calls?.length) return m;
      const kept = dropUnanswered(m.tool_calls, answered, (c) => c.id);
      if (kept.length === m.tool_calls.length) return m;
      if (kept.length === 0) {
        const { tool_calls: _dropped, ...rest } = m;
        return rest.content ? rest : null;
      }
      return { ...m, tool_calls: kept };
    })
    .filter((m): m is ChatMessage => m !== null);
}

function toChatTools(tools: readonly ToolSpec[]): ChatTool[] {
  // NOTE the nested shape — the mirror image of the Responses form above.
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
      ...(t.strict ? { strict: true } : {}),
    },
  }));
}

export function buildChatRequest(req: NormalizedRequest, opts: BuildOptions = {}): ChatRequest {
  const out: ChatRequest = {
    model: req.model,
    messages: toChatMessages(req.messages, req.system, opts.providerId),
  };
  const nativeChatTools = filterNativeTools(req.providerTools?.[opts.providerId ?? "openai"]);
  if (req.tools?.length || nativeChatTools.length) {
    // Chat Completions has no activeTools concept, so narrowing here really does
    // mean shipping fewer declarations.
    const activeNames = req.activeTools ? new Set(req.activeTools) : undefined;
    const active = activeNames ? (req.tools ?? []).filter((t) => activeNames.has(t.name)) : (req.tools ?? []);
    if (active.length || nativeChatTools.length) {
      out.tools = [...(active.length ? toChatTools(active) : []), ...nativeChatTools] as ChatTool[];
      if (opts.parallelToolCalls !== false) out.parallel_tool_calls = true;
      switch (req.toolChoice?.type) {
        case "none":
          out.tool_choice = "none";
          break;
        case "required":
          out.tool_choice = "required";
          break;
        case "tool":
          out.tool_choice = { type: "function", function: { name: req.toolChoice.name } };
          break;
        default:
          out.tool_choice = "auto";
      }
    }
  }
  if (req.maxOutputTokens != null) out.max_completion_tokens = req.maxOutputTokens;
  if (req.temperature != null) out.temperature = req.temperature;
  if (req.topP != null) out.top_p = req.topP;
  if (req.stopSequences?.length) out.stop = req.stopSequences;
  if (req.reasoning?.effort) out.reasoning_effort = req.reasoning.effort;
  if (req.metadata) out.metadata = req.metadata;
  if (req.store != null) out.store = req.store;
  if (req.responseFormat) {
    if (req.responseFormat.type === "json") out.response_format = { type: "json_object" };
    else if (req.responseFormat.type === "json_schema") {
      out.response_format = {
        type: "json_schema",
        json_schema: {
          name: req.responseFormat.name,
          schema: req.responseFormat.schema as Record<string, unknown>,
          strict: req.responseFormat.strict ?? true,
        },
      };
    } else out.response_format = { type: "text" };
  }
  if (opts.stream) {
    out.stream = true;
    // Usage is omitted from streamed responses unless asked for — without this
    // every streamed turn meters as zero tokens.
    out.stream_options = { include_usage: true };
  }
  mergeProviderOptions(out as Record<string, unknown>, req, opts.providerId);
  return out;
}
