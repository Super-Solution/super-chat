// The app-state seam — the agent reading and operating the HOST APPLICATION,
// not just the transcript.
//
// This is the piece that makes "an agent surface inside your own product"
// literal. Without it an agent can only talk about the product; with it the
// agent sees what the user sees (a form's current values, the selected rows,
// the open document) and can act on it (fill the field, apply the filter,
// navigate) — while the UI stays the source of truth and re-renders normally.
//
// Two halves, both built on machinery that already exists:
//
//   READ  → `createAppStateSource()` is a ContextSource. State enters context
//           the same way memory and retrieval do: budgeted, traced, derived
//           fresh every turn — never accumulated, so a stale snapshot from
//           three turns ago can't contradict the screen.
//   WRITE → `createAppActionTools()` are ordinary ToolDefinitions, which means
//           they inherit the whole security model for free: preset allowlists,
//           `side: "confirm"` suspension, deny-last. An action that mutates a
//           user's document belongs in `executor`, and the framework already
//           knows what that means.
//
// The deliberate non-goal: no diffing, no CRDT, no bidirectional sync
// protocol. The host owns its state and already has a way to render it; this
// reads a snapshot and calls a handler. Anything more would be a state
// manager competing with the one the host already uses.

import { estimateTokens } from "../tokens/estimate.js";
import type { ContextSource } from "../context/types.js";
import type { JSONSchema } from "../providers/types.js";
import type { ToolDefinition, ToolSide } from "../tools/types.js";

export type AppStateBinding<T = unknown> = {
  /** Stable id — also the context layer id and the trace entry name. */
  id: string;
  /**
   * What this state IS, in the model's vocabulary. This is the description the
   * model reasons about, so write it for the model: "the checkout form the
   * user is filling in", not "checkoutFormState".
   */
  description: string;
  /** Read the CURRENT value. Called fresh every turn — never cached. */
  read(): T | Promise<T>;
  /**
   * Serialize for the prompt. Default is pretty JSON; override to summarize a
   * large store down to what the model actually needs.
   */
  serialize?(value: T): string;
  /** Skip injection entirely (a closed dialog's state is noise). */
  when?(value: T): boolean;
};

export type AppAction<I = Record<string, unknown>> = {
  /** Tool name the model calls — verb-shaped: `applyFilter`, `openDocument`. */
  name: string;
  description: string;
  inputSchema: JSONSchema;
  /**
   * Perform it against the host app. The return value is what the model reads
   * back, so return the RESULT ("filter applied, 12 rows match"), not `void` —
   * an action whose outcome the model can't observe is an action it will
   * repeat.
   */
  run(input: I): unknown | Promise<unknown>;
  /**
   * `confirm` suspends the run behind an interactive card before executing —
   * the right default for anything the user would want to see first.
   */
  side?: ToolSide;
};

export type AppStateSourceOptions = {
  id?: string;
  /** Budget-pressure priority. Memory is 500, retrieval 400. */
  priority?: number;
};

const defaultSerialize = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return "[unserializable state]";
  }
};

/**
 * The read half: host application state as a context layer, refreshed every
 * turn. Bindings that throw are skipped rather than failing the turn — a
 * component unmounting mid-run must cost context, not the conversation.
 */
export function createAppStateSource(
  // Bindings are heterogeneous by nature — a form's values and a selection's
  // ids have nothing in common — so the array is typed at the erased boundary
  // and each binding keeps its own type at its definition site.
  bindings: readonly AppStateBinding<any>[],
  opts: AppStateSourceOptions = {},
): ContextSource {
  return {
    id: opts.id ?? "app-state",
    async run() {
      const blocks: string[] = [];
      for (const binding of bindings) {
        try {
          const value = await binding.read();
          if (binding.when && !binding.when(value)) continue;
          const body = (binding.serialize ?? defaultSerialize)(value);
          if (!body?.trim()) continue;
          blocks.push(`### ${binding.id} — ${binding.description}\n${body}`);
        } catch {
          // A binding that throws is a component that went away. Skip it.
        }
      }
      if (!blocks.length) return {};

      const text = [
        "Current state of the application the user is looking at. This is live — it reflects the screen right now, not the conversation:",
        ...blocks,
        "Refer to it directly rather than asking the user to repeat what is already on screen.",
      ].join("\n\n");

      return {
        layers: [
          {
            id: opts.id ?? "app-state",
            kind: "environment",
            text,
            tokens: estimateTokens(text),
            priority: opts.priority ?? 600,
          },
        ],
      };
    },
  };
}

/**
 * The write half: host actions as ordinary tools.
 *
 * Returned, not registered — the host calls `registry.registerAll(...)` with
 * the preset it decides these deserve. That is the same rule MCP imports
 * follow, and for the same reason: a tool that can mutate the user's document
 * must get its authority explicitly, never by virtue of being wired up.
 */
export function createAppActionTools(actions: readonly AppAction<any>[]): ToolDefinition[] {
  return actions.map((action) => ({
    name: action.name,
    description: action.description,
    inputSchema: action.inputSchema,
    side: action.side ?? "write",
    execute: async (input) => {
      const result = await action.run((input ?? {}) as Record<string, unknown>);
      // A bare undefined reads as failure to a model; say it worked.
      return { output: result === undefined ? { ok: true } : result };
    },
  }));
}
