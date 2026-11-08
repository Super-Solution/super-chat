// Accessible names and roles on the composer, the one control every user reaches.
// Rendered to static markup: what a screen reader is given on first paint.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextBuilder, ToolRegistry, createOpenAIProvider, type Transport } from "@supersolutions/super-chat-core";
import { AgentClient } from "@supersolutions/super-chat-client";
import { AgentProvider } from "@supersolutions/super-chat-react";
import { Composer } from "./Thread.js";
import { SuggestMenu, suggestOptionId } from "./Autocomplete.js";

const transport: Transport = { kind: "custom", credentialSafe: true, fetch: () => Promise.reject(new Error("offline")) };
const client = () =>
  new AgentClient({
    provider: createOpenAIProvider({ transport }),
    model: "m",
    contextBuilder: new ContextBuilder({ identity: "Test.", contextWindow: 32_000 }),
    tools: new ToolRegistry(),
    toolResolution: { presets: [] },
  });

const composer = (props: Parameters<typeof Composer>[0] = {}) =>
  renderToStaticMarkup(
    <AgentProvider client={client()}>
      <Composer {...props} />
    </AgentProvider>,
  );

describe("Composer accessibility", () => {
  it("names the message field even when the host removes the placeholder", () => {
    expect(composer()).toMatch(/<textarea[^>]*aria-label="Message"/);
    expect(composer({ placeholder: "" })).toMatch(/<textarea[^>]*aria-label="Message"/);
  });

  it("offers file attachment as a focusable button, not a label around a display:none input", () => {
    const html = composer();
    expect(html).toMatch(/<button[^>]*title="Attach a file"/);
    expect(html).not.toMatch(/<label[^>]*title="Attach a file"/);
    // The input is only a target for the button's click: out of the tab order and the a11y tree.
    expect(html).toMatch(/<input[^>]*type="file"[^>]*tabindex="-1"[^>]*aria-hidden/);
  });

  it("points the textarea at the suggestion menu only while it is open", () => {
    // Closed on first paint: no dangling reference to an element that is not in the DOM.
    const html = composer();
    expect(html).not.toContain("aria-activedescendant");
    expect(html).not.toContain("aria-controls");
    expect(html).toContain('aria-autocomplete="list"');
  });
});

describe("SuggestMenu accessibility", () => {
  const items = [
    { id: "legal", label: "Legal review" },
    { id: "tax", label: "Tax", hint: "Quarterly" },
  ];

  it("is a listbox that owns only options, each with an id the input can reference", () => {
    const html = renderToStaticMarkup(<SuggestMenu id="m1" items={items} active={1} onPick={() => {}} />);
    expect(html).toContain('role="listbox"');
    expect(html).toContain('id="m1"');
    expect(html.match(/role="presentation"/g)).toHaveLength(2); // the <li> wrappers
    expect(html).toContain(`id="${suggestOptionId("m1", 0)}"`);
    expect(html).toContain(`id="${suggestOptionId("m1", 1)}"`);
    expect(html).toMatch(/id="m1-opt-1"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="m1-opt-0"[^>]*aria-selected="false"/);
    // Highlighting follows the arrow keys, not Tab: the options stay out of the tab order.
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });
});
