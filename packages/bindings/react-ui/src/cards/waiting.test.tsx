import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Card, CardSpec } from "@supersolutions/super-chat-core";
import { CardRenderer, CardRendererProvider } from "../renderer-registry.js";
import { BUILTIN_RENDERERS } from "./index.js";

/**
 * "Whose turn is it?" is the question every agent state has to answer. An open
 * question says so in words and with a border, and stops saying so the moment it
 * has been answered: a chip left behind would claim the run is still waiting.
 */

const SPECS: Record<string, CardSpec> = {
  choice: { kind: "choice", prompt: "Which vendor?", options: [{ id: "a", label: "Halcyon" }] },
  form: { kind: "form", fields: [{ name: "email", label: "Email", type: "text" }] },
  confirm: { kind: "confirm", title: "Delete three files?", summary: [] },
  editreview: { kind: "editreview", docId: "d", revision: 1, hunks: [] },
};

const render = (card: Card, answered = false) =>
  renderToStaticMarkup(
    <CardRendererProvider renderers={BUILTIN_RENDERERS}>
      <CardRenderer card={card} answered={answered} respond={() => {}} />
    </CardRendererProvider>,
  );

describe.each(Object.keys(SPECS))("%s card", (kind) => {
  const card: Card = { id: "c1", callId: "call_1", spec: SPECS[kind]! };

  it("shows that it is waiting for the person while unanswered", () => {
    const html = render(card);
    expect(html).toContain('data-waiting=""');
    expect(html).toContain('<span class="sc-turnchip">Your turn</span>');
  });

  it("drops the waiting state once answered", () => {
    const html = render(card, true);
    expect(html).not.toContain("data-waiting");
    expect(html).not.toContain("sc-turnchip");
  });
});
