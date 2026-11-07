// SSE dialect → normalized StreamEvent. Two translators, because the two OpenAI
// streaming formats share nothing but the transport.
//
// Responses streams *semantic* events: `response.output_text.delta`,
// `response.function_call_arguments.delta`, each naming the item it belongs to.
// Chat Completions streams *positional* deltas: a `tool_calls` array whose
// entries are correlated by `index`, where the name arrives once on the first
// fragment and the arguments dribble in across the rest. The second format is
// the one that needs state, and getting that state wrong is why streamed
// parallel tool calls so often come out with merged arguments.

import { parseSSE, parseSSEJson } from "../../transport/sse.js";
import { repairToolArguments } from "../../tools/repair.js";
import type { StreamEvent } from "../types.js";
import { finishFromChat, finishFromResponses, usageFromChat, usageFromResponses } from "./map-out.js";
import type { ChatStreamChunk, ResponsesResponse, ResponsesStreamEvent } from "./wire.js";

/**
 * Translate a Responses SSE body. `onCursor` receives each event's
 * `sequence_number` so a caller can persist it and resume with `starting_after`
 * after a dropped connection.
 */
export async function* streamResponses(
  body: ReadableStream<Uint8Array>,
  opts: { onCursor?: (seq: number) => void } = {},
): AsyncGenerator<StreamEvent> {
  // call_id is only present on the item, not on the argument deltas, so we key
  // pending calls by item_id and resolve the call_id when the item completes.
  const callsByItemId = new Map<string, { callId: string; name: string; args: string }>();
  let started = false;

  for await (const { data } of parseSSEJson<ResponsesStreamEvent>(body)) {
    if (typeof data.sequence_number === "number") opts.onCursor?.(data.sequence_number);

    switch (data.type) {
      case "response.created":
      case "response.in_progress": {
        if (started) break;
        started = true;
        yield { type: "start", responseId: data.response?.id, modelId: data.response?.model ?? "" };
        break;
      }

      case "response.output_item.added": {
        const item = data.item;
        if (item?.type === "function_call") {
          const fc = item as { call_id: string; name: string; id?: string };
          const key = fc.id ?? fc.call_id;
          callsByItemId.set(key, { callId: fc.call_id, name: fc.name, args: "" });
          yield { type: "tool-call-start", callId: fc.call_id, name: fc.name };
        }
        break;
      }

      case "response.output_text.delta": {
        if (data.delta) yield { type: "text-delta", delta: data.delta };
        break;
      }

      case "response.reasoning_summary_text.delta": {
        if (data.delta) {
          yield { type: "reasoning-delta", delta: data.delta, ...(data.item_id ? { signature: data.item_id } : {}) };
        }
        break;
      }

      case "response.function_call_arguments.delta": {
        const key = data.item_id ?? "";
        const pending = callsByItemId.get(key);
        if (pending && data.delta) {
          pending.args += data.delta;
          yield { type: "tool-call-delta", callId: pending.callId, argsDelta: data.delta };
        }
        break;
      }

      case "response.function_call_arguments.done": {
        const key = data.item_id ?? "";
        const pending = callsByItemId.get(key);
        if (pending) {
          // Prefer the API's own complete `arguments` over our concatenation —
          // a dropped delta frame would otherwise yield truncated JSON.
          const raw = data.arguments ?? pending.args;
          const { value, repaired } = repairToolArguments(raw);
          yield { type: "tool-call-end", callId: pending.callId, name: pending.name, input: value, repaired };
          callsByItemId.delete(key);
        }
        break;
      }

      case "response.completed":
      case "response.incomplete":
      case "response.failed": {
        const r = data.response;
        if (!r) break;
        // Any call that never got a `.done` event (stream cut short) still needs
        // to be emitted, or the runtime waits forever for a result it will
        // never be asked to produce.
        for (const [key, pending] of callsByItemId) {
          const { value, repaired } = repairToolArguments(pending.args);
          yield { type: "tool-call-end", callId: pending.callId, name: pending.name, input: value, repaired };
          callsByItemId.delete(key);
        }
        const usage = usageFromResponses(r.usage);
        yield { type: "usage", usage };
        yield { type: "finish", finishReason: finishFromResponses(r as ResponsesResponse), responseId: r.id, usage };
        return;
      }

      case "error": {
        yield { type: "error", error: { message: data.message ?? "Stream error", code: data.code } };
        return;
      }

      default:
        break; // content_part.added/done, output_item.done, … carry nothing new for us
    }
  }
}

