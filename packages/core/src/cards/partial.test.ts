// Previews of cards whose spec is still streaming: which kinds get one, and
// that every preview is a VALID card — never a malformed one, never a question.

import { describe, expect, it } from "vitest";
import { BUILTIN_CARDS } from "./builtin.js";
import { CardRegistry, type CardKindDefinition } from "./registry.js";
import { createVisualizeTool } from "../tools/builtin.js";
import { parsePartialJson } from "../tools/partial-json.js";
import { resolvePartialCard } from "../tools/types.js";

const cards = new CardRegistry(BUILTIN_CARDS);

/** Every snapshot a stream of `value` would produce, one character at a time. */
function prefixes(value: unknown): unknown[] {
  const text = JSON.stringify(value);
  const out: unknown[] = [];
  for (let i = 1; i <= text.length; i += 1) {
    const { value: partial } = parsePartialJson(text.slice(0, i));
    if (partial !== undefined) out.push(partial);
  }
  return out;
}

const FULL: Record<string, Record<string, unknown>> = {
  table: {
    kind: "table",
    title: "Vendors",
    columns: [
      { key: "name", label: "Name" },
      { key: "cost", label: "Cost", format: "currency" },
    ],
    rows: [
      { name: "Halcyon", cost: 48200 },
      { name: "Brightline", cost: 52900 },
      { name: "Tessellate", cost: 39800 },
    ],
    sortBy: "cost",
  },
  stats: { kind: "stats", items: [{ label: "Open", value: 12 }, { label: "Closed", value: "40%" }] },
  checklist: {
    kind: "checklist",
    items: [
      { label: "Data map", status: "done" },
      { label: "DPA signed", status: "blocked", detail: "Two vendors" },
    ],
  },
  timeline: { kind: "timeline", events: [{ at: "Hour 0", label: "Read" }, { at: "Day 1", label: "Decide" }] },
  markdown: { kind: "markdown", title: "Notes", body: "# Heading\n\nSome **bold** text.\n\n- one\n- two" },
};

