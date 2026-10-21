// Streaming tool arguments reach the run as `tool-call-input-delta`, for every
// adapter: real adapter, real SSE decoding, real run loop — only the bytes on
// the wire are canned, split into fragments the way a model streams them.

import { describe, expect, it } from "vitest";
import { BUILTIN_CARDS } from "../cards/builtin.js";
import { CardRegistry } from "../cards/registry.js";
import { userMessage } from "../content/parts.js";
import { ContextBuilder } from "../context/builder.js";
import { createAnthropicProvider } from "../providers/anthropic/adapter.js";
import { createOpenAIProvider } from "../providers/openai/adapter.js";
import type { Provider } from "../providers/types.js";
import { createVisualizeTool } from "../tools/builtin.js";
import { ToolRegistry } from "../tools/registry.js";
import type { Transport, TransportRequest } from "../transport/types.js";
import { initialRunState, reduceRunEvent, type RunEvent } from "./events.js";
import { runAgent } from "./run.js";

type Delta = Extract<RunEvent, { type: "tool-call-input-delta" }>;

const TABLE_ARGS = {
  kind: "table",
  spec: {
    kind: "table",
    title: "Vendor shortlist",
    columns: [
      { key: "vendor", label: "Vendor" },
      { key: "cost", label: "Annual cost", format: "currency" },
    ],
    rows: [
      { vendor: "Halcyon", cost: 48200 },
      { vendor: "Brightline", cost: 52900 },
      { vendor: "Tessellate", cost: 39800 },
      { vendor: "Quarry 和 Vale", cost: 61500 },
      { vendor: "Lumen", cost: 33100 },
      { vendor: "Ostrander", cost: 45750 },
    ],
  },
};

const CONFIRM_ARGS = {
  kind: "confirm",
  spec: { kind: "confirm", title: "Delete three files?", summary: [{ label: "Files", value: "3" }] },
};

/** Fragments of the serialized arguments, by code point, `size` at a time. */
function fragments(args: unknown, size = 7): string[] {
  const chars = Array.from(JSON.stringify(args));
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out;
}

const sse = (frames: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
};
const named = (e: { type: string } & Record<string, unknown>) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const bare = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;

/** One canned SSE body per request, in order. */
function streamingTransport(bodies: string[][]): Transport & { sent: TransportRequest[] } {
  const sent: TransportRequest[] = [];
  return {
    kind: "custom",
    credentialSafe: true,
    sent,
    async fetch(req: TransportRequest): Promise<Response> {
      const frames = bodies[Math.min(sent.length, bodies.length - 1)]!;
      sent.push(req);
      return new Response(sse(frames), { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  };
}

// ── the three wire dialects ─────────────────────────────────────────────────

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };

const responsesTool = (args: unknown): string[] => {
  const call = { type: "function_call", id: "item_1", call_id: "call_1", name: "visualize", arguments: JSON.stringify(args) };
  return [
    named({ type: "response.created", response: { id: "resp_1", model: "gpt-test" } }),
    named({ type: "response.output_item.added", item: { ...call, arguments: "" } }),
    ...fragments(args).map((delta) => named({ type: "response.function_call_arguments.delta", item_id: "item_1", delta })),
    named({ type: "response.function_call_arguments.done", item_id: "item_1", arguments: call.arguments }),
    named({
      type: "response.completed",
      response: { id: "resp_1", model: "gpt-test", status: "completed", output: [call], usage },
    }),
  ];
};
const responsesText = (text: string): string[] => [
  named({ type: "response.created", response: { id: "resp_2", model: "gpt-test" } }),
  named({ type: "response.output_text.delta", delta: text }),
  named({
    type: "response.completed",
    response: {
      id: "resp_2",
      model: "gpt-test",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
      usage,
    },
  }),
];

const chunk = (delta: unknown, finish: string | null = null) =>
  bare({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "gpt-test", choices: [{ index: 0, delta, finish_reason: finish }] });
const chatTool = (args: unknown): string[] => [
  chunk({ role: "assistant" }),
  chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "visualize", arguments: "" } }] }),
  ...fragments(args).map((a) => chunk({ tool_calls: [{ index: 0, function: { arguments: a } }] })),
  chunk({}, "tool_calls"),
  "data: [DONE]\n\n",
];
const chatText = (text: string): string[] => [chunk({ role: "assistant", content: text }), chunk({}, "stop"), "data: [DONE]\n\n"];

