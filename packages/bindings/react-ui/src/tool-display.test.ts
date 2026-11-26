import { describe, expect, it } from "vitest";
import { describeCall } from "./tool-display.js";

const tool = {
  display: {
    label: (input: unknown) => `Search “${(input as { q: string }).q}”`,
    summary: (output: unknown) => `${(output as { hits: unknown[] }).hits.length} results`,
  },
};

describe("describeCall", () => {
  it("says nothing for a tool with no display, so the row keeps the tool's name", () => {
    expect(describeCall(undefined, {}, {}, true)).toEqual({});
    expect(describeCall({}, {}, {}, true)).toEqual({});
  });

  it("labels the call, and summarises it only once it has finished", () => {
    expect(describeCall(tool, { q: "clause 3" }, undefined, false)).toEqual({ label: "Search “clause 3”", summary: undefined });
    expect(describeCall(tool, { q: "clause 3" }, { hits: [1, 2, 3, 4] }, true)).toEqual({ label: "Search “clause 3”", summary: "4 results" });
  });

  it("treats a function that throws, or answers with something that is not text, as absent", () => {
    const bad = { display: { label: () => { throw new Error("boom"); }, summary: () => 42 as unknown as string } };
    expect(describeCall(bad, {}, {}, true)).toEqual({ label: undefined, summary: undefined });
    // The model may send input the author did not expect; that is the tool's problem, not a crash.
    expect(describeCall(tool, null, { hits: [] }, true).label).toBeUndefined();
  });

  it("keeps a row to one line", () => {
    const long = { display: { label: () => `a\n${"word ".repeat(100)}` } };
    const { label } = describeCall(long, {}, {}, false);
    expect(label).not.toContain("\n");
    expect(label!.length).toBeLessThanOrEqual(140);
    expect(label!.endsWith("…")).toBe(true);
  });
});
