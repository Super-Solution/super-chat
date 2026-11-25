import { describe, expect, it } from "vitest";
import { USER_DECLINED, type ToolCallOutcome } from "./execute-tools.js";
import { DEFAULT_STOP_CONDITIONS, consecutiveFailures, isUserDecline, shouldStop, userDeclined, type StopContext } from "./stop.js";

const outcome = (over: Partial<ToolCallOutcome>): ToolCallOutcome => ({ callId: "c1", name: "t", output: {}, ms: 0, ...over });
const ctx = (...outcomes: ToolCallOutcome[]): StopContext => ({ step: 1, finishReason: "tool-calls", outcomes, usage: {} });

describe("userDeclined", () => {
  it("fires on the three shapes a person's no takes", () => {
    for (const declined of [
      outcome({ output: { error: USER_DECLINED }, failure: "denied" }), // runtime approval
      outcome({ output: { cancelled: true, reason: USER_DECLINED } }), // a tool that asks for itself
      outcome({ output: { ok: true, kind: "confirm", response: { cancelled: true } } }), // an interactive card
    ]) {
      expect(isUserDecline(declined)).toBe(true);
      expect(userDeclined(ctx(declined))).toBe(true);
    }
  });

  it("does not fire on a host that cannot ask, a failing tool or a plain result", () => {
    for (const other of [
      outcome({ output: { error: `"send" needs the user's approval and this host cannot ask for it.` }, failure: "denied" }),
      outcome({ output: { error: USER_DECLINED } }), // not a denial: someone else's tool wrote this text
      outcome({ output: { error: "boom" }, failure: "execution-error" }),
      outcome({ output: "text" }),
      outcome({ output: null }),
      outcome({ output: { response: { cancelled: false } } }),
    ]) {
      expect(isUserDecline(other)).toBe(false);
    }
  });

  it("is not a default: a decline is told to the model and the run continues", () => {
    const declined = outcome({ output: { error: USER_DECLINED }, failure: "denied" });
    expect(shouldStop(DEFAULT_STOP_CONDITIONS, ctx(declined))).toBe(false);
    expect(shouldStop([userDeclined], ctx(declined))).toBe(true);
  });

  it("leaves the defaults to what they were for: a tool that fails the same way again and again", () => {
    const failing = ctx(outcome({ failure: "execution-error" }));
    const stop = consecutiveFailures(3);
    expect([stop(failing), stop(failing), stop(failing)]).toEqual([false, false, true]);
    expect(DEFAULT_STOP_CONDITIONS).toHaveLength(1);
  });
});
