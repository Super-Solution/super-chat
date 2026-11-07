import { describe, expect, it } from "vitest";
import type { Message } from "../../content/types.js";
import type { NormalizedRequest } from "../types.js";
import { buildChatRequest, buildResponsesRequest, toChatMessages, toResponsesInput } from "./map-in.js";

const msg = (role: Message["role"], parts: Message["parts"]): Message => ({ id: `${role}-1`, role, parts });

const baseReq = (over: Partial<NormalizedRequest> = {}): NormalizedRequest => ({
  model: "gpt-5.2",
  messages: [msg("user", [{ type: "text", text: "hi" }])],
  ...over,
});

describe("toResponsesInput", () => {
  it("uses input_text for user turns and output_text for assistant turns", () => {
    const items = toResponsesInput([
      msg("user", [{ type: "text", text: "hello" }]),
      msg("assistant", [{ type: "text", text: "hi back" }]),
    ]);
    expect(items[0]).toEqual({ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] });
    expect(items[1]).toEqual({ type: "message", role: "assistant", content: [{ type: "output_text", text: "hi back" }] });
  });

  it("emits function_call / function_call_output as top-level items", () => {
    const items = toResponsesInput([
      msg("assistant", [{ type: "tool-call", callId: "c1", name: "getPrice", input: { s: "SUI" }, status: "done" }]),
      msg("tool", [{ type: "tool-result", callId: "c1", name: "getPrice", output: { price: 3 } }]),
    ]);
    expect(items).toEqual([
      { type: "function_call", call_id: "c1", name: "getPrice", arguments: '{"s":"SUI"}' },
      { type: "function_call_output", call_id: "c1", output: '{"price":3}' },
    ]);
  });

  it("drops a tool call whose result never arrived", () => {
    // A cancelled turn leaves a dangling call; replaying it 400s the whole thread.
    const items = toResponsesInput([
      msg("assistant", [
        { type: "text", text: "checking" },
        { type: "tool-call", callId: "orphan", name: "getPrice", input: {}, status: "pending" },
      ]),
    ]);
    expect(items.some((i) => i.type === "function_call")).toBe(false);
    expect(items).toHaveLength(1);
  });

  it("encodes a base64 image as a data URL", () => {
    const items = toResponsesInput([
      msg("user", [{ type: "image", source: { kind: "base64", data: "AAAA" }, mediaType: "image/png" }]),
    ]);
    expect(items[0]).toMatchObject({
      content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }],
    });
  });

  it("degrades a file id minted by another provider to text instead of poisoning the thread", () => {
    // A throw here would 400 EVERY subsequent turn, because the ref lives in
    // persisted history. Degrading keeps the thread alive and tells the model.
    const items = toResponsesInput([
      msg("user", [{ type: "file", source: { kind: "providerFile", id: "f1", provider: "anthropic" }, mediaType: "application/pdf" }]),
    ]);
    expect(items[0]).toMatchObject({
      content: [{ type: "input_text", text: expect.stringContaining('"anthropic"') }],
    });
  });

  it("checks file ownership against the configured provider id", () => {
    const own = (provider: string) =>
      msg("user", [{ type: "file", source: { kind: "providerFile", id: "f1", provider }, mediaType: "application/pdf" }]);
    // A groq-id'd adapter accepts its own file ids…
    expect(toResponsesInput([own("groq")], "groq")[0]).toMatchObject({
      content: [{ type: "input_file", file_id: "f1" }],
    });
    // …and degrades openai-minted ones to text, exactly as openai degrades groq's.
    expect(toResponsesInput([own("openai")], "groq")[0]).toMatchObject({
      content: [{ type: "input_text", text: expect.stringContaining('"openai"') }],
    });
    expect(toChatMessages([own("groq")], undefined, "openai")[0]).toMatchObject({
      content: expect.stringContaining('"groq"'),
    });
  });

  it("replays reasoning only when it carries a provider item id", () => {
    const withId = toResponsesInput([msg("assistant", [{ type: "reasoning", text: "hm", signature: "rs_1" }])]);
    expect(withId[0]).toMatchObject({ type: "reasoning", id: "rs_1" });
    const withoutId = toResponsesInput([msg("assistant", [{ type: "reasoning", text: "hm" }])]);
    expect(withoutId).toHaveLength(0);
  });
});

