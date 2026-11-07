import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("LiveTurn markdown streaming", () => {
  it("is what LiveTurn renders its streamed text with", () => {
    // There is no DOM renderer in this package's tests, so this reads the
    // component's source, the way rwd.test.ts reads the stylesheet: going back
    // to renderMarkdown(throttledText) would pass every other test here.
    const thread = readFileSync(fileURLToPath(new URL("./Thread.tsx", import.meta.url)), "utf8");
    const start = thread.indexOf("export function LiveTurn(");
    expect(start).toBeGreaterThan(-1);
    const liveTurn = thread.slice(start, thread.indexOf("\n}\n", start));
    expect(liveTurn).toMatch(/renderMarkdownStream\(throttledText, /);
    expect(liveTurn).not.toMatch(/renderMarkdown\(/);
  });
});
