// Built-in tools: the agent's own capabilities, as opposed to the host's domain
// tools.
//
// `visualize` is the important one. Without it an agent can only show what some
// engineer pre-built a card for; with it the agent CHOOSES a presentation for
// whatever it is holding — a comparison becomes a table, a trend becomes a
// chart, an ambiguous match becomes a choice card instead of a guess. That is
// the difference between an agent that talks about data and one that shows it.

import { CardRegistry, isObj } from "../cards/registry.js";
import type { CardSpec } from "../cards/types.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { ToolDefinition } from "./types.js";

export type VisualizeToolOptions = {
  cards: CardRegistry;
  /** Restrict which kinds the agent may emit (a read-only chat may want no `confirm`). */
  kinds?: string[];
};

/**
 * The generic visualization tool.
 *
 * The description carries the whole catalogue because model card-choice quality
 * tracks how well the options are described far more than it tracks schema
 * strictness — and a `oneOf` union across 13 shapes both bloats the request and
 * degrades tool-call accuracy on most models. We take a loose schema plus a
 * precise description, then validate and hand back a correction the model can
 * act on.
 */
export function createVisualizeTool(opts: VisualizeToolOptions): ToolDefinition {
  const { cards } = opts;
  const available = opts.kinds ? cards.list().filter((k) => opts.kinds!.includes(k.kind)) : cards.list();
  const catalogue = available
    .map((k) => `- ${k.kind}${k.interactive ? " (interactive — the user replies)" : ""}: ${k.summary}`)
    .join("\n");

  return {
    name: "visualize",
    side: "read",
    description: [
      "Render a visual card for the user. Use this whenever a result is easier to SEE than to read:",
      "comparisons, trends, sequences, multi-field records, long operations, or a decision the user must make.",
      "",
      "Available kinds:",
      catalogue,
      "",
      "Rules:",
      "- Put the data IN the card. Do not also repeat every row in your prose — say what it means instead.",
      "- Interactive kinds (choice, form, confirm) pause for the user's answer, which is returned to you as this tool's result. Use them instead of guessing.",
      "- Use `confirm` before anything consequential or irreversible.",
      "- One card per distinct idea. Do not wrap a one-line answer in a card.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      required: ["kind", "spec"],
      properties: {
        kind: { type: "string", enum: available.map((k) => k.kind), description: "Which card to render." },
        spec: {
          type: "object",
          description: "The card body. Must match the schema for `kind`, and must include `kind` itself.",
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
    loading: (input) => {
      const { kind, spec } = (input ?? {}) as { kind?: string; spec?: Record<string, unknown> };
      if (!kind || cards.get(kind)?.interactive) return undefined;
      const outputKind = kind === "media"
        ? "media"
        : ["chart", "funnel", "gauge"].includes(kind)
          ? "chart"
          : ["table", "comparison"].includes(kind)
            ? "table"
            : ["document", "markdown", "code", "diff", "email"].includes(kind)
              ? "document"
              : "generic";
      const mediaItems = kind === "media" && Array.isArray(spec?.["items"])
        ? spec["items"] as Record<string, unknown>[]
        : [];
      const first = mediaItems[0];
      const width = typeof first?.["width"] === "number" ? first["width"] : undefined;
      const height = typeof first?.["height"] === "number" ? first["height"] : undefined;
      return {
        kind: outputKind,
        label: `Preparing ${kind} card`,
        ...(mediaItems.length ? { count: mediaItems.length } : {}),
        ...(width && height ? { aspectRatio: `${width} / ${height}` } : {}),
      };
    },
    // The card IS this tool's arguments, so it can be drawn while they stream.
    // `cards.partial` refuses interactive kinds and anything its own validator
    // rejects; `execute` below stays the only path to a real card.
    partialCard: (input) => {
      const { kind, spec } = (input ?? {}) as { kind?: unknown; spec?: unknown };
      if (typeof kind !== "string" || !isObj(spec)) return undefined;
      if (opts.kinds && !opts.kinds.includes(kind)) return undefined;
      return cards.partial({ ...spec, kind });
    },
    async execute(input, ctx) {
      const { kind, spec } = (input ?? {}) as { kind?: string; spec?: Record<string, unknown> };
      if (!kind) return { output: { ok: false, error: "`kind` is required." }, failure: "invalid-input" as const };

      // Models routinely omit `kind` inside `spec` since they already passed it
      // at the top level. Filling it in is unambiguous, so do it rather than
      // bouncing the call.
      const full = { ...(spec ?? {}), kind } as CardSpec;

      const verdict = cards.validate(full);
      if (!verdict.ok) {
        return {
          // Returned as data, not thrown: the model reads the correction and
          // retries with a valid spec on the next step.
          output: { ok: false, error: verdict.error, ...(verdict.expected ? { expected: verdict.expected } : {}) },
          failure: "invalid-input" as const,
        };
      }

      const def = cards.get(kind);
      if (def?.interactive && ctx.requestCard) {
        // Suspend for the user's answer. The runtime resolves this when the UI
        // reports a CardAction.
        //
        // No `card` in the result: requestCard already surfaced this card and
        // the user has answered it on screen. Returning it again mints a second
        // card with a new id, and the thread renders the same question twice.
        const answer = await ctx.requestCard(full);
        return { output: { ok: true, kind, response: answer } };
      }

      return { output: { ok: true, kind, rendered: true }, card: full };
    },
  };
}

/**
 * `loadSkill` — the pull half of progressive disclosure.
 *
 * Paired with `SkillRegistry.manualIndex()` in the system prompt: the model sees
 * a one-line menu every turn and pays for a skill's body only when it decides it
 * needs one.
 */
export function createLoadSkillTool(skills: SkillRegistry): ToolDefinition {
  return {
    name: "loadSkill",
    side: "read",
    description:
      "Load a skill's full instructions before acting in its area. Skill ids are listed in your instructions. " +
      "Loading a skill may also unlock tools specific to it.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "The skill id to load." },
        topic: { type: "string", description: "Optional sub-topic, to load only the relevant section." },
      },
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const { id, topic } = (input ?? {}) as { id?: string; topic?: string };
      if (!id) return { output: { ok: false, error: "`id` is required." }, failure: "invalid-input" as const };

      const loaded = await skills.load(id, { query: topic ?? "", vars: ctx.vars });
      if (!loaded.found) return { output: { ok: false, error: loaded.text }, failure: "not-found" as const };

      return {
        output: {
          ok: true,
          id,
          instructions: loaded.text,
          ...(loaded.tools.length ? { unlockedTools: loaded.tools } : {}),
        },
        // The runtime half of the promise: re-resolve the active set so the
        // names announced in `unlockedTools` are actually callable next step.
        ...(loaded.tools.length ? { unlockTools: loaded.tools } : {}),
      };
    },
  };
}

/**
 * `updateCard` — let the agent revise a card it already emitted.
 *
 * Without this, a long-running operation can only append new progress cards, and
 * the thread fills with near-identical snapshots.
 */
export function createUpdateCardTool(cards: CardRegistry): ToolDefinition {
  return {
    name: "updateCard",
    side: "read",
    description:
      "Replace a card you previously rendered, by its id. Use for progress updates instead of emitting a new card each time.",
    inputSchema: {
      type: "object",
      required: ["cardId", "spec"],
      properties: {
        cardId: { type: "string" },
        spec: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
    execute(input) {
      const { cardId, spec } = (input ?? {}) as { cardId?: string; spec?: Record<string, unknown> };
      if (!cardId || !spec) {
        return { output: { ok: false, error: "`cardId` and `spec` are required." }, failure: "invalid-input" as const };
      }
      const verdict = cards.validate(spec);
      if (!verdict.ok) {
        return { output: { ok: false, error: verdict.error, expected: verdict.expected }, failure: "invalid-input" as const };
      }
      // `cardId` makes the runtime REUSE the id, so the reducer's upsert
      // replaces the original card instead of appending a near-identical twin.
      return { output: { ok: true, cardId }, card: spec as CardSpec, cardId };
    },
  };
}

/** The default built-in set, wired to the given registries. */
export function createBuiltinTools(opts: { cards: CardRegistry; skills?: SkillRegistry }): ToolDefinition[] {
  const tools = [createVisualizeTool({ cards: opts.cards }), createUpdateCardTool(opts.cards)];
  if (opts.skills && opts.skills.list().some((s) => s.mode === "manual")) {
    tools.push(createLoadSkillTool(opts.skills));
  }
  return tools;
}
