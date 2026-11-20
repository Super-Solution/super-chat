import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_CARDS,
  CardRegistry,
  SURFACE_LIMITS,
  SurfaceCatalogue,
  SurfaceLedger,
  ToolRegistry,
  applySurfaceOperations,
  authorizeSurfaceTool,
  buildSurface,
  createSurfaceContextSource,
  createSurfaceSkill,
  createSurfaceTools,
  evaluateSurfaceCondition,
  findUnsafe,
  foldSurfaces,
  getAt,
  hasTurnOrder,
  layoutTurn,
  parsePointer,
  previewSurface,
  resolveSurfaceValue,
  runSurfaceQuery,
  runSurfaceToolAction,
  safeSurfaceUrl,
  sanitizeSurfaceSpec,
  setAt,
  surfaceActionTools,
  surfaceCardId,
  toA2uiMessages,
  type Card,
  type ContentPart,
  type Message,
  type MeteringRecord,
  type RunEvent,
  type SurfaceSpec,
  type ToolDefinition,
  type ToolExecutionContext,
} from "../index.js";

const cards = new CardRegistry(BUILTIN_CARDS);
const catalogue = new SurfaceCatalogue({ cards });
const ctx = { catalogue };

const text = (id: string, value: unknown = "Hello") => ({ id, component: "Text", text: value });
const minimal = (over: Record<string, unknown> = {}) => ({
  surfaceId: "s1",
  root: "main",
  data: { region: "all" },
  components: [{ id: "main", component: "Stack", children: ["a"] }, text("a")],
  ...over,
});
const built = (input: unknown = minimal()) => {
  const result = buildSurface(input, ctx);
  if (!result.spec) throw new Error(JSON.stringify(result.issues));
  return result.spec;
};
const codes = (input: unknown) => buildSurface(input, ctx).issues.map((i) => i.code);

