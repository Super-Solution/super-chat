// Normalized request → Anthropic Messages wire.
//
// Structural differences from the OpenAI builders that matter here:
//   • Tool CALLS are `tool_use` blocks inside the assistant message; tool
//     RESULTS are `tool_result` blocks inside the FOLLOWING USER message.
//   • Thinking replays as a `thinking` block with its `signature` — and only
//     with one; a reasoning part without a signature is display-only.
//   • `max_tokens` is required and caps thinking + text together.

import type { ContentPart, Message } from "../../content/types.js";
import type { NormalizedRequest, ToolSpec } from "../types.js";
import { collectAnsweredIds, dropUnanswered, filterNativeTools, foreignFileText } from "../shared.js";
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicTool,
  AnthropicToolChoice,
} from "./wire.js";

export type AnthropicBuildOptions = {
  stream?: boolean;
  providerId?: string;
  parallelToolCalls?: boolean;
  /** Applied when the request carries no maxOutputTokens (`max_tokens` is required). */
  defaultMaxTokens?: number;
};

const DEFAULT_MAX_TOKENS = 4096;

function toBlocks(part: ContentPart, providerId: string): AnthropicContentBlock | null {
  switch (part.type) {
    case "text":
      return part.text ? { type: "text", text: part.text } : null;
    case "reasoning":
      // Replayable only with its signature; redacted blocks round-trip via the
      // signature field where the opaque payload was stashed on the way out.
      if (part.redacted && part.signature) return { type: "redacted_thinking", data: part.signature };
      if (part.signature) return { type: "thinking", thinking: part.text, signature: part.signature };
      return null;
    case "image": {
      const s = part.source;
      if (s.kind === "url") return { type: "image", source: { type: "url", url: s.url } };
      if (s.kind === "base64") {
        return { type: "image", source: { type: "base64", media_type: part.mediaType ?? "image/png", data: s.data } };
      }
      if (s.provider !== providerId) return { type: "text", text: foreignFileText("image", undefined, s) };
      return { type: "image", source: { type: "file", file_id: s.id } };
    }
    case "file": {
      const s = part.source;
      if (s.kind === "url") return { type: "document", source: { type: "url", url: s.url }, ...(part.filename ? { title: part.filename } : {}) };
      if (s.kind === "base64") {
        return {
          type: "document",
          source: { type: "base64", media_type: part.mediaType, data: s.data },
          ...(part.filename ? { title: part.filename } : {}),
        };
      }
      if (s.provider !== providerId) return { type: "text", text: foreignFileText("file", part.filename, s) };
      return { type: "document", source: { type: "file", file_id: s.id }, ...(part.filename ? { title: part.filename } : {}) };
    }
    case "audio":
      // No audio input on the Messages API; surface the transcript.
      return part.transcript ? { type: "text", text: part.transcript } : null;
    case "tool-call":
      return {
        type: "tool_use",
        id: part.callId,
        name: part.name,
        input: typeof part.input === "string" ? tryParse(part.input) : (part.input ?? {}),
      };
    case "tool-result":
      return {
        type: "tool_result",
        tool_use_id: part.callId,
        content: typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? null),
        ...(part.failure ? { is_error: true } : {}),
      };
    default:
      return null; // artifact parts are UI-only
  }
}

const tryParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

/**
 * Fold normalized messages into Anthropic's user/assistant alternation.
 * System messages are hoisted by the caller; `tool` role messages become USER
 * messages carrying tool_result blocks (the wire has no tool role). Adjacent
 * same-role messages merge — cheap, and robust to strict-alternation servers.
 */
export function toAnthropicMessages(messages: readonly Message[], providerId = "anthropic"): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "system") continue;
    const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : "user";
    const blocks = m.parts.map((p) => toBlocks(p, providerId)).filter((b): b is AnthropicContentBlock => b !== null);
    if (!blocks.length) continue;

    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  }

  return dropOrphanToolUses(out);
}

/**
 * Same orphan rule as OpenAI: a `tool_use` with no `tool_result` in the next
 * user message 400s the whole request. A cancelled turn leaves exactly that in
 * persisted history, so prune rather than letting one lost step poison the
 * thread forever.
 */
