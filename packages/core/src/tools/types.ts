// Tool definitions and capability presets.
//
// Presets are EXPLICIT ALLOWLISTS, not blocklists. A newly registered tool is
// invisible until someone puts it in a preset. The inverse (everything exposed
// unless denied) means the day you add `deleteEverything` it is already live on
// every API key you ever minted.
//
// Three preset tiers cover most agent products, and they map to genuinely
// different trust levels rather than arbitrary groupings:
//   observer — pure reads. Safe to hand to anyone.
//   draft    — produces something the USER must approve/sign. No side effects.
//   executor — acts on the user's behalf. Needs explicit, scoped authorization.
// Hosts can define their own tiers; these are just the defaults.

import type { JSONSchema } from "../providers/types.js";
import type { Card, CardSpec } from "../cards/types.js";

export type ToolSide = "read" | "write" | "confirm";

/**
 * A truthful preview of the output geometry while a tool is still running.
 *
 * This is host-only metadata: providers never see it. A function is useful for
 * tools such as image generation where count and aspect ratio come from the
 * call input rather than from the tool definition alone.
 */
export type ToolLoadingHint = {
  kind: "media" | "chart" | "table" | "document" | "generic";
  label: string;
  count?: number;
  /** CSS-compatible ratio, for example `1024 / 1536`. */
  aspectRatio?: string;
};

export type ToolLoading = ToolLoadingHint | ((input: unknown) => ToolLoadingHint | undefined);

export type ToolExecutionContext = {
  /** Host-supplied per-run values: user id, session, network, locale. */
  vars: Record<string, unknown>;
  signal?: AbortSignal;
  /** The tool call's id, for correlating a card back to it. */
  callId: string;
  /** Emit a card mid-execution (progress updates on a long tool). */
  emitCard?: (spec: CardSpec) => void;
  /** Ask the user something and await the answer. Powers `side: "confirm"`. */
  requestCard?: (spec: CardSpec) => Promise<unknown>;
};

export type ToolResultExtras = {
  /**
   * Update an EXISTING card instead of minting a new one: the runtime reuses
   * this id, and the reducer's upsert replaces the old card in place.
   */
  cardId?: string;
  /**
   * Tool names this result unlocks for the REST of the run (`loadSkill`'s pull
   * half). The runtime re-resolves the active set and re-declares specs to the
   * provider from the next step on.
   */
  unlockTools?: string[];
};

export type ToolResult = ToolResultExtras & {
  /** What the model sees. Keep it small — this is re-sent every subsequent step. */
  output: unknown;
  /** What the user sees. Not sent to the model. */
  card?: CardSpec;
  failure?: "execution-error" | "denied" | "invalid-input" | "timeout" | "not-found";
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  /**
   * Absent `execute` means the HOST runs this tool (browser-side: read the DOM,
   * open a wallet, use a local file). The runtime emits a `tool-call` event and
   * suspends until the host supplies a result.
   */
  execute?: (input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult | unknown> | ToolResult | unknown;
  /**
   * `confirm` suspends the run and shows an approval card before executing.
   * The distinction from `write` is intent: `write` acts, `confirm` asks first.
   */
  side?: ToolSide;
  /** Ask the provider to enforce the schema (OpenAI strict mode). */
  strict?: boolean;
  /** Default card renderer key when the result carries no explicit card. */
  render?: string;
  /** Rough token cost of a typical result, for budgeting. */
  costHint?: number;
  /** Live-only output placeholder. Omit when the result's shape is unknown. */
  loading?: ToolLoading;
  /**
   * For a tool whose ARGUMENTS are a card (`visualize` is the built-in one):
   * a preview of that card from arguments that are still streaming. Called
   * with each tolerant parse of the partial JSON; return `undefined` until
   * there is something worth drawing. Route it through
   * `CardRegistry.partial` so interactive kinds and specs that fail
   * validation never preview. Live-only — the validated card from `execute`
   * replaces it, and it is never written to history.
   *
   * A tool whose card is computed BY `execute` has nothing to preview here:
   * the arguments are a query, not the answer.
   */
  partialCard?: (partialInput: unknown) => CardSpec | undefined;
};

/** Resolve a tool's streaming card preview; a throwing hook means "no preview", never a failed call. */
export function resolvePartialCard(tool: ToolDefinition | undefined, partialInput: unknown): CardSpec | undefined {
  if (!tool?.partialCard) return undefined;
  try {
    return tool.partialCard(partialInput);
  } catch {
    return undefined;
  }
}

/** Resolve a static or input-derived loading hint without leaking a function into run events. */
export function resolveToolLoading(loading: ToolLoading | undefined, input: unknown): ToolLoadingHint | undefined {
  try {
    return typeof loading === "function" ? loading(input) : loading;
  } catch {
    // Presentation metadata must never be able to fail the tool call itself.
    return undefined;
  }
}

export type PresetName = string;

export type ToolResolution = {
  /** Preset names enabled for this run. */
  presets: readonly PresetName[];
  /** Extra tools unlocked beyond the presets (skills unlock their own tools). */
  allow?: readonly string[];
  /** Removed even if a preset grants them. Applied last. */
  deny?: readonly string[];
};

export const DEFAULT_PRESETS = ["observer", "draft", "executor"] as const;