describe("validation", () => {
  it("accepts a complete surface with no corrections", () => {
    expect(buildSurface(minimal(), ctx).issues).toEqual([]);
  });

  it("keeps the valid parts and names the invalid one with a fix", () => {
    const { spec, issues } = buildSurface(
      minimal({ components: [{ id: "main", component: "Stack", children: ["a", "b"] }, text("a"), { id: "b", component: "Sparkle" }] }),
      ctx,
    );
    expect(spec?.components.map((c) => c.id)).toEqual(["main", "a"]);
    expect(issues[0]).toMatchObject({ code: "unknown-component", componentId: "b" });
    expect(issues[0]!.fix).toContain("Stack");
    expect(spec?.issues?.[0]?.componentId).toBe("b");
  });

  it("reports unknown props with the allowed list", () => {
    const { issues } = buildSurface(minimal({ components: [{ id: "main", component: "Text", text: "x", onClick: "go" }] }), ctx);
    expect(issues[0]!.message).toContain('Unknown prop "onClick"');
    expect(issues[0]!.fix).toContain("variant");
  });

  it("rejects duplicate ids, missing children, cycles and a missing root", () => {
    expect(codes(minimal({ components: [{ id: "main", component: "Stack", children: [] }, { id: "main", component: "Stack", children: [] }] }))).toContain("duplicate-id");
    expect(codes(minimal({ components: [{ id: "main", component: "Stack", children: ["ghost"] }] }))).toContain("missing-child");
    expect(codes(minimal({ components: [{ id: "main", component: "Stack", children: ["b"] }, { id: "b", component: "Stack", children: ["main"] }] }))).toContain("cycle");
    expect(codes(minimal({ root: "nope" }))).toContain("missing-root");
  });

  it("bounds depth and component count", () => {
    const chain = Array.from({ length: SURFACE_LIMITS.depth + 3 }, (_, i) => ({ id: i ? `n${i}` : "main", component: "Stack", children: [`n${i + 1}`] }));
    expect(codes(minimal({ components: [...chain, text(`n${chain.length}`)] }))).toContain("too-deep");
    const many = Array.from({ length: SURFACE_LIMITS.components + 1 }, (_, i) => text(i ? `t${i}` : "main"));
    expect(buildSurface(minimal({ components: many }), ctx).spec).toBeUndefined();
  });

  it("validates a card against its own kind, with bindings resolved", () => {
    const table = (rows: unknown) => ({ id: "main", component: "Card", kind: "table", spec: { columns: [{ key: "a", label: "A" }], rows } });
    expect(buildSurface(minimal({ data: { rows: [] }, components: [table({ $path: "/rows" })] }), ctx).issues).toEqual([]);
    expect(codes(minimal({ data: { rows: "nope" }, components: [table({ $path: "/rows" })] }))).toContain("invalid-card");
    expect(codes(minimal({ components: [{ id: "main", component: "Card", kind: "surface", spec: {} }] }))).toContain("invalid-card");
  });

  it("requires a place to store an interactive card's answer", () => {
    const confirm = { kind: "confirm", spec: { title: "Sure?", summary: [{ label: "a", value: 1 }] } };
    expect(codes(minimal({ components: [{ id: "main", component: "Card", ...confirm }] }))).toContain("invalid-card");
    expect(buildSurface(minimal({ components: [{ id: "main", component: "Card", ...confirm, bind: "/answer" }] }), ctx).issues).toEqual([]);
  });

  it("allows $item only inside a List template", () => {
    expect(codes(minimal({ components: [text("main", { $item: "name" })] }))).toContain("invalid-binding");
    const list = [{ id: "main", component: "List", items: { $path: "/rows" }, child: "row" }, text("row", { $item: "name" })];
    expect(buildSurface(minimal({ data: { rows: [] }, components: list }), ctx).issues).toEqual([]);
  });

  it("includes every card kind and host component in the catalogue", () => {
    const host = new SurfaceCatalogue({
      cards,
      components: [{ name: "Ticker", category: "custom", summary: "A ticker.", props: { type: "object", properties: { symbol: { type: "string" } }, additionalProperties: false } }],
    });
    for (const kind of BUILTIN_CARDS) expect(host.schemaOf(`Card:${kind.kind}`)?.props).toBe(kind.schema);
    expect(host.index()).toContain("Ticker");
    expect(buildSurface(minimal({ components: [{ id: "main", component: "Ticker", symbol: "A" }] }), { catalogue: host }).issues).toEqual([]);
    expect(() => host.register({ name: "Text", category: "custom", summary: "", props: {} })).toThrow(/built in/);
  });

  it("picks up a card kind registered after the catalogue was created", () => {
    const registry = new CardRegistry(BUILTIN_CARDS);
    const late = new SurfaceCatalogue({ cards: registry });
    registry.register({ kind: "plugin-note", summary: "A plugin card.", schema: { type: "object" }, validate: () => ({ ok: true }) });
    expect(late.names()).toContain("Card:plugin-note");
    expect(buildSurface(minimal({ components: [{ id: "main", component: "Card", kind: "plugin-note", spec: {} }] }), { catalogue: late }).issues).toEqual([]);
  });
});

