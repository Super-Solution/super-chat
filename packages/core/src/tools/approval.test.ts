import { describe, expect, it } from "vitest";
import { confirmCard } from "../cards/builtin.js";
import { approvalCard, humanizeFieldName } from "./approval.js";

describe("humanizeFieldName", () => {
  it.each([
    ["documentId", "Document"],
    ["max_retry_count", "Max retry count"],
    ["to", "To"],
    ["id", "Id"],
    ["userIds", "User"],
    ["kebab-case-key", "Kebab case key"],
  ])("%s → %s", (key, label) => expect(humanizeFieldName(key)).toBe(label));
});

describe("approvalCard", () => {
  const tool = { description: "Archive a project. It stays readable for 30 days." };

  it("without wording: the first sentence, the plain fields, and a plain question", () => {
    const spec = approvalCard(tool, { projectId: "p_9", notify: true, tags: ["q3", "web"], options: { deep: { x: 1 } }, empty: "  " });
    expect(spec).toEqual({
      kind: "confirm",
      title: "Allow this?",
      description: "Archive a project.",
      summary: [
        { label: "Project", value: "p_9" },
        { label: "Notify", value: "Yes" },
        { label: "Tags", value: "q3, web" },
      ],
      confirmLabel: "Allow",
      cancelLabel: "Not now",
    });
  });

  it("uses the tool's own sentence, question and verb, with no rows unless it lists some", () => {
    const worded = {
      ...tool,
      approval: (input: unknown) => ({
        description: `Your report will be titled “${(input as { title: string }).title}”.`,
        title: "Rename the report?",
        confirmLabel: "Rename",
        danger: false,
      }),
    };
    const spec = approvalCard(worded, { documentId: "launch-report", title: "Launch readiness report" }, { danger: true });
    expect(spec).toEqual({
      kind: "confirm",
      title: "Rename the report?",
      description: "Your report will be titled “Launch readiness report”.",
      summary: [],
      confirmLabel: "Rename",
      cancelLabel: "Not now",
    });
    expect(confirmCard.validate(spec)).toEqual({ ok: true });
  });

  it("keeps only plain text from wording it does not control", () => {
    const hostile = {
      ...tool,
      approval: () => ({
        title: { toString: () => "x" },
        description: `  Delete   ${"x".repeat(400)}`,
        summary: [{ label: "Rows", value: "12" }, { label: 3, value: "n" }, null, "row"],
        confirmLabel: "",
        danger: "yes",
      }),
    };
    const spec = approvalCard(hostile as never, {}) as Record<string, unknown>;
    expect(spec["title"]).toBe("Allow this?");
    expect((spec["description"] as string).length).toBe(240);
    expect((spec["description"] as string).startsWith("Delete x")).toBe(true);
    expect(spec["summary"]).toEqual([{ label: "Rows", value: "12" }]);
    expect(spec["confirmLabel"]).toBe("Allow");
    expect(spec["danger"]).toBeUndefined();
  });

  it("falls back to the generic card when the wording throws or says nothing", () => {
    for (const approval of [() => { throw new Error("bad copy"); }, () => ({ confirmLabel: "Go" }), () => "Rename?"]) {
      expect(approvalCard({ ...tool, approval } as never, { name: "Q3" })).toMatchObject({ title: "Allow this?", description: "Archive a project.", summary: [{ label: "Name", value: "Q3" }] });
    }
  });

  it("counts lists it cannot spell out, and clips long values", () => {
    const spec = approvalCard(tool, { rows: [{ a: 1 }, { a: 2 }], note: "x".repeat(400) });
    expect((spec as { summary?: unknown }).summary).toEqual([
      { label: "Rows", value: "2 items" },
      { label: "Note", value: `${"x".repeat(159)}…` },
    ]);
  });

  it("stops at six fields", () => {
    const input = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`field${i}`, i]));
    expect((approvalCard(tool, input) as { summary?: unknown[] }).summary).toHaveLength(6);
  });

  it("marks a hard-to-undo action", () => {
    expect(approvalCard(tool, {}, { danger: true })).toMatchObject({ danger: true });
  });

  it.each([undefined, null, {}, "plain", 3, [1, 2]])("passes the confirm validator for input %j", (input) => {
    expect(confirmCard.validate(approvalCard(tool, input))).toEqual({ ok: true });
    expect(confirmCard.validate(approvalCard({ description: "" }, input))).toEqual({ ok: true });
  });
});

describe("confirm card", () => {
  it("needs a detail row only when there is no sentence", () => {
    expect(confirmCard.validate({ kind: "confirm", title: "Go?", summary: [] }).ok).toBe(false);
    expect(confirmCard.validate({ kind: "confirm", title: "Go?", description: "  ", summary: [] }).ok).toBe(false);
    expect(confirmCard.validate({ kind: "confirm", title: "Go?", description: "Sends the invoice.", summary: [] })).toEqual({ ok: true });
  });
});
