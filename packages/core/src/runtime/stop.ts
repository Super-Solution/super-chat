// Stop conditions.
//
// `maxSteps` alone is a blunt instrument: it either cuts a task short or lets a
// looping agent burn eight steps re-reading the same file. These are the
// composable predicates that let a host say what "done" actually means for its
// domain.

import type { FinishReason, Usage } from "../content/types.js";
import type { ToolCallOutcome } from "./execute-tools.js";

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

/** Stop when the user declined an interactive card — proceeding would ignore them. */
export const userDeclined: StopCondition = (ctx) =>
  ctx.outcomes.some(
    (o) => typeof o.output === "object" && o.output !== null && (o.output as { cancelled?: boolean }).cancelled === true,
  );

export function shouldStop(conditions: readonly StopCondition[] | undefined, ctx: StopContext): boolean {
  if (!conditions?.length) return false;
  return conditions.some((c) => c(ctx));
}

/** A sane default set for an interactive chat agent. */
export const DEFAULT_STOP_CONDITIONS: StopCondition[] = [consecutiveFailures(3), userDeclined];