describe("malicious specs", () => {
  const unsafeProps: [string, Record<string, unknown>][] = [
    ["a script link", { id: "main", component: "Link", text: "x", href: "javascript:alert(1)" }],
    ["an obfuscated script link", { id: "main", component: "Link", text: "x", href: " java\tscript:alert(1)" }],
    ["an html data url", { id: "main", component: "Image", src: "data:text/html,<script>1</script>", alt: "x" }],
    ["an svg data url", { id: "main", component: "Image", src: "data:image/svg+xml;base64,AAAA", alt: "x" }],
    ["script markup in text", { id: "main", component: "Text", text: "<script>alert(1)</script>" }],
    ["an inline handler in text", { id: "main", component: "Text", text: "<img src=x onerror=alert(1)>" }],
  ];
  for (const [name, component] of unsafeProps) {
    it(`refuses ${name}`, () => {
      const result = buildSurface(minimal({ components: [component] }), ctx);
      expect(result.issues[0]?.code).toBe("unsafe-content");
      expect(result.spec?.components).toEqual([]);
    });
  }

  it("leaves ordinary prose alone", () => {
    for (const value of ["Revenue is online = true", "5 < 6 and 7 > 2", "Margins fell <10%"]) {
      expect(buildSurface(minimal({ components: [text("main", value)] }), ctx).issues, value).toEqual([]);
    }
  });

  it("refuses styling, class names, handlers and raw html props", () => {
    for (const prop of ["style", "className", "onClick", "dangerouslySetInnerHTML", "html"]) {
      expect(buildSurface(minimal({ components: [{ ...text("main"), [prop]: { __html: "x" } }] }), ctx).spec?.components, prop).toEqual([]);
    }
  });

  it("refuses prototype pollution through keys and pointers", () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(buildSurface(minimal({ data: polluted }), ctx).spec).toBeUndefined();
    expect(parsePointer("/__proto__/polluted")).toBeUndefined();
    expect(parsePointer("/a/constructor/prototype")).toBeUndefined();
    expect(setAt({}, "/__proto__/polluted", true)).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(getAt({}, "/toString")).toBeUndefined();
  });

  it("refuses an action that carries code, a url or an unknown type", () => {
    const button = (action: unknown) => ({ id: "main", component: "Button", label: "Go", action });
    expect(codes(minimal({ components: [button({ type: "eval", code: "alert(1)" })] }))).toContain("invalid-action");
    expect(codes(minimal({ components: [button({ type: "event", name: "go", code: "alert(1)" })] }))).toContain("invalid-action");
    expect(codes(minimal({ components: [button({ type: "navigate", url: "https://example.com" })] }))).toContain("invalid-action");
    expect(codes(minimal({ components: [button({ type: "set", updates: [{ path: "/__proto__/x", value: 1 }] })] }))).toContain("invalid-action");
  });

  it("never treats a value read from data as a binding", () => {
    const scope = { data: { secret: "s3cret", row: { $path: "/secret" } } };
    expect(resolveSurfaceValue({ $path: "/row" }, scope)).toEqual({ $path: "/secret" });
  });

  it("drops hostile components from a stored spec at render time", () => {
    const tampered = { ...built(), components: [{ id: "main", component: "Link", text: "x", href: "javascript:alert(1)" }] } as SurfaceSpec;
    const clean = sanitizeSurfaceSpec(tampered, catalogue);
    expect(clean.components).toEqual([]);
    expect(clean.issues?.[0]?.code).toBe("unsafe-content");
  });

  it("only lets http(s) and raster images through as urls", () => {
    expect(safeSurfaceUrl("https://example.com/a.png", "image")).toBeDefined();
    expect(safeSurfaceUrl("data:image/png;base64,AAAA", "image")).toBeDefined();
    expect(safeSurfaceUrl("data:image/png;base64,AAAA", "link")).toBeUndefined();
    expect(safeSurfaceUrl("javascript:alert(1)", "link")).toBeUndefined();
    expect(findUnsafe({ code: "javascript:alert(1)" })).toBeDefined();
  });
});

describe("streaming", () => {
  it("shows complete components as they arrive and skips the half-written one", () => {
    const preview = previewSurface(
      { surfaceId: "s1", root: "main", data: {}, components: [{ id: "main", component: "Stack", children: ["a", "b"] }, text("a"), { id: "b", component: "Te" }] },
      catalogue,
    );
    expect(preview?.components.map((c) => c.id)).toEqual(["main", "a"]);
    expect(preview?.issues).toBeUndefined();
  });

  it("draws nothing until the envelope and one component exist", () => {
    expect(previewSurface({ surfaceId: "s1" }, catalogue)).toBeUndefined();
    expect(previewSurface({ surfaceId: "s1", root: "main", components: [{ id: "ma" }] }, catalogue)).toBeUndefined();
  });

  it("never previews hostile content", () => {
    const preview = previewSurface({ surfaceId: "s1", root: "main", components: [text("main"), { id: "x", component: "Link", text: "x", href: "javascript:alert(1)" }] }, catalogue);
    expect(preview?.components.map((c) => c.id)).toEqual(["main"]);
  });

  it("previews every prefix of a surface without throwing", () => {
    const json = JSON.stringify(minimal());
    for (let i = 0; i < json.length; i += 3) {
      expect(() => previewSurface({ surfaceId: "s1", root: "main", components: [json.slice(0, i)] }, catalogue)).not.toThrow();
    }
  });
});

