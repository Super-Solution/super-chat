import { describe, expect, it } from "vitest";
import { BUILTIN_CARDS } from "./builtin.js";
import { CardRegistry } from "./registry.js";
import { createVisualizeTool } from "../tools/builtin.js";
import { ToolRegistry } from "../tools/registry.js";
import { resolveToolLoading, type ToolDefinition } from "../tools/types.js";

const cards = new CardRegistry(BUILTIN_CARDS);

const ctx = { vars: {}, callId: "c1" };

describe("CardRegistry", () => {
  it("names the valid kinds when given an unknown one", () => {
    // A model that hallucinated "barchart" recovers from a list; it cannot
    // recover from a card that was silently dropped.
    const verdict = cards.validate({ kind: "barchart" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.error).toContain("barchart");
      expect(verdict.expected).toContain("chart");
    }
  });

  it("accepts a well-formed table", () => {
    expect(
      cards.validate({ kind: "table", columns: [{ key: "sym", label: "Symbol" }], rows: [{ sym: "SUI" }] }),
    ).toEqual({ ok: true });
  });

  it("rejects a table whose columns lack key/label", () => {
    const verdict = cards.validate({ kind: "table", columns: [{ label: "Symbol" }], rows: [] });
    expect(verdict.ok).toBe(false);
  });

  it("catches the common bare-values mistake in chart points", () => {
    const verdict = cards.validate({ kind: "chart", series: [{ name: "price", points: [1, 2, 3] }] });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.expected).toContain("[[0, 12]");
  });

  it("accepts candlestick charts on their own required fields", () => {
    expect(
      cards.validate({ kind: "chart", variant: "candlestick", candles: [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5 }] }),
    ).toEqual({ ok: true });
  });

  it("rejects duplicate choice option ids", () => {
    // Duplicates make the returned selection ambiguous.
    const verdict = cards.validate({
      kind: "choice",
      options: [
        { id: "a", label: "A" },
        { id: "a", label: "Also A" },
      ],
    });
    expect(verdict.ok).toBe(false);
  });

  it("requires options on a select field", () => {
    const verdict = cards.validate({ kind: "form", fields: [{ name: "x", label: "X", type: "select" }] });
    expect(verdict.ok).toBe(false);
  });

  it("accepts citations with and without ids, so every existing card still validates", () => {
    const plain = { kind: "citations", items: [{ title: "A" }, { title: "B", url: "https://example.com" }] };
    expect(cards.validate(plain)).toEqual({ ok: true });
    const named = { kind: "citations", id: "authority", items: [{ id: "photo", title: "A" }, { id: "ucta.s3", title: "B" }] };
    expect(cards.validate(named)).toEqual({ ok: true });
  });

  it("refuses a citation id that cannot travel in a link, or is used twice, saying which", () => {
    const bad = cards.validate({ kind: "citations", items: [{ id: "has space", title: "A" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("citation `id`");
    const twice = cards.validate({ kind: "citations", items: [{ id: "a", title: "A" }, { id: "a", title: "B" }] });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error).toContain('"a"');
    const card = cards.validate({ kind: "citations", id: "no good", items: [{ title: "A" }] });
    expect(card.ok).toBe(false);
  });

  it("tells the model how to cite into the card", () => {
    expect(cards.get("citations")?.summary).toContain("ref:<card id>?cite=");
  });

  it("marks exactly the decision-requiring kinds as interactive", () => {
    // "Interactive" means the run SUSPENDS until the user answers. The bar is
    // that something is waiting — not that the card has controls in it. An
    // email draft is editable and is not on this list, because nothing blocks
    // on it; an edit review is, because no document changes until it comes back.
    expect(cards.list().filter((k) => k.interactive).map((k) => k.kind).sort()).toEqual([
      "choice",
      "confirm",
      "editreview",
      "form",
    ]);
  });

  it("registers validator and renderer key together so they cannot drift", () => {
    // Every kind the registry knows is describable and schema-backed — the
    // structural fix for "parser exists, render branch missing".
    for (const def of cards.list()) {
      expect(def.summary.length).toBeGreaterThan(0);
      expect(def.schema.properties?.["kind"]).toBeDefined();
    }
  });
});

describe("visualize tool", () => {
  const tool = createVisualizeTool({ cards });

  it("fills in a `kind` the model omitted inside spec", async () => {
    const result = (await tool.execute!({ kind: "stats", spec: { items: [{ label: "TVL", value: 10 }] } }, ctx)) as {
      output: { ok: boolean };
      card?: { kind: string };
    };
    expect(result.output.ok).toBe(true);
    expect(result.card?.kind).toBe("stats");
  });

  it("returns a correction as data, not as a thrown error", async () => {
    const result = (await tool.execute!({ kind: "table", spec: { rows: [] } }, ctx)) as {
      output: { ok: boolean; error: string };
      failure?: string;
    };
    expect(result.output.ok).toBe(false);
    expect(result.output.error).toContain("columns");
    expect(result.failure).toBe("invalid-input");
  });

  it("sends the kind's own summary when its refusal names no shape of its own", async () => {
    const summarised = new CardRegistry([
      {
        kind: "pin",
        summary: "A map pin. Spec {at:{lat,lng}, label?}.",
        schema: { type: "object" },
        validate: (spec) => (typeof (spec as { at?: unknown }).at === "object" ? { ok: true } : { ok: false, error: "at must be an object." }),
      },
      { kind: "bare", summary: "", schema: { type: "object" }, validate: () => ({ ok: false, error: "never valid." }) },
      { kind: "own", summary: "ignored", schema: { type: "object" }, validate: () => ({ ok: false, error: "no.", expected: "own: {…}" }) },
    ]);
    const t = createVisualizeTool({ cards: summarised });
    const run = async (kind: string) => ((await t.execute!({ kind, spec: { at: "x" } }, ctx)) as { output: { error: string; expected?: string } }).output;
    expect(await run("pin")).toEqual({ ok: false, error: "at must be an object.", expected: "A map pin. Spec {at:{lat,lng}, label?}." });
    expect((await run("bare")).expected).toBeUndefined();
    expect((await run("own")).expected).toBe("own: {…}");
  });

  it("suspends for the user on an interactive card", async () => {
    let asked: unknown;
    const result = (await tool.execute!(
      { kind: "choice", spec: { options: [{ id: "p1", label: "Pool 1" }] } },
      {
        ...ctx,
        requestCard: async (spec) => {
          asked = spec;
          return { selected: ["p1"] };
        },
      },
    )) as { output: { response: unknown } };

    expect(asked).toMatchObject({ kind: "choice" });
    expect(result.output.response).toEqual({ selected: ["p1"] });
  });

  it("offers no placement until the host has a side panel", async () => {
    expect(tool.inputSchema.properties?.["placement"]).toBeUndefined();
    const refused = (await tool.execute!({ kind: "stats", placement: "panel", spec: { items: [{ label: "A", value: 1 }] } }, ctx)) as { output: { ok: boolean; error?: string }; failure?: string };
    expect(refused.failure).toBe("invalid-input");
    expect(refused.output.error).toContain("no side panel");
  });

  it("opens a card in the side panel when asked, and keeps interactive cards in the chat", async () => {
    const paneled = createVisualizeTool({ cards, placements: ["inline", "panel"] });
    expect(Object.keys(paneled.inputSchema.properties ?? {})).toEqual(["kind", "placement", "spec"]);
    expect(paneled.description).toContain('placement: "panel"');
    const opened = (await paneled.execute!({ kind: "stats", placement: "panel", spec: { items: [{ label: "A", value: 1 }] } }, ctx)) as { placement?: string; card?: unknown };
    expect(opened.placement).toBe("panel");
    expect(opened.card).toBeDefined();
    const inline = (await paneled.execute!({ kind: "stats", spec: { items: [{ label: "A", value: 1 }] } }, ctx)) as { placement?: string };
    expect(inline.placement).toBeUndefined();
    const asked = (await paneled.execute!({ kind: "confirm", placement: "panel", spec: { title: "Go?", summary: [] } }, ctx)) as { failure?: string };
    expect(asked.failure).toBe("invalid-input");
    expect(paneled.partialCard?.({ kind: "stats", placement: "panel", spec: { items: [{ label: "A", value: 1 }] } })).toBeUndefined();
  });

  it("advertises only the kinds it was given", () => {
    const limited = createVisualizeTool({ cards, kinds: ["table", "stats"] });
    expect(limited.inputSchema.properties?.["kind"]?.enum).toEqual(["table", "stats"]);
    expect(limited.description).not.toContain("- confirm");
  });

  it("describes known passive card geometry but never skeletonizes a decision", () => {
    expect(resolveToolLoading(tool.loading, { kind: "chart", spec: {} })).toEqual({
      kind: "chart",
      label: "Preparing chart card",
    });
    expect(resolveToolLoading(tool.loading, { kind: "choice", spec: {} })).toBeUndefined();
  });
});

describe("ToolRegistry presets", () => {
  const mk = (name: string): ToolDefinition => ({ name, description: name, inputSchema: { type: "object" } });

  it("exposes nothing that is not in an enabled preset", () => {
    const reg = new ToolRegistry()
      .register(mk("getPrice"), ["observer"])
      .register(mk("sendFunds"), ["executor"]);

    const names = reg.resolve({ presets: ["observer"] }).map((t) => t.name);
    expect(names).toEqual(["getPrice"]);
  });

  it("keeps a newly registered tool private until it is placed in a preset", () => {
    const reg = new ToolRegistry().register(mk("brandNew"));
    expect(reg.resolve({ presets: ["observer", "draft", "executor"] })).toHaveLength(0);
  });

  it("applies deny after allow, so a kill switch cannot be re-granted", () => {
    const reg = new ToolRegistry().register(mk("risky"), ["observer"]);
    const names = reg.resolve({ presets: ["observer"], allow: ["risky"], deny: ["risky"] }).map((t) => t.name);
    expect(names).toEqual([]);
  });

  it("lets `allow` surface a tool that belongs to no preset", () => {
    // Skill-gated: private by default, unlocked by the skill that documents it.
    const reg = new ToolRegistry().register(mk("reviewContract"));
    expect(reg.resolve({ presets: ["observer"] })).toHaveLength(0);
    expect(reg.resolve({ presets: ["observer"], allow: ["reviewContract"] }).map((t) => t.name)).toEqual([
      "reviewContract",
    ]);
  });

  it("does NOT let `allow` escalate past the capability tier", () => {
    // A matched skill grants relevance, not authority. If naming a tool were
    // enough, any skill could hand out the executor tier.
    const reg = new ToolRegistry().register(mk("sendFunds"), ["executor"]);
    expect(reg.resolve({ presets: ["observer"], allow: ["sendFunds"] })).toHaveLength(0);
    expect(reg.resolve({ presets: ["observer", "executor"], allow: ["sendFunds"] }).map((t) => t.name)).toEqual([
      "sendFunds",
    ]);
  });

  it("skips preset names that reference unregistered tools", () => {
    const reg = new ToolRegistry().register(mk("real"), ["observer"]).addToPreset("observer", "deleted");
    expect(reg.resolve({ presets: ["observer"] }).map((t) => t.name)).toEqual(["real"]);
  });

  it("resolves a router-namespaced tool name", () => {
    const reg = new ToolRegistry().register(mk("getPrice"), ["observer"]);
    expect(reg.get("functions.getPrice")?.name).toBe("getPrice");
  });

  it("reports which tools the host must execute", () => {
    const reg = new ToolRegistry()
      .register({ ...mk("local"), execute: () => ({ output: 1 }) }, ["observer"])
      .register(mk("hostSide"), ["observer"]);
    expect(reg.hostExecuted(reg.resolve({ presets: ["observer"] }))).toEqual(["hostSide"]);
  });
});
