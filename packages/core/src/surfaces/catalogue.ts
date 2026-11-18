// The catalogue: everything a surface may be built from, in one place.
//
// Three sources, one lookup: the built-in primitives, every kind in the card
// registry (read live, so a plugin installed after startup is available
// immediately), and components a host registers with its own renderer.
//
// The index is one line per component and the schemas are fetched on request.
// That split is the progressive disclosure: forty schemas in every prompt would
// cost more than most of the surfaces they describe.

import type { CardRegistry } from "../cards/registry.js";
import type { JSONSchema } from "../providers/types.js";
import { ACTION_SCHEMA, SURFACE_PRIMITIVES } from "./primitives.js";
import { SURFACE_CARD_KIND } from "./types.js";

export type SurfaceComponentCategory = "layout" | "display" | "input" | "action" | "card" | "custom";

export type SurfaceComponentDefinition = {
  name: string;
  category: SurfaceComponentCategory;
  /** One line for the index. Keep domain nouns out of it: this steers the model. */
  summary: string;
  /** Schema for the component's props, excluding `id`, `component` and `visibleWhen`. */
  props: JSONSchema;
  /** Ids of the components this one renders. */
  slots?: (props: Record<string, unknown>) => string[];
  /** The subset of `slots` rendered once per row, where `$item` is in scope. */
  templateSlots?: (props: Record<string, unknown>) => string[];
};

/** The prefix that addresses one card kind in the index, as in `Card:chart`. */
export const CARD_ENTRY_PREFIX = "Card:";

export const CARD_COMPONENT: SurfaceComponentDefinition = {
  name: "Card",
  category: "card",
  summary: "Embed any card kind. `spec` may contain bindings.",
  props: {
    type: "object",
    required: ["kind", "spec"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", description: "A registered card kind.", "x-static": true },
      spec: { type: "object", description: "The card body, without `kind`.", "x-static": true },
      bind: { type: "string", description: "Interactive kinds only: JSON Pointer that stores the answer.", "x-static": true },
      action: ACTION_SCHEMA,
    },
  },
};

export type SurfaceCatalogueOptions = {
  cards?: CardRegistry;
  /** Host components. Each needs a renderer under the same name in the UI layer. */
  components?: readonly SurfaceComponentDefinition[];
};

export class SurfaceCatalogue {
  readonly cards: CardRegistry | undefined;
  private readonly definitions = new Map<string, SurfaceComponentDefinition>();

  constructor(options: SurfaceCatalogueOptions = {}) {
    this.cards = options.cards;
    for (const def of SURFACE_PRIMITIVES) this.definitions.set(def.name, def);
    this.definitions.set(CARD_COMPONENT.name, CARD_COMPONENT);
    for (const def of options.components ?? []) this.register(def);
  }

  /** Add a host component. A built-in name cannot be replaced: its meaning is part of the format. */
  register(def: SurfaceComponentDefinition): this {
    const existing = this.definitions.get(def.name);
    if (existing && existing.category !== "custom") throw new Error(`Surface component "${def.name}" is built in and cannot be replaced.`);
    if (def.name.startsWith(CARD_ENTRY_PREFIX)) throw new Error(`Surface component names cannot start with "${CARD_ENTRY_PREFIX}".`);
    this.definitions.set(def.name, { ...def, category: "custom" });
    return this;
  }

  get(name: string): SurfaceComponentDefinition | undefined {
    return this.definitions.get(name);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  /** Card kinds usable inside a surface. A surface cannot contain a surface. */
  cardKinds() {
    return (this.cards?.list() ?? []).filter((k) => k.kind !== SURFACE_CARD_KIND);
  }

  /** Every addressable entry: components by name, cards as `Card:<kind>`. */
  names(): string[] {
    return [...this.definitions.keys(), ...this.cardKinds().map((k) => `${CARD_ENTRY_PREFIX}${k.kind}`)];
  }

  /** One line per entry. Cheap enough to hand over whenever the model asks what exists. */
  index(): string {
    const lines = [...this.definitions.values()].map((d) => `- ${d.name} (${d.category}): ${d.summary}`);
    for (const k of this.cardKinds()) {
      lines.push(`- ${CARD_ENTRY_PREFIX}${k.kind}${k.interactive ? " (interactive, needs `bind`)" : ""}: ${k.summary}`);
    }
    return lines.join("\n");
  }

  /** The full schema of one entry, or `undefined` for a name that does not exist. */
  schemaOf(name: string): { name: string; summary: string; props: JSONSchema; interactive?: boolean } | undefined {
    if (name.startsWith(CARD_ENTRY_PREFIX)) {
      const kind = name.slice(CARD_ENTRY_PREFIX.length);
      const def = this.cardKinds().find((k) => k.kind === kind);
      if (!def) return undefined;
      return { name, summary: def.summary, props: def.schema, ...(def.interactive ? { interactive: true } : {}) };
    }
    const def = this.definitions.get(name);
    return def ? { name: def.name, summary: def.summary, props: def.props } : undefined;
  }
}
