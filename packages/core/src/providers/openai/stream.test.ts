import { describe, expect, it } from "vitest";
import { streamChat, streamResponses } from "./stream.js";
import { partsFromChat } from "./map-out.js";
import type { ChatResponse } from "./wire.js";
import type { StreamEvent } from "../types.js";

/**
 * Chat Completions streaming.
 *
 * This dialect is the integration path for every OpenAI-COMPATIBLE server —
 * LM Studio, Ollama, vLLM, Together, Groq — because they implement
 * /chat/completions and nothing else. Real OpenAI runs the Responses dialect,
 * so nothing here is exercised by pointing the kit at openai.com: this is the
 * least-covered and most-used path in the adapter, which is exactly how a
 * doubled tool name shipped.
 */

const sse = (chunks: object[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
};

const chunk = (delta: unknown, finish: string | null = null) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "test-model",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

async function collect(body: ReadableStream<Uint8Array>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of streamChat(body)) out.push(e);
  return out;
}

const calls = (events: StreamEvent[]) =>
  events.filter((e): e is Extract<StreamEvent, { type: "tool-call-end" }> => e.type === "tool-call-end");

describe("streamChat tool calls", () => {
  // The regression. Every OpenAI-compatible server observed sends the function
  // name complete on the first fragment; the accumulator both seeded and
  // appended it, so `visualize` arrived as `visualizevisualize` and the
  // registry answered "not-found" for a tool that was plainly registered.
  it("does not double a name that arrives whole on the first fragment", async () => {
    const events = await collect(
      sse([
        chunk({ role: "assistant" }),
        chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "visualize", arguments: "" } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"kind":"table"}' } }] }),
        chunk({}, "tool_calls"),
      ]),
    );

    const ended = calls(events);
    expect(ended).toHaveLength(1);
    expect(ended[0]!.name).toBe("visualize");
    expect(ended[0]!.callId).toBe("call_1");
    expect(ended[0]!.input).toEqual({ kind: "table" });

    // The announcement carries the same name — a UI that renders the start
    // event must not show a different tool than the one that ran.
    const started = events.find((e) => e.type === "tool-call-start");
    expect(started).toMatchObject({ name: "visualize" });
  });

  // The protocol permits splitting the name, which is why it accumulates at
  // all. Fixing the double must not break the case the += was there for.
  it("still concatenates a name split across fragments", async () => {
    const events = await collect(
      sse([
        chunk({ tool_calls: [{ index: 0, id: "call_2", function: { name: "visu" } }] }),
        chunk({ tool_calls: [{ index: 0, function: { name: "alize" } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }),
        chunk({}, "tool_calls"),
      ]),
    );
    expect(calls(events)[0]!.name).toBe("visualize");
  });

  // Correlation is by `index`, so two calls interleaved across fragments must
  // not bleed into each other.
  it("keeps parallel calls separate", async () => {
    const events = await collect(
      sse([
        chunk({
          tool_calls: [
            { index: 0, id: "a", function: { name: "alpha", arguments: "" } },
            { index: 1, id: "b", function: { name: "beta", arguments: "" } },
          ],
        }),
        chunk({ tool_calls: [{ index: 1, function: { arguments: '{"n":2}' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"n":1}' } }] }),
        chunk({}, "tool_calls"),
      ]),
    );
    const ended = calls(events);
    expect(ended.map((c) => c.name).sort()).toEqual(["alpha", "beta"]);
    expect(ended.find((c) => c.name === "alpha")!.input).toEqual({ n: 1 });
    expect(ended.find((c) => c.name === "beta")!.input).toEqual({ n: 2 });
  });

  // An id that only shows up on a later fragment must still reach the call.
  it("adopts an id that arrives after the name", async () => {
    const events = await collect(
      sse([
        chunk({ tool_calls: [{ index: 0, function: { name: "late" } }] }),
        chunk({ tool_calls: [{ index: 0, id: "call_late", function: { arguments: "{}" } }] }),
        chunk({}, "tool_calls"),
      ]),
    );
    expect(calls(events)[0]!.callId).toBe("call_late");
  });
});

describe("streamChat reasoning", () => {
  // `reasoning_content` is non-standard but is what the compatible servers
  // emit for a thinking model. The pair with partsFromChat below is the point:
  // both modes must surface it, or the same model says different things
  // depending on a config flag.
  it("surfaces reasoning_content as reasoning deltas", async () => {
    const events = await collect(
      sse([
        chunk({ role: "assistant" }),
        chunk({ reasoning_content: "weighing " }),
        chunk({ reasoning_content: "the options" }),
        chunk({ content: "Use HS256." }),
        chunk({}, "stop"),
      ]),
    );
    const reasoning = events
      .filter((e): e is Extract<StreamEvent, { type: "reasoning-delta" }> => e.type === "reasoning-delta")
      .map((e) => e.delta)
      .join("");
    expect(reasoning).toBe("weighing the options");
  });
});

describe("Chat dialect: sync and stream agree", () => {
  // The asymmetry this closes: reasoning_content was declared on the stream
  // chunk and handled, but absent from the non-streamed response type and
  // never read — so `mode: "sync"` dropped a thinking model's reasoning on the
  // floor while `mode: "stream"` kept it.
  it("keeps reasoning_content in the non-streamed response too", () => {
    const res = {
      id: "chatcmpl-1",
      object: "chat.completion",
      model: "test-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant" as const,
            reasoning_content: "weighing the options",
            content: "Use HS256.",
          },
          finish_reason: "stop",
        },
      ],
    } satisfies ChatResponse;

    const parts = partsFromChat(res);
    expect(parts).toEqual([
      { type: "reasoning", text: "weighing the options" },
      { type: "text", text: "Use HS256." },
    ]);
  });

  it("emits nothing extra when the server sends no reasoning", () => {
    const res = {
      id: "chatcmpl-2",
      object: "chat.completion",
      model: "test-model",
      choices: [
        { index: 0, message: { role: "assistant" as const, content: "Plain answer." }, finish_reason: "stop" },
      ],
    } satisfies ChatResponse;

    expect(partsFromChat(res)).toEqual([{ type: "text", text: "Plain answer." }]);
  });
});

/** A body that closes WITHOUT the `[DONE]` sentinel, the way a cut connection does. */
const cut = (chunks: object[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
      controller.close();
    },
  });
};