describe("buildResponsesRequest", () => {
  it("hoists system content into instructions", () => {
    const out = buildResponsesRequest(baseReq({ system: "Be terse." }));
    expect(out.instructions).toBe("Be terse.");
    expect(out.input.every((i) => i.type !== "message" || i.role !== "system")).toBe(true);
  });

  it("declares tools in the FLAT Responses shape", () => {
    const out = buildResponsesRequest(
      baseReq({ tools: [{ name: "getPrice", description: "d", parameters: { type: "object" } }] }),
    );
    // Flat: name at the top level, NOT nested under `function`.
    expect(out.tools?.[0]).toEqual({ type: "function", name: "getPrice", description: "d", parameters: { type: "object" } });
  });

  it("forces store:true for background runs so the job can be polled", () => {
    const out = buildResponsesRequest(baseReq({ background: true, store: false }));
    expect(out.background).toBe(true);
    expect(out.store).toBe(true);
  });

  it("sends only the new tail when chaining on previous_response_id", () => {
    const out = buildResponsesRequest(
      baseReq({
        previousResponseId: "resp_1",
        messages: [
          msg("user", [{ type: "text", text: "old" }]),
          msg("assistant", [{ type: "text", text: "answered" }]),
          msg("user", [{ type: "text", text: "new" }]),
        ],
      }),
    );
    expect(out.previous_response_id).toBe("resp_1");
    expect(out.input).toHaveLength(1);
    expect(out.input[0]).toMatchObject({ content: [{ type: "input_text", text: "new" }] });
  });

  it("narrows a single active tool via tool_choice, keeping all declarations", () => {
    const out = buildResponsesRequest(
      baseReq({
        tools: [
          { name: "a", description: "", parameters: { type: "object" } },
          { name: "b", description: "", parameters: { type: "object" } },
        ],
        activeTools: ["a"],
      }),
    );
    // Declarations stay stable so the cached prompt prefix survives.
    expect(out.tools).toHaveLength(2);
    expect(out.tool_choice).toEqual({ type: "function", name: "a" });
  });
});

describe("toChatMessages", () => {
  it("puts tool results in role:tool messages keyed by tool_call_id", () => {
    const out = toChatMessages([
      msg("assistant", [{ type: "tool-call", callId: "c1", name: "getPrice", input: {}, status: "done" }]),
      msg("tool", [{ type: "tool-result", callId: "c1", name: "getPrice", output: { p: 1 } }]),
    ]);
    expect(out[0]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", function: { name: "getPrice" } }] });
    expect(out[1]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"p":1}' });
  });

  it("drops an unanswered assistant tool_call", () => {
    const out = toChatMessages([
      msg("assistant", [
        { type: "text", text: "working" },
        { type: "tool-call", callId: "orphan", name: "x", input: {}, status: "pending" },
      ]),
    ]);
    expect(out[0]).toMatchObject({ role: "assistant", content: "working" });
    expect((out[0] as { tool_calls?: unknown }).tool_calls).toBeUndefined();
  });

  it("collapses a lone text part to a bare string", () => {
    const out = toChatMessages([msg("user", [{ type: "text", text: "just text" }])]);
    expect(out[0]).toEqual({ role: "user", content: "just text" });
  });

  it("uses image_url for images, not input_image", () => {
    const out = toChatMessages([msg("user", [{ type: "image", source: { kind: "url", url: "https://x/i.png" } }])]);
    expect(out[0]).toMatchObject({ content: [{ type: "image_url", image_url: { url: "https://x/i.png" } }] });
  });
});

describe("buildChatRequest", () => {
  it("declares tools in the NESTED Chat Completions shape", () => {
    const out = buildChatRequest(
      baseReq({ tools: [{ name: "getPrice", description: "d", parameters: { type: "object" } }] }),
    );
    expect(out.tools?.[0]).toEqual({
      type: "function",
      function: { name: "getPrice", description: "d", parameters: { type: "object" } },
    });
  });

  it("uses max_completion_tokens, not max_tokens", () => {
    const out = buildChatRequest(baseReq({ maxOutputTokens: 512 }));
    expect(out.max_completion_tokens).toBe(512);
    expect((out as Record<string, unknown>)["max_tokens"]).toBeUndefined();
  });

  it("requests usage on streamed calls", () => {
    // Without stream_options every streamed turn meters as zero tokens.
    const out = buildChatRequest(baseReq(), { stream: true });
    expect(out.stream_options).toEqual({ include_usage: true });
  });

  it("really removes inactive tools, since Chat has no activeTools concept", () => {
    const out = buildChatRequest(
      baseReq({
        tools: [
          { name: "a", description: "", parameters: { type: "object" } },
          { name: "b", description: "", parameters: { type: "object" } },
        ],
        activeTools: ["a"],
      }),
    );
    expect(out.tools).toHaveLength(1);
  });
});
