// Surfaces through the real client: real adapter, real run loop, scripted network.

import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_CARDS,
  CardRegistry,
  ContextBuilder,
  SurfaceCatalogue,
  ToolRegistry,
  createMemoryThreadStore,
  createOpenAIProvider,
  createSurfaceTools,
  layoutTurn,
  surfaceCardId,
  type Card,
  type MeteringRecord,
  type ToolDefinition,
  type Transport,
} from "@supersolutions/super-chat-core";
import { AgentClient } from "./client.js";

const response = (output: unknown[]) => ({
  id: "resp",
  object: "response",
  created_at: 0,
  model: "m",
  status: "completed",
  output,
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
});
const say = (text: string) => response([{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }]);
const call = (name: string, args: unknown, id = `call_${name}`, lead?: string) =>
  response([
    ...(lead ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: lead }] }] : []),
    { type: "function_call", call_id: id, name, arguments: JSON.stringify(args) },
  ]);

const SURFACE = {
  surfaceId: "s1",
  title: "Explorer",
  root: "main",
  data: { team: "all" },
  components: [
    { id: "main", component: "Stack", children: ["team", "ask", "run", "reset"] },
    { id: "team", component: "Select", label: "Team", value: { $path: "/team" }, options: [{ value: "all", label: "All" }, { value: "a", label: "A" }] },
    { id: "ask", component: "Button", label: "Ask", action: { type: "event", name: "review", context: { team: { $path: "/team" } } } },
    { id: "run", component: "Button", label: "Run", action: { type: "tool", tool: "lookup", args: { team: { $path: "/team" } }, resultPath: "/result" } },
    { id: "reset", component: "Button", label: "Reset", action: { type: "set", updates: [{ path: "/team", value: "all" }] } },
  ],
};