describe("patching", () => {
  it("upserts, removes and bumps the revision", () => {
    const next = applySurfaceOperations(built(), [
      { op: "upsertComponents", components: [text("b", "New"), { id: "main", component: "Stack", children: ["a", "b"] }] },
      { op: "removeComponents", ids: ["a"] },
      { op: "setTitle", title: "Renamed" },
    ], ctx);
    expect(next.issues).toEqual([]);
    expect(next.spec?.revision).toBe(2);
    expect(next.spec?.title).toBe("Renamed");
    // The removed child is dropped from its parent rather than left dangling.
    expect(next.spec?.components.find((c) => c.id === "main")?.["children"]).toEqual(["b"]);
  });

  it("keeps the previous version when an upsert is rejected", () => {
    const next = applySurfaceOperations(built(), [{ op: "upsertComponents", components: [{ id: "a", component: "Text" }] }], ctx);
    expect(next.issues[0]?.componentId).toBe("a");
    expect(next.spec?.components.find((c) => c.id === "a")?.["text"]).toBe("Hello");
  });

  it("clears a fallback once the part is corrected", () => {
    const broken = built(minimal({ components: [{ id: "main", component: "Stack", children: ["b"] }, { id: "b", component: "Sparkle" }] }));
    expect(broken.issues?.[0]?.componentId).toBe("b");
    const fixed = applySurfaceOperations(broken, [{ op: "upsertComponents", components: [text("b")] }], ctx);
    expect(fixed.issues).toEqual([]);
    expect(fixed.spec?.issues).toBeUndefined();
  });

  it("validates a card against data sent in the same patch, whatever the order", () => {
    const next = applySurfaceOperations(built(), [
      { op: "upsertComponents", components: [{ id: "a", component: "Card", kind: "table", spec: { columns: [{ key: "x", label: "X" }], rows: { $path: "/rows" } } }] },
      { op: "setData", path: "/rows", value: [{ x: 1 }] },
    ], ctx);
    expect(next.issues).toEqual([]);
  });

  it("refuses unknown operations and unsafe data", () => {
    expect(applySurfaceOperations(built(), [{ op: "exec" }], ctx).issues[0]?.code).toBe("invalid-shape");
    expect(applySurfaceOperations(built(), [{ op: "setData", path: "/u", value: "javascript:alert(1)" }], ctx).issues[0]?.code).toBe("unsafe-content");
  });
});

