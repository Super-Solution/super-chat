import { describe, expect, it, vi } from "vitest";
import { confirmCard } from "../cards/builtin.js";
import type { ToolDefinition } from "../tools/types.js";
import { executeToolCall, executeToolCalls, type ToolCallOutcome } from "./execute-tools.js";

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

describe('side: "confirm" is enforced', () => {
  const yes = { confirmed: true };
  const guarded = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({
    name: "transfer",
    description: "Move funds.",
    inputSchema: { type: "object" },
    side: "confirm",
    execute: vi.fn(() => ({ output: { moved: true } })),
    ...over,
  });
  const call = { callId: "c1", name: "transfer", input: { amount: 5, to: "acct" } };

  it("shows what will run, and runs only after an explicit yes", async () => {
    const tool = guarded();
    const order: string[] = [];
    (tool.execute as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push("ran");
      return { output: { moved: true } };
    });
    const requestCard = vi.fn(async () => {
      order.push("asked");
      return yes;
    });
    const outcome = await executeToolCall(call, { tools: [tool], vars: {}, requestCard });
    expect(order).toEqual(["asked", "ran"]);
    expect(outcome.failure).toBeUndefined();
    expect(requestCard).toHaveBeenCalledWith("c1", expect.objectContaining({
      kind: "confirm",
      title: "Allow this?",
      summary: [{ label: "Amount", value: "5" }, { label: "To", value: "acct" }],
    }));
    expect(JSON.stringify((requestCard.mock.calls[0] as unknown[])[1])).not.toContain("transfer");
  });

  it("uses the tool's own approval wording, and falls back when that hook throws", async () => {
    const worded = guarded({
      approval: (input) => ({
        title: "Send this payment?",
        summary: [{ label: "Amount", value: `$${(input as { amount: number }).amount}.00` }],
        confirmLabel: "Send",
        danger: true,
      }),
    });
    const requestCard = vi.fn(async () => yes);
    await executeToolCall(call, { tools: [worded], vars: {}, requestCard });
    expect((requestCard.mock.calls[0] as unknown[])[1]).toMatchObject({
      title: "Send this payment?",
      summary: [{ label: "Amount", value: "$5.00" }],
      confirmLabel: "Send",
      danger: true,
    });

    const broken = guarded({ approval: () => { throw new Error("bad copy"); } });
    const outcome = await executeToolCall(call, { tools: [broken], vars: {}, requestCard });
    expect((requestCard.mock.calls[1] as unknown[])[1]).toMatchObject({ title: "Allow this?" });
    expect(outcome.failure).toBeUndefined();
  });

  it("produces a card the confirm kind accepts, even with no input", async () => {
    const requestCard = vi.fn(async () => yes);
    await executeToolCall({ callId: "c1", name: "transfer", input: undefined }, { tools: [guarded()], vars: {}, requestCard });
    const spec = (requestCard.mock.calls[0] as unknown[])[1];
    expect(confirmCard.validate(spec)).toEqual({ ok: true });
  });

  for (const [name, answer] of [
    ["a decline", { cancelled: true, reason: "The user declined." }],
    ["an empty answer", undefined],
    ["an answer that is not a yes", { confirmed: "yes" }],
  ] as const) {
    it(`does not run on ${name}`, async () => {
      const tool = guarded();
      const outcome = await executeToolCall(call, { tools: [tool], vars: {}, requestCard: async () => answer });
      expect(tool.execute).not.toHaveBeenCalled();
      expect(outcome.failure).toBe("denied");
    });
  }

  it("does not run when the host cannot ask", async () => {
    const tool = guarded();
    const outcome = await executeToolCall(call, { tools: [tool], vars: {} });
    expect(tool.execute).not.toHaveBeenCalled();
    expect(outcome.failure).toBe("denied");
    expect(JSON.stringify(outcome.output)).toContain("cannot ask");
  });

  it("guards a tool the host executes too", async () => {
    const onHostTool = vi.fn(async () => ({ moved: true }));
    const tool = guarded({ execute: undefined });
    await executeToolCall(call, { tools: [tool], vars: {}, onHostTool, requestCard: async () => ({ cancelled: true }) });
    expect(onHostTool).not.toHaveBeenCalled();
  });

  it("does not run if the run was stopped while the question was open", async () => {
    const controller = new AbortController();
    const tool = guarded();
    const requestCard = async () => {
      controller.abort();
      return yes;
    };
    const outcome = await executeToolCall(call, { tools: [tool], vars: {}, signal: controller.signal, requestCard });
    expect(tool.execute).not.toHaveBeenCalled();
    expect(outcome.failure).toBe("denied");
  });

  it("does not count the person's decision against the tool timeout", async () => {
    const tool = guarded();
    const requestCard = () => new Promise((resolve) => setTimeout(() => resolve(yes), 40));
    const outcome = await executeToolCall(call, { tools: [tool], vars: {}, timeoutMs: 10, requestCard });
    expect(outcome.failure).toBeUndefined();
    expect(tool.execute).toHaveBeenCalledOnce();
  });

  it("asks once when the tool does its own asking", async () => {
    const requestCard = vi.fn(async () => yes);
    const tool = guarded({
      confirmation: "tool",
      async execute(_input, ctx) {
        await ctx.requestCard?.({ kind: "confirm", title: "Exact terms", summary: [{ label: "a", value: 1 }] });
        return { output: { moved: true } };
      },
    });
    await executeToolCall(call, { tools: [tool], vars: {}, requestCard });
    expect(requestCard).toHaveBeenCalledOnce();
  });

  it("refuses a self-asking tool when the host cannot ask", async () => {
    const tool = guarded({ confirmation: "tool" });
    const outcome = await executeToolCall(call, { tools: [tool], vars: {} });
    expect(tool.execute).not.toHaveBeenCalled();
    expect(outcome.failure).toBe("denied");
  });

  it("leaves other tools alone", async () => {
    const tool = guarded({ side: "write" });
    const outcome = await executeToolCall(call, { tools: [tool], vars: {} });
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(outcome.failure).toBeUndefined();
  });
});

