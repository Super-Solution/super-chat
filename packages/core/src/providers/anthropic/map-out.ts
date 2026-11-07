// Anthropic wire → normalized parts.

import type { ContentPart, FinishReason, Usage } from "../../content/types.js";
import type { AnthropicResponse, AnthropicStopReason, AnthropicUsage } from "./wire.js";

export function partsFromAnthropic(response: AnthropicResponse): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const block of response.content) {
    switch (block.type) {
      case "text":
        parts.push({ type: "text", text: block.text });
        break;
      case "thinking":
        // The signature is the replay token — without it the block can never
        // be echoed back, so keep it on the part.
        parts.push({ type: "reasoning", text: block.thinking, ...(block.signature ? { signature: block.signature } : {}) });
        break;
      case "redacted_thinking":
        // Opaque payload rides in `signature` so map-in can round-trip it.
        parts.push({ type: "reasoning", text: "", signature: block.data, redacted: true });
        break;
      case "tool_use":
        parts.push({ type: "tool-call", callId: block.id, name: block.name, input: block.input, status: "pending" });
        break;
      default: {
        // `tool_result` never appears in an assistant response, so anything
        // else here is a PROVIDER-HOSTED tool record (server_tool_use,
        // web_search_tool_result, …): work done provider-side with no call for
        // us to execute. Surface it as a UI-only artifact so the transcript
        // shows the search happened; it is stripped before the next request.
        const record = block as { type: string; id?: string };
        if (record.type === "tool_result") break;
        parts.push({
          type: "artifact",
          id: record.id ?? `${record.type}_${parts.length}`,
          kind: `provider-tool:${record.type}`,
          data: record,
        });
        break;
      }
    }
  }
  return parts;
}

export function finishFromAnthropic(reason: AnthropicStopReason | null | undefined): FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
    case "pause_turn":
      return "stop";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "length";
    case "tool_use":
      return "tool-calls";
    case "refusal":
      return "content-filter";
    default:
      return "unknown";
  }
}

export function usageFromAnthropic(usage: AnthropicUsage | undefined): Usage {
  if (!usage) return {};
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    ...(usage.cache_read_input_tokens != null ? { cachedInputTokens: usage.cache_read_input_tokens } : {}),
  };
}
