import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "@supersolutions/super-chat-core";
import { ConfirmCardView } from "./cards/Interactive.js";
import { CardBoundary, CardRenderer, CardRendererProvider } from "./renderer-registry.js";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("cards a reader cannot use", () => {
  it("shows the card's own alt text when no renderer is registered, never its kind or JSON", () => {
    // The console warning for developers fires in an effect, after the first paint.
    const card = { id: "k1", spec: { kind: "super.plot", spec: { data: [{ x: [1] }] }, alt: "Revenue rose each quarter of 2026." } } as unknown as Card;
    const html = renderToStaticMarkup(<CardRenderer card={card} />);
    expect(text(html)).toBe("Revenue rose each quarter of 2026. Shown as text because this card couldn’t load.");
    expect(html).not.toMatch(/super\.plot|unrendered|&quot;|\{/);
  });

  it("names an unrendered card by its title, or not at all", () => {
    const titled = { id: "k2", spec: { kind: "sankey", title: "Where signups come from", nodes: [] } } as unknown as Card;
    expect(text(renderToStaticMarkup(<CardRenderer card={titled} />))).toBe("“Where signups come from” couldn’t load.");
    const bare = { id: "k3", spec: { kind: "sankey", nodes: [] } } as unknown as Card;
    expect(text(renderToStaticMarkup(<CardRenderer card={bare} />))).toBe("This card couldn’t load.");
  });

  it("names no kind when a saved result has expired", () => {
    const card = { id: "k4", expired: true, spec: { kind: "table" } } as unknown as Card;
    expect(text(renderToStaticMarkup(<CardRenderer card={card} />))).toBe("This result expired from saved history. Ask again to refresh it.");
  });

  it("keeps a renderer's kind out of the fallback and in the console", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new CardBoundary({ children: null, kind: "table", spec: { kind: "table", title: "Quarterly revenue" } });
    boundary.state = CardBoundary.getDerivedStateFromError();
    boundary.componentDidCatch(new Error("cannot read 'x' of undefined"));
    expect(text(renderToStaticMarkup(<>{boundary.render()}</>))).toBe("“Quarterly revenue” couldn’t load.");
    expect(log.mock.calls[0]![0]).toBe('[super-chat] The "table" card failed to render.');
    log.mockRestore();
  });
});

describe("confirm card", () => {
  it("reads as what will happen, then the question, then the verbs", () => {
    const spec = {
      kind: "confirm" as const,
      title: "Rename the document?",
      description: "This document will be titled “Launch readiness report”.",
      summary: [],
      confirmLabel: "Rename",
      cancelLabel: "Not now",
    };
    const html = renderToStaticMarkup(
      <CardRendererProvider renderers={{ confirm: ConfirmCardView as never }}>
        <CardRenderer card={{ id: "c", spec } as unknown as Card} respond={() => {}} />
      </CardRendererProvider>,
    );
    expect(text(html)).toBe("This document will be titled “Launch readiness report”. Rename the document? Rename Not now");
    expect(html).not.toContain("<dl");
  });
});
