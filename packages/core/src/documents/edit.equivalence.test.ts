// applyEdits, searchBlocks and outlineOf against the code they replaced.
//
// The rewrite changed how results are built — one splice instead of a re-slice
// per edit, hits counted instead of collected, one block split instead of two —
// and none of what they are. The reference below is that earlier code, kept
// only for this file, and every generated case has to come out identical: the
// same text, offsets and blocks, and the same refusals with the same messages.

import { isDeepStrictEqual } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { splitBlocks, type MarkdownBlock } from "../content/blocks.js";
import { applyEdits, hunksOf, outlineOf, searchBlocks } from "./edit.js";
import type { AppliedEdit, DocumentEdit, DocumentOutlineEntry, EditResult } from "./types.js";

// Pass-through, so the split can be counted.
vi.mock("../content/blocks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../content/blocks.js")>();
  return { ...actual, splitBlocks: vi.fn(actual.splitBlocks) };
});

// ── Pre-fix reference: documents/edit.ts at 6a965ed. Test-only. ─────────────

const referenceHeadingLevel = (line: string): number | undefined => {
  const m = /^ {0,3}(#{1,6})\s/.exec(line);
  return m ? m[1]!.length : undefined;
};

function referenceOutlineOf(markdown: string): DocumentOutlineEntry[] {
  return splitBlocks(markdown).map((block, i) => {
    const raw = markdown.slice(block.start, block.end);
    const firstLine = raw.split("\n", 1)[0] ?? "";
    const level = block.kind === "text" ? referenceHeadingLevel(firstLine) : undefined;
    return {
      block: i,
      kind: block.kind,
      ...(level ? { level } : {}),
      preview: firstLine.trim().slice(0, 100),
      chars: raw.length,
    };
  });
}

function referenceSearchBlocks(markdown: string, query: string): DocumentOutlineEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const blocks = splitBlocks(markdown);
  return referenceOutlineOf(markdown).filter((entry) => {
    const b = blocks[entry.block]!;
    return markdown.slice(b.start, b.end).toLowerCase().includes(needle);
  });
}

function referenceOccurrences(haystack: string, needle: string, offset = 0): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    out.push(i + offset);
  }
  return out;
}

const referenceBlockOf = (blocks: MarkdownBlock[], index: number): number =>
  Math.max(
    0,
    blocks.findIndex((b) => index >= b.start && index < b.end),
  );

function referenceApplyEdits(markdown: string, edits: readonly DocumentEdit[]): EditResult {
  if (!edits.length) return { ok: true, markdown, applied: [] };

  const blocks = splitBlocks(markdown);
  const applied: AppliedEdit[] = [];

  for (const edit of edits) {
    if (!edit.find) {
      return { ok: false, reason: "not-found", message: "An edit needs a non-empty `find`.", edit };
    }

    let hits: number[];
    if (edit.block === undefined) {
      hits = referenceOccurrences(markdown, edit.find);
    } else {
      const block = blocks[edit.block];
      if (!block) {
        return {
          ok: false,
          reason: "no-such-block",
          message: `Block ${edit.block} does not exist; the document has ${blocks.length}.`,
          edit,
        };
      }
      hits = referenceOccurrences(markdown.slice(block.start, block.end), edit.find, block.start);
    }

    if (hits.length === 0) {
      return {
        ok: false,
        reason: "not-found",
        message:
          `Could not find that text${edit.block === undefined ? "" : ` in block ${edit.block}`}. ` +
          "Re-read the document and quote it exactly, whitespace included.",
        edit,
      };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        message:
          `That text appears ${hits.length} times. Include more surrounding text, or name the block.`,
        edit,
      };
    }

    const start = hits[0]!;
    const end = start + edit.find.length;
    const clash = applied.find((a) => start < a.end && end > a.start);
    if (clash) {
      return {
        ok: false,
        reason: "ambiguous",
        message: "Two edits target overlapping text. Send them as one edit instead.",
        edit,
      };
    }

    applied.push({ edit, start, end, block: referenceBlockOf(blocks, start) });
  }

  let out = markdown;
  for (const a of [...applied].sort((x, y) => y.start - x.start)) {
    out = out.slice(0, a.start) + a.edit.replace + out.slice(a.end);
  }

  return { ok: true, markdown: out, applied };
}

// ── Generators ──────────────────────────────────────────────────────────────

