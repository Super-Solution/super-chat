// A client whose turns run somewhere else. The runner here stands in for a
// server: it yields RunEvents by hand, so every test is about what the client
// does with them, not about a loop.

import { describe, expect, it } from "vitest";
import {
  createMemoryThreadStore,
  threadSnapshot,
  userMessage,
  type Card,
  type CardAction,
  type Message,
  type RunConfig,
  type RunEvent,
} from "@supersolutions/super-chat-core";
import { AgentClient, type TurnContext, type TurnRunner } from "./client.js";
import { serverRunConfig } from "./server-run.js";

const finish: RunEvent = { type: "run-finish", runId: "srv_1", finishReason: "stop", usage: { totalTokens: 7 }, steps: 1 };
const start: RunEvent = { type: "run-start", runId: "srv_1", mode: "stream" };

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A promise the test settles by hand, to hold a runner at a point. */
function gate<T = void>() {
  let open!: (value: T) => void;
  const wait = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

const textOf = (m: Message | undefined) => (m?.parts ?? []).flatMap((p) => (p.type === "text" ? [p.text] : [])).join("");

const approval: Card = {
  id: "card_1",
  callId: "call_1",
  spec: { kind: "confirm", title: "Send the email?", summary: [] },
};

describe("a turn that runs on a server", () => {
  it("hands the turn to the runner and folds its events into the thread", async () => {
    const seen: { messages: Message[]; turn: TurnContext }[] = [];
    const runner: TurnRunner = async function* (messages, _config, turn) {
      seen.push({ messages, turn });
      yield start;
      yield { type: "text-delta", delta: "Hello " };
      yield { type: "text-delta", delta: "there." };
      yield finish;
    };
    const client = new AgentClient(serverRunConfig({ runner, threadId: "thread_a" }));

    await client.send("hi");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.turn.threadId).toBe("thread_a");
    expect(seen[0]!.turn.kind).toBe("send");
    expect(textOf(seen[0]!.messages.at(-1))).toBe("hi");

    const s = client.store.get();
    expect(s.status).toBe("done");
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(textOf(s.messages[1])).toBe("Hello there.");
    expect(s.messages[1]!.metadata?.turn).toMatchObject({ model: "server", usage: { totalTokens: 7 } });
  });

  it("tells the runner what started the turn", async () => {
    const kinds: string[] = [];
    const runner: TurnRunner = async function* (_messages, _config, turn) {
      kinds.push(turn.kind);
      yield start;
      yield { type: "text-delta", delta: "ok" };
      yield finish;
    };
    const client = new AgentClient(serverRunConfig({ runner }));

    await client.send("one");
    await client.regenerate();
    await client.editMessage(client.store.get().messages[0]!.id, "two");

    expect(kinds).toEqual(["send", "regenerate", "edit"]);
  });

  it("passes the person's answer to a card back through onUserDecision", async () => {
    const answers: CardAction[] = [];
    const runner: TurnRunner = async function* (_messages, config) {
      yield start;
      yield { type: "awaiting-user", callId: "call_1", card: approval };
      const action = await config.onUserDecision!("call_1", approval);
      answers.push(action);
      yield { type: "user-responded", callId: "call_1", action };
      yield { type: "text-delta", delta: "Sent." };
      yield finish;
    };
    const client = new AgentClient(serverRunConfig({ runner }));

    const sending = client.send("send it");
    await flush();
    expect(client.store.get().status).toBe("awaiting-user");
    expect(client.pendingCard()?.id).toBe("card_1");

    client.respond({ cardId: "card_1", callId: "call_1", kind: "confirm", type: "confirm", at: 1 });
    await sending;

    expect(answers.map((a) => a.type)).toEqual(["confirm"]);
    const committed = client.store.get().messages.at(-1)!;
    expect(committed.parts.find((p) => p.type === "artifact")).toMatchObject({ id: "card_1", action: { type: "confirm" } });
  });

  it("shows a runner's throw as the turn's error", async () => {
    const runner: TurnRunner = async function* () {
      yield start;
      throw new Error("The server refused the turn.");
    };
    const client = new AgentClient(serverRunConfig({ runner }));

    await client.send("hi");

    const s = client.store.get();
    expect(s.status).toBe("error");
    expect((s.error as Error).message).toBe("The server refused the turn.");
  });

  it("never reaches for a provider", async () => {
    const config = serverRunConfig({ runner: async function* () {} });
    await expect(config.provider.generate({ model: "m", messages: [] } as never)).rejects.toThrow(/run on a server/);
    expect(config.tools.list()).toEqual([]);
  });
});

