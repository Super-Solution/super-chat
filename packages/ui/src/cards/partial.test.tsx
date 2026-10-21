// A card whose spec is still streaming renders progressively — and an
// interactive card never renders from a partial spec, whatever hands it one.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContextBuilder,
  ToolRegistry,
  createOpenAIProvider,
  initialRunState,
  type Card,
  type CardSpec,
  type PartialToolCall,
  type Transport,
} from "@zzyzxlabs/super-chat-core";
import { AgentClient, AgentProvider } from "@zzyzxlabs/super-chat-react";
import { CardRenderer, CardRendererProvider, type CardRendererMap } from "../renderer-registry.js";
import { LiveTurn } from "../Thread.js";
import { BUILTIN_RENDERERS } from "./index.js";

const INTERACTIVE = ["choice", "form", "confirm", "editreview"] as const;

/** BUILTIN_RENDERERS, with every interactive renderer replaced by a spy. */
function withSpies() {
  const calls: { kind: string; partial?: boolean }[] = [];
  const spies: CardRendererMap = {};
  for (const kind of INTERACTIVE) {
    spies[kind] = ((props: { partial?: boolean }) => {
      calls.push({ kind, partial: props.partial });
      return <div>{`interactive ${kind}`}</div>;
    }) as CardRendererMap[string];
  }
  return { renderers: { ...BUILTIN_RENDERERS, ...spies }, calls };
}

const TABLE: CardSpec = {
  kind: "table",
  title: "Vendor shortlist",
  columns: [
    { key: "vendor", label: "Vendor" },
    { key: "cost", label: "Annual cost", format: "currency" },
  ],
  rows: [{ vendor: "Halcyon", cost: 48200 }, { vendor: "Bright" }],
};

const card = (spec: CardSpec, id = "c1"): Card => ({ id, spec, callId: "call_1" });

const render = (renderers: CardRendererMap, node: React.ReactNode) =>
  renderToStaticMarkup(<CardRendererProvider renderers={renderers}>{node}</CardRendererProvider>);

