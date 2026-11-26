// Stop conditions.
//
// `maxSteps` alone is a blunt instrument: it either cuts a task short or lets a
// looping agent burn eight steps re-reading the same file. These are the
// composable predicates that let a host say what "done" actually means for its
// domain.

import type { FinishReason, Usage } from "../content/types.js";
import { USER_DECLINED, type ToolCallOutcome } from "./execute-tools.js";

export type StopContext = {
  step: number;
  finishReason: FinishReason;
  outcomes: readonly ToolCallOutcome[];
  usage: Usage;
};

export type StopCondition = (ctx: StopContext) => boolean;

export const stepCountIs = (n: number): StopCondition => (ctx) => ctx.step >= n;

/** Stop as soon as a specific tool has run — the "one action then report" shape. */
export const afterTool = (...names: string[]): StopCondition => (ctx) =>
  ctx.outcomes.some((o) => names.includes(o.name) && !o.failure);

/** Stop when the model produced prose with no tool calls. The natural end. */
export const noToolCalls: StopCondition = (ctx) => ctx.finishReason !== "tool-calls" && ctx.outcomes.length === 0;

export const tokenBudgetExceeded = (maxTotal: number): StopCondition => (ctx) =>
  (ctx.usage.totalTokens ?? (ctx.usage.inputTokens ?? 0) + (ctx.usage.outputTokens ?? 0)) >= maxTotal;

/**
 * Stop after `n` consecutive failing steps.
 *
 * The failure mode this catches: a tool that errors identically every time
 * (bad credential, missing config). The model will happily retry it until the
 * step cap, producing nothing but latency and spend.
 */
export const consecutiveFailures = (n: number): StopCondition => {
  let streak = 0;
  return (ctx) => {
    const allFailed = ctx.outcomes.length > 0 && ctx.outcomes.every((o) => o.failure);
    streak = allFailed ? streak + 1 : 0;
    return streak >= n;
  };
};

/**
 * Whether an outcome is the person saying no, as opposed to a tool failing or a
 * host that cannot ask. Three shapes carry it:
 *
 *  - an approval the runtime asked for (`side: "confirm"`): `failure: "denied"`
 *    and the error is `USER_DECLINED`;
 *  - a tool that asks for itself (`confirmation: "tool"`) and returns the
 *    answer it was given: `{ cancelled: true }`;
 *  - an interactive card from `visualize`: `{ response: { cancelled: true } }`.
 */
export function isUserDecline(outcome: ToolCallOutcome): boolean {
  const output = outcome.output;
  if (typeof output !== "object" || output === null) return false;
  const o = output as { error?: unknown; cancelled?: unknown; response?: unknown };
  if (outcome.failure === "denied" && o.error === USER_DECLINED) return true;
  if (o.cancelled === true) return true;
  return typeof o.response === "object" && o.response !== null && (o.response as { cancelled?: unknown }).cancelled === true;
}

/**
 * Stop the run as soon as the person has declined something.
 *
 * Opt-in. By default a decline is only a result the model reads ("The user
 * declined."): the run goes on, and the model decides what to do, usually to say
 * what was left undone and ask. Use this when your product treats a "no" as the
 * end of the turn. It is not in `DEFAULT_STOP_CONDITIONS`.
 */
export const userDeclined: StopCondition = (ctx) => ctx.outcomes.some(isUserDecline);

export function shouldStop(conditions: readonly StopCondition[] | undefined, ctx: StopContext): boolean {
  if (!conditions?.length) return false;
  return conditions.some((c) => c(ctx));
}

/**
 * A sane default set for an interactive chat agent. A person's "no" is not here:
 * it is told to the model and the run continues (see `userDeclined`).
 */
export const DEFAULT_STOP_CONDITIONS: StopCondition[] = [/* @__PURE__ */ consecutiveFailures(3)];
