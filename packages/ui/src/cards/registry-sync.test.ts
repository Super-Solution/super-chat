import { describe, expect, it } from "vitest";
import { BUILTIN_CARDS } from "@super-solution/super-chat-core";
import { BUILTIN_RENDERERS } from "./index.js";

describe("card registry / renderer sync", () => {
  // This is the guardrail. The reference implementation this design reacts to
  // kept parsers and render branches in two hand-maintained lists, and a card
  // that had one but not the other silently degraded to a "ran ✓" chip in
  // production. Here that drift fails the build instead.
  it("has a renderer for every registered card kind", () => {
    const defined = BUILTIN_CARDS.map((c) => c.kind).sort();
    const rendered = Object.keys(BUILTIN_RENDERERS).sort();
    expect(rendered).toEqual(defined);
  });

  it("has no renderer for a kind nothing validates", () => {
    const defined = new Set(BUILTIN_CARDS.map((c) => c.kind));
    for (const kind of Object.keys(BUILTIN_RENDERERS)) {
      expect(defined.has(kind), `renderer "${kind}" has no card definition`).toBe(true);
    }
  });
});
