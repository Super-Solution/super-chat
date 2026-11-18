import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BUILTIN_CARDS,
  CardRegistry,
  SurfaceCatalogue,
  buildSurface,
  type Card,
  type Message,
  type SurfaceSpec,
} from "@supersolutions/super-chat-core";
import { AgentClient } from "@supersolutions/super-chat-client";
import { AgentProvider } from "@supersolutions/super-chat-react";
import { ContextBuilder, ToolRegistry, createOpenAIProvider, type Transport } from "@supersolutions/super-chat-core";
import { BUILTIN_RENDERERS } from "../cards/index.js";
import { CardRenderer, CardRendererProvider, type CardRendererMap } from "../renderer-registry.js";
import { MessageView } from "../Thread.js";
import { SurfaceHostProvider, SurfaceView } from "./SurfaceView.js";

const cards = new CardRegistry(BUILTIN_CARDS);
const catalogue = new SurfaceCatalogue({ cards });

const surface = (components: unknown[], data: Record<string, unknown> = {}): SurfaceSpec => {
  const { spec } = buildSurface({ surfaceId: "s1", title: "Explorer", root: "main", data, components }, { catalogue });
  return spec!;
};
const render = (node: React.ReactNode, renderers: CardRendererMap = BUILTIN_RENDERERS) =>
  renderToStaticMarkup(<CardRendererProvider renderers={renderers} registry={cards}>{node}</CardRendererProvider>);

