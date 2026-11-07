import { describe, expect, it } from "vitest";
import type { Message } from "../../content/types.js";
import { userMessage } from "../../content/parts.js";
import { ContextBuilder } from "../../context/builder.js";
import { ToolRegistry } from "../../tools/registry.js";
import { runAgent } from "../../runtime/run.js";
import type { RunEvent } from "../../runtime/events.js";
import type { Transport, TransportRequest } from "../../transport/types.js";
import type { NormalizedRequest } from "../types.js";
import { createAnthropicProvider } from "./adapter.js";
import { buildAnthropicRequest, toAnthropicMessages } from "./map-in.js";
import { finishFromAnthropic, partsFromAnthropic } from "./map-out.js";
import { streamAnthropic } from "./stream.js";
import type { AnthropicResponse } from "./wire.js";

const msg = (role: Message["role"], parts: Message["parts"], id = `${role}-1`): Message => ({ id, role, parts });

const baseReq = (over: Partial<NormalizedRequest> = {}): NormalizedRequest => ({
  model: "claude-opus-5",
  messages: [msg("user", [{ type: "text", text: "hi" }])],
  ...over,
});

function mockTransport(responses: unknown[]): Transport & { sent: TransportRequest[] } {
  const sent: TransportRequest[] = [];
  let i = 0;
  return {
    kind: "custom",
    credentialSafe: true,
    sent,
    async fetch(req: TransportRequest): Promise<Response> {
      sent.push(req);
      const body = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

const respondText = (text: string, id = "msg_1"): AnthropicResponse => ({
  id,
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 20 },
});

const respondToolUse = (name: string, input: unknown, callId = "toolu_1", id = "msg_1"): AnthropicResponse => ({
  id,
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [{ type: "tool_use", id: callId, name, input }],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 30 },
});

describe("toAnthropicMessages", () => {
  it("maps tool calls to assistant tool_use and results to USER tool_result blocks", () => {
    const out = toAnthropicMessages([
      msg("assistant", [{ type: "tool-call", callId: "t1", name: "getPrice", input: { s: "SUI" }, status: "done" }]),
      msg("tool", [{ type: "tool-result", callId: "t1", name: "getPrice", output: { price: 3 } }], "tool-1"),
    ]);
    expect(out).toEqual([
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "getPrice", input: { s: "SUI" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"price":3}' }] },
    ]);
  });

  it("drops a tool_use whose result never arrived (thread-poison guard)", () => {
    const out = toAnthropicMessages([
      msg("assistant", [
        { type: "text", text: "checking" },
        { type: "tool-call", callId: "orphan", name: "x", input: {}, status: "pending" },
      ]),
    ]);
    expect(out).toEqual([{ role: "assistant", content: [{ type: "text", text: "checking" }] }]);
  });

  it("replays thinking only with its signature, and round-trips redacted blocks", () => {
    const out = toAnthropicMessages([
      msg("assistant", [
        { type: "reasoning", text: "hm", signature: "sig_abc" },
        { type: "reasoning", text: "unsigned — display only" },
        { type: "reasoning", text: "", signature: "opaque_data", redacted: true },
        { type: "text", text: "answer" },
      ]),
    ]);
    expect(out[0]!.content).toEqual([
      { type: "thinking", thinking: "hm", signature: "sig_abc" },
      { type: "redacted_thinking", data: "opaque_data" },
      { type: "text", text: "answer" },
    ]);
  });

  it("merges consecutive same-role messages (strict alternation safety)", () => {
    const out = toAnthropicMessages([
      msg("user", [{ type: "text", text: "one" }], "u1"),
      msg("user", [{ type: "text", text: "two" }], "u2"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.content).toHaveLength(2);
  });

  it("degrades a foreign providerFile to text instead of erroring the thread", () => {
    const out = toAnthropicMessages([
      msg("user", [
        { type: "file", source: { kind: "providerFile", id: "file_x", provider: "openai" }, mediaType: "application/pdf" },
      ]),
    ]);
    expect(out[0]!.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('"openai"') });
  });
});

describe("buildAnthropicRequest", () => {
  it("hoists system, requires max_tokens, and shapes tools natively", () => {
    const out = buildAnthropicRequest(
      baseReq({
        system: "Be terse.",
        tools: [{ name: "getPrice", description: "d", parameters: { type: "object" }, strict: true }],
      }),
    );
    expect(out.system).toBe("Be terse.");
    expect(out.max_tokens).toBe(4096); // required by the wire; defaulted
    expect(out.tools?.[0]).toEqual({ name: "getPrice", description: "d", input_schema: { type: "object" }, strict: true });
    expect(out.tool_choice).toEqual({ type: "auto" });
  });

  it("maps reasoning to adaptive thinking + effort — never budget_tokens", () => {
    const out = buildAnthropicRequest(baseReq({ reasoning: { effort: "high", summary: "auto" } }));
    expect(out.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(out.output_config).toEqual({ effort: "high" });
    expect(JSON.stringify(out)).not.toContain("budget_tokens");
  });

  it('maps toolChoice "required" to "any" and disables parallel when asked', () => {
    const out = buildAnthropicRequest(
      baseReq({ tools: [{ name: "a", description: "", parameters: { type: "object" } }], toolChoice: { type: "required" } }),
      { parallelToolCalls: false },
    );
    expect(out.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true });
  });

  it("merges providerOptions last, keyed by the provider id", () => {
    const out = buildAnthropicRequest(
      baseReq({ providerOptions: { anthropic: { metadata: { user_id: "u1" } } } }),
    );
    expect(out.metadata).toEqual({ user_id: "u1" });
  });
});

describe("map-out", () => {
  it("maps content blocks to parts, keeping the thinking signature", () => {
    const parts = partsFromAnthropic({
      ...respondText("done"),
      content: [
        { type: "thinking", thinking: "let me see", signature: "sig_1" },
        { type: "text", text: "done" },
        { type: "tool_use", id: "t1", name: "lookup", input: { q: 1 } },
      ],
    });
    expect(parts).toEqual([
      { type: "reasoning", text: "let me see", signature: "sig_1" },
      { type: "text", text: "done" },
      { type: "tool-call", callId: "t1", name: "lookup", input: { q: 1 }, status: "pending" },
    ]);
  });

  it("maps stop reasons onto the normalized union", () => {
    expect(finishFromAnthropic("end_turn")).toBe("stop");
    expect(finishFromAnthropic("max_tokens")).toBe("length");
    expect(finishFromAnthropic("tool_use")).toBe("tool-calls");
    expect(finishFromAnthropic("refusal")).toBe("content-filter");
  });
});

describe("streamAnthropic", () => {
  const sse = (events: object[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const e of events) {
          controller.enqueue(encoder.encode(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`));
        }
        controller.close();
      },
    });
  };

  it("translates the full dialect: text, thinking + late signature, tool args, usage", async () => {
    const events = sse([
      { type: "message_start", message: { ...respondText(""), content: [], usage: { input_tokens: 80 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm " } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_9" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_stop", index: 1 },
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"q":' } },
      { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "42}" } },
      { type: "content_block_stop", index: 2 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 25 } },
      { type: "message_stop" },
    ]);

    const out: unknown[] = [];
    for await (const e of streamAnthropic(events)) out.push(e);

    expect(out).toContainEqual({ type: "reasoning-delta", delta: "hmm " });
    // The replay token arrives at the END of the thinking block.
    expect(out).toContainEqual({ type: "reasoning-delta", delta: "", signature: "sig_9" });
    expect(out).toContainEqual({ type: "text-delta", delta: "Hello" });
    expect(out).toContainEqual({ type: "tool-call-end", callId: "toolu_1", name: "lookup", input: { q: 42 }, repaired: false });
    // Input tokens from message_start merge with output tokens from message_delta.
    const finish = out.find((e) => (e as { type: string }).type === "finish") as { finishReason: string; usage: { totalTokens: number } };
    expect(finish.finishReason).toBe("tool-calls");
    expect(finish.usage.totalTokens).toBe(105);
  });
});

describe("createAnthropicProvider", () => {
  it("POSTs /messages with the anthropic-version header", async () => {
    const transport = mockTransport([respondText("hello")]);
    const provider = createAnthropicProvider({ transport });
    const result = await provider.generate(baseReq());

    expect(transport.sent[0]).toMatchObject({ provider: "anthropic", path: "/messages", method: "POST" });
    expect(transport.sent[0]!.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(result.parts).toEqual([{ type: "text", text: "hello" }]);
    expect(result.usage.totalTokens).toBe(120);
  });

  it("adds the Files beta header only when the request references its own file ids", async () => {
    const transport = mockTransport([respondText("ok")]);
    const provider = createAnthropicProvider({ transport });
    await provider.generate(
      baseReq({
        messages: [
          msg("user", [
            { type: "text", text: "read this" },
            { type: "file", source: { kind: "providerFile", id: "file_1", provider: "anthropic" }, mediaType: "application/pdf" },
          ]),
        ],
      }),
    );
    expect(transport.sent[0]!.headers?.["anthropic-beta"]).toBe("files-api-2025-04-14");

    await provider.generate(baseReq());
    expect(transport.sent[1]!.headers?.["anthropic-beta"]).toBeUndefined();
  });

  it("drives the full agent tool loop end-to-end", async () => {
    const transport = mockTransport([respondToolUse("echo", { value: "ping" }), respondText("It said ping.")]);
    const provider = createAnthropicProvider({ transport });
    const registry = new ToolRegistry().register(
      {
        name: "echo",
        description: "Echo.",
        inputSchema: { type: "object" },
        execute: (input) => ({ output: { echoed: (input as { value?: string })?.value ?? null } }),
      },
      ["observer"],
    );

    const events: RunEvent[] = [];
    for await (const e of runAgent([userMessage("echo ping")], {
      provider,
      model: "claude-opus-5",
      contextBuilder: new ContextBuilder({ identity: "Test.", contextWindow: 32_000 }),
      tools: registry,
      toolResolution: { presets: ["observer"] },
      mode: "sync",
    })) {
      events.push(e);
    }

    const result = events.find((e) => e.type === "tool-result") as Extract<RunEvent, { type: "tool-result" }>;
    expect(result.output).toEqual({ echoed: "ping" });

    // The second request carries the tool_use AND its tool_result in a user turn.
    const second = transport.sent[1]!.body as { messages: { role: string; content: { type: string }[] }[] };
    const flat = second.messages.flatMap((m) => m.content.map((c) => ({ role: m.role, type: c.type })));
    expect(flat).toContainEqual({ role: "assistant", type: "tool_use" });
    expect(flat).toContainEqual({ role: "user", type: "tool_result" });
    expect(events.at(-1)).toMatchObject({ type: "run-finish", finishReason: "stop" });
  });
});
