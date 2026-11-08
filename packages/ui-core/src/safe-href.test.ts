import { describe, expect, it } from "vitest";
import { safeHref } from "./format.js";

describe("safeHref", () => {
  it("passes http and https links, trimmed", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("  http://example.com ")).toBe("http://example.com");
    expect(safeHref("HTTPS://EXAMPLE.COM")).toBe("HTTPS://EXAMPLE.COM");
  });

  it("rejects script-bearing and non-web schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//evil.example/x",
      "/relative/path",
      "https://exa mple.com",
      "",
    ]) {
      expect(safeHref(bad)).toBeUndefined();
    }
  });

  it("rejects values that are not strings", () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(42 as unknown as string)).toBeUndefined();
  });
});
