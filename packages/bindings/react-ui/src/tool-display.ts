// What a tool call says about itself on its row, from the tool's own `display`.
//
// The functions belong to the tool's author and run on whatever the model sent and the tool
// returned, so each result is held to being a short plain string, and a function that throws or
// answers with something else is as if it were absent: the row falls back to the tool's name.

import type { ToolDefinition } from "@supersolutions/super-chat-core";

/** A row is one line; past this a label is a paragraph. */
const MAX = 140;

const clean = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
};

const attempt = (fn: (() => unknown) | undefined): string | undefined => {
  if (!fn) return undefined;
  try {
    return clean(fn());
  } catch {
    return undefined;
  }
};

export function describeCall(
  tool: Pick<ToolDefinition, "display"> | undefined,
  input: unknown,
  output: unknown,
  finished: boolean,
): { label?: string; summary?: string } {
  const display = tool?.display;
  if (!display) return {};
  return {
    label: attempt(display.label && (() => display.label!(input))),
    summary: finished ? attempt(display.summary && (() => display.summary!(output))) : undefined,
  };
}