function setup(responses: unknown[], over: { tools?: ToolDefinition[]; presets?: string[]; meter?: (r: MeteringRecord) => void; delayMs?: number } = {}) {
  let i = 0;
  const requests: unknown[] = [];
  const transport: Transport = {
    kind: "custom",
    credentialSafe: true,
    async fetch(req) {
      requests.push(req.body);
      if (over.delayMs) await new Promise((r) => setTimeout(r, over.delayMs));
      const body = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  const cards = new CardRegistry(BUILTIN_CARDS);
  const catalogue = new SurfaceCatalogue({ cards });
  const tools = new ToolRegistry();
  tools.registerAll(createSurfaceTools({ catalogue }), ["base"]);
  tools.registerAll(over.tools ?? [], ["base"]);
  const threadStore = createMemoryThreadStore();
  const client = new AgentClient({
    provider: createOpenAIProvider({ transport, dialect: "responses" }),
    model: "m",
    contextBuilder: new ContextBuilder({ identity: "test", contextWindow: 32_000 }),
    tools,
    toolResolution: { presets: over.presets ?? ["base"] },
    mode: "sync",
    threadId: "t1",
    threadStore,
    cards,
    surfaceCatalogue: catalogue,
    ...(over.meter ? { meter: { record: over.meter } } : {}),
  });
  return { client, requests, threadStore, tools };
}

const lookup = (execute: ToolDefinition["execute"] = vi.fn((input: unknown) => ({ output: { echoed: input } }))): ToolDefinition => ({
  name: "lookup",
  description: "Look something up.",
  inputSchema: { type: "object", properties: { team: { type: "string" } }, additionalProperties: false },
  execute,
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const created = async (extra: unknown[] = [], over: Parameters<typeof setup>[1] = {}) => {
  const ctx = setup([call("createSurface", SURFACE), say("Built."), ...extra], over);
  await ctx.client.send("build it");
  return ctx;
};

describe("surface state", () => {
  it("creates a surface and commits it as a card with its place in the turn", async () => {
    const { client } = await created();
    const state = client.store.get();
    expect(state.surfaces["s1"]?.revision).toBe(1);
    const artifact = state.messages.at(-1)!.parts.find((p) => p.type === "artifact");
    expect(artifact).toMatchObject({ id: surfaceCardId("s1"), kind: "card:surface", callId: "call_createSurface" });
  });

  it("changes a neighbour's data locally without calling the model", async () => {
    const { client, requests } = await created();
    const before = requests.length;
    expect(client.setSurfaceData("s1", "/team", "a")).toBe(true);
    expect(client.store.get().surfaces["s1"]?.data["team"]).toBe("a");
    expect(requests.length).toBe(before);
  });

  it("gives the model the person's edits when it reads the surface", async () => {
    const { client, requests } = await created([call("readSurface", { surfaceId: "s1" }), say("Read.")]);
    client.setSurfaceData("s1", "/team", "a");
    await client.send("what did I pick?");
    const lastInput = (requests.at(-1) as { input: { type: string; output?: string }[] }).input;
    const output = lastInput.filter((i) => i.type === "function_call_output").at(-1)?.output;
    expect(JSON.parse(output!).data.team).toBe("a");
  });

  it("updates in place across turns and keeps its origin", async () => {
    const { client } = await created([call("updateSurface", { surfaceId: "s1", operations: [{ op: "setTitle", title: "Renamed" }] }), say("Done.")]);
    await client.send("rename it");
    const spec = client.store.get().surfaces["s1"]!;
    expect(spec.title).toBe("Renamed");
    expect(spec.originCallId).toBe("call_createSurface");
  });

  it("survives a reload with the person's edits", async () => {
    const { client, threadStore } = await created();
    client.setSurfaceData("s1", "/team", "a");
    await new Promise((r) => setTimeout(r, 340));
    await settle();
    const reloaded = setup([say("x")]).client;
    reloaded.getConfig().threadStore = threadStore;
    expect(await reloaded.openThread("t1")).toBe(true);
    expect(reloaded.store.get().surfaces["s1"]?.data["team"]).toBe("a");
  });

  it("keeps saving edits after a clear left a save timer behind", async () => {
    const { client, threadStore } = await created();
    client.setSurfaceData("s1", "/team", "a");
    await new Promise((r) => setTimeout(r, 340));
    client.setSurfaceData("s1", "/team", "all");
    client.setSurfaceData("s1", "/team", "a");
    await new Promise((r) => setTimeout(r, 340));
    await settle();
    const stored = await threadStore.load("t1");
    const artifact = stored!.messages.at(-1)!.parts.find((p) => p.type === "artifact") as { data: { data: { team: string } } };
    expect(artifact.data.data.team).toBe("a");
  });

  it("follows the branch: regenerating drops an update that branch never made", async () => {
    const { client } = await created([call("updateSurface", { surfaceId: "s1", operations: [{ op: "setTitle", title: "Second" }] }), say("Done."), say("Different answer.")]);
    await client.send("rename it");
    expect(client.store.get().surfaces["s1"]?.title).toBe("Second");
    await client.regenerate();
    expect(client.store.get().surfaces["s1"]?.title).toBe("Explorer");
  });

  it("clears surfaces with the thread", async () => {
    const { client } = await created();
    client.clear();
    expect(client.store.get().surfaces).toEqual({});
  });
});

describe("surface actions", () => {
  it("applies a set action locally", async () => {
    const { client, requests } = await created();
    client.setSurfaceData("s1", "/team", "a");
    const before = requests.length;
    expect(await client.dispatchSurfaceAction("s1", "reset")).toBe("done");
    expect(client.store.get().surfaces["s1"]?.data["team"]).toBe("all");
    expect(requests.length).toBe(before);
  });

  it("sends an event to the agent as a marked turn, with bindings read at the press", async () => {
    const { client, requests } = await created([say("Reviewed.")]);
    client.setSurfaceData("s1", "/team", "a");
    await client.dispatchSurfaceAction("s1", "ask");
    const messages = client.store.get().messages;
    const note = messages.at(-2)!;
    expect(note.role).toBe("user");
    expect(note.metadata?.["surfaceEvent"]).toMatchObject({ name: "review", context: { team: "a" } });
    expect(JSON.stringify(requests.at(-1))).toContain("Surface event");
    expect(client.store.get().surfaceActivity["s1"]?.state).toBe("done");
  });

  it("runs a tool action without a model call and writes the result into the surface", async () => {
    const execute = vi.fn((input: unknown) => ({ output: { echoed: input } }));
    const records: MeteringRecord[] = [];
    const { client, requests } = await created([], { tools: [lookup(execute)], meter: (r) => void records.push(r) });
    const before = requests.length;
    client.setSurfaceData("s1", "/team", "a");
    expect(await client.dispatchSurfaceAction("s1", "run")).toBe("done");
    expect(execute).toHaveBeenCalledOnce();
    expect(requests.length).toBe(before);
    expect(client.store.get().surfaces["s1"]?.data["result"]).toEqual({ echoed: { team: "a" } });
    expect(records.some((r) => r.metadata?.["trigger"] === "surface-action")).toBe(true);
    const turn = client.store.get().messages.at(-1)!;
    expect(turn.parts.map((p) => p.type)).toEqual(["tool-call", "tool-result"]);
    expect((turn.metadata?.["turn"] as { origin?: string }).origin).toBe("surface-action");
  });

  it("refuses at the press when the preset was withdrawn after the surface was drawn", async () => {
    const execute = vi.fn(() => ({ output: {} }));
    const { client } = await created([], { tools: [lookup(execute)] });
    const count = client.store.get().messages.length;
    client.configure({ toolResolution: { presets: ["base"], deny: ["lookup"] } });
    expect(await client.dispatchSurfaceAction("s1", "run")).toBe("refused");
    expect(execute).not.toHaveBeenCalled();
    expect(client.store.get().messages.length).toBe(count);
    expect(client.store.get().surfaceActivity["s1"]?.message).toContain("not permitted");
  });

  it("runs only the action in the validated spec", async () => {
    const { client } = await created();
    expect(await client.dispatchSurfaceAction("s1", "no-such-control")).toBe("refused");
    expect(await client.dispatchSurfaceAction("other", "ask")).toBe("refused");
  });

  it("waits for a confirming tool's approval, and records a decline as cancelled", async () => {
    const execute = vi.fn();
    const confirming: ToolDefinition = {
      ...lookup(),
      side: "confirm",
      async execute(_input, ctx) {
        const answer = (await ctx.requestCard?.({ kind: "confirm", title: "Sure?", summary: [{ label: "a", value: 1 }] })) as { cancelled?: boolean };
        if (answer.cancelled) return { output: { done: false }, failure: "denied" as const };
        execute();
        return { output: { done: true } };
      },
    };
    const { client } = await created([], { tools: [confirming] });
    const running = client.dispatchSurfaceAction("s1", "run");
    await vi.waitFor(() => expect(client.pendingCard()).toBeDefined());
    const card = client.pendingCard() as Card;
    client.respond({ cardId: card.id, callId: card.callId, kind: "confirm", type: "cancel", at: 0 });
    expect(await running).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("queues a press made during a run and delivers it afterwards", async () => {
    const ctx = setup([call("createSurface", SURFACE), say("Built."), say("Busy."), say("Reviewed.")], { delayMs: 5 });
    await ctx.client.send("build it");
    const busy = ctx.client.send("keep going");
    expect(await ctx.client.dispatchSurfaceAction("s1", "ask")).toBe("queued");
    await busy;
    await vi.waitFor(() => expect(ctx.client.store.get().surfaceActivity["s1"]?.state).toBe("done"));
    expect(ctx.client.store.get().messages.some((m) => m.metadata?.["surfaceEvent"])).toBe(true);
  });

  it("drops queued presses when the person stops the run", async () => {
    const ctx = setup([call("createSurface", SURFACE), say("Built."), say("Busy.")], { delayMs: 5 });
    await ctx.client.send("build it");
    const busy = ctx.client.send("keep going");
    await ctx.client.dispatchSurfaceAction("s1", "ask");
    ctx.client.stop();
    await busy;
    await settle();
    expect(ctx.client.store.get().surfaceActivity["s1"]?.state).toBe("cancelled");
    expect(ctx.client.store.get().messages.some((m) => m.metadata?.["surfaceEvent"])).toBe(false);
  });
});

describe("turn order", () => {
  it("commits text and interface in the order they happened", async () => {
    const ctx = setup([call("createSurface", SURFACE, "c1", "Before."), say("After.")]);
    await ctx.client.send("build it");
    const message = ctx.client.store.get().messages.at(-1)!;
    const cards = message.parts.flatMap((p) => (p.type === "artifact" ? [{ id: p.id, spec: p.data as Card["spec"], callId: p.callId }] : []));
    expect(layoutTurn(message.parts, cards).map((s) => s.type)).toEqual(["text", "output", "text"]);
  });

  it("keeps an updated card in the slot of the call that first drew it", async () => {
    const ctx = setup([
      call("createSurface", SURFACE, "c1"),
      call("updateSurface", { surfaceId: "s1", operations: [{ op: "setTitle", title: "T" }] }, "c2"),
      say("Done."),
    ]);
    await ctx.client.send("build it");
    const artifacts = ctx.client.store.get().messages.at(-1)!.parts.filter((p) => p.type === "artifact");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ callId: "c1", data: { title: "T", revision: 2 } });
  });
});