const toolFragment = (args: string, extra: Record<string, unknown> = {}) =>
  chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "rm", arguments: args }, ...extra }] });

describe("streamChat truncation", () => {
  it("reports a body that ends with no finish_reason and no [DONE] as an error, and runs nothing", async () => {
    const events = await collect(cut([toolFragment('{"path":"/data/arch')]));
    expect(calls(events)).toHaveLength(0);
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { kind: "network", retryable: true } });
    expect(events.some((e) => e.type === "finish")).toBe(false);
  });

  it("still accepts a server that sends [DONE] but forgot the finish_reason", async () => {
    const events = await collect(sse([chunk({ content: "hi" })]));
    expect(events.at(-1)).toMatchObject({ type: "finish", finishReason: "stop" });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("drops a call whose arguments needed repair when the model hit its output cap", async () => {
    const events = await collect(sse([toolFragment('{"path":"/data/arch'), chunk({}, "length")]));
    expect(calls(events)).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "finish", finishReason: "length" });
  });

  it("keeps a call whose arguments are complete even when the finish reason is length", async () => {
    const events = await collect(sse([toolFragment('{"path":"/tmp/x"}'), chunk({}, "length")]));
    expect(calls(events)).toMatchObject([{ input: { path: "/tmp/x" }, repaired: false }]);
  });

  it("does not run a repaired call from a non-streamed response that hit the output cap", () => {
    const resp = (finish: string): ChatResponse =>
      ({
        id: "c",
        object: "chat.completion",
        created: 1,
        model: "m",
        choices: [
          {
            index: 0,
            finish_reason: finish,
            message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "rm", arguments: '{"path":"/data/arch' } }] },
          },
        ],
      }) as ChatResponse;
    expect(partsFromChat(resp("length"))).toEqual([]);
    expect(partsFromChat(resp("tool_calls"))).toHaveLength(1); // a normal finish keeps the old repair behaviour
  });
});

describe("streamResponses", () => {
  const frames = (events: object[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const e of events) controller.enqueue(encoder.encode(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`));
        controller.close();
      },
    });
  };
  const run = async (events: object[]) => {
    const out: StreamEvent[] = [];
    for await (const e of streamResponses(frames(events))) out.push(e);
    return out;
  };
  const created = { type: "response.created", response: { id: "resp_1", model: "m", status: "in_progress", output: [] } };
  const callAdded = { type: "response.output_item.added", item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "rm" } };
  const argDelta = { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"path":"/data/arch' };
  const terminal = (status: string, extra: object = {}) => ({
    type: `response.${status}`,
    response: { id: "resp_1", model: "m", status, output: [], ...extra },
  });

  it("surfaces response.failed as a typed error instead of a silent finish", async () => {
    const events = await run([created, terminal("failed", { error: { code: "rate_limit_exceeded", message: "Too fast" } })]);
    expect(events.find((e) => e.type === "error")).toMatchObject({ error: { kind: "rate-limit", message: "Too fast", retryable: true } });
    expect(events.some((e) => e.type === "finish")).toBe(false);
  });

  it("does not run a call whose arguments were still being written when the response was incomplete", async () => {
    const events = await run([created, callAdded, argDelta, terminal("incomplete", { incomplete_details: { reason: "max_output_tokens" } })]);
    expect(events.some((e) => e.type === "tool-call-end")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "finish", finishReason: "length" });
  });

  it("still closes a call that lost only its .done event on a completed response", async () => {
    const events = await run([created, callAdded, { ...argDelta, delta: '{"path":"/tmp/x"}' }, terminal("completed", { output: [{ type: "function_call" }] })]);
    expect(events.find((e) => e.type === "tool-call-end")).toMatchObject({ input: { path: "/tmp/x" } });
    expect(events.at(-1)).toMatchObject({ finishReason: "tool-calls" });
  });

  it("reports a body that ends before any terminal event as an error", async () => {
    const events = await run([created, callAdded, argDelta]);
    expect(events.some((e) => e.type === "tool-call-end")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", error: { kind: "network" } });
  });
});
