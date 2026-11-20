import { describe, expect, it } from "vitest";
import { initialRunState, reduceRunEvent, type RunEvent } from "./events.js";
import type { Card } from "../cards/types.js";

const card: Card = { id: "card_1", callId: "call_2", spec: { kind: "confirm", title: "Send the email?", summary: [] } };

const reduce = (events: RunEvent[]) => events.reduce(reduceRunEvent, initialRunState("run_1", "stream"));

describe("run-snapshot", () => {
  it("replaces what the run has produced instead of adding to it", () => {
    const state = reduce([
      { type: "run-start", runId: "run_1", mode: "stream" },
      { type: "text-delta", delta: "seen before the connection dropped" },
      { type: "tool-call", callId: "call_0", name: "lookup", input: {} },
      {
        type: "run-snapshot",
        parts: [
          { type: "text", text: "Looked it up." },
          { type: "tool-call", callId: "call_1", name: "lookup", input: {}, status: "done" },
          { type: "tool-result", callId: "call_1", name: "lookup", output: { ok: true }, ms: 12 },
          { type: "tool-call", callId: "call_2", name: "send_email", input: {}, status: "running" },
        ],
        cards: [card],
        usage: { totalTokens: 40 },
        steps: 2,
      },
      { type: "text-delta", delta: " Next." },
    ]);

    expect(state.status).toBe("running");
    expect(state.parts.map((p) => p.type)).toEqual(["text", "tool-call", "tool-result", "tool-call", "text"]);
    expect(state.cards).toEqual([card]);
    expect(state.usage).toEqual({ totalTokens: 40 });
    expect(state.steps).toBe(2);
    // Only the call the snapshot shows as running is still pending.
    expect(Object.keys(state.pendingTools)).toEqual(["call_2"]);
  });

  it("drops what was live-only, and leaves the wait on a card to be announced again", () => {
    const waiting = reduce([
      { type: "run-start", runId: "run_1", mode: "stream" },
      { type: "tool-call-input-delta", callId: "call_2", name: "send_email", partialInput: { to: "a" } },
      { type: "awaiting-user", callId: "call_2", card },
    ]);
    expect(waiting.status).toBe("awaiting-user");

    const after = reduceRunEvent(waiting, { type: "run-snapshot", parts: [], cards: [card] });
    expect(after.status).toBe("running");
    expect(after.pendingCard).toBeUndefined();
    expect(after.partialTools).toEqual({});
    // Counters the snapshot does not carry keep their value.
    expect(after.steps).toBe(waiting.steps);

    const again = reduceRunEvent(after, { type: "awaiting-user", callId: "call_2", card });
    expect(again.status).toBe("awaiting-user");
    expect(again.cards).toEqual([card]);
  });
});