const INTERACTIVE: Record<string, Record<string, unknown>> = {
  confirm: { kind: "confirm", title: "Delete three files?", summary: [{ label: "Files", value: "3" }] },
  choice: { kind: "choice", prompt: "Which one?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
  form: { kind: "form", title: "Details", fields: [{ name: "email", type: "text" }] },
  editreview: {
    kind: "editreview",
    docId: "doc_1",
    revision: 1,
    hunks: [{ index: 0, block: 0, removed: ["a"], added: ["b"] }],
  },
};

describe("CardRegistry.partial", () => {
  for (const [kind, spec] of Object.entries(FULL)) {
    it(`previews a streaming ${kind} — and every preview passes the ${kind} validator`, () => {
      const previews = prefixes(spec).map((p) => cards.partial(p)).filter(Boolean);
      expect(previews.length).toBeGreaterThan(3);
      for (const preview of previews) expect(cards.validate(preview)).toEqual({ ok: true });
    });
  }

  it("fills a table row by row, holding each unfinished number back", () => {
    const counts = prefixes(FULL["table"]).map((p) => (cards.partial(p) as { rows?: unknown[] } | undefined)?.rows?.length ?? -1);
    // No preview until a column has both its key and label.
    expect(counts[0]).toBe(-1);
    // Then 0, 1, 2, 3 rows in order — never shrinking.
    expect([...new Set(counts.filter((c) => c >= 0))]).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    // A cost never shows as a shorter number on its way to the real one.
    for (const p of prefixes(FULL["table"])) {
      const rows = (cards.partial(p) as { rows?: { cost?: number }[] } | undefined)?.rows ?? [];
      for (const r of rows) if (r.cost !== undefined) expect([48200, 52900, 39800]).toContain(r.cost);
    }
  });

  it("leaves sorting to the finished table, so rows land in arrival order", () => {
    const whole = cards.partial(FULL["table"]) as { sortBy?: string };
    expect(whole.sortBy).toBeUndefined();
  });

  it("shows a checklist item only once its status is known", () => {
    const partial = parsePartialJson('{"kind":"checklist","items":[{"label":"Data map","status":"done"},{"label":"DPA","status":"blo').value;
    expect(cards.partial(partial)).toEqual({ kind: "checklist", items: [{ label: "Data map", status: "done" }] });
  });

  it("never previews an interactive kind, at any point in its stream", () => {
    for (const [kind, spec] of Object.entries(INTERACTIVE)) {
      expect(cards.validate(spec), `${kind} fixture should be valid`).toEqual({ ok: true });
      for (const p of prefixes(spec)) expect(cards.partial(p), kind).toBeUndefined();
    }
  });

  it("refuses an interactive kind even when its definition offers a preview", () => {
    const sneaky: CardKindDefinition = {
      kind: "approve",
      summary: "Approve something.",
      schema: { type: "object" },
      interactive: true,
      validate: () => ({ ok: true }),
      partial: (spec) => ({ ...spec, kind: "approve" }),
    };
    const registry = new CardRegistry([...BUILTIN_CARDS, sneaky]);
    expect(registry.partial({ kind: "approve", title: "Ship it?" })).toBeUndefined();
  });

  it("drops a preview its own validator rejects, or that throws, or that changes kind", () => {
    const base = { summary: "x", schema: { type: "object" } as const };
    const registry = new CardRegistry([
      { ...base, kind: "strict", validate: () => ({ ok: false, error: "no" }), partial: (s) => ({ ...s, kind: "strict" }) },
      { ...base, kind: "throws", validate: () => ({ ok: true }), partial: () => { throw new Error("boom"); } },
      { ...base, kind: "shifty", validate: () => ({ ok: true }), partial: () => ({ kind: "table" }) },
    ]);
    expect(registry.partial({ kind: "strict" })).toBeUndefined();
    expect(registry.partial({ kind: "throws" })).toBeUndefined();
    expect(registry.partial({ kind: "shifty" })).toBeUndefined();
  });

  it("keeps a skeleton for kinds that do not opt in", () => {
    expect(cards.partial({ kind: "chart", series: [{ name: "a", points: [[1, 2]] }] })).toBeUndefined();
    expect(cards.partial({ kind: "nope" })).toBeUndefined();
  });

  it("every built-in kind with a preview is non-interactive", () => {
    for (const def of BUILTIN_CARDS) if (def.partial) expect(def.interactive, def.kind).not.toBe(true);
  });
});

describe("visualize.partialCard", () => {
  const visualize = createVisualizeTool({ cards });

  it("previews the card its streaming arguments describe", () => {
    const args = parsePartialJson('{"kind":"stats","spec":{"items":[{"label":"Open","value":12},{"label":"Clo').value;
    expect(resolvePartialCard(visualize, args)).toEqual({ kind: "stats", items: [{ label: "Open", value: 12 }] });
  });

  it("never previews an interactive kind", () => {
    for (const [kind, spec] of Object.entries(INTERACTIVE)) {
      for (const p of prefixes({ kind, spec })) expect(resolvePartialCard(visualize, p), kind).toBeUndefined();
    }
  });

  it("respects the tool's kind restriction", () => {
    const restricted = createVisualizeTool({ cards, kinds: ["stats"] });
    expect(resolvePartialCard(restricted, { kind: "table", spec: FULL["table"] })).toBeUndefined();
    expect(resolvePartialCard(restricted, { kind: "stats", spec: FULL["stats"] })).toBeDefined();
  });

  it("waits for a spec object", () => {
    expect(resolvePartialCard(visualize, { kind: "table" })).toBeUndefined();
    expect(resolvePartialCard(visualize, { kind: "tab" })).toBeUndefined();
    expect(resolvePartialCard(visualize, undefined)).toBeUndefined();
  });
});