/** mulberry32: small, seeded, and the same sequence on every machine. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const int = (r: Rand, n: number) => Math.floor(r() * n);
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[int(r, xs.length)]!;

// Few distinct pieces, so short finds repeat (ambiguous) and long ones do not.
// Markdown structure for the splitter, CRLF, astral and case-changing letters.
const PIECES = [
  "a", "b", "ab", "aa", " ", ".", "x", "The cap", "\n", "\n\n", "\r\n", "\r\n\r\n",
  "# ", "## ", "- ", "1. ", "> ", "```", "~~~", "    ", "\t", "|", "Σ", "ΑΣ ", "é", "İ", "😀", "𝒜",
] as const;

/** Up to `max` pieces; with `marks`, some are numbered tokens that occur once. */
function text(r: Rand, max: number, marks = false): string {
  let s = "";
  for (let n = int(r, max); n > 0; n -= 1) s += marks && r() < 0.2 ? `<${n}>` : pick(r, PIECES);
  return s;
}

function replacement(r: Rand): string {
  const k = int(r, 20);
  if (k === 0) return "";
  // Not strings, which the type forbids and a model can still send: the text
  // they become is part of what has to stay the same.
  if (k === 1) return null as unknown as string;
  if (k === 2) return 7 as unknown as string;
  return text(r, 6);
}

/** Edits aimed at the awkward cases: adjacent, same offset, overlapping, ends. */
function editsFor(r: Rand, md: string): DocumentEdit[] {
  const blocks = splitBlocks(md);
  const edits: DocumentEdit[] = [];
  let prevStart = 0;
  let prevEnd = 0;
  // Numbered tokens, each used at most once by a clean list.
  const marks = [...md.matchAll(/<\d+>/g)].map((m) => [m.index, m[0].length] as const);
  // Some lists aim only where an edit can land, so that several succeed together.
  const clean = r() < 0.5;
  for (let n = int(r, 8); n > 0; n -= 1) {
    let start: number;
    let len: number;
    let kind = -1;
    if (clean) {
      const k = int(r, 10);
      const mark = k < 7 ? marks.splice(int(r, marks.length), 1)[0] : undefined;
      if (mark) [start, len] = [mark[0] - int(r, 2), mark[1] + int(r, 3)]; // a unique token
      else if (k === 9 && n === 1) [start, len] = [prevEnd, md.length - prevEnd]; // the rest of the document
      else [start, len] = [prevEnd, 1 + int(r, 3)]; // adjacent to the previous edit
      start = Math.max(0, start);
    } else {
      kind = int(r, 10);
      start = int(r, md.length + 1);
      if (kind === 0) start = prevEnd; // adjacent to the previous edit
      else if (kind === 1) start = prevStart; // same offset
      else if (kind === 2) start = Math.max(0, prevEnd - 1 - int(r, 3)); // overlapping
      else if (kind === 3) start = 0; // start of the document
      len = kind === 4 ? md.length - start : 1 + int(r, kind >= 8 ? 20 : 8); // 4: to the end
    }
    let find = md.slice(start, start + len);
    if (kind === 5) find = pick(r, ["", "zz", "QQQ", "a\nb", "\uDE00", "\r"]);
    const edit: DocumentEdit = { find, replace: replacement(r) };
    const b = int(r, 10);
    const home = blocks.findIndex((x) => start >= x.start && start < x.end);
    if (b < 3 && (!clean || home >= 0)) edit.block = home;
    else if (!clean && b === 3) edit.block = int(r, blocks.length + 2);
    else if (!clean && b === 4) edit.block = pick(r, [-1, 99, 0.5]);
    edits.push(edit);
    prevStart = start;
    prevEnd = start + find.length;
  }
  return edits;
}