describe("CardRenderer — partial specs", () => {
  it("never hands a partial spec to an interactive renderer", () => {
    const { renderers, calls } = withSpies();
    const specs: Record<string, CardSpec> = {
      confirm: { kind: "confirm", title: "Delete three files?", summary: [] },
      choice: { kind: "choice", prompt: "Which?", options: [{ id: "a", label: "A" }] },
      form: { kind: "form", fields: [{ name: "email", type: "text" }] },
      editreview: { kind: "editreview", docId: "d", revision: 1, hunks: [] },
    };
    for (const kind of INTERACTIVE) {
      const html = render(renderers, <CardRenderer card={card(specs[kind]!)} partial respond={() => {}} />);
      expect(html, kind).toBe("");
    }
    expect(calls).toEqual([]);

    // The same cards, finished and validated, do render.
    for (const kind of INTERACTIVE) render(renderers, <CardRenderer card={card(specs[kind]!)} respond={() => {}} />);
    expect(calls.map((c) => c.kind)).toEqual([...INTERACTIVE]);
    expect(calls.every((c) => !c.partial)).toBe(true);
  });

  it("renders a partial table's rows as they are, without the actions that would act on them", () => {
    const html = render(BUILTIN_RENDERERS, <CardRenderer card={card(TABLE)} partial />);
    expect(html).toContain("Halcyon");
    expect(html).toContain("Bright");
    expect(html).not.toContain("Download");
    expect(html).not.toContain("No rows.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Vendor/);

    const whole = render(BUILTIN_RENDERERS, <CardRenderer card={card(TABLE)} />);
    expect(whole).toContain("Download");
    expect(whole).not.toMatch(/<button[^>]*disabled[^>]*>Vendor/);
  });

  it("renders the other progressive kinds from a partial spec", () => {
    const specs: CardSpec[] = [
      { kind: "stats", items: [{ label: "Open", value: 12 }] },
      { kind: "checklist", items: [{ label: "Data map", status: "done" }] },
      { kind: "timeline", events: [{ at: "Hour 0", label: "Read the contract" }] },
      { kind: "markdown", title: "Notes", body: "# Plan\n\n- first\n- sec" },
    ];
    const expected = ["Open", "Data map", "Read the contract", "sec"];
    specs.forEach((spec, i) => {
      const html = render(BUILTIN_RENDERERS, <CardRenderer card={card(spec)} partial />);
      expect(html, spec.kind).toContain(expected[i]);
      expect(html, spec.kind).not.toContain("Download");
    });
    // A checklist's tally waits for the whole list.
    expect(render(BUILTIN_RENDERERS, <CardRenderer card={card(specs[1]!)} partial />)).not.toContain("done</span>");
  });

  it("does not fall back to raw JSON for a partial card with no renderer", () => {
    expect(render({}, <CardRenderer card={card({ kind: "mystery", a: 1 })} partial />)).toBe("");
  });
});

describe("LiveTurn — streaming output slots", () => {
  const transport: Transport = { kind: "custom", credentialSafe: true, fetch: () => Promise.reject(new Error("offline")) };

  function liveTurn(partialTools: Record<string, PartialToolCall>, extra: Partial<ReturnType<typeof initialRunState>> = {}) {
    const client = new AgentClient({
      provider: createOpenAIProvider({ transport }),
      model: "m",
      contextBuilder: new ContextBuilder({ identity: "Test.", contextWindow: 32_000 }),
      tools: new ToolRegistry(),
      toolResolution: { presets: [] },
    });
    client.store.set((s) => ({
      ...s,
      status: "running",
      run: { ...initialRunState("r", "stream"), status: "running", partialTools, ...extra },
      cards: extra.cards ?? [],
    }));
    const { renderers, calls } = withSpies();
    const html = renderToStaticMarkup(
      <AgentProvider client={client}>
        <CardRendererProvider renderers={renderers}>
          <LiveTurn />
        </CardRendererProvider>
      </AgentProvider>,
    );
    return { html, calls };
  }

  it("draws a table preview while its arguments stream, before any tool-call exists", () => {
    const { html } = liveTurn({
      call_1: { callId: "call_1", name: "visualize", partialInput: {}, partialCard: TABLE },
    });
    expect(html).toContain('data-call-id="call_1"');
    expect(html).toContain('class="sc-cardstream"');
    expect(html).toContain("Halcyon");
  });

  it("never renders an interactive kind from a preview, even one a tool hook forged", () => {
    const { html, calls } = liveTurn({
      call_2: {
        callId: "call_2",
        name: "rogueTool",
        partialInput: {},
        partialCard: { kind: "confirm", title: "Wire the funds?", summary: [] },
      },
    });
    expect(calls).toEqual([]);
    expect(html).not.toContain("interactive confirm");
    expect(html).not.toContain("Wire the funds");
  });

  it("keeps the preview in its slot after tool-call, until the validated card replaces it", () => {
    const preview = { call_1: { callId: "call_1", name: "visualize", partialInput: {}, partialCard: TABLE } };
    const called = {
      parts: [{ type: "tool-call" as const, callId: "call_1", name: "visualize", input: {}, status: "running" as const }],
    };
    const { html } = liveTurn(preview, called);
    expect(html).toContain('class="sc-cardstream"');
    expect(html).toContain("Halcyon");

    const final = { ...TABLE, rows: [{ vendor: "Halcyon", cost: 48200 }, { vendor: "Brightline", cost: 52900 }] };
    const done = liveTurn(preview, { ...called, cards: [{ id: "card_1", callId: "call_1", spec: final }] });
    expect(done.html).not.toContain("sc-cardstream");
    expect(done.html).toContain("Brightline");
    expect(done.html).toContain("Download");
  });
});
