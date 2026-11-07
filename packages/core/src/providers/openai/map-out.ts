// OpenAI wire → normalized. The inverse of map-in, and the place where model
// output stops being provider-shaped.

import type { ContentPart, FinishReason, Usage } from "../../content/types.js";
import { repairToolArguments } from "../../tools/repair.js";
import type { ChatResponse, ChatUsage, ResponsesResponse, ResponsesUsage } from "./wire.js";

export function usageFromResponses(u?: ResponsesUsage): Usage {
  if (!u) return {};
  return {
    ...(u.input_tokens != null ? { inputTokens: u.input_tokens } : {}),
    ...(u.output_tokens != null ? { outputTokens: u.output_tokens } : {}),
    ...(u.total_tokens != null ? { totalTokens: u.total_tokens } : {}),
    ...(u.input_tokens_details?.cached_tokens != null ? { cachedInputTokens: u.input_tokens_details.cached_tokens } : {}),
    ...(u.output_tokens_details?.reasoning_tokens != null
      ? { reasoningTokens: u.output_tokens_details.reasoning_tokens }
      : {}),
  };
}

export function usageFromChat(u?: ChatUsage): Usage {
  if (!u) return {};
  return {
    ...(u.prompt_tokens != null ? { inputTokens: u.prompt_tokens } : {}),
    ...(u.completion_tokens != null ? { outputTokens: u.completion_tokens } : {}),
    ...(u.total_tokens != null ? { totalTokens: u.total_tokens } : {}),
    ...(u.prompt_tokens_details?.cached_tokens != null ? { cachedInputTokens: u.prompt_tokens_details.cached_tokens } : {}),
    ...(u.completion_tokens_details?.reasoning_tokens != null
      ? { reasoningTokens: u.completion_tokens_details.reasoning_tokens }
      : {}),
  };
}

/**
 * Map Responses `status` + `incomplete_details` to a finish reason.
 * `incomplete` is ambiguous on its own — the reason field is what distinguishes
 * "hit max_output_tokens" from "tripped a content filter", and those need
 * different handling upstream (retry bigger vs never retry).
 */
export function finishFromResponses(r: ResponsesResponse): FinishReason {
  switch (r.status) {
    case "completed":
      // A completed response whose only output is a tool call means the model is
      // mid-task, not done — the runtime must run tools and loop.
      return r.output.some((o) => o.type === "function_call") ? "tool-calls" : "stop";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "error";
    case "incomplete": {
      const reason = r.incomplete_details?.reason ?? "";
      if (/max_output_tokens|max_tokens|length/i.test(reason)) return "length";
      if (/content_filter|refusal|safety/i.test(reason)) return "content-filter";
      return "unknown";
    }
    default:
      return "unknown";
  }
}

export function finishFromChat(raw: string | null | undefined): FinishReason {
  switch (raw) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool-calls";
    case "content_filter":
      return "content-filter";
    default:
      return raw ? "unknown" : "stop";
  }
}

export function partsFromResponses(r: ResponsesResponse): ContentPart[] {
  const parts: ContentPart[] = [];

  for (const item of r.output ?? []) {
    if (item.type === "message") {
      for (const c of (item as Extract<typeof item, { type: "message" }>).content ?? []) {
        if (c.type === "output_text" && c.text) parts.push({ type: "text", text: c.text });
        // A refusal is the model declining — surface it as text so the user sees
        // the reason instead of an empty bubble.
        else if (c.type === "refusal" && c.refusal) parts.push({ type: "text", text: c.refusal });
      }
      continue;
    }
    if (item.type === "function_call") {
      const call = item as Extract<typeof item, { type: "function_call" }>;
      const { value, repaired } = repairToolArguments(call.arguments);
      parts.push({
        type: "tool-call",
        callId: call.call_id,
        name: call.name,
        input: value,
        status: "pending",
        ...(repaired ? { repaired: true } : {}),
      });
      continue;
    }
    if (item.type === "reasoning") {
      const rz = item as Extract<typeof item, { type: "reasoning" }>;
      const text = (rz.summary ?? []).map((s) => s.text).join("\n");
      // `signature` carries the item id so the next turn can replay it — see the
      // reasoning branch in toResponsesInput.
      parts.push({ type: "reasoning", text, signature: rz.id });
      continue;
    }
    // Anything else the model emitted is a PROVIDER-HOSTED tool record
    // (web_search_call, code_interpreter_call, …): work that happened
    // server-side with no call for us to execute. Surface it as an artifact so
    // the transcript shows the agent searched rather than the answer arriving
    // from nowhere — artifacts are UI-only and stripped before the next
    // request, so this costs nothing at request time.
    const record = item as { type: string; id?: string; status?: string };
    parts.push({
      type: "artifact",
      id: record.id ?? `${record.type}_${parts.length}`,
      kind: `provider-tool:${record.type}`,
      data: record,
    });
  }

  return parts;
}

export function partsFromChat(r: ChatResponse): ContentPart[] {
  const choice = r.choices?.[0];
  if (!choice) return [];
  const parts: ContentPart[] = [];
  const msg = choice.message;

  if (msg.refusal) parts.push({ type: "text", text: msg.refusal });
  // Before the answer, matching both the order it was produced in and the
  // order streamChat emits it. Without this, a reasoning model showed its
  // thinking in stream mode and silently lost it in sync mode — same
  // provider, same model, different mode, different content.
  if (msg.reasoning_content) parts.push({ type: "reasoning", text: msg.reasoning_content });
  if (msg.content) parts.push({ type: "text", text: msg.content });

  for (const call of msg.tool_calls ?? []) {
    const { value, repaired } = repairToolArguments(call.function.arguments);
    parts.push({
      type: "tool-call",
      callId: call.id,
      name: call.function.name,
      input: value,
      status: "pending",
      ...(repaired ? { repaired: true } : {}),
    });
  }

  return parts;
}