describe("stopping a server-run turn, and leaving one", () => {
  /** A runner that waits on a card and records how the wait ended and what the turn was told. */
  function waitingRunner() {
    const log: { outcome?: string; stopRequested?: boolean; aborted?: boolean } = {};
    const runner: TurnRunner = async function* (_messages, config: RunConfig, turn) {
      yield start;
      yield { type: "awaiting-user", callId: "call_1", card: approval };
      try {
        const action = await config.onUserDecision!("call_1", approval);
        log.outcome = action.type;
      } catch (e) {
        log.outcome = (e as Error).name;
      }
      log.stopRequested = turn.stopRequested;
      log.aborted = config.signal?.aborted;
    };
    return { runner, log };
  }

  it("stop() is the person's: the signal aborts, the turn is told, and the card is answered as cancelled", async () => {
    const { runner, log } = waitingRunner();
    const client = new AgentClient(serverRunConfig({ runner }));

    const sending = client.send("send it");
    await flush();
    client.stop();
    await sending;

    expect(log).toEqual({ outcome: "cancel", stopRequested: true, aborted: true });
  });

  it("opening another thread only leaves: the card's wait is aborted, not answered", async () => {
    const { runner, log } = waitingRunner();
    const threadStore = createMemoryThreadStore();
    await threadStore.save(threadSnapshot("thread_b", [userMessage("elsewhere")]));
    const client = new AgentClient(serverRunConfig({ runner, threadStore, threadId: "thread_a" }));

    const sending = client.send("send it");
    await flush();
    expect(await client.openThread("thread_b")).toBe(true);
    await sending;

    expect(log).toEqual({ outcome: "AbortError", stopRequested: false, aborted: true });
    const s = client.store.get();
    expect(s.id).toBe("thread_b");
    expect(s.status).toBe("idle");
    expect(s.messages.map(textOf)).toEqual(["elsewhere"]);
  });

  it("a turn left behind cannot take the next turn's stop with it", async () => {
    const held = gate();
    let calls = 0;
    const second: { aborted?: boolean } = {};
    const runner: TurnRunner = async function* (_messages, config) {
      calls += 1;
      yield start;
      if (calls === 1) {
        // Slow to unwind: still closing its connection when the next turn starts.
        await held.wait;
        return;
      }
      yield { type: "awaiting-user", callId: "call_1", card: approval };
      await config.onUserDecision!("call_1", approval);
      second.aborted = config.signal?.aborted;
    };
    const client = new AgentClient(serverRunConfig({ runner }));

    const first = client.send("one");
    await flush();
    client.newThread();
    const next = client.send("two");
    await flush();
    held.open();
    await first;
    await flush();

    client.stop();
    await next;
    expect(second.aborted).toBe(true);
  });
});

describe("following a turn that is already running", () => {
  it("resume() asks the runner for it and a snapshot replaces what the client holds", async () => {
    const kinds: string[] = [];
    const runner: TurnRunner = async function* (_messages, _config, turn) {
      kinds.push(turn.kind);
      yield start;
      yield { type: "text-delta", delta: "stale " };
      yield { type: "run-snapshot", parts: [{ type: "text", text: "Checked the filing. " }], cards: [], steps: 2 };
      yield { type: "text-delta", delta: "Two items are missing." };
      yield finish;
    };
    const client = new AgentClient(serverRunConfig({ runner, initialMessages: [userMessage("what is missing?")] }));

    await client.resume();

    expect(kinds).toEqual(["resume"]);
    const s = client.store.get();
    expect(s.status).toBe("done");
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(textOf(s.messages[1])).toBe("Checked the filing. Two items are missing.");
  });

  it("leaves the thread as it was when there is nothing to follow", async () => {
    const runner: TurnRunner = async function* () {};
    const client = new AgentClient(serverRunConfig({ runner, initialMessages: [userMessage("hello")] }));

    await client.resume();

    const s = client.store.get();
    expect(s.status).toBe("idle");
    expect(s.messages).toHaveLength(1);
  });

  it("is announced again after a snapshot: a card that is still waiting can be answered", async () => {
    const runner: TurnRunner = async function* (_messages, config) {
      yield start;
      yield { type: "run-snapshot", parts: [{ type: "text", text: "Ready to send." }], cards: [approval] };
      yield { type: "awaiting-user", callId: "call_1", card: approval };
      const action = await config.onUserDecision!("call_1", approval);
      yield { type: "user-responded", callId: "call_1", action };
      yield finish;
    };
    const client = new AgentClient(serverRunConfig({ runner, initialMessages: [userMessage("send it")] }));

    const following = client.resume();
    await flush();
    expect(client.store.get().status).toBe("awaiting-user");
    expect(client.store.get().cards).toHaveLength(1);

    client.respond({ cardId: "card_1", callId: "call_1", kind: "confirm", type: "confirm", at: 1 });
    await following;

    expect(client.store.get().messages.at(-1)!.parts.find((p) => p.type === "artifact")).toMatchObject({
      id: "card_1",
      action: { type: "confirm" },
    });
  });

  it("does nothing on a client whose turns run in this process", async () => {
    const config = serverRunConfig({ runner: async function* () {} });
    const { runner: _unused, ...local } = config;
    const client = new AgentClient({ ...local, initialMessages: [userMessage("hello")] });

    await client.resume();

    expect(client.store.get().status).toBe("idle");
    expect(client.store.get().messages).toHaveLength(1);
  });
});
