// A card that throws while rendering is contained to its own slot. The reader is told
// the card is missing; the error itself goes to the developer console.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CardBoundary } from "./renderer-registry.js";

describe("CardBoundary", () => {
  it("keeps the error out of what the reader sees", () => {
    const boundary = new CardBoundary({ label: "The table card", children: null });
    boundary.state = CardBoundary.getDerivedStateFromError();
    const html = renderToStaticMarkup(boundary.render() as never);
    expect(html).toContain("The table card couldn’t load.");
    expect(html).not.toContain("sc-card--error");
    expect(html).not.toContain('role="alert"');
  });
  it("reports the error to the console", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new TypeError("Cannot read properties of undefined (reading 'rows')");
    new CardBoundary({ label: "The table card", children: null }).componentDidCatch(error);
    expect(log).toHaveBeenCalledWith("[super-chat] The table card failed to render.", error);
    log.mockRestore();
  });
});