describe("binding", () => {
  const rows = [
    { team: "a", month: "Jul", amount: 10, flagged: true },
    { team: "a", month: "Aug", amount: 20, flagged: false },
    { team: "b", month: "Jul", amount: 5, flagged: false },
  ];
  const where = [
    { field: "team", value: { $path: "/team" }, ignore: "all" },
    { field: "amount", op: "gte" as const, value: { $path: "/min" } },
  ];

  it("lets a filter drive a neighbouring total with no model involved", () => {
    const query = { from: "/rows", where, aggregate: { op: "sum" as const, field: "amount" } };
    expect(runSurfaceQuery(query, { data: { rows, team: "all", min: 0 } })).toBe(35);
    expect(runSurfaceQuery(query, { data: { rows, team: "a", min: 0 } })).toBe(30);
    expect(runSurfaceQuery(query, { data: { rows, team: "a", min: 15 } })).toBe(20);
  });

  it("groups into chart points, sorts and limits", () => {
    const query = { from: "/rows", groupBy: "month", aggregate: { op: "sum" as const, field: "amount" }, sortBy: "value", sortDir: "desc" as const };
    expect(runSurfaceQuery(query, { data: { rows } })).toEqual([["Aug", 20], ["Jul", 15]]);
    expect(runSurfaceQuery({ ...query, limit: 1, shape: "rows" }, { data: { rows } })).toEqual([{ key: "Aug", value: 20 }]);
  });

  it("returns an empty result for a path that is not an array", () => {
    expect(runSurfaceQuery({ from: "/missing" }, { data: {} })).toEqual([]);
  });

  it("resolves templates, row fields and conditions", () => {
    expect(resolveSurfaceValue({ $template: "{/team}: {.name}" }, { data: { team: "a" }, item: { name: "n" } })).toBe("a: n");
    expect(evaluateSurfaceCondition({ path: "/n", op: "gt", value: 1 }, { data: { n: 2 } })).toBe(true);
    expect(evaluateSurfaceCondition({ path: "/list" }, { data: { list: [] } })).toBe(false);
  });

  it("writes without mutating the previous state", () => {
    const before = { a: { b: 1 }, keep: { x: 1 } };
    const after = setAt(before, "/a/b", 2)!;
    expect(before.a.b).toBe(1);
    expect(getAt(after, "/a/b")).toBe(2);
    expect(after["keep"]).toBe(before.keep);
  });
});

describe("agent tools", () => {
  const tools = Object.fromEntries(createSurfaceTools({ catalogue }).map((t) => [t.name, t]));
  const run = (name: string, input: unknown, ledger: SurfaceLedger, extra: Partial<ToolExecutionContext> = {}) =>
    tools[name]!.execute!(input, { vars: {}, callId: `call_${name}`, surfaces: ledger, ...extra }) as { output: Record<string, unknown>; card?: SurfaceSpec; cardId?: string; failure?: string };

  it("creates, reads, patches and deletes one surface under one card id", () => {
    const ledger = new SurfaceLedger();
    const created = run("createSurface", minimal(), ledger);
    expect(created.output["ok"]).toBe(true);
    expect(created.cardId).toBe(surfaceCardId("s1"));
    expect(created.card?.originCallId).toBe("call_createSurface");

    const patched = run("updateSurface", { surfaceId: "s1", operations: [{ op: "setData", path: "/region", value: "emea" }] }, ledger);
    expect(patched.card?.revision).toBe(2);
    expect(patched.card?.originCallId).toBe("call_createSurface");
    expect(run("readSurface", { surfaceId: "s1" }, ledger).output["data"]).toEqual({ region: "emea" });

    expect(run("deleteSurface", { surfaceId: "s1" }, ledger).card?.deleted).toBe(true);
    expect(run("readSurface", { surfaceId: "s1" }, ledger).failure).toBe("not-found");
  });

  it("renders the valid part and returns corrections for the rest", () => {
    const result = run("createSurface", minimal({ components: [{ id: "main", component: "Stack", children: ["x"] }, { id: "x", component: "Nope" }] }), new SurfaceLedger());
    expect(result.failure).toBe("invalid-input");
    expect(result.output["partial"]).toBe(true);
    expect(result.card).toBeDefined();
    expect((result.output["corrections"] as unknown[]).length).toBeGreaterThan(0);
  });

  it("refuses a stale patch instead of overwriting the person's edits", () => {
    const ledger = new SurfaceLedger();
    run("createSurface", minimal(), ledger);
    const stale = run("updateSurface", { surfaceId: "s1", expectedRevision: 9, operations: [{ op: "setTitle", title: "x" }] }, ledger);
    expect(stale.failure).toBe("invalid-input");
    expect(JSON.stringify(stale.output)).toContain("stale-revision");
  });

  it("corrects a button that names a tool outside the allowed set", () => {
    const button = { id: "main", component: "Button", label: "Go", action: { type: "tool", tool: "wipe" } };
    const result = run("createSurface", minimal({ components: [button] }), new SurfaceLedger(), { surfaceActionTools: ["safe"] });
    expect(JSON.stringify(result.output)).toContain("tool-not-allowed");
    expect(JSON.stringify(result.output)).toContain("safe");
  });

  it("says when a surface expired and how to recover", () => {
    const ledger = new SurfaceLedger(foldSurfaces([expiredMessage()]));
    const result = run("updateSurface", { surfaceId: "s1", operations: [{ op: "setTitle", title: "x" }] }, ledger);
    expect(result.failure).toBe("not-found");
    expect(String(result.output["error"])).toContain("createSurface");
  });

  it("keeps schemas out of the prompt until they are asked for", () => {
    const definition = JSON.stringify(tools["createSurface"]);
    expect(definition.length).toBeLessThan(1_200);
    expect(definition).not.toContain("Slider");
    const index = run("describeSurfaceComponents", {}, new SurfaceLedger()).output;
    expect(String(index["index"])).toContain("Card:chart");
    const asked = run("describeSurfaceComponents", { components: ["Select", "Nope"] }, new SurfaceLedger()).output;
    expect((asked["schemas"] as { name: string }[]).map((s) => s.name)).toEqual(["Select"]);
    expect(asked["unknown"]).toEqual(["Nope"]);
  });

  it("spends the schema budget in order and names what it left out", () => {
    const names = BUILTIN_CARDS.map((k) => `Card:${k.kind}`);
    const output = run("describeSurfaceComponents", { components: names, maxTokens: 300 }, new SurfaceLedger()).output;
    expect((output["omitted"] as string[]).length).toBeGreaterThan(0);
  });

  it("reaches the model through a manual skill and a one-line context layer", async () => {
    const skill = createSurfaceSkill(catalogue);
    expect(skill.mode).toBe("manual");
    const source = createSurfaceContextSource();
    const out = await source.run({ messages: [surfaceMessage(built())], query: "", vars: {} });
    expect(out.layers?.[0]?.text).toContain("s1");
    expect(out.layers?.[0]?.text).not.toContain("region");
    expect(await source.run({ messages: [], query: "", vars: {} })).toEqual({});
  });
});

