import { describe, expect, it } from "vitest";
import { hasComposerContent } from "./Thread";

describe("hasComposerContent", () => {
  it("enables a quote-only send", () => {
    expect(hasComposerContent("", 0, 1)).toBe(true);
  });

  it("keeps an empty composer disabled", () => {
    expect(hasComposerContent("   ", 0, 0)).toBe(false);
  });

  it("still accepts text or attachments", () => {
    expect(hasComposerContent("explain this", 0, 0)).toBe(true);
    expect(hasComposerContent("", 1, 0)).toBe(true);
  });
});
