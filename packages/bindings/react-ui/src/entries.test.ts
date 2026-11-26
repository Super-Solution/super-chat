import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as index from "./index.js";
import * as cards from "./entry-cards.js";
import * as agent from "./entry-agent.js";
import * as surfaces from "./entry-surfaces.js";
import * as labels from "./entry-labels.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, unknown> };
const tsup = readFileSync(new URL("../tsup.config.ts", import.meta.url), "utf8");

describe("subpath entries", () => {
  const entries = { cards, agent, surfaces, labels } as const;

  it("export the very same things as the package root, so there is one copy of every context", () => {
    for (const [name, entry] of Object.entries(entries)) {
      const names = Object.keys(entry);
      expect(names.length, name).toBeGreaterThan(0);
      for (const key of names) {
        expect((index as Record<string, unknown>)[key], `${name}.${key}`).toBe((entry as Record<string, unknown>)[key]);
      }
    }
  });

  it("are each declared in package.json and built by tsup", () => {
    for (const name of Object.keys(entries)) {
      expect(pkg.exports[`./${name}`], name).toMatchObject({
        types: `./dist/${name}.d.ts`,
        import: `./dist/${name}.js`,
      });
      expect(tsup, name).toContain(`${name}: "src/entry-${name}.ts"`);
    }
  });

  it("between them leave nothing of the package root out of reach but the conversation itself", () => {
    // The root's components for a thread live only at the root: they are the thing the
    // subpaths exist to avoid. Anything else exported at the root must be reachable from a subpath.
    const reachable = new Set(Object.values(entries).flatMap((e) => Object.keys(e)));
    const threadOnly = new Set([
      "Thread", "Composer", "MessageView", "LiveTurn", "matchesAccept", "Suggestions", "EmptyThread",
      "ChatPanel", "ChatPanelProvider", "PanelCardLine", "useChatPanel", "useOptionalChatPanel",
      "ContextInspector", "ToastProvider", "ConnectionBanner", "useToast", "ProseHtml",
      "MarkdownProvider", "useMarkdownOptions", "DocumentQuoteProvider", "useDocumentQuotes",
    ]);
    const missing = Object.keys(index).filter((k) => !reachable.has(k) && !threadOnly.has(k));
    expect(missing).toEqual([]);
  });
});