const surfaceMessage = (spec: SurfaceSpec, id = "m1"): Message => ({
  id,
  role: "assistant",
  parts: [{ type: "artifact", id: surfaceCardId(spec.surfaceId), kind: "card:surface", data: spec, callId: "c1" }],
});
const expiredMessage = (): Message => ({
  id: "m2",
  role: "assistant",
  parts: [{ type: "artifact", id: surfaceCardId("s1"), kind: "card:surface", data: { kind: "surface", expired: true } }],
});

describe("persistence", () => {
  it("derives each surface from the newest snapshot on the path", () => {
    const first = built();
    const second = { ...first, revision: 5 };
    expect(foldSurfaces([surfaceMessage(first), surfaceMessage(second, "m2")])["s1"]?.revision).toBe(5);
    expect(foldSurfaces([surfaceMessage(first)])["s1"]?.revision).toBe(1);
  });

  it("recognises a payload shed from saved history as expired", () => {
    expect(foldSurfaces([surfaceMessage(built()), expiredMessage()])["s1"]?.expired).toBe(true);
  });
});

describe("message order", () => {
  const call = (callId: string): ContentPart => ({ type: "tool-call", callId, name: "t", input: {}, status: "done" });
  const card = (id: string, callId?: string): Card => ({ id, spec: { kind: "stats", items: [] }, ...(callId ? { callId } : {}) });

  it("keeps text and output in the order they happened", () => {
    const parts: ContentPart[] = [{ type: "text", text: "before" }, call("a"), { type: "text", text: "after" }];
    expect(layoutTurn(parts, [card("c1", "a")]).map((s) => s.type)).toEqual(["text", "output", "text"]);
  });

  it("does not split prose around a call that drew nothing", () => {
    const parts: ContentPart[] = [{ type: "text", text: "one" }, call("a"), { type: "text", text: "two" }];
    expect(layoutTurn(parts, [])).toEqual([{ type: "text", key: "text:0", text: "one\n\ntwo" }]);
  });

  it("keeps an empty slot for a live call, so its card cannot move later", () => {
    expect(layoutTurn([call("a")], [], { keepEmptyOutputs: true })[0]).toMatchObject({ type: "output", key: "call:a" });
  });

  it("places a card no call accounts for at the end", () => {
    expect(layoutTurn([{ type: "text", text: "x" }], [card("c1")]).map((s) => s.type)).toEqual(["text", "card"]);
  });

  it("leaves turns saved before order was recorded on the old layout", () => {
    expect(hasTurnOrder([{ type: "text", text: "x" }, { type: "artifact", id: "c", kind: "card:stats", data: {} }])).toBe(false);
    expect(hasTurnOrder([{ type: "artifact", id: "c", kind: "card:stats", data: {}, callId: "a" }])).toBe(true);
  });
});

