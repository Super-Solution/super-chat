// AgentClient persistence tests, against the same mocked-transport harness the
// core runtime tests use: real adapter, real run loop, no network.

import { describe, expect, it } from "vitest";
import {
  ContextBuilder,
  ToolRegistry,
  createMemoryDocumentStore,
  createMemoryJobStore,
  createMemoryThreadStore,
  createOpenAIProvider,
  quotesOf,
  threadSnapshot,
  QUOTES_METADATA_KEY,
  type Transport,
  type TransportRequest,
} from "@super-solution/super-chat-core";
import { AgentClient } from "./client.js";

function mockTransport(responses: unknown[], opts: { delayMs?: number } = {}): Transport {
  let i = 0;
  return {
    kind: "custom",
    credentialSafe: true,
    async fetch(): Promise<Response> {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      const body = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  } satisfies Transport & { fetch(req: TransportRequest): Promise<Response> };
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

function makeClient(
  responses: unknown[],
  over: Partial<ConstructorParameters<typeof AgentClient>[0]> = {},
  transportOpts: { delayMs?: number } = {},
) {
  return new AgentClient({
    provider: createOpenAIProvider({ transport: mockTransport(responses, transportOpts), dialect: "responses" }),
    model: "gpt-5.2",
    contextBuilder: new ContextBuilder({ identity: "You are a test agent.", contextWindow: 32_000 }),
    tools: new ToolRegistry(),
    toolResolution: { presets: [] },
    mode: "sync",
    ...over,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("AgentClient + ThreadStore", () => {
  it("passes the full metering controls through to runAgent", async () => {
    const records: import("@super-solution/super-chat-core").MeteringRecord[] = [];
    const client = makeClient([respondText("metered")], {
      meter: { record: (record) => { records.push(record); } },
      meteringMetadata: { tenantId: "tenant-1" },
    });

    await client.send("measure this");

    expect(records.map((record) => record.scope)).toEqual(["step", "run"]);
    expect(records.every((record) => record.metadata?.tenantId === "tenant-1")).toBe(true);
    expect(records[0]).toMatchObject({
      provider: "openai",
      requestedModel: "gpt-5.2",
      reportedModel: "gpt-5.2",
      usage: { totalTokens: 120 },
    });
  });

  it("saves after the user turn and again after the assistant turn", async () => {
    const store = createMemoryThreadStore();
    const saves: number[] = [];
    const spyStore = {
      ...store,
      save: async (t: Parameters<typeof store.save>[0]) => {
        saves.push(t.messages.length);
        await store.save(t);
      },
    };
    const client = makeClient([respondText("Hello.")], { threadStore: spyStore });

    await client.send("hi there");
    await flush();

    // First save: just the user message (a reload mid-run keeps the turn).
    // Second: user + assistant after commit.
    expect(saves).toEqual([1, 2]);
    const metas = await store.list();
    expect(metas).toHaveLength(1);
    expect(metas[0]?.title).toBe("hi there");
    const stored = await store.load(client.store.get().id);
    expect(stored?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("openThread hydrates messages and resets run state", async () => {
    const store = createMemoryThreadStore();
    const first = makeClient([respondText("Answer one.")], { threadStore: store });
    await first.send("question one");
    await flush();
    const threadId = first.store.get().id;

    // A different client (fresh page) opens the stored thread.
    const second = makeClient([respondText("unused")], { threadStore: store });
    expect(await second.openThread(threadId)).toBe(true);

    const s = second.store.get();
    expect(s.id).toBe(threadId);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(s.status).toBe("idle");
    expect(s.cards).toEqual([]);

    expect(await second.openThread("t_missing")).toBe(false);
    // A failed open leaves the current thread untouched.
    expect(second.store.get().id).toBe(threadId);
  });

  it("newThread mints a fresh id and persists nothing until the next send", async () => {
    const store = createMemoryThreadStore();
    const client = makeClient([respondText("Hi.")], { threadStore: store });
    await client.send("hello");
    await flush();
    const oldId = client.store.get().id;

    client.newThread();
    const newId = client.store.get().id;
    expect(newId).not.toBe(oldId);
    expect(client.store.get().messages).toEqual([]);
    await flush();
    expect((await store.list()).map((m) => m.id)).toEqual([oldId]);

    await client.send("second thread");
    await flush();
    const ids = (await store.list()).map((m) => m.id);
    expect(ids).toContain(oldId);
    expect(ids).toContain(newId);
    // The old thread's saved turns were not disturbed.
    expect((await store.load(oldId))?.messages).toHaveLength(2);
  });

  it("keeps createdAt stable when a hydrated client re-saves", async () => {
    const store = createMemoryThreadStore();
    const first = makeClient([respondText("one")], { threadStore: store });
    await first.send("hello");
    await flush();
    const threadId = first.store.get().id;
    const createdAt = (await store.load(threadId))!.meta.createdAt;

    // Fresh client hydrated via config, as a page reload would do.
    const stored = await store.load(threadId);
    const second = makeClient([respondText("two")], {
      threadStore: store,
      threadId: stored!.meta.id,
      initialMessages: stored!.messages,
    });
    await second.send("again");
    await flush();

    expect((await store.load(threadId))!.meta.createdAt).toBe(createdAt);
  });

  it("runs without a threadStore exactly as before", async () => {
    const client = makeClient([respondText("no store")]);
    await client.send("hi");
    expect(client.store.get().messages).toHaveLength(2);
  });

  it("clear() persists the emptied thread so reload does not resurrect it", async () => {
    const store = createMemoryThreadStore();
    const client = makeClient([respondText("hi")], { threadStore: store });
    await client.send("hello");
    await flush();
    const id = client.store.get().id;
    client.clear();
    await flush();
    expect((await store.load(id))?.messages).toEqual([]);
  });
});

describe("thread-switch safety", () => {
  it("a run dying from openThread cannot write into the newly opened thread", async () => {
    const store = createMemoryThreadStore();
    // Seed a stored thread to switch to.
    await store.save(threadSnapshot("t_target", [{ id: "u1", role: "user", parts: [{ type: "text", text: "old" }] }]));

    const client = makeClient([respondText("slow answer")], { threadStore: store }, { delayMs: 60 });
    const running = client.send("go"); // in-flight; transport answers in 60ms

    await new Promise((r) => setTimeout(r, 10));
    expect(await client.openThread("t_target")).toBe(true);

    await running; // let the dying run finish unwinding
    await flush();

    const s = client.store.get();
    expect(s.id).toBe("t_target");
    // The dying run must leak NOTHING: no error, no status, no committed parts.
    expect(s.error).toBeUndefined();
    expect(s.status).toBe("idle");
    expect(s.messages.map((m) => m.role)).toEqual(["user"]);
    // And nothing was persisted against the target thread either.
    expect((await store.load("t_target"))?.messages).toHaveLength(1);
  });
});

describe("background job resume routing", () => {
  const completedJob = (id: string) => ({
    id,
    object: "response",
    created_at: 0,
    model: "gpt-5.2",
    status: "completed",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "job answer" }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });

  it("lands another thread's job result in ITS stored snapshot, not the open thread", async () => {
    const jobStore = createMemoryJobStore();
    const threadStore = createMemoryThreadStore();
    await threadStore.save(
      threadSnapshot("t_away", [{ id: "u1", role: "user", parts: [{ type: "text", text: "long question" }] }]),
    );
    await jobStore.put({
      handle: { provider: "openai", id: "resp_bg", model: "gpt-5.2", createdAt: Date.now() },
      status: "in_progress",
      threadId: "t_away",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // The mock transport answers the poll GET with a completed response.
    const client = makeClient([completedJob("resp_bg")], { jobStore, threadStore });
    await client.resumeBackgroundJobs();

    // Current (fresh) thread got nothing.
    expect(client.store.get().messages).toEqual([]);
    // The away thread got the answer appended to its snapshot.
    const away = await threadStore.load("t_away");
    expect(away?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(away?.messages[1]?.parts)).toContain("job answer");
  });
});

describe("branching", () => {
  it("regenerate forks: the old answer survives as a switchable sibling", async () => {
    const client = makeClient([respondText("first answer"), respondText("second answer")]);
    await client.send("question");
    const firstAssistant = client.store.get().messages[1]!;

    await client.regenerate();
    const s = client.store.get();
    // Active path shows the NEW answer…
    expect(s.messages).toHaveLength(2);
    expect(JSON.stringify(s.messages[1]!.parts)).toContain("second answer");
    // …while the tree kept the old one as a sibling under the same user turn.
    expect(s.tree).toHaveLength(3);
    const siblings = s.tree.filter((m) => m.parentId === s.messages[0]!.id);
    expect(siblings.map((m) => m.id)).toContain(firstAssistant.id);

    // Switch back: the first answer is the active branch again.
    client.switchBranch(s.messages[1]!.id, -1);
    expect(JSON.stringify(client.store.get().messages[1]!.parts)).toContain("first answer");
  });

  it("editMessage forks a sibling user turn under the same parent", async () => {
    const client = makeClient([respondText("about A"), respondText("about B")]);
    await client.send("tell me about A");
    const originalUser = client.store.get().messages[0]!;

    await client.editMessage(originalUser.id, "tell me about B");
    const s = client.store.get();
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(s.messages[0]!.parts)).toContain("about B");
    // Original user turn + its answer still exist in the tree.
    expect(s.tree.map((m) => m.id)).toContain(originalUser.id);
    expect(s.tree).toHaveLength(4);
    // Both user turns are roots (siblings under null).
    expect(s.tree.filter((m) => (m.parentId ?? null) === null)).toHaveLength(2);
  });

  it("persists the TREE and the head, and reloads the active branch", async () => {
    const store = createMemoryThreadStore();
    const client = makeClient([respondText("v1"), respondText("v2")], { threadStore: store });
    await client.send("q");
    await client.regenerate();
    await flush();
    const id = client.store.get().id;

    const stored = await store.load(id);
    expect(stored?.messages).toHaveLength(3); // both answers persisted
    expect(stored?.headId).toBe(client.store.get().headId);

    const reloaded = makeClient([respondText("unused")], { threadStore: store });
    await reloaded.openThread(id);
    expect(JSON.stringify(reloaded.store.get().messages[1]!.parts)).toContain("v2");
    expect(reloaded.store.get().tree).toHaveLength(3);
  });
});

describe("attachments", () => {
  it("staged parts join the next send and are consumed by it", async () => {
    const client = makeClient([respondText("got it")]);
    client.attach({
      type: "file",
      source: { kind: "providerFile", id: "file_1", provider: "openai" },
      mediaType: "application/pdf",
      filename: "doc.pdf",
    });
    expect(client.store.get().attachments).toHaveLength(1);

    await client.send("summarize this");
    const user = client.store.get().messages[0]!;
    expect(user.parts.map((p) => p.type)).toEqual(["text", "file"]);
    // Consumed: the next send must not re-attach.
    expect(client.store.get().attachments).toEqual([]);
  });

  it("removeAttachment unstages by index and thread switches drop staged parts", async () => {
    const client = makeClient([respondText("x")]);
    client.attach({ type: "file", source: { kind: "providerFile", id: "a", provider: "openai" }, mediaType: "text/plain" });
    client.attach({ type: "file", source: { kind: "providerFile", id: "b", provider: "openai" }, mediaType: "text/plain" });
    client.removeAttachment(0);
    expect(client.store.get().attachments).toHaveLength(1);

    client.newThread();
    // An attached-but-unsent file must not silently ride into another thread.
    expect(client.store.get().attachments).toEqual([]);
  });
});

describe("AgentClient + document quotes", () => {
  const quote = {
    docId: "doc_1",
    title: "Q3 plan",
    revision: 2,
    blocks: [1, 1] as [number, number],
    start: 0,
    end: 20,
    text: "The **liability** cap is 12 months.",
  };

  it("sends the quote as part of the user's own message", async () => {
    // Not as a context layer. A quote is what the user said, so it must not be
    // re-derived per turn (it would go stale) and must not be droppable under
    // budget pressure (that loses part of their words, not some ambient detail).
    let sent = "";
    const provider = createOpenAIProvider({
      transport: {
        kind: "custom",
        credentialSafe: true,
        async fetch(req: TransportRequest): Promise<Response> {
          sent = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
          return new Response(JSON.stringify(respondText("ok")), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      } as Transport,
      dialect: "responses",
    });
    const client = makeClient([], { provider });

    await client.send("tighten this", { quotes: [quote] });
    await flush();

    expect(sent).toContain("Quoted from");
    // The SOURCE markdown reaches the model, asterisks and all.
    expect(sent).toContain("**liability**");
    expect(sent).toContain("tighten this");
  });

  it("keeps the structured quote on metadata, out of the provider payload", async () => {
    let sent = "";
    const provider = createOpenAIProvider({
      transport: {
        kind: "custom",
        credentialSafe: true,
        async fetch(req: TransportRequest): Promise<Response> {
          sent = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
          return new Response(JSON.stringify(respondText("ok")), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      } as Transport,
      dialect: "responses",
    });
    const client = makeClient([], { provider });

    await client.send("tighten this", { quotes: [quote] });
    await flush();

    const user = client.store.get().messages.find((m) => m.role === "user");
    // Present for re-rendering the chip when history is replayed…
    expect(quotesOf(user?.metadata)).toEqual([quote]);
    // …and absent from the wire, which is what Message.metadata promises.
    expect(sent).not.toContain("docId");
    expect(sent).not.toContain(QUOTES_METADATA_KEY);
  });

  // The card a quote is taken from can be older than the document — the one
  // createDocument returned, scrolled back to after two edits. Checked at send
  // time and frozen onto the message, so the turn is told and history keeps
  // what was true when the user spoke.
  it("stamps drift from the document store onto the text and the metadata", async () => {
    let sent = "";
    const provider = createOpenAIProvider({
      transport: {
        kind: "custom",
        credentialSafe: true,
        async fetch(req: TransportRequest): Promise<Response> {
          sent = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
          return new Response(JSON.stringify(respondText("ok")), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      } as Transport,
      dialect: "responses",
    });
    const documentStore = createMemoryDocumentStore();
    const doc = await documentStore.create({ id: "doc_1", title: "Q3 plan", markdown: "# Q3\n\nThe cap is 12 months." });
    const stale = { ...quote, revision: doc.revision, text: "The cap is 12 months." };
    await documentStore.update(doc.id, "# Q3\n\nThe cap is 24 months.", 1);

    const client = makeClient([], { provider, documentStore });
    await client.send("tighten this", { quotes: [stale] });
    await flush();

    expect(sent).toContain("now at v2");
    const user = client.store.get().messages.find((m) => m.role === "user");
    expect(quotesOf(user?.metadata)[0]?.drift).toEqual({ status: "moved", revision: 2, intact: false });
  });

  it("leaves an unquoted message untouched", async () => {
    const client = makeClient([respondText("ok")]);
    await client.send("plain question");
    await flush();
    const user = client.store.get().messages.find((m) => m.role === "user");
    expect(user?.metadata).toBeUndefined();
  });
});

describe("AgentClient commit order", () => {
  it("shows results as they finish but commits them in call order", async () => {
    const timed = (name: string, ms: number) => ({
      name,
      description: name,
      inputSchema: { type: "object" },
      execute: async () => {
        await new Promise((r) => setTimeout(r, ms));
        return { output: { name } };
      },
    });
    const respondToolCalls = {
      id: "resp_1",
      object: "response",
      created_at: 0,
      model: "gpt-5.2",
      status: "completed",
      output: [
        { type: "function_call", call_id: "c_slow", name: "slow", arguments: "{}" },
        { type: "function_call", call_id: "c_fast", name: "fast", arguments: "{}" },
      ],
      usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
    };
    const client = makeClient([respondToolCalls, respondText("done")], {
      tools: new ToolRegistry().registerAll([timed("slow", 80), timed("fast", 10)], ["observer"]),
      toolResolution: { presets: ["observer"] },
    });

    const live: string[] = [];
    const unsubscribe = client.store.subscribe(() => {
      for (const p of client.store.get().run.parts) {
        if (p.type === "tool-result" && !live.includes(p.callId)) live.push(p.callId);
      }
    });
    await client.send("go");
    await flush();
    unsubscribe();

    expect(live).toEqual(["c_fast", "c_slow"]);
    const assistant = client.store.get().messages.find((m) => m.role === "assistant");
    const committed = assistant!.parts.flatMap((p) => (p.type === "tool-call" || p.type === "tool-result" ? [`${p.type}:${p.callId}`] : []));
    expect(committed).toEqual(["tool-call:c_slow", "tool-call:c_fast", "tool-result:c_slow", "tool-result:c_fast"]);
  });
});