export function dropOrphanToolUses(messages: AnthropicMessage[]): AnthropicMessage[] {
  const answered = collectAnsweredIds(
    messages.flatMap((m) => m.content),
    (b) => (b.type === "tool_result" ? b.tool_use_id : undefined),
  );
  return messages
    .map((m) => ({
      ...m,
      content: dropUnanswered(m.content, answered, (b) => (b.type === "tool_use" ? b.id : undefined)),
    }))
    .filter((m) => m.content.length > 0);
}

function toAnthropicTools(tools: readonly ToolSpec[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Record<string, unknown>,
    ...(t.strict ? { strict: true } : {}),
  }));
}

function toToolChoice(req: NormalizedRequest, parallel: boolean): AnthropicToolChoice | undefined {
  const noParallel = parallel ? {} : { disable_parallel_tool_use: true };
  // `activeTools` narrows like the OpenAI builder: a single active tool forces it.
  if (req.activeTools?.length === 1 && req.tools && req.tools.length > 1) {
    return { type: "tool", name: req.activeTools[0]!, ...noParallel };
  }
  if (req.activeTools?.length === 0) return { type: "none" };
  switch (req.toolChoice?.type) {
    case "none":
      return { type: "none" };
    case "required":
      return { type: "any", ...noParallel };
    case "tool":
      return { type: "tool", name: req.toolChoice.name, ...noParallel };
    default:
      return parallel ? { type: "auto" } : { type: "auto", disable_parallel_tool_use: true };
  }
}

const EFFORT: Record<string, NonNullable<AnthropicRequest["output_config"]>["effort"]> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

export function buildAnthropicRequest(req: NormalizedRequest, opts: AnthropicBuildOptions = {}): AnthropicRequest {
  const providerId = opts.providerId ?? "anthropic";

  const systemFromMessages = req.messages
    .filter((m) => m.role === "system")
    .flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text))
    .join("\n\n");
  const system = [req.system, systemFromMessages].filter(Boolean).join("\n\n") || undefined;

  const out: AnthropicRequest = {
    model: req.model,
    max_tokens: req.maxOutputTokens ?? opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    messages: toAnthropicMessages(req.messages, providerId),
  };
  if (system) out.system = system;

  // Provider-hosted tools (web search, code execution) share the tools array
  // with function tools and are appended verbatim — the vendor owns the shape.
  const nativeTools = filterNativeTools(req.providerTools?.[providerId]);
  if (req.tools?.length || nativeTools.length) {
    out.tools = [...(req.tools?.length ? toAnthropicTools(req.tools) : []), ...nativeTools] as AnthropicTool[];
    if (req.tools?.length) {
      const choice = toToolChoice(req, opts.parallelToolCalls !== false);
      if (choice) out.tool_choice = choice;
    }
  }

  if (req.reasoning) {
    // Current models: adaptive thinking + effort — never budget_tokens (400s
    // on Opus 4.7+). `summary` opt-in maps to display: "summarized" so hosts
    // that render reasoning actually receive text.
    out.thinking = {
      type: "adaptive",
      ...(req.reasoning.summary && req.reasoning.summary !== "none" ? { display: "summarized" as const } : {}),
    };
    const effort = req.reasoning.effort ? EFFORT[req.reasoning.effort] : undefined;
    if (effort) out.output_config = { ...(out.output_config ?? {}), effort };
  }

  if (req.responseFormat?.type === "json_schema") {
    out.output_config = {
      ...(out.output_config ?? {}),
      format: { type: "json_schema", schema: req.responseFormat.schema as Record<string, unknown> },
    };
  }

  // Sampling params are caller-set pass-throughs. NOTE: models from Opus 4.7
  // on REJECT them — leave unset unless the target model accepts them.
  if (req.temperature != null) out.temperature = req.temperature;
  if (req.topP != null) out.top_p = req.topP;
  if (req.stopSequences?.length) out.stop_sequences = req.stopSequences;
  if (opts.stream) out.stream = true;

  const extra = req.providerOptions?.[providerId];
  if (extra) Object.assign(out, extra);
  return out;
}

/** Whether any message references a providerFile minted by THIS provider (needs the Files beta header). */
export function usesOwnFiles(req: NormalizedRequest, providerId: string): boolean {
  return req.messages.some((m) =>
    m.parts.some(
      (p) =>
        (p.type === "file" || p.type === "image") &&
        p.source.kind === "providerFile" &&
        p.source.provider === providerId,
    ),
  );
}