/** Translate a Chat Completions SSE body. */
export async function* streamChat(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  // Correlate by the delta's `index`, NOT by array position in the chunk: a
  // chunk may carry only the entry that changed, so position is meaningless.
  const pending = new Map<number, { callId: string; name: string; args: string; announced: boolean }>();
  let started = false;
  let finish: StreamEvent | null = null;
  let lastUsage: ReturnType<typeof usageFromChat> | null = null;

  for await (const { data } of parseSSEJson<ChatStreamChunk>(body)) {
    if (!started) {
      started = true;
      yield { type: "start", responseId: data.id, modelId: data.model };
    }

    if (data.usage) lastUsage = usageFromChat(data.usage);

    const choice = data.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta ?? {};
    if (delta.reasoning_content) yield { type: "reasoning-delta", delta: delta.reasoning_content };
    if (delta.content) yield { type: "text-delta", delta: delta.content };

    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? 0;
      let entry = pending.get(index);
      if (!entry) {
        // `name` starts EMPTY and is only ever accumulated below. Seeding it
        // from this same fragment would then append it a second time, so a
        // server that sends the whole name up front — which is what the
        // OpenAI-compatible ones do — produced "visualizevisualize" and a
        // not-found on every streamed tool call.
        entry = { callId: call.id ?? `call_${index}`, name: "", args: "", announced: false };
        pending.set(index, entry);
      }
      // id and name may each arrive on a later fragment than the first, and
      // the name may itself be split across fragments.
      if (call.id) entry.callId = call.id;
      if (call.function?.name) entry.name += call.function.name;
      if (!entry.announced && entry.name && entry.callId) {
        entry.announced = true;
        yield { type: "tool-call-start", callId: entry.callId, name: entry.name };
      }
      if (call.function?.arguments) {
        entry.args += call.function.arguments;
        if (entry.announced) yield { type: "tool-call-delta", callId: entry.callId, argsDelta: call.function.arguments };
      }
    }

    if (choice.finish_reason) {
      finish = { type: "finish", finishReason: finishFromChat(choice.finish_reason), responseId: data.id };
    }
  }

  // Tool calls complete at stream end here — Chat Completions has no per-call
  // "done" event, so we can only finalize once no more fragments can arrive.
  for (const entry of pending.values()) {
    const { value, repaired } = repairToolArguments(entry.args);
    if (!entry.announced) yield { type: "tool-call-start", callId: entry.callId, name: entry.name };
    yield { type: "tool-call-end", callId: entry.callId, name: entry.name, input: value, repaired };
  }

  if (lastUsage) yield { type: "usage", usage: lastUsage };
  yield finish
    ? { ...(finish as Extract<StreamEvent, { type: "finish" }>), ...(lastUsage ? { usage: lastUsage } : {}) }
    : { type: "finish", finishReason: pending.size ? "tool-calls" : "stop", ...(lastUsage ? { usage: lastUsage } : {}) };
}

/**
 * Read a Responses SSE body purely to recover the terminal response object.
 * Used when resuming a background job's stream: the caller wants the final
 * result, not the deltas it already missed.
 */
export async function finalResponseFromStream(
  body: ReadableStream<Uint8Array>,
): Promise<ResponsesResponse | null> {
  for await (const msg of parseSSE(body)) {
    if (!msg.data || msg.data === "[DONE]") continue;
    try {
      const evt = JSON.parse(msg.data) as ResponsesStreamEvent;
      if (
        (evt.type === "response.completed" || evt.type === "response.failed" || evt.type === "response.incomplete") &&
        evt.response
      ) {
        return evt.response;
      }
    } catch {
      continue;
    }
  }
  return null;
}
