// Streaming tool arguments are LIVE-ONLY state: visible on the store while the
// run is in flight, never written into the thread.

import { describe, expect, it } from "vitest";
import {
  BUILTIN_CARDS,
  CardRegistry,
  ContextBuilder,
  ToolRegistry,
  createOpenAIProvider,
  createVisualizeTool,
  type Provider,
  type StreamEvent,
  type Transport,
} from "@zzyzxlabs/super-chat-core";
import { AgentClient } from "./client.js";

const ARGS = {
  kind: "table",
  spec: {
    kind: "table",
    columns: [{ key: "name", label: "Name" }],
    rows: [{ name: "Halcyon" }, { name: "Brightline" }, { name: "Tessellate" }],
  },
};

const unused: Transport = {
  kind: "custom",
  credentialSafe: true,
  fetch: () => Promise.reject(new Error("the scripted provider never calls the network")),
};

/** A provider that streams canned events, one script per step. */
function scripted(steps: (StreamEvent | Error)[][]): Provider {
  const base = createOpenAIProvider({ transport: unused });
  let step = 0;
  return {
    ...base,
    async *stream() {
      const events = steps[Math.min(step, steps.length - 1)]!;
      step += 1;
      for (const e of events) {
        await Promise.resolve();
        if (e instanceof Error) throw e;
        yield e;
      }
    },
  };
}

function toolStep(args: unknown, opts: { cutAfter?: number } = {}): (StreamEvent | Error)[] {
  const json = JSON.stringify(args);
  const pieces = json.match(/.{1,6}/g) ?? [];
  const deltas: StreamEvent[] = pieces.map((argsDelta) => ({ type: "tool-call-delta", callId: "call_1", argsDelta }));
  const head: StreamEvent[] = [{ type: "start", modelId: "m" }, { type: "tool-call-start", callId: "call_1", name: "visualize" }];
  if (opts.cutAfter != null) return [...head, ...deltas.slice(0, opts.cutAfter), new Error("connection reset")];
  return [
    ...head,
    ...deltas,
    { type: "tool-call-end", callId: "call_1", name: "visualize", input: args },
    { type: "finish", finishReason: "tool-calls", usage: {} },
  ];
}
const textStep = (text: string): StreamEvent[] => [
  { type: "start", modelId: "m" },
  { type: "text-delta", delta: text },
  { type: "finish", finishReason: "stop", usage: {} },
];

function makeClient(provider: Provider) {
  const tools = new ToolRegistry().register(createVisualizeTool({ cards: new CardRegistry(BUILTIN_CARDS) }), ["observer"]);
  return new AgentClient({
    provider,
    model: "m",
    contextBuilder: new ContextBuilder({ identity: "Test.", contextWindow: 32_000 }),
    tools,
    toolResolution: { presets: ["observer"] },
    mode: "stream",
  });
}

describe("AgentClient — partial tool input", () => {
  it("exposes a growing card preview while arguments stream, and commits only the validated card", async () => {
    const client = makeClient(scripted([toolStep(ARGS), textStep("Done.")]));
    const rowCounts: number[] = [];
    client.store.subscribe(() => {
      const preview = client.store.get().run.partialTools?.["call_1"]?.partialCard as { rows?: unknown[] } | undefined;
      if (preview?.rows) rowCounts.push(preview.rows.length);
    });

    await client.send("show me");

    expect(Math.max(...rowCounts)).toBe(3);
    expect(rowCounts).toContain(1); // it was visible before the arguments were complete

    const state = client.store.get();
    expect(state.run.partialTools).toEqual({});
    const committed = JSON.stringify(state.tree);
    expect(committed).not.toContain("partialInput");
    expect(committed).not.toContain("partialCard");
    const assistant = state.messages.at(-1)!;
    const card = assistant.parts.find((p) => p.type === "artifact" && p.kind === "card:table") as { data?: unknown } | undefined;
    expect(card?.data).toEqual(ARGS.spec);
  });

  it("leaves no half-drawn preview behind when the stream dies mid-arguments", async () => {
    const client = makeClient(scripted([toolStep(ARGS, { cutAfter: 20 })]));
    let sawPreview = false;
    client.store.subscribe(() => {
      if (client.store.get().run.partialTools?.["call_1"]?.partialCard) sawPreview = true;
    });

    await client.send("show me");

    expect(sawPreview).toBe(true);
    const state = client.store.get();
    expect(state.status).toBe("error");
    expect(state.run.partialTools).toEqual({});
    expect(JSON.stringify(state.tree)).not.toContain("partialCard");
  });
});
