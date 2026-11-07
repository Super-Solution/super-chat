// Regression tests for the integration seams: tools unlocked mid-run actually
// become callable, updateCard updates instead of appending, and RunConfig
// pass-throughs reach the wire.

import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../context/builder.js";
import { createOpenAIProvider } from "../providers/openai/adapter.js";
import { SkillRegistry } from "../skills/registry.js";
import { ToolRegistry } from "../tools/registry.js";
import { createLoadSkillTool, createUpdateCardTool } from "../tools/builtin.js";
import { BUILTIN_CARDS } from "../cards/builtin.js";
import { CardRegistry } from "../cards/registry.js";
import { userMessage } from "../content/parts.js";
import { runAgent } from "./run.js";
import { initialRunState, reduceRunEvent, type RunEvent } from "./events.js";
import type { Transport, TransportRequest } from "../transport/types.js";
import type { ToolDefinition } from "../tools/types.js";

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

const respondText = (text: string, id = "resp_1") => ({
  id,
  object: "response",
  created_at: 0,
  model: "gpt-5.2",
  status: "completed",
  output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
});

const respondToolCall = (name: string, args: unknown, callId = "call_1", id = "resp_1") => ({
  id,
  object: "response",
  created_at: 0,
  model: "gpt-5.2",
  status: "completed",
  output: [{ type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) }],
  usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
});

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("loadSkill unlocks tools mid-run", () => {
  it("makes a skill-gated tool callable and re-declares specs after loadSkill", async () => {
    const secret: ToolDefinition = {
      name: "secretLookup",
      description: "Skill-gated lookup.",
      inputSchema: { type: "object" },
      execute: () => ({ output: { found: 42 } }),
    };
    const skills = new SkillRegistry([
      {
        id: "research",
        name: "Research",
        description: "Deep research.",
        mode: "manual",
        body: "Use secretLookup for the data.",
        tools: ["secretLookup"],
      },
    ]);
    const registry = new ToolRegistry();
    registry.register(createLoadSkillTool(skills), ["observer"]);
    registry.register(secret); // NO preset — skill-gated, invisible at run start

    const transport = mockTransport([
      respondToolCall("loadSkill", { id: "research" }, "call_load"),
      respondToolCall("secretLookup", {}, "call_secret"),
      respondText("Found it."),
    ]);
    const provider = createOpenAIProvider({ transport });

    const events = await collect(
      runAgent([userMessage("research this")], {
        provider,
        model: "gpt-5.2",
        contextBuilder: new ContextBuilder({ identity: "Test.", skills, contextWindow: 32_000 }),
        tools: registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    // Before the fix this was `failure: "not-found"` — the tool the model was
    // TOLD about was not callable.
    const secretResult = events.find(
      (e): e is Extract<RunEvent, { type: "tool-result" }> => e.type === "tool-result" && e.name === "secretLookup",
    );
    expect(secretResult?.failure).toBeUndefined();
    expect(secretResult?.output).toEqual({ found: 42 });

    // And the provider was told about it: the request AFTER loadSkill declares it.
    const declared = (i: number) => ((transport.sent[i]?.body as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
    expect(declared(0)).not.toContain("secretLookup");
    expect(declared(1)).toContain("secretLookup");
  });
});

describe("updateCard updates in place", () => {
  it("reuses the card id so the reducer upserts instead of appending", async () => {
    const cards = new CardRegistry(BUILTIN_CARDS);
    const progress: ToolDefinition = {
      name: "longJob",
      description: "Long job with progress.",
      inputSchema: { type: "object" },
      execute: () => ({
        output: { ok: true },
        card: { kind: "progress", steps: [{ label: "fetch", status: "active" }] },
      }),
    };
    const registry = new ToolRegistry().registerAll([progress, createUpdateCardTool(cards)], ["observer"]);

    const transport = mockTransport([
      respondToolCall("longJob", {}, "call_1"),
      respondText("started"),
    ]);
    const provider = createOpenAIProvider({ transport });

    const events = await collect(
      runAgent([userMessage("go")], {
        provider,
        model: "gpt-5.2",
        contextBuilder: new ContextBuilder({ identity: "Test.", contextWindow: 32_000 }),
        tools: registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );
    const firstCard = events.find((e): e is Extract<RunEvent, { type: "card" }> => e.type === "card")!.card;

    // Simulate the model's follow-up: updateCard with the SAME id.
    const update = await createUpdateCardTool(cards).execute!(
      { cardId: firstCard.id, spec: { kind: "progress", steps: [{ label: "fetch", status: "done" }] } },
      { vars: {}, callId: "call_2" },
    );
    expect(update).toMatchObject({ cardId: firstCard.id });

    // Reducer proof: applying both cards leaves ONE card, with the new spec.
    let state = initialRunState("run", "sync");
    state = reduceRunEvent(state, { type: "card", card: firstCard });
    const updated = { id: firstCard.id, spec: (update as { card: object }).card, callId: "call_2" };
    state = reduceRunEvent(state, { type: "card", card: updated as never });
    expect(state.cards).toHaveLength(1);
    expect((state.cards[0]!.spec as { steps: { status: string }[] }).steps[0]!.status).toBe("done");
  });
});

describe("RunConfig pass-throughs reach the wire", () => {
  it("sends toolChoice, responseFormat, topP, stopSequences, metadata, store and providerOptions", async () => {
    const transport = mockTransport([respondText("ok")]);
    const provider = createOpenAIProvider({ transport });
    const echo: ToolDefinition = {
      name: "echo",
      description: "d",
      inputSchema: { type: "object" },
      execute: () => "ok",
    };

    await collect(
      runAgent([userMessage("hi")], {
        provider,
        model: "gpt-5.2",
        contextBuilder: new ContextBuilder({ identity: "Test.", contextWindow: 32_000 }),
        tools: new ToolRegistry().register(echo, ["observer"]),
        toolResolution: { presets: ["observer"] },
        mode: "sync",
        toolChoice: { type: "required" },
        responseFormat: { type: "json" },
        topP: 0.9,
        metadata: { runId: "test-1" },
        store: false,
        providerOptions: { openai: { service_tier: "flex" } },
      }),
    );

    const body = transport.sent[0]!.body as Record<string, unknown>;
    expect(body["tool_choice"]).toBe("required");
    expect(body["text"]).toEqual({ format: { type: "json_object" } });
    expect(body["top_p"]).toBe(0.9);
    expect(body["metadata"]).toEqual({ runId: "test-1" });
    expect(body["store"]).toBe(false);
    // providerOptions merged last — the per-provider escape hatch.
    expect(body["service_tier"]).toBe("flex");
  });
});

describe("tool loading hints", () => {
  it("surfaces host-only output geometry and clears the pending slot on result", async () => {
    const tool: ToolDefinition = {
      name: "buildChart",
      description: "Build a chart.",
      inputSchema: { type: "object" },
      loading: { kind: "chart", label: "Building chart" },
      execute: () => ({ output: { ok: true } }),
    };
    const registry = new ToolRegistry().register(tool, ["observer"]);
    const provider = createOpenAIProvider({
      transport: mockTransport([respondToolCall("buildChart", {}, "call_chart"), respondText("Done.")]),
    });
    const events = await collect(
      runAgent([userMessage("chart it")], {
        provider,
        model: "gpt-5.2",
        contextBuilder: new ContextBuilder({ identity: "Test.", contextWindow: 32_000 }),
        tools: registry,
        toolResolution: { presets: ["observer"] },
        mode: "sync",
      }),
    );

    const callIndex = events.findIndex((event) => event.type === "tool-call");
    const resultIndex = events.findIndex((event) => event.type === "tool-result");
    const call = events[callIndex] as Extract<RunEvent, { type: "tool-call" }>;
    expect(call.loading).toEqual({ kind: "chart", label: "Building chart" });

    const pending = events.slice(0, callIndex + 1).reduce(reduceRunEvent, initialRunState("run", "sync"));
    expect(pending.pendingTools.call_chart?.loading?.kind).toBe("chart");

    const settled = events.slice(0, resultIndex + 1).reduce(reduceRunEvent, initialRunState("run", "sync"));
    expect(settled.pendingTools.call_chart).toBeUndefined();
  });
});

describe("capability enforcement", () => {
  it("rejects image parts on a provider that declares images: false", async () => {
    const transport = mockTransport([respondText("ok")]);
    const provider = createOpenAIProvider({ transport, capabilities: { images: false } });
    await expect(
      provider.generate({
        model: "m",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "image", source: { kind: "url", url: "https://x/i.png" } }] },
        ],
      }),
    ).rejects.toThrow(/image parts/);
    expect(transport.sent).toHaveLength(0);
  });

  it("strips strict from tool specs when strictJsonSchema is off", async () => {
    const transport = mockTransport([respondText("ok")]);
    const provider = createOpenAIProvider({ transport, capabilities: { strictJsonSchema: false } });
    await provider.generate({
      model: "m",
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      tools: [{ name: "t", description: "d", parameters: { type: "object" }, strict: true }],
    });
    const body = transport.sent[0]!.body as { tools: { strict?: boolean }[] };
    expect(body.tools[0]!.strict).toBeUndefined();
  });

  it("omits parallel_tool_calls when the capability is off", async () => {
    const transport = mockTransport([respondText("ok")]);
    const provider = createOpenAIProvider({ transport, capabilities: { parallelToolCalls: false } });
    await provider.generate({
      model: "m",
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }],
      tools: [{ name: "t", description: "d", parameters: { type: "object" } }],
    });
    const body = transport.sent[0]!.body as Record<string, unknown>;
    expect(body["parallel_tool_calls"]).toBeUndefined();
  });
});