describe("action authority", () => {
  const tool = (name: string, execute: ToolDefinition["execute"] = vi.fn(() => ({ output: { ok: true } }))): ToolDefinition => ({
    name,
    description: name,
    inputSchema: { type: "object", required: ["n"], properties: { n: { type: "number" } }, additionalProperties: false },
    execute,
  });

  const registry = () => {
    const tools = new ToolRegistry();
    tools.register(tool("reader"), ["observer"]);
    tools.register(tool("writer"), ["executor"]);
    tools.register(tool("skillOnly"));
    tools.registerAll(createSurfaceTools({ catalogue }), ["observer"]);
    return tools;
  };

  it("allows only what the enabled presets grant", () => {
    const tools = registry();
    expect(authorizeSurfaceTool("reader", { n: 1 }, tools, { presets: ["observer"] }).ok).toBe(true);
    expect(authorizeSurfaceTool("writer", { n: 1 }, tools, { presets: ["observer"] }).ok).toBe(false);
  });

  it("does not let a skill's unlock reach a button", () => {
    expect(authorizeSurfaceTool("skillOnly", { n: 1 }, registry(), { presets: ["observer"], allow: ["skillOnly"] }).ok).toBe(false);
  });

  it("applies deny last", () => {
    expect(authorizeSurfaceTool("reader", { n: 1 }, registry(), { presets: ["observer"], deny: ["reader"] }).ok).toBe(false);
  });

  it("keeps the surface tools themselves out of reach", () => {
    expect(surfaceActionTools(registry(), { presets: ["observer"] }).map((t) => t.name)).toEqual(["reader"]);
  });

  it("refuses arguments that do not match the tool's schema", () => {
    const verdict = authorizeSurfaceTool("reader", { n: "one" }, registry(), { presets: ["observer"] });
    expect(verdict.ok).toBe(false);
  });

  const collect = async (events: AsyncIterable<RunEvent>) => {
    const out: RunEvent[] = [];
    for await (const event of events) out.push(event);
    return out;
  };

  it("runs through the shared executor, emits run events and meters the action", async () => {
    const records: MeteringRecord[] = [];
    const execute = vi.fn(() => ({ output: { done: true } }));
    const events = await collect(runSurfaceToolAction({
      tool: tool("reader", execute), args: { n: 1 }, surfaceId: "s1", componentId: "b", provider: "p", model: "m",
      meter: { record: (r) => void records.push(r) },
    }));
    expect(execute).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toEqual(["run-start", "step-start", "tool-call", "tool-result", "metering", "run-finish"]);
    expect(records[0]?.metadata).toMatchObject({ trigger: "surface-action", surfaceId: "s1", tool: "reader" });
  });

  it("suspends a confirming tool on the same approval card", async () => {
    const confirming: ToolDefinition = {
      ...tool("pay"),
      side: "confirm",
      confirmation: "tool",
      async execute(_input, c) {
        const answer = (await c.requestCard?.({ kind: "confirm", title: "Pay?", summary: [{ label: "a", value: 1 }] })) as { cancelled?: boolean };
        return answer.cancelled ? { output: { paid: false }, failure: "denied" as const } : { output: { paid: true } };
      },
    };
    const decide = vi.fn(async (callId: string, card: Card) => ({ cardId: card.id, callId, kind: "confirm", type: "cancel" as const, at: 0 }));
    const events = await collect(runSurfaceToolAction({ tool: confirming, args: { n: 1 }, surfaceId: "s1", componentId: "b", provider: "p", model: "m", onUserDecision: decide }));
    expect(decide).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toContain("awaiting-user");
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({ failure: "denied" });
  });
});

