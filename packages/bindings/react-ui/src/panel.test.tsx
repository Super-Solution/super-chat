import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Card, Message } from "@supersolutions/super-chat-core";
import { ChatPanel, ChatPanelProvider } from "./panel.js";
import { MessageView } from "./Thread.js";
import { AgentClient, serverRunConfig } from "@supersolutions/super-chat-client";
import { AgentProvider } from "@supersolutions/super-chat-react";
import { CardRenderer, CardRendererProvider, type CardRendererProps } from "./renderer-registry.js";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// Records where the renderer was asked to draw the card.
const Probe = ({ spec, placement }: CardRendererProps) => <div data-probe={placement ?? "none"}>{(spec as { title?: string }).title}</div>;
const renderers = { "x.board": Probe as never, confirm: Probe as never };

const panelCard = { id: "p1", placement: "panel", spec: { kind: "x.board", title: "BTC weekly" } } as unknown as Card;
const inlineCard = { id: "i1", spec: { kind: "x.board", title: "Inline board" } } as unknown as Card;

const render = (node: ReactNode) => renderToStaticMarkup(<CardRendererProvider renderers={renderers}>{node}</CardRendererProvider>);

describe("panel cards in the chat", () => {
  it("leave a line that reopens them when the host has a panel", () => {
    const html = render(
      <ChatPanelProvider>
        <CardRenderer card={panelCard} />
      </ChatPanelProvider>,
    );
    expect(html).toContain("sc-panel-line");
    expect(text(html)).toBe("BTC weekly Opened beside the chat Open");
    expect(html).not.toContain("data-probe");
  });

  it("come back to the panel when a saved turn is shown again", () => {
    const saved: Message = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "artifact", id: "p1", kind: "card:x.board", data: { kind: "x.board", title: "BTC weekly" }, placement: "panel" },
        { type: "artifact", id: "i1", kind: "card:x.board", data: { kind: "x.board", title: "Inline board" } },
      ],
    };
    const client = new AgentClient(serverRunConfig({ runner: async function* () {} }));
    const html = render(
      <AgentProvider client={client}>
        <ChatPanelProvider>
          <MessageView message={saved} />
        </ChatPanelProvider>
      </AgentProvider>,
    );
    expect(text(html)).toContain("BTC weekly Opened beside the chat Open");
    expect(html.match(/data-probe="[^"]+"/g)).toEqual(['data-probe="inline"']);
  });

  it("are drawn inline when the host has no panel", () => {
    const html = render(<CardRenderer card={panelCard} />);
    expect(html).toContain('data-probe="inline"');
    expect(html).not.toContain("sc-panel-line");
  });

  it("never take an interactive card out of the chat", () => {
    const confirm = { id: "c1", placement: "panel", spec: { kind: "confirm", title: "Go?" } } as unknown as Card;
    const html = render(
      <ChatPanelProvider>
        <CardRenderer card={confirm} respond={() => {}} />
      </ChatPanelProvider>,
    );
    expect(html).not.toContain("sc-panel-line");
  });

  it("leave inline cards alone", () => {
    const html = render(
      <ChatPanelProvider>
        <CardRenderer card={inlineCard} />
      </ChatPanelProvider>,
    );
    expect(html).toContain('data-probe="inline"');
  });

  it("take the host's words", () => {
    const html = render(
      <ChatPanelProvider labels={{ opened: "已在側邊開啟", open: "打開" }}>
        <CardRenderer card={panelCard} />
      </ChatPanelProvider>,
    );
    expect(text(html)).toBe("BTC weekly 已在側邊開啟 打開");
  });
});

describe("ChatPanel", () => {
  it("renders nothing, or the host's empty state, while closed", () => {
    expect(render(<ChatPanelProvider><ChatPanel /></ChatPanelProvider>)).toBe("");
    expect(text(render(<ChatPanelProvider><ChatPanel empty={<p>Nothing open</p>} /></ChatPanelProvider>))).toBe("Nothing open");
  });

  it("draws the open card with the panel placement under its title", () => {
    const html = render(
      <ChatPanelProvider initialCard={panelCard}>
        <ChatPanel />
      </ChatPanelProvider>,
    );
    expect(html).toContain('aria-label="BTC weekly"');
    expect(html).toContain('data-probe="panel"');
    expect(html).toContain('aria-label="Close panel"');
  });

  it("lets the host draw its own chrome", () => {
    const html = render(
      <ChatPanelProvider initialCard={panelCard}>
        <ChatPanel header={false}>{(card) => <span>custom {card.id}</span>}</ChatPanel>
      </ChatPanelProvider>,
    );
    expect(text(html)).toBe("custom p1");
    expect(html).not.toContain("sc-panel__header");
  });

  it("throws outside a provider", () => {
    expect(() => renderToStaticMarkup(<ChatPanel />)).toThrow(/ChatPanelProvider/);
  });
});