/** A document with many unique anchors, and edits over a random subset of them. */
function markedCase(r: Rand): { md: string; edits: DocumentEdit[] } {
  const paragraphs = Array.from({ length: 20 + int(r, 200) }, (_, i) => `[P${i}] ${text(r, 12)}`);
  const md = paragraphs.join(pick(r, ["\n\n", "\r\n\r\n", "\n"]));
  const blocks = splitBlocks(md);
  // Distinct paragraphs in random order, and now and then one twice.
  const order = paragraphs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = int(r, i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const chosen = order.slice(0, int(r, Math.min(80, order.length)));
  if (chosen.length && r() < 0.1) chosen.push(pick(r, chosen));
  const edits: DocumentEdit[] = chosen.map((i) => {
    const at = md.indexOf(`[P${i}] `);
    // Anchor on the marker, sometimes running on into the paragraph and, rarely,
    // far enough to reach the next marker — an overlap that must be refused.
    const find = md.slice(at, at + `[P${i}] `.length + (r() < 0.02 ? 80 : int(r, 4)));
    const edit: DocumentEdit = { find, replace: replacement(r) };
    if (r() < 0.5) edit.block = blocks.findIndex((x) => at >= x.start && at < x.end);
    return edit;
  });
  return { md, edits };
}

/** What a call returned, or what it threw. */
function outcome<T>(fn: () => T): { value: T } | { threw: string } {
  try {
    return { value: fn() };
  } catch (e) {
    return { threw: String(e) };
  }
}

function sameAsReference(md: string, edits: readonly DocumentEdit[]): string | null {
  const got = applyEdits(md, edits);
  const want = referenceApplyEdits(md, edits);
  if (!isDeepStrictEqual(got, want)) return "result";
  if (got.ok && want.ok && !isDeepStrictEqual(outcome(() => hunksOf(got.applied)), outcome(() => hunksOf(want.applied)))) {
    return "hunks";
  }
  return null;
}

// ── Differential ────────────────────────────────────────────────────────────

describe("applyEdits matches the pre-fix implementation", () => {
  it("on 20,000 generated documents and edit lists", () => {
    const r = prng(0x5eed);
    const mismatches: unknown[] = [];
    let applied = 0;
    for (let n = 0; n < 20_000; n += 1) {
      const md = text(r, 40, true);
      const edits = editsFor(r, md);
      const diff = sameAsReference(md, edits);
      if (diff) mismatches.push({ md, edits, diff });
      if (applyEdits(md, edits).ok && edits.length > 1) applied += 1;
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
    // The generator has to reach the rebuild with several edits, not only refusals.
    expect(applied).toBeGreaterThan(1_500);
  });

  it("on 400 documents with many edits each", () => {
    const r = prng(0xd0c5);
    const mismatches: unknown[] = [];
    let many = 0;
    for (let n = 0; n < 400; n += 1) {
      const { md, edits } = markedCase(r);
      const diff = sameAsReference(md, edits);
      if (diff) mismatches.push({ edits: edits.length, diff });
      const out = applyEdits(md, edits);
      if (out.ok && out.applied.length >= 10) many += 1;
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(many).toBeGreaterThan(20);
  });
});

describe("searchBlocks and outlineOf match the pre-fix implementation", () => {
  it("on 20,000 generated documents and queries", () => {
    const r = prng(0x5ea7c4);
    const mismatches: unknown[] = [];
    let found = 0;
    for (let n = 0; n < 20_000; n += 1) {
      const md = text(r, 40);
      const start = int(r, md.length + 1);
      let query = md.slice(start, start + 1 + int(r, 10));
      const k = int(r, 8);
      if (k === 0) query = pick(r, ["", "   ", "\n", "σ", "Σ", "ς", "i̇", "😀", "THE CAP", "zz"]);
      else if (k === 1) query = query.toUpperCase();
      else if (k === 2) query = `  ${query}\t`;
      const got = searchBlocks(md, query);
      if (!isDeepStrictEqual(got, referenceSearchBlocks(md, query))) mismatches.push({ md, query });
      if (!isDeepStrictEqual(outlineOf(md), referenceOutlineOf(md))) mismatches.push({ md, outline: true });
      if (got.length) found += 1;
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(found).toBeGreaterThan(5_000);
  });
});

describe("applyEdits edge cases", () => {
  const check = (md: string, edits: DocumentEdit[]) => {
    const got = applyEdits(md, edits);
    expect(got).toEqual(referenceApplyEdits(md, edits));
    return got;
  };

  it("splices adjacent edits with nothing lost or doubled between them", () => {
    const got = check("abcdef", [
      { find: "cd", replace: "X" },
      { find: "ab", replace: "Y" },
      { find: "ef", replace: "Z" },
    ]);
    expect(got).toMatchObject({ ok: true, markdown: "YXZ" });
  });

  it("edits the very start and the very end of the document", () => {
    expect(check("start middle end", [{ find: "end", replace: "E" }, { find: "start", replace: "S" }])).toMatchObject({
      ok: true,
      markdown: "S middle E",
    });
    expect(check("whole", [{ find: "whole", replace: "" }])).toMatchObject({ ok: true, markdown: "" });
  });

  it("refuses two edits at the same offset as overlapping", () => {
    const got = check("alpha beta", [{ find: "alpha", replace: "A" }, { find: "alpha b", replace: "B" }]);
    expect(got).toMatchObject({ ok: false, reason: "ambiguous", message: expect.stringMatching(/overlapping/) });
  });

  it("counts overlapping occurrences when it refuses an ambiguous anchor", () => {
    const got = check("aaaa", [{ find: "aa", replace: "b" }]);
    expect(got).toMatchObject({ ok: false, reason: "ambiguous", message: expect.stringMatching(/appears 3 times/) });
  });

  it("keeps CRLF line endings byte for byte", () => {
    const md = "one\r\n\r\ntwo\r\n\r\nthree\r\n";
    const got = check(md, [{ block: 1, find: "two", replace: "2" }, { find: "\r\nthree\r\n", replace: "\r\n3\r\n" }]);
    expect(got).toMatchObject({ ok: true, markdown: "one\r\n\r\n2\r\n\r\n3\r\n" });
  });

  it("addresses astral characters by UTF-16 offset", () => {
    expect(check("😀a😀b", [{ find: "a😀", replace: "-" }])).toMatchObject({ ok: true, markdown: "😀-b" });
    expect(check("😀a😀b", [{ find: "😀", replace: "-" }])).toMatchObject({ ok: false, reason: "ambiguous" });
    // Half a surrogate pair is still text that occurs twice.
    expect(check("😀a😀b", [{ find: "\uDE00", replace: "-" }])).toMatchObject({
      message: expect.stringMatching(/appears 2 times/),
    });
  });

  it("gives the same text whatever order the edits arrive in", () => {
    const md = "one two three four";
    const edits = [
      { find: "one", replace: "1" },
      { find: "three", replace: "3" },
      { find: " four", replace: "" },
    ];
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0]]) {
      expect(check(md, order.map((i) => edits[i]!))).toMatchObject({ ok: true, markdown: "1 two 3" });
    }
  });

  it("refuses an empty find, a missing one and a missing block the same way", () => {
    expect(check("abc", [{ find: "", replace: "x" }])).toMatchObject({ ok: false, reason: "not-found" });
    expect(check("abc", [{ find: "zz", replace: "x" }])).toMatchObject({ ok: false, reason: "not-found" });
    expect(check("abc", [{ block: 1, find: "a", replace: "x" }])).toMatchObject({ ok: false, reason: "no-such-block" });
  });
});

// ── Cost ────────────────────────────────────────────────────────────────────
// Counted, not timed: these hold on any machine at any load.

/** Characters returned by String.prototype.slice while `fn` runs. */
function slicedChars<T>(fn: () => T): { result: T; chars: number } {
  const slice = String.prototype.slice;
  let chars = 0;
  String.prototype.slice = function (this: string, start?: number, end?: number) {
    const s = slice.call(this, start, end);
    chars += s.length;
    return s;
  };
  try {
    return { result: fn(), chars };
  } finally {
    String.prototype.slice = slice;
  }
}

/** Calls to Array.prototype.push while `fn` runs. */
function arrayPushes<T>(fn: () => T): { result: T; pushes: number } {
  const push = Array.prototype.push;
  let pushes = 0;
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    pushes += 1;
    return push.apply(this, items);
  };
  try {
    return { result: fn(), pushes };
  } finally {
    Array.prototype.push = push;
  }
}

