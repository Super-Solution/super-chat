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

import { matchesAccept } from "./Thread";

describe("matchesAccept", () => {
  const file = (name: string, type: string) => ({ name, type });
  it("takes a MIME type, a wildcard and an extension, as the file picker does", () => {
    expect(matchesAccept(file("a.png", "image/png"), "image/*,application/pdf")).toBe(true);
    expect(matchesAccept(file("a.pdf", "application/pdf"), "image/*,application/pdf")).toBe(true);
    expect(matchesAccept(file("a.csv", ""), ".csv, .tsv")).toBe(true);
    expect(matchesAccept(file("A.CSV", ""), ".csv")).toBe(true);
  });
  it("refuses what the list does not name", () => {
    expect(matchesAccept(file("a.zip", "application/zip"), "image/*,application/pdf,text/*")).toBe(false);
    expect(matchesAccept(file("a.exe", ""), "image/*")).toBe(false);
    expect(matchesAccept(file("a.png", "image/png"), "")).toBe(false);
  });
});
