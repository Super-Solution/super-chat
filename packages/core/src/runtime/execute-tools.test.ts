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

  const obedient = (seen: { signal?: AbortSignal }): ToolDefinition => ({
    name: "obedient",
    description: "records its signal and waits",
    inputSchema: { type: "object" },
    execute: (_input, ctx) => {
      seen.signal = ctx.signal;
      return new Promise(() => undefined); // never finishes by itself
    },
  });

  it("aborts the tool's own signal when it times out, so a cooperative tool can stop", async () => {
    const seen: { signal?: AbortSignal } = {};
    const [outcome] = await executeToolCalls([{ callId: "c1", name: "obedient", input: {} }], {
      tools: [obedient(seen)],
      vars: {},
      timeoutMs: 15,
    });
    expect(outcome!.failure).toBe("execution-error");
    expect(outcome!.output).toMatchObject({ kind: "timeout" });
    expect(seen.signal?.aborted).toBe(true);
  });

  it("settles at once when the run is cancelled, even if the tool ignores its signal", async () => {
    const ctl = new AbortController();
    const seen: { signal?: AbortSignal } = {};
    const pending = executeToolCalls([{ callId: "c1", name: "obedient", input: {} }], {
      tools: [obedient(seen)],
      vars: {},
      signal: ctl.signal,
    });
    await sleep(10);
    ctl.abort();
    const [outcome] = await pending; // would hang forever if the abort were not raced
    expect(outcome!.failure).toBe("denied");
    expect(seen.signal?.aborted).toBe(true);
  });

  it("does not wait on a confirm card the user never answers once the run is cancelled", async () => {
    const ctl = new AbortController();
    const confirm: ToolDefinition = {
      name: "ask",
      description: "asks",
      inputSchema: { type: "object" },
      side: "confirm",
      execute: async (_input, ctx) => ({ output: await ctx.requestCard!({ kind: "confirm", title: "Sure?" }) }),
    };
    const pending = executeToolCalls([{ callId: "c1", name: "ask", input: {} }], {
      tools: [confirm],
      vars: {},
      signal: ctl.signal,
      requestCard: () => new Promise(() => undefined), // the host dialog is never answered
    });
    await sleep(10);
    ctl.abort();
    const [outcome] = await pending;
    expect(outcome!.failure).toBe("denied");
  });

  it("does not start a tool for a run that is already cancelled", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const execute = vi.fn(async () => ({ output: 1 }));
    const [outcome] = await executeToolCalls([{ callId: "c1", name: "t", input: {} }], {
      tools: [{ name: "t", description: "t", inputSchema: { type: "object" }, execute }],
      vars: {},
      signal: ctl.signal,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(outcome!.failure).toBe("denied");
  });

  it("leaves no timer behind after a call finishes before its timeout", async () => {
    vi.useFakeTimers();
    try {
      const done = executeToolCalls([{ callId: "c1", name: "fast", input: {} }], {
        tools: [{ name: "fast", description: "f", inputSchema: { type: "object" }, execute: async () => ({ output: 1 }) }],
        vars: {},
        timeoutMs: 60_000,
      });
      await vi.advanceTimersByTimeAsync(0);
      const [outcome] = await done;
      expect(outcome!.output).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("detaches from the run's signal after each call", async () => {
    const ctl = new AbortController();
    const remove = vi.spyOn(ctl.signal, "removeEventListener");
    await executeToolCalls([{ callId: "c1", name: "fast", input: {} }], {
      tools: [{ name: "fast", description: "f", inputSchema: { type: "object" }, execute: async () => ({ output: 1 }) }],
      vars: {},
      signal: ctl.signal,
    });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
