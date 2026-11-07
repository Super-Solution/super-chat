import { describe, expect, it } from "vitest";
import { normalizeToolName, repairToolArguments } from "./repair.js";

describe("repairToolArguments", () => {
  it("passes valid JSON through unrepaired", () => {
    const r = repairToolArguments('{"symbol":"SUI","limit":10}');
    expect(r.value).toEqual({ symbol: "SUI", limit: 10 });
    expect(r.repaired).toBe(false);
  });

  it("treats an empty string as an empty argument object", () => {
    // Weak models emit "" for no-argument tools; failing that call is pointless.
    expect(repairToolArguments("").value).toEqual({});
    expect(repairToolArguments("null").value).toEqual({});
  });

  it("strips markdown fences", () => {
    const r = repairToolArguments('```json\n{"a":1}\n```');
    expect(r.value).toEqual({ a: 1 });
    expect(r.repaired).toBe(true);
  });

  it("unwraps double-encoded JSON", () => {
    const r = repairToolArguments(JSON.stringify(JSON.stringify({ a: 1 })));
    expect(r.value).toEqual({ a: 1 });
    expect(r.repaired).toBe(true);
  });

  it("escapes raw control characters inside string literals", () => {
    // A literal newline inside a JSON string is invalid; models emit them often.
    const r = repairToolArguments('{"note":"line one\nline two"}');
    expect(r.value).toEqual({ note: "line one\nline two" });
    expect(r.repaired).toBe(true);
  });

  it("drops trailing commas", () => {
    const r = repairToolArguments('{"a":1,"b":[1,2,],}');
    expect(r.value).toEqual({ a: 1, b: [1, 2] });
  });

  it("converts Python literals from local models", () => {
    const r = repairToolArguments('{"ok":True,"off":False,"none":None}');
    expect(r.value).toEqual({ ok: true, off: false, none: null });
  });

  it("extracts an object embedded in prose", () => {
    const r = repairToolArguments('Sure! Here you go: {"symbol":"BTC"} — let me know.');
    expect(r.value).toEqual({ symbol: "BTC" });
  });

  it("does not corrupt apostrophes when the input is already valid", () => {
    // The single-quote fix is destructive, so it must never run on valid JSON.
    const r = repairToolArguments('{"text":"it\'s fine"}');
    expect(r.value).toEqual({ text: "it's fine" });
    expect(r.repaired).toBe(false);
  });

  it("returns an empty object rather than throwing on unsalvageable input", () => {
    const r = repairToolArguments("<<<not json at all>>>");
    expect(r.value).toEqual({});
    expect(r.repaired).toBe(true);
    expect(r.error).toBeDefined();
  });

  it("passes objects through untouched", () => {
    const input = { already: "parsed" };
    expect(repairToolArguments(input).value).toBe(input);
  });
});

describe("normalizeToolName", () => {
  it("strips router-added namespaces", () => {
    expect(normalizeToolName("functions.getPrice")).toBe("getPrice");
    expect(normalizeToolName("mcp_searchDocs")).toBe("searchDocs");
    expect(normalizeToolName("default_api:listPools")).toBe("listPools");
  });

  it("leaves a plain name alone", () => {
    expect(normalizeToolName("getPrice")).toBe("getPrice");
  });
});
