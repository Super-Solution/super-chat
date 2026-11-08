import { describe, expect, it } from "vitest";
import {
  afterTool,
  consecutiveFailures,
  DEFAULT_STOP_CONDITIONS,
  noToolCalls,
  shouldStop,
  stepCountIs,
  tokenBudgetExceeded,
  userDeclined,
  type StopContext,
} from "./stop.js";

const fail = { callId: "c", name: "t", output: {}, failure: "execution-error", ms: 1 };
const ok = { callId: "c", name: "t", output: {}, ms: 1 };
const ctx = (over: Partial<StopContext> = {}): StopContext => ({
  step: 1,
  finishReason: "tool-calls",
  outcomes: [ok],
  usage: {},
  ...over,
});

describe("stop conditions", () => {
  it("stepCountIs / afterTool / noToolCalls / tokenBudgetExceeded", () => {
    expect(stepCountIs(2)(ctx({ step: 1 }))).toBe(false);
    expect(stepCountIs(2)(ctx({ step: 2 }))).toBe(true);
    expect(afterTool("t")(ctx())).toBe(true);
    expect(afterTool("t")(ctx({ outcomes: [fail] }))).toBe(false); // a failed run of the tool is not "done"
    expect(noToolCalls(ctx({ finishReason: "stop", outcomes: [] }))).toBe(true);
    expect(tokenBudgetExceeded(10)(ctx({ usage: { inputTokens: 6, outputTokens: 4 } }))).toBe(true);
    expect(tokenBudgetExceeded(10)(ctx({ usage: { totalTokens: 9 } }))).toBe(false);
  });

  it("userDeclined reads the cancelled marker", () => {
    expect(userDeclined(ctx({ outcomes: [{ ...ok, output: { cancelled: true } }] }))).toBe(true);
    expect(userDeclined(ctx())).toBe(false);
  });

  it("shouldStop is false with no conditions", () => {
    expect(shouldStop(undefined, ctx())).toBe(false);
    expect(shouldStop([], ctx())).toBe(false);
  });
});

describe("consecutiveFailures", () => {
  it("stops after n failing steps in a row and resets on a success", () => {
    const c = consecutiveFailures(3);
    const f = (step: number) => c(ctx({ runId: "r", step, outcomes: [fail] }));
    expect([f(1), f(2)]).toEqual([false, false]);
    expect(c(ctx({ runId: "r", step: 3, outcomes: [ok] }))).toBe(false); // success breaks the streak
    expect([f(4), f(5), f(6)]).toEqual([false, false, true]);
  });

  it("keeps a separate streak per run (a reused condition must not leak failures across turns)", () => {
    const c = consecutiveFailures(3);
    const f = (runId: string, step: number) => c(ctx({ runId, step, outcomes: [fail] }));
    f("a", 1);
    f("a", 2); // run a ends here, two failures deep
    expect(f("b", 1)).toBe(false); // run b's first failure is its own first failure
    // interleaved concurrent runs do not mix their tallies
    expect(f("b", 2)).toBe(false); // b: 2 failures
    expect(f("a", 3)).toBe(true); // a: 3 failures, unaffected by b's step in between
    expect(f("b", 3)).toBe(true);
  });

  it("without a run id, a step that does not advance starts a new streak", () => {
    const c = consecutiveFailures(3);
    const f = (step: number) => c(ctx({ step, outcomes: [fail] }));
    f(1);
    f(2);
    expect(f(1)).toBe(false); // new run: 2 earlier failures are not counted
  });

  it("the shared default set is safe to reuse across runs", () => {
    const run = (runId: string, steps: number) => {
      let stopped = false;
      for (let step = 1; step <= steps; step += 1) {
        stopped = shouldStop(DEFAULT_STOP_CONDITIONS, ctx({ runId, step, outcomes: [fail] }));
      }
      return stopped;
    };
    expect(run("one", 2)).toBe(false);
    expect(run("two", 2)).toBe(false); // would be true if the streak carried over
    expect(run("three", 3)).toBe(true);
  });

  it("does not grow without bound when runs end mid-streak", () => {
    const c = consecutiveFailures(3);
    for (let i = 0; i < 5000; i += 1) c(ctx({ runId: `r${i}`, step: 1, outcomes: [fail] }));
    // Still correct for a fresh run after thousands of abandoned ones.
    expect(c(ctx({ runId: "fresh", step: 1, outcomes: [fail] }))).toBe(false);
  });
});
