import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@supersolutions/super-chat-ui-core";
import { CardRefProvider, ProseHtml, useCardRefHost } from "./card-refs.js";

const html = renderMarkdown("see [support](ref:btc?key=support) and [docs](https://example.com)");

// Interaction (hover, focus, Enter, Escape, a stale ref turning to text) needs a DOM and is
// exercised in a browser; what can be pinned without one is that the server markup is the
// renderer's own, so hydration never disagrees, and that a ref stays inert with no host.
describe("ProseHtml", () => {
  it("renders the markdown's own markup with no host, refs as plain spans", () => {
    const out = renderToString(<ProseHtml className="sc-prose" html={html} />);
    expect(out).toContain(`<div class="sc-prose">${html}</div>`);
    expect(out).toContain('<span class="sc-ref" data-ref="ref:btc?key=support">support</span>');
    expect(out).not.toContain("tabindex");
    expect(out).not.toContain("data-ref-live");
  });

  it("renders the same markup under a host, with a polite live region for labels", () => {
    const host = { ref: () => ({ ok: true as const }) };
    const out = renderToString(
      <CardRefProvider host={host}>
        <ProseHtml className="sc-prose" html={html} />
      </CardRefProvider>,
    );
    expect(out).toContain(`<div class="sc-prose">${html}</div>`);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
  });

  it("exposes the host only inside a provider", () => {
    const seen: unknown[] = [];
    const Probe = () => {
      seen.push(useCardRefHost());
      return null;
    };
    const host = { ref: () => ({ ok: true as const }) };
    renderToString(<Probe />);
    renderToString(<CardRefProvider host={host}><Probe /></CardRefProvider>);
    expect(seen).toEqual([undefined, host]);
  });
});
