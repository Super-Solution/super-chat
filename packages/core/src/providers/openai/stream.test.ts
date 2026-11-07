import { describe, expect, it } from "vitest";
import { streamChat } from "./stream.js";
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