describe("enforced confirmation on surface actions", () => {
  const guarded = (execute: ToolDefinition["execute"]): ToolDefinition => ({
    name: "pay",
    description: "Pay.",
    side: "confirm",
    inputSchema: { type: "object" },
    execute,
  });
  const base = { args: { amount: 5 }, surfaceId: "s1", componentId: "b", provider: "p", model: "m" };
  const drain = async (events: AsyncIterable<RunEvent>) => {
    const out: RunEvent[] = [];
    for await (const event of events) out.push(event);
    return out;
  };

  it("asks before a button runs a tool that only declares side: confirm", async () => {
    const execute = vi.fn(() => ({ output: { paid: true } }));
    const decide = vi.fn(async (callId: string, card: Card) => ({ cardId: card.id, callId, kind: "confirm", type: "confirm" as const, value: { confirmed: true }, at: 0 }));
    const events = await drain(runSurfaceToolAction({ ...base, tool: guarded(execute), onUserDecision: decide }));
    expect(decide).toHaveBeenCalledOnce();
    expect(decide.mock.calls[0]![1].spec).toMatchObject({ kind: "confirm", title: "Allow this?" });
    expect(execute).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toContain("awaiting-user");
  });

  it("does not run when the person declines", async () => {
    const execute = vi.fn(() => ({ output: { paid: true } }));
    const decide = async (callId: string, card: Card) => ({ cardId: card.id, callId, kind: "confirm", type: "cancel" as const, at: 0 });
    const events = await drain(runSurfaceToolAction({ ...base, tool: guarded(execute), onUserDecision: decide }));
    expect(execute).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({ failure: "denied" });
  });

  it("does not run when the host has no way to ask", async () => {
    const execute = vi.fn(() => ({ output: { paid: true } }));
    const events = await drain(runSurfaceToolAction({ ...base, tool: guarded(execute) }));
    expect(execute).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({ failure: "denied" });
  });
});

describe("documentation", () => {
  it("publishes an example that the validator accepts", () => {
    const guide = readFileSync(fileURLToPath(new URL("../../../../docs/guide/surfaces.md", import.meta.url)), "utf8");
    const example = /```json\n([\s\S]*?)```/.exec(guide)?.[1];
    expect(buildSurface(JSON.parse(example!), ctx).issues).toEqual([]);
  });
});

describe("A2UI mapping", () => {
  it("exports the same structure as A2UI messages", () => {
    const spec = built(minimal({
      components: [
        { id: "main", component: "Stack", direction: "horizontal", children: ["pick", "go"] },
        { id: "pick", component: "Select", label: "Region", value: { $path: "/region" }, options: [{ value: "all", label: "All" }] },
        { id: "go", component: "Button", label: "Go", action: { type: "event", name: "go", context: { region: { $path: "/region" } } } },
      ],
    }));
    const [create, update, data] = toA2uiMessages(spec) as unknown as [
      { createSurface: { surfaceId: string } },
      { updateComponents: { components: Record<string, unknown>[] } },
      { updateDataModel: { value: unknown } },
    ];
    expect(create.createSurface.surfaceId).toBe("s1");
    const byId = Object.fromEntries(update.updateComponents.components.map((c) => [c["id"], c]));
    expect(byId["root"]).toMatchObject({ component: "Row", children: ["pick", "go"] });
    expect(byId["pick"]).toMatchObject({ component: "ChoicePicker", value: { path: "/region" } });
    expect(byId["go"]).toMatchObject({ component: "Button", child: "go__label", action: { event: { name: "go", context: { region: { path: "/region" } } } } });
    expect(data.updateDataModel.value).toEqual({ region: "all" });
  });
});
