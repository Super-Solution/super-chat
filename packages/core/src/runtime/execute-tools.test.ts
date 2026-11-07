import { describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "../tools/types.js";
import { executeToolCalls, type ToolCallOutcome } from "./execute-tools.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const timed = (name: string, ms: number): ToolDefinition => ({
  name,
  description: name,
  inputSchema: { type: "object" },
  execute: async () => {
    await sleep(ms);
    return { output: { name } };
  },
});

describe("executeToolCalls", () => {
  it("reports outcomes in completion order and returns them in call order", async () => {
    const reported: ToolCallOutcome[] = [];
    const outcomes = await executeToolCalls(
      [
        { callId: "c_slow", name: "slow", input: {} },
        { callId: "c_missing", name: "missing", input: {} },
        { callId: "c_fast", name: "fast", input: {} },
      ],
      {
        tools: [timed("slow", 80), timed("fast", 10)],
        vars: {},
        onOutcome: (o) => reported.push(o),
      },
    );

    expect(reported.map((o) => o.callId)).toEqual(["c_missing", "c_fast", "c_slow"]);
    expect(outcomes.map((o) => o.callId)).toEqual(["c_slow", "c_missing", "c_fast"]);
    expect(reported.find((o) => o.callId === "c_missing")?.failure).toBe("not-found");
  });

  it("drops cards and dialogs from a tool that already timed out", async () => {
    // A timed-out tool keeps running. Whatever it surfaces afterwards would
    // arrive after its own result — a card for a call the UI marked finished.
    const onCard = vi.fn();
    const requestCard = vi.fn(async () => ({ confirmed: true }));
    const late: ToolDefinition = {
      name: "late",
      description: "outlives its timeout",
      inputSchema: { type: "object" },
      execute: async (_input, ctx) => {
        await sleep(60);
        ctx.emitCard?.({ kind: "progress", steps: [{ label: "too late", status: "done" }] });
        await ctx.requestCard?.({ kind: "confirm", title: "Still there?" }).catch(() => undefined);
        return { output: { ok: true } };
      },
    };

    const reported: ToolCallOutcome[] = [];
    await executeToolCalls([{ callId: "c_late", name: "late", input: {} }], {
      tools: [late],
      vars: {},
      timeoutMs: 20,
      onCard,
      requestCard,
      onOutcome: (o) => reported.push(o),
    });
    await sleep(100);

    expect(reported).toHaveLength(1);
    expect(reported[0]!.failure).toBe("execution-error");
    expect(onCard).not.toHaveBeenCalled();
    expect(requestCard).not.toHaveBeenCalled();
  });
});