describe("editing cost", () => {
  it("rebuilds a many-edit document in one pass instead of once per edit", () => {
    // Re-slicing the rewritten document once per edit copies edits × length
    // characters. One pass copies each unchanged stretch once.
    const md = Array.from({ length: 400 }, (_, i) => `[P${i}] ${"lorem ipsum ".repeat(20)}`).join("\n\n");
    const edits = Array.from({ length: 200 }, (_, i) => ({ find: `[P${i * 2}] `, replace: `[Q${i * 2}] ` }));
    const { result, chars } = slicedChars(() => applyEdits(md, edits));
    expect(result.ok).toBe(true);
    // Splitting the blocks slices every line once and the rebuild the rest; 200
    // re-slices would be about 200 × the length.
    expect(chars).toBeLessThan(4 * md.length);
  });

  it("counts the hits of an ambiguous anchor rather than collecting them", () => {
    const { result, pushes } = arrayPushes(() => applyEdits("a".repeat(20_000), [{ find: "a", replace: "b" }]));
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/appears 20000 times/) });
    expect(pushes).toBeLessThan(100);
  });

  it("splits the document once to search it", () => {
    const md = "# Title\n\nThe cap is 12 months.\n\n- one\n- two\n\nThe cap again.";
    vi.mocked(splitBlocks).mockClear();
    expect(searchBlocks(md, "cap").map((m) => m.block)).toEqual([1, 3]);
    expect(splitBlocks).toHaveBeenCalledTimes(1);
  });
});