const message = (id: string) => ({ id, type: "message", role: "assistant", model: "claude-test", content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } });
const anthropicTool = (args: unknown): string[] => [
  named({ type: "message_start", message: message("msg_1") }),
  named({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "visualize", input: {} } }),
  ...fragments(args).map((partial_json) => named({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json } })),
  named({ type: "content_block_stop", index: 0 }),
  named({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } }),
  named({ type: "message_stop" }),
];
const anthropicText = (text: string): string[] => [
  named({ type: "message_start", message: message("msg_2") }),
  named({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  named({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
  named({ type: "content_block_stop", index: 0 }),
  named({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }),
  named({ type: "message_stop" }),
];

const DIALECTS: {
  name: string;
  provider: (t: Transport) => Provider;
  tool: (args: unknown) => string[];
  text: (text: string) => string[];
}[] = [
  { name: "OpenAI Responses", provider: (transport) => createOpenAIProvider({ transport }), tool: responsesTool, text: responsesText },
  {
    name: "OpenAI Chat Completions",
    provider: (transport) => createOpenAIProvider({ transport, dialect: "chat" }),
    tool: chatTool,
    text: chatText,
  },
  { name: "Anthropic Messages", provider: (transport) => createAnthropicProvider({ transport }), tool: anthropicTool, text: anthropicText },
];

// ── harness ─────────────────────────────────────────────────────────────────

const cards = new CardRegistry(BUILTIN_CARDS);

async function run(provider: Provider, mode: "stream" | "sync" = "stream"): Promise<RunEvent[]> {
  const tools = new ToolRegistry().register(createVisualizeTool({ cards }), ["observer"]);
  const events: RunEvent[] = [];
  for await (const e of runAgent([userMessage("show me")], {
    provider,
    model: "test-model",
    contextBuilder: new ContextBuilder({ identity: "Test.", contextWindow: 32_000 }),
    tools,
    toolResolution: { presets: ["observer"] },
    mode,
    // Answer any interactive card at once, so the confirm case can finish.
    onUserDecision: async (callId, card) => ({ cardId: card.id, callId, kind: "confirm", type: "confirm", at: Date.now() }),
  })) {
    events.push(e);
  }
  return events;
}

const deltasOf = (events: RunEvent[]) => events.filter((e): e is Delta => e.type === "tool-call-input-delta");
const indexOf = (events: RunEvent[], type: RunEvent["type"]) => events.findIndex((e) => e.type === type);

describe.each(DIALECTS)("tool-call-input-delta — $name", ({ provider, tool, text }) => {
  it("forwards streaming arguments as a growing, valid table preview before the authoritative tool-call", async () => {
    const events = await run(provider(streamingTransport([tool(TABLE_ARGS), text("Done.")])));
    expect(events.find((e) => e.type === "error")).toBeUndefined();

    const deltas = deltasOf(events);
    expect(deltas.length).toBeGreaterThan(10);
    for (const d of deltas) {
      expect(d.callId).toBe("call_1");
      expect(d.name).toBe("visualize");
    }

    // Every delta precedes the authoritative call, which carries the whole input.
    const callAt = indexOf(events, "tool-call");
    expect(events.lastIndexOf(deltas.at(-1)!)).toBeLessThan(callAt);
    expect((events[callAt] as Extract<RunEvent, { type: "tool-call" }>).input).toEqual(TABLE_ARGS);

    // Row by row: the preview passes through every count from 0 to 6, never
    // shrinks, and every preview is a valid table.
    const rows = deltas.filter((d) => d.partialCard).map((d) => (d.partialCard as { rows: unknown[] }).rows.length);
    expect([...new Set(rows)]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i]!).toBeGreaterThanOrEqual(rows[i - 1]!);
    for (const d of deltas) if (d.partialCard) expect(cards.validate(d.partialCard)).toEqual({ ok: true });

    // CJK split across fragments arrives whole.
    const last = deltas.at(-1)!.partialInput as typeof TABLE_ARGS;
    expect(last.spec.rows.map((r) => r.vendor)).toContain("Quarry 和 Vale");

    // The loading hint follows the partial input too.
    expect(deltas.at(-1)!.loading).toMatchObject({ kind: "table" });

    // The real card is still the validated one from execute.
    const card = events.find((e): e is Extract<RunEvent, { type: "card" }> => e.type === "card");
    expect(card?.card.spec).toEqual({ ...TABLE_ARGS.spec });
  });

  it("never previews an interactive card, though its arguments still stream", async () => {
    const events = await run(provider(streamingTransport([tool(CONFIRM_ARGS), text("Done.")])));
    const deltas = deltasOf(events);
    expect(deltas.length).toBeGreaterThan(3);
    for (const d of deltas) expect(d.partialCard).toBeUndefined();
    // It reaches the user only as the validated card.
    const awaiting = events.find((e): e is Extract<RunEvent, { type: "awaiting-user" }> => e.type === "awaiting-user");
    expect(awaiting?.card.spec).toEqual(CONFIRM_ARGS.spec);
  });

  it("keeps previews out of the committed state", async () => {
    const events = await run(provider(streamingTransport([tool(TABLE_ARGS), text("Done.")])));
    let state = initialRunState("run", "stream");
    let sawPreview = false;
    for (const e of events) {
      state = reduceRunEvent(state, e);
      if (state.partialTools?.["call_1"]?.partialCard) sawPreview = true;
      if (e.type === "tool-result") expect(state.partialTools?.["call_1"]).toBeUndefined();
    }
    expect(sawPreview).toBe(true);
    expect(state.partialTools).toEqual({});
    expect(JSON.stringify(state.parts)).not.toContain("partial");
  });
});

describe("tool-call-input-delta — modes without a stream", () => {
  it("is never sent in sync mode", async () => {
    const call = { type: "function_call", call_id: "call_1", name: "visualize", arguments: JSON.stringify(TABLE_ARGS) };
    const transport: Transport = {
      kind: "custom",
      credentialSafe: true,
      async fetch(req: TransportRequest) {
        const first = !JSON.stringify(req.body).includes("function_call_output");
        const body = first
          ? { id: "r1", object: "response", model: "m", status: "completed", output: [call], usage }
          : { id: "r2", object: "response", model: "m", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }], usage };
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      },
    };
    const events = await run(createOpenAIProvider({ transport }), "sync");
    expect(deltasOf(events)).toEqual([]);
    expect(events.some((e) => e.type === "card")).toBe(true);
  });
});

describe("reduceRunEvent — partialTools lifecycle", () => {
  const delta = (callId: string, rows: number): Delta => ({
    type: "tool-call-input-delta",
    callId,
    name: "visualize",
    partialInput: {},
    partialCard: { kind: "table", columns: [{ key: "a", label: "A" }], rows: Array.from({ length: rows }, () => ({ a: 1 })) },
  });

  it("holds a preview past tool-call, drops it with the call's tool-result", () => {
    let s = initialRunState("r", "stream");
    s = reduceRunEvent(s, { type: "run-start", runId: "r", mode: "stream" });
    s = reduceRunEvent(s, delta("c1", 1));
    s = reduceRunEvent(s, delta("c1", 2));
    s = reduceRunEvent(s, delta("c2", 1));
    expect((s.partialTools?.["c1"]?.partialCard as { rows: unknown[] }).rows).toHaveLength(2);
    s = reduceRunEvent(s, { type: "tool-call", callId: "c1", name: "visualize", input: {} });
    expect(s.partialTools?.["c1"]).toBeDefined(); // no gap between preview and card
    s = reduceRunEvent(s, { type: "tool-result", callId: "c1", name: "visualize", output: {}, ms: 1 });
    expect(s.partialTools?.["c1"]).toBeUndefined();
    expect(s.partialTools?.["c2"]).toBeDefined();
  });

  it("clears every preview when the run finishes or fails", () => {
    const base = reduceRunEvent(initialRunState("r", "stream"), delta("c1", 1));
    expect(reduceRunEvent(base, { type: "run-finish", runId: "r", finishReason: "stop", usage: {}, steps: 1 }).partialTools).toEqual({});
    expect(reduceRunEvent(base, { type: "error", error: new Error("x"), recoverable: false }).partialTools).toEqual({});
    expect(reduceRunEvent(base, { type: "error", error: new Error("x"), recoverable: true }).partialTools?.["c1"]).toBeDefined();
  });
});