describe("a failed call that left out a required argument", () => {
  const lookup = (execute: ToolDefinition["execute"]): ToolDefinition => ({
    name: "lookup",
    description: "lookup",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["quote", "profile"], description: "What to read." },
        symbol: { type: "string", description: "A ticker such as AAPL." },
        limit: { type: "integer" },
      },
      required: ["action", "symbol"],
    },
    execute,
  });

  it("is told which required arguments are missing, with their schema, beside the tool's own error", async () => {
    const tool = lookup(async () => ({ error: "No symbol given." }));
    const out = await executeToolCall({ callId: "c1", name: "lookup", input: {} }, { tools: [tool], vars: {} });
    expect(out.output).toEqual({
      error: "No symbol given.",
      missing: ["action", "symbol"],
      expected: {
        action: { type: "string", enum: ["quote", "profile"], description: "What to read." },
        symbol: { type: "string", description: "A ticker such as AAPL." },
      },
    });
  });

  it("names only what is absent, and treats null as absent", async () => {
    const tool = lookup(async () => ({ error: "Unknown action." }));
    const out = await executeToolCall({ callId: "c1", name: "lookup", input: { symbol: null, action: "quote" } }, { tools: [tool], vars: {} });
    expect((out.output as { missing: string[] }).missing).toEqual(["symbol"]);
  });

  it("also explains a tool that throws", async () => {
    const tool = lookup(async () => {
      throw new Error("symbol is required");
    });
    const out = await executeToolCall({ callId: "c1", name: "lookup", input: "nope" }, { tools: [tool], vars: {} });
    expect(out.failure).toBe("execution-error");
    expect((out.output as { missing: string[] }).missing).toEqual(["action", "symbol"]);
  });

  it("leaves a successful call alone, even without its required arguments (the tool may default them)", async () => {
    const tool = lookup(async () => ({ price: 1 }));
    const out = await executeToolCall({ callId: "c1", name: "lookup", input: {} }, { tools: [tool], vars: {} });
    expect(out.output).toEqual({ price: 1 });
  });

  it("leaves a failure that is not about the input alone: timeouts, a call with everything given, a tool that already says what it expects", async () => {
    const slow = lookup(() => new Promise(() => {}));
    const timedOut = await executeToolCall({ callId: "c1", name: "lookup", input: {} }, { tools: [slow], vars: {}, timeoutMs: 5 });
    expect(timedOut.output).not.toHaveProperty("missing");

    const full = lookup(async () => ({ error: "Unknown symbol ZZZ." }));
    const given = await executeToolCall({ callId: "c2", name: "lookup", input: { action: "quote", symbol: "ZZZ" } }, { tools: [full], vars: {} });
    expect(given.output).toEqual({ error: "Unknown symbol ZZZ." });

    const own = lookup(async () => ({ error: "Give a symbol.", expected: { symbol: "a ticker" } }));
    const told = await executeToolCall({ callId: "c3", name: "lookup", input: {} }, { tools: [own], vars: {} });
    expect(told.output).toEqual({ error: "Give a symbol.", expected: { symbol: "a ticker" } });
  });

  it("does nothing for a tool whose schema lists no required arguments", async () => {
    const tool: ToolDefinition = { name: "free", description: "free", inputSchema: { type: "object" }, execute: async () => ({ error: "nope" }) };
    const out = await executeToolCall({ callId: "c1", name: "free", input: {} }, { tools: [tool], vars: {} });
    expect(out.output).toEqual({ error: "nope" });
  });
});