describe("SurfaceView", () => {
  it("renders a composed interface from one spec", () => {
    const html = render(<SurfaceView spec={surface([
      { id: "main", component: "Stack", children: ["team", "total", "go"] },
      { id: "team", component: "Select", label: "Team", value: { $path: "/team" }, options: [{ value: "a", label: "Alpha" }] },
      { id: "total", component: "Metric", label: "Total", format: "number", value: { $query: { from: "/rows", aggregate: { op: "sum", field: "n" } } } },
      { id: "go", component: "Button", label: "Go", action: { type: "event", name: "go" } },
    ], { team: "a", rows: [{ n: 2 }, { n: 3 }] })} />);
    expect(html).toContain("Alpha");
    expect(html).toContain(">5<");
    expect(html).toContain("Go");
    expect(html).toContain('aria-label="Explorer"');
  });

  it("shows a visible fallback where a part was rejected", () => {
    const html = render(<SurfaceView spec={surface([{ id: "main", component: "Stack", children: ["bad"] }, { id: "bad", component: "Sparkle" }])} />);
    expect(html).toContain("couldn’t be shown");
  });

  it("escapes text and renders no script-bearing link from a stored spec", () => {
    const tampered: SurfaceSpec = {
      ...surface([{ id: "main", component: "Text", text: "x" }]),
      components: [
        { id: "main", component: "Stack", children: ["t", "l"] },
        { id: "t", component: "Text", text: "<b>bold</b>" },
        { id: "l", component: "Link", text: "go", href: "javascript:alert(1)" },
      ],
    };
    const html = render(<SurfaceView spec={tampered} />);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<b>bold</b>");
  });

  it("disables every control while the spec is still streaming", () => {
    const html = render(<SurfaceView partial spec={surface([{ id: "main", component: "Button", label: "Go", action: { type: "event", name: "go" } }])} />);
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("marks tabs for keyboard and assistive technology", () => {
    const html = render(<SurfaceView spec={surface([
      { id: "main", component: "Tabs", label: "Views", tabs: [{ id: "a", label: "One", child: "x" }, { id: "b", label: "Two", child: "y" }] },
      { id: "x", component: "Text", text: "first" },
      { id: "y", component: "Text", text: "second" },
    ])} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("first");
    expect(html).not.toContain("second");
  });

  it("composes a plugin's card kind beside the built-in parts", () => {
    const registry = new CardRegistry(BUILTIN_CARDS);
    registry.register({ kind: "plugin-note", summary: "A note.", schema: { type: "object" }, validate: () => ({ ok: true }) });
    const hosted = new SurfaceCatalogue({ cards: registry });
    const { spec } = buildSurface({ surfaceId: "s1", root: "main", data: { who: "Ada" }, components: [
      { id: "main", component: "Stack", children: ["t", "p"] },
      { id: "t", component: "Text", text: "Beside" },
      { id: "p", component: "Card", kind: "plugin-note", spec: { who: { $path: "/who" } } },
    ] }, { catalogue: hosted });
    const Note = (({ spec: s }: { spec: { who: string } }) => <div>plugin says {s.who}</div>) as unknown as CardRendererMap[string];
    const html = renderToStaticMarkup(
      <CardRendererProvider renderers={{ ...BUILTIN_RENDERERS, "plugin-note": Note }} registry={registry}>
        <SurfaceHostProvider catalogue={hosted}><SurfaceView spec={spec!} /></SurfaceHostProvider>
      </CardRendererProvider>,
    );
    expect(html).toContain("Beside");
    expect(html).toContain("plugin says Ada");
  });

  it("renders a host component through its registered renderer", () => {
    const hosted = new SurfaceCatalogue({ cards, components: [{ name: "Ticker", category: "custom", summary: "t", props: { type: "object", properties: { symbol: { type: "string" } }, additionalProperties: false } }] });
    const { spec } = buildSurface({ surfaceId: "s1", root: "main", data: { s: "ABC" }, components: [{ id: "main", component: "Ticker", symbol: { $path: "/s" } }] }, { catalogue: hosted });
    const html = render(
      <SurfaceHostProvider catalogue={hosted} components={{ Ticker: ({ props }) => <b>{String(props["symbol"])}</b> }}>
        <SurfaceView spec={spec!} />
      </SurfaceHostProvider>,
    );
    expect(html).toContain("<b>ABC</b>");
  });

  it("says when a surface expired or was removed", () => {
    const base = surface([{ id: "main", component: "Text", text: "x" }]);
    expect(render(<SurfaceView spec={{ ...base, expired: true }} />)).toContain("expired from saved history");
    expect(render(<SurfaceView spec={{ ...base, deleted: true }} />)).toContain("was removed");
    const card: Card = { id: "surface:s1", spec: { kind: "surface", expired: true } as never, expired: true };
    expect(render(<CardRenderer card={card} />)).toContain("Ask the agent to rebuild it");
  });
});

const idle: Transport = { kind: "custom", credentialSafe: true, fetch: async () => new Response("{}") };
const clientWith = (registry: CardRegistry, messages: Message[] = []) =>
  new AgentClient({
    provider: createOpenAIProvider({ transport: idle, dialect: "responses" }),
    model: "m",
    contextBuilder: new ContextBuilder({}),
    tools: new ToolRegistry(),
    toolResolution: { presets: [] },
    cards: registry,
    initialMessages: messages,
  });

describe("message order in the transcript", () => {
  const stats = { kind: "stats", items: [{ label: "Seen", value: 1 }] };
  const view = (message: Message, registry = cards) =>
    renderToStaticMarkup(
      <AgentProvider client={clientWith(registry, [message])}>
        <CardRendererProvider renderers={BUILTIN_RENDERERS}><MessageView message={message} /></CardRendererProvider>
      </AgentProvider>,
    );

  it("renders a new turn in the order it happened", () => {
    const html = view({ id: "m", role: "assistant", parts: [
      { type: "text", text: "Before the card." },
      { type: "tool-call", callId: "c1", name: "t", input: {}, status: "done" },
      { type: "tool-result", callId: "c1", name: "t", output: {} },
      { type: "text", text: "After the card." },
      { type: "artifact", id: "a", kind: "card:stats", data: stats, callId: "c1" },
    ] });
    expect(html.indexOf("Before the card.")).toBeLessThan(html.indexOf("Seen"));
    expect(html.indexOf("Seen")).toBeLessThan(html.indexOf("After the card."));
  });

  it("keeps a thread saved before order was recorded exactly as it was", () => {
    const html = view({ id: "m", role: "assistant", parts: [
      { type: "text", text: "Saved text." },
      { type: "artifact", id: "a", kind: "card:stats", data: stats },
    ] });
    expect(html.indexOf("Seen")).toBeLessThan(html.indexOf("Saved text."));
  });

  it("treats a plugin's interactive kind as interactive because the registry says so", () => {
    const registry = new CardRegistry(BUILTIN_CARDS);
    registry.register({ kind: "plugin-ask", interactive: true, summary: "Ask.", schema: { type: "object" }, validate: () => ({ ok: true }) });
    const seen: { answered?: boolean }[] = [];
    const Spy = ((props: { answered?: boolean }) => { seen.push(props); return <div>asked</div>; }) as unknown as CardRendererMap[string];
    const message: Message = { id: "m", role: "assistant", parts: [{ type: "artifact", id: "a", kind: "card:plugin-ask", data: { kind: "plugin-ask" } }] };
    renderToStaticMarkup(
      <AgentProvider client={clientWith(registry, [message])}>
        <CardRendererProvider renderers={{ ...BUILTIN_RENDERERS, "plugin-ask": Spy }}><MessageView message={message} /></CardRendererProvider>
      </AgentProvider>,
    );
    expect(seen[0]?.answered).toBe(true);
  });

  it("treats editreview as interactive, which the old hard-coded list missed", () => {
    const seen: { answered?: boolean }[] = [];
    const Spy = ((props: { answered?: boolean }) => { seen.push(props); return <div>review</div>; }) as unknown as CardRendererMap[string];
    const message: Message = { id: "m", role: "assistant", parts: [{ type: "artifact", id: "a", kind: "card:editreview", data: { kind: "editreview" } }] };
    renderToStaticMarkup(
      <AgentProvider client={clientWith(cards, [message])}>
        <CardRendererProvider renderers={{ ...BUILTIN_RENDERERS, editreview: Spy }}><MessageView message={message} /></CardRendererProvider>
      </AgentProvider>,
    );
    expect(seen[0]?.answered).toBe(true);
  });
});
