// Anthropic SSE dialect → normalized StreamEvents.
//
// Shape of the stream: message_start, then per content block a
// content_block_start / *_delta / *_stop trio (indexed), then message_delta
// (stop_reason + output usage) and message_stop. Deltas are typed:
// text_delta, thinking_delta, signature_delta (the thinking replay token,
// arriving at the END of a thinking block), input_json_delta (tool args).

import { parseSSEJson } from "../../transport/sse.js";
import { repairToolArguments } from "../../tools/repair.js";
import type { StreamEvent } from "../types.js";
import { finishFromAnthropic, usageFromAnthropic } from "./map-out.js";
import type { AnthropicStreamEvent, AnthropicUsage } from "./wire.js";

export async function* streamAnthropic(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  type PendingTool = { callId: string; name: string; args: string };
  const toolsByIndex = new Map<number, PendingTool>();
  let inputUsage: AnthropicUsage | undefined;
  let outputUsage: AnthropicUsage | undefined;
  let stopReason: Parameters<typeof finishFromAnthropic>[0] = null;

  for await (const frame of parseSSEJson<AnthropicStreamEvent>(body)) {
    const event = frame.data;
    switch (event.type) {
      case "message_start":
        inputUsage = event.message.usage;
        yield { type: "start", responseId: event.message.id, modelId: event.message.model };
        break;

      case "content_block_start": {
        if (event.content_block.type === "tool_use") {
          const pending: PendingTool = {
            callId: event.content_block.id,
            name: event.content_block.name,
            // `input` on the start block is {} — args stream via input_json_delta.
            args: "",
          };
          toolsByIndex.set(event.index, pending);
          yield { type: "tool-call-start", callId: pending.callId, name: pending.name };
        }
        break;
      }

      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "text-delta", delta: delta.text };
        } else if (delta.type === "thinking_delta") {
          yield { type: "reasoning-delta", delta: delta.thinking };
        } else if (delta.type === "signature_delta") {
          // The replay token arrives at the end of the thinking block. Emit an
          // empty reasoning delta carrying it — the collector stamps it onto
          // the accumulated reasoning part.
          yield { type: "reasoning-delta", delta: "", signature: delta.signature };
        } else if (delta.type === "input_json_delta") {
          const pending = toolsByIndex.get(event.index);
          if (pending) {
            pending.args += delta.partial_json;
            yield { type: "tool-call-delta", callId: pending.callId, argsDelta: delta.partial_json };
          }
        }
        break;
      }

      case "content_block_stop": {
        const pending = toolsByIndex.get(event.index);
        if (pending) {
          const { value, repaired } = repairToolArguments(pending.args || "{}");
          yield { type: "tool-call-end", callId: pending.callId, name: pending.name, input: value, repaired };
          toolsByIndex.delete(event.index);
        }
        break;
      }

      case "message_delta":
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
        if (event.usage) outputUsage = event.usage;
        break;

      case "message_stop": {
        // Input tokens arrive on message_start, output tokens on message_delta —
        // merge before reporting, or every streamed turn meters as zero input.
        const usage = usageFromAnthropic({ ...(inputUsage ?? {}), ...(outputUsage ?? {}) });
        yield { type: "usage", usage };
        yield { type: "finish", finishReason: finishFromAnthropic(stopReason), usage };
        return;
      }

      case "error":
        yield { type: "error", error: new Error(event.error.message) };
        return;

      default:
        break; // ping and future event types
    }
  }

  // Stream ended without message_stop (dropped connection). Close out what we
  // have rather than leaving the consumer's reducer half-applied.
  for (const pending of toolsByIndex.values()) {
    const { value, repaired } = repairToolArguments(pending.args || "{}");
    yield { type: "tool-call-end", callId: pending.callId, name: pending.name, input: value, repaired };
  }
  const usage = usageFromAnthropic({ ...(inputUsage ?? {}), ...(outputUsage ?? {}) });
  yield { type: "usage", usage };
  yield { type: "finish", finishReason: finishFromAnthropic(stopReason), usage };
}
