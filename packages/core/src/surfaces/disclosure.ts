// Progressive disclosure, through the seams the framework already has.
//
// The skill index carries one line. `loadSkill` pays for the guide when the model
// decides to build something. The context source keeps surfaces discoverable after
// compaction has trimmed the calls that created them.

import type { ContextSource } from "../context/types.js";
import type { Skill } from "../skills/types.js";
import { estimateTokens } from "../tokens/estimate.js";
import type { SurfaceCatalogue } from "./catalogue.js";
import { foldSurfaces } from "./ledger.js";
import { SURFACE_GUIDE } from "./tools.js";

export const SURFACE_SKILL_ID = "surface-authoring";

/** A `manual` skill: one line in the index until the model loads it. */
export function createSurfaceSkill(catalogue: SurfaceCatalogue): Skill {
  return {
    id: SURFACE_SKILL_ID,
    name: "Building interfaces",
    description: "How to assemble an interactive surface from components, bindings and actions.",
    mode: "manual",
    aliases: ["surface", "interface", "dashboard", "filter", "form"],
    tools: ["createSurface", "updateSurface", "deleteSurface", "readSurface", "describeSurfaceComponents"],
    body: () => [SURFACE_GUIDE, "", "Components:", catalogue.index()].join("\n"),
  };
}

/**
 * One line per surface on the active path. Data stays out: the model asks for it
 * with `readSurface` when it needs it, so an idle dashboard costs a line a turn.
 */
export function createSurfaceContextSource(): ContextSource {
  return {
    id: "surfaces",
    run({ messages }) {
      const live = Object.values(foldSurfaces(messages)).filter((s) => !s.deleted && !s.expired);
      if (!live.length) return {};
      const text = [
        "Surfaces on screen. Call readSurface for their current state before relying on it:",
        ...live.map((s) => `- ${s.surfaceId}${s.title ? ` (${s.title})` : ""}, revision ${s.revision}`),
      ].join("\n");
      return { layers: [{ id: "surfaces", kind: "custom", text, tokens: estimateTokens(text), priority: 400 }] };
    },
  };
}
