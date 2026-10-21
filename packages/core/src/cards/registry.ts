// The card registry.
//
// One registration binds four things that MUST NOT drift apart:
//   schema     — what the model is told it may send
//   validate   — what we actually accept (and the error we hand back)
//   interactive— whether this card participates in control flow
//   renderer   — resolved by the UI package from the same `kind` key
//
// The reference implementation this is modelled on keeps parsers and render
// branches in two hand-maintained lists, and its own comments record the
// consequence: a card that had a parser but no render branch disappeared into a
// generic "ran ✓" chip and nobody noticed. Binding them at registration makes
// that failure unrepresentable — `renderers` is derived from the same map, so a
// kind is either fully present or absent.

import type { Card, CardSpec } from "./types.js";
import type { JSONSchema } from "../providers/types.js";

export type CardValidation = { ok: true } | { ok: false; error: string; expected?: string };

export type CardKindDefinition = {
  kind: string;
  /** One line for the `visualize` tool description — this is what steers model choice. */
  summary: string;
  schema: JSONSchema;
  validate: (spec: unknown) => CardValidation;
  /** Interactive cards must render at top level and never collapse. */
  interactive?: boolean;
  /** Approximate token cost of the spec, for context budgeting of replayed cards. */
  estimateTokens?: (spec: CardSpec) => number;
  /**
   * Derive a renderable spec from one that is still streaming in — keep what
   * has fully arrived, drop the entry still being written when the renderer
   * cannot show it yet. Return `undefined` until there is something worth
   * drawing. The result must pass `validate`: `CardRegistry.partial` checks
   * it, so a preview is a VALID card that is merely incomplete, never a
   * malformed one.
   *
   * Omit for kinds that should keep a skeleton until they are whole. Ignored
   * on interactive kinds: a control the user can act on must never be shown
   * before the spec behind it is complete and validated.
   */
  partial?: (spec: Record<string, unknown>) => CardSpec | undefined;
};

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Small validator helpers — enough to give the model an actionable correction. */
export const check = {
  object(spec: unknown, kind: string): CardValidation | Record<string, unknown> {
    if (!isObj(spec)) return { ok: false as const, error: `${kind} spec must be an object.` };
    return spec;
  },
  arrayField(spec: Record<string, unknown>, field: string, kind: string, minLength = 1): CardValidation | unknown[] {
    const value = spec[field];
    if (!Array.isArray(value)) {
      return { ok: false as const, error: `${kind}.${field} must be an array.`, expected: `${field}: [...]` };
    }
    if (value.length < minLength) {
      return { ok: false as const, error: `${kind}.${field} must have at least ${minLength} item(s).` };
    }
    return value;
  },
};

export const failed = (v: unknown): v is CardValidation => isObj(v) && "ok" in v && (v as { ok: unknown }).ok === false;

export class CardRegistry {
  private kinds = new Map<string, CardKindDefinition>();

  constructor(definitions: readonly CardKindDefinition[] = []) {
    for (const d of definitions) this.register(d);
  }

  register(def: CardKindDefinition): this {
    this.kinds.set(def.kind, def);
    return this;
  }

  has(kind: string): boolean {
    return this.kinds.has(kind);
  }

  get(kind: string): CardKindDefinition | undefined {
    return this.kinds.get(kind);
  }

  list(): CardKindDefinition[] {
    return [...this.kinds.values()];
  }

  isInteractive(kind: string): boolean {
    return this.kinds.get(kind)?.interactive === true;
  }

  /**
   * Validate a spec. An unknown kind is a hard failure with the list of valid
   * kinds attached — a model that receives "unknown kind: barchart, valid kinds
   * are: chart, table, …" fixes itself on the next step, whereas one that
   * receives a silently-dropped card repeats the mistake forever.
   */
  validate(spec: unknown): CardValidation {
    if (!isObj(spec)) return { ok: false, error: "Card spec must be an object with a `kind` field." };
    const kind = spec["kind"];
    if (typeof kind !== "string") return { ok: false, error: "Card spec is missing a string `kind`." };
    const def = this.kinds.get(kind);
    if (!def) {
      return {
        ok: false,
        error: `Unknown card kind "${kind}".`,
        expected: `One of: ${this.list().map((k) => k.kind).join(", ")}`,
      };
    }
    return def.validate(spec);
  }

  /**
   * A preview of a spec that is still streaming, or `undefined` when there
   * should not be one: an unknown kind, an interactive kind, a kind with no
   * `partial`, or a derived spec its own validator rejects. The one place that
   * decides whether a partial spec may reach a renderer.
   */
  partial(spec: unknown): CardSpec | undefined {
    if (!isObj(spec) || typeof spec["kind"] !== "string") return undefined;
    const def = this.kinds.get(spec["kind"]);
    if (!def?.partial || def.interactive) return undefined;
    let preview: CardSpec | undefined;
    try {
      preview = def.partial(spec);
    } catch {
      return undefined; // a preview must never be able to fail the call it previews
    }
    if (!isObj(preview) || preview["kind"] !== def.kind) return undefined;
    return def.validate(preview).ok ? preview : undefined;
  }

  /** The catalogue text embedded in the `visualize` tool description. */
  describe(): string {
    return this.list()
      .map((k) => `- ${k.kind}${k.interactive ? " (interactive)" : ""}: ${k.summary}`)
      .join("\n");
  }

  /** Per-kind schemas, for hosts that prefer one tool per card kind. */
  schemas(): Record<string, JSONSchema> {
    return Object.fromEntries(this.list().map((k) => [k.kind, k.schema]));
  }
}

let cardCounter = 0;
export function makeCard(spec: CardSpec, callId?: string, id?: string): Card {
  // An explicit id means "replace that card": the reducer upserts by id, so
  // reusing one turns an append into an in-place update (`updateCard`).
  if (id) return { id, spec, ...(callId ? { callId } : {}) };
  cardCounter += 1;
  return { id: `card_${Date.now().toString(36)}${cardCounter.toString(36)}`, spec, ...(callId ? { callId } : {}) };
}
