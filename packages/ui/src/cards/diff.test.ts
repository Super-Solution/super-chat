import { describe, expect, it } from "vitest";
import { diffLines } from "./Basic.js";

type Row = { kind: "same" | "add" | "del"; text: string };

// ── Pre-fix reference ────────────────────────────────────────────────────────
// diffLines and diffLinesFast exactly as they were before the Myers rewrite
// (origin/main 6a965ed, cards/Basic.tsx). Test-only: the new diffLines must
// reproduce this output row for row.

const REF_CAP = 2000;

function referenceDiff(a: string[], b: string[]): Row[] {
  if (a.length > REF_CAP || b.length > REF_CAP) return referenceFast(a, b);

  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++]! });
  while (j < m) out.push({ kind: "add", text: b[j++]! });
  return out;
}

function referenceFast(a: string[], b: string[]): Row[] {
  let start = 0;
  const maxStart = Math.min(a.length, b.length);
  while (start < maxStart && a[start] === b[start]) start += 1;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const out: Row[] = [];
  for (let i = 0; i < start; i += 1) out.push({ kind: "same", text: a[i]! });
  for (let i = start; i < endA; i += 1) out.push({ kind: "del", text: a[i]! });
  for (let i = start; i < endB; i += 1) out.push({ kind: "add", text: b[i]! });
  for (let i = endA; i < a.length; i += 1) out.push({ kind: "same", text: a[i]! });
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every text of up to `maxLen` lines drawn from `alphabet`. */
function allTexts(alphabet: string[], maxLen: number): string[][] {
  const out: string[][] = [[]];
  let frontier: string[][] = [[]];
  for (let len = 1; len <= maxLen; len += 1) {
    frontier = frontier.flatMap((t) => alphabet.map((c) => [...t, c]));
    out.push(...frontier);
  }
  return out;
}

/** The rows must rebuild both texts: same+del is the old one, same+add the new. */
function expectReplays(rows: Row[], a: string[], b: string[]) {
  expect(rows.filter((r) => r.kind !== "add").map((r) => r.text)).toEqual(a);
  expect(rows.filter((r) => r.kind !== "del").map((r) => r.text)).toEqual(b);
}

const kept = (rows: Row[]) => rows.filter((r) => r.kind === "same").length;

/** A random pair of texts of up to `maxLines` lines each, in one of the shapes a diff card sees, or worse. */
function randomPair(r: () => number, maxLines: number): [string[], string[]] {
  const alphabet = 1 + Math.floor(r() * 12);
  const line = (tag: string) => `${tag}${Math.floor(r() * alphabet)}`;
  const a = Array.from({ length: Math.floor(r() * (maxLines + 1)) }, () => line("l"));
  const shape = r();
  if (shape < 0.5) {
    // An edited copy: insertions (sometimes of lines the old text never had),
    // deletions and replacements.
    const b = a.slice();
    const edits = Math.floor(r() * (a.length / 2 + 3));
    for (let e = 0; e < edits; e += 1) {
      const at = Math.floor(r() * (b.length + 1));
      const op = r();
      const fresh = r() < 0.5 ? line("l") : line("new");
      if (op < 0.35) b.splice(at, 0, fresh);
      else if (op < 0.7) b.splice(at, 1);
      else if (at < b.length) b[at] = fresh;
    }
    return [a, b.slice(0, maxLines)];
  }
  if (shape < 0.8) return [a, Array.from({ length: Math.floor(r() * (maxLines + 1)) }, () => line(r() < 0.7 ? "l" : "new"))];
  return [a, a.slice().sort(() => r() - 0.5)];
}

/** Counts reads of numbered elements — i.e. line comparisons and copies. */
function counted(lines: string[], counter: { reads: number }): string[] {
  return new Proxy(lines, {
    get(target, key, receiver) {
      if (typeof key === "string" && key !== "length" && /^\d+$/.test(key)) counter.reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
}

const numbered = (n: number, tag = "line") => Array.from({ length: n }, (_, i) => `${tag} ${i}: ${"x".repeat(i % 7)}`);

/**
 * Runs `fn` counting the typed arrays it allocates. The search's trace and the
 * table both grow with the work they do, so `cells` measures it without a
 * clock, and `tables` (Uint16Array) says whether a table was filled at all.
 */
function allocations<R>(fn: () => R): { result: R; tables: number; cells: number } {
  const g = globalThis as unknown as Record<string, unknown>;
  const names = ["Int32Array", "Uint16Array", "Uint8Array"];
  const saved = names.map((name) => g[name]);
  const counts = { tables: 0, cells: 0 };
  names.forEach((name, i) => {
    const Base = saved[i] as Int32ArrayConstructor;
    g[name] = class extends Base {
      constructor(length: number) {
        super(length);
        counts.cells += length;
        if (name === "Uint16Array") counts.tables += 1;
      }
    };
  });
  try {
    const result = fn();
    return { result, ...counts };
  } finally {
    names.forEach((name, i) => (g[name] = saved[i]));
  }
}

/** diffLines(a, b), with its line reads and its allocated cells counted. */
function measured(a: string[], b: string[]) {
  const counter = { reads: 0 };
  const { result, tables, cells } = allocations(() => diffLines(counted(a, counter), counted(b, counter)));
  return { rows: result, reads: counter.reads, tables, cells };
}

/** A code-like file: functions whose bodies mix their own statements with blank and brace lines. */
function codeFile(r: () => number, lines: number, uid: { n: number }): string[] {
  const shared = ["", "}", "  }", "    }", "  return;", "  } else {", "});"];
  const out: string[] = [];
  while (out.length < lines) {
    out.push(`function f${uid.n++}() {`);
    const body = 3 + Math.floor(r() * 12);
    for (let i = 0; i < body; i += 1) out.push(r() < 0.35 ? shared[Math.floor(r() * shared.length)]! : `  step${uid.n++}();`);
    out.push("}", "");
  }
  return out;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("diffLines (DiffCardView)", () => {
  it("matches the pre-fix LCS output for every pair of texts up to 5 lines over 3 distinct lines", () => {
    const texts = allTexts(["A", "B", "C"], 5);
    let mismatches = 0;
    for (const a of texts) {
      for (const b of texts) {
        const got = diffLines(a, b);
        const want = referenceDiff(a, b);
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          mismatches += 1;
          if (mismatches === 1) expect({ a, b, got }).toEqual({ a, b, got: want });
        }
      }
    }
    expect(texts.length).toBe(364);
    expect(mismatches).toBe(0);
  });

  it("matches the pre-fix LCS output for small pairs behind or ahead of 40 shared lines, where the search runs", () => {
    // Alone, pairs that small go to the table. Behind or ahead of shared
    // context the search runs instead and must end on the same rows, at the
    // end of the texts and at their start.
    const context = numbered(40, "ctx");
    const texts = allTexts(["A", "B", "C"], 4);
    let mismatches = 0;
    const { tables } = allocations(() => {
      for (const core of texts) {
        for (const other of texts) {
          for (const [a, b] of [
            [[...context, ...core], [...context, ...other]],
            [[...core, ...context], [...other, ...context]],
          ]) {
            const got = diffLines(a!, b!);
            const want = referenceDiff(a!, b!);
            if (JSON.stringify(got) !== JSON.stringify(want)) {
              mismatches += 1;
              if (mismatches === 1) expect({ a, b, got }).toEqual({ a, b, got: want });
            }
          }
        }
      }
    });
    expect(mismatches).toBe(0);
    expect(tables).toBe(0);
  });

  it("matches the pre-fix LCS output when the second, filtered pass does the work", () => {
    // Every pair of texts up to 3 lines, and 2000 seeded pairs up to 6, between
    // 24 shared lines before and 24 after, each side then padded with 44 lines
    // only it has, at seeded random places: too many changes for the first
    // pass, so the second one runs on the shared lines alone and has to place
    // the dropped ones exactly where the old walk put them.
    const r = rng(42);
    const before = numbered(24, "pre");
    const after = numbered(24, "post");
    const pad = (text: string[], tag: string) => {
      const out = [...before, ...text, ...after];
      for (let k = 0; k < 44; k += 1) out.splice(Math.floor(r() * (out.length + 1)), 0, `${tag} only ${k}`);
      return out;
    };
    const texts = allTexts(["A", "B", "C"], 3);
    const cores = texts.flatMap((core) => texts.map((other) => [core, other]));
    const short = () => Array.from({ length: Math.floor(r() * 7) }, () => "ABC"[Math.floor(r() * 3)]!);
    for (let k = 0; k < 2000; k += 1) cores.push([short(), short()]);
    let mismatches = 0;
    const { tables } = allocations(() => {
      for (const [core, other] of cores) {
        const a = pad(core!, "old");
        const b = pad(other!, "new");
        const got = diffLines(a, b);
        const want = referenceDiff(a, b);
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          mismatches += 1;
          if (mismatches === 1) expect({ a, b, got }).toEqual({ a, b, got: want });
        }
      }
    });
    expect(mismatches).toBe(0);
    expect(tables).toBe(0);
  });

  it("matches the pre-fix LCS output on seeded random texts (every path: table, first and second search)", () => {
    const r = rng(20260926);
    for (const [cases, maxLines] of [
      [4000, 40],
      [300, 300],
    ] as const) {
      for (let it = 0; it < cases; it += 1) {
        const [a, b] = randomPair(r, maxLines);
        const got = diffLines(a, b);
        expect(got, `case ${it}: ${a.join(",")} → ${b.join(",")}`).toEqual(referenceDiff(a, b));
        expectReplays(got, a, b);
      }
    }
  });

  it("matches the pre-fix LCS output on realistic edits of long texts", () => {
    const r = rng(7);
    for (const n of [150, 600, 2000]) {
      for (let it = 0; it < 6; it += 1) {
        const a = numbered(n);
        const b = a.slice();
        const edits = 1 + Math.floor(r() * n * 0.3);
        for (let e = 0; e < edits; e += 1) {
          const at = Math.floor(r() * (b.length + 1));
          const op = r();
          if (op < 0.3) b.splice(at, 0, `inserted ${e}`);
          else if (op < 0.55) b.splice(at, 1);
          else if (op < 0.9) b[at] = `replaced ${e}`;
          else b.splice(Math.floor(r() * b.length), 0, ...b.splice(at, 3)); // a moved block
        }
        const bb = b.filter((l) => l !== undefined).slice(0, 2000);
        expect(diffLines(a, bb)).toEqual(referenceDiff(a, bb));
      }
    }
  });

  it("matches the pre-fix LCS output on code-like files edited in several hunks", () => {
    // Whole functions added, removed or replaced in up to 4 places. Every hunk
    // brings blank and brace lines the rest of the file also has, which is
    // what made the first version of the search give up and show a block.
    const r = rng(9);
    const uid = { n: 0 };
    for (let it = 0; it < 150; it += 1) {
      const a = codeFile(r, 5 + Math.floor(r() * 600), uid);
      const b = a.slice();
      const hunks = 1 + Math.floor(r() * 4);
      for (let h = 0; h < hunks; h += 1) {
        const at = Math.floor(r() * (b.length + 1));
        const hunk = codeFile(r, Math.floor(r() * 250), uid);
        const op = r();
        if (op < 0.3) b.splice(at, hunk.length);
        else if (op < 0.7) b.splice(at, 0, ...hunk);
        else b.splice(at, Math.floor(r() * 40), ...hunk);
      }
      const [x, y] = r() < 0.5 ? [a, b] : [b, a];
      expect(diffLines(x, y), `case ${it}`).toEqual(referenceDiff(x, y));
    }
  });

  it("matches the pre-fix LCS output on the inputs the first version showed as a block", () => {
    const fn = (name: string) => [`export function ${name}(input: string): string {`, `  const v = step_${name}(input);`, `  return v;`, `}`, ``];
    const names = (tag: string, k: number) => Array.from({ length: k }, (_, i) => `${tag}${i}`);
    const f = names("f", 20);
    const items = (tag: string, k: number) => Array.from({ length: k }, (_, i) => [`- item ${tag}${i}`, ""]).flat();
    const paras = (tag: string, k: number) => Array.from({ length: k }, (_, i) => [`${tag} paragraph ${i}.`, ""]).flat();
    const moved = (n: number, len: number, by: number) => {
      const a = numbered(n);
      const b = a.slice();
      const block = b.splice(20, len);
      b.splice(20 + by, 0, ...block);
      return [a, b] as const;
    };
    const notes = ["# Notes", "", "intro", "", "- one", "- two", "", "outro", ""];
    const cases: (readonly [string[], string[]])[] = [
      // Two hunks of list items, each with its blank line: a pure insertion.
      [notes, ["# Notes", "", ...items("a", 64), "intro", "", "- one", "- two", "", ...items("b", 64), "outro", ""]],
      [notes, ["# Notes", "", ...items("a", 200), "intro", "", "- one", "- two", "", ...items("b", 200), "outro", ""]],
      // Functions added in two places, and removed from two places.
      [f.flatMap(fn), [...f.slice(0, 5), ...names("x", 40), ...f.slice(5, 15), ...names("y", 40), ...f.slice(15)].flatMap(fn)],
      [[...f, ...names("g", 80)].flatMap(fn), [...f.slice(0, 7), ...f.slice(12), ...names("g", 80).slice(30)].flatMap(fn)],
      // Two sections of a document rewritten.
      [
        ["# Title", "", ...paras("a", 30), ...paras("b", 30), ...paras("c", 30)],
        ["# Title", "", ...paras("new a", 200), ...paras("b", 30), ...paras("new c", 200)],
      ],
      // A new file: nothing before, 200 functions after.
      [[""], names("f", 200).flatMap(fn)],
      // A block moved by a quarter of the file or more.
      moved(300, 80, 100),
      moved(2000, 520, 600),
    ];
    for (const [a, b] of cases) expect(diffLines(a, b)).toEqual(referenceDiff(a, b));
  });

  it("keeps the old tie-breaking: a matching line is taken early, deletions come before insertions", () => {
    // Before [x, s], after [s, y, s]: the old walk deleted x, kept the FIRST s
    // and inserted y, s. Trimming the common suffix first would have kept the
    // last s instead — equally short, but a different card.
    expect(diffLines(["x", "s"], ["s", "y", "s"])).toEqual([
      { kind: "del", text: "x" },
      { kind: "same", text: "s" },
      { kind: "add", text: "y" },
      { kind: "add", text: "s" },
    ]);
    expect(diffLines(["a", "b", "c"], ["a", "x", "y", "c"])).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "x" },
      { kind: "add", text: "y" },
      { kind: "same", text: "c" },
    ]);
    // The same behind 40 shared lines, where the search makes the choice.
    const context = numbered(40, "ctx");
    const shared = context.map((text) => ({ kind: "same", text }));
    expect(diffLines([...context, "x", "s"], [...context, "s", "y", "s"])).toEqual([
      ...shared,
      { kind: "del", text: "x" },
      { kind: "same", text: "s" },
      { kind: "add", text: "y" },
      { kind: "add", text: "s" },
    ]);
  });

  it("handles empty sides and identical texts", () => {
    expect(diffLines([], [])).toEqual([]);
    expect(diffLines(["a"], [])).toEqual([{ kind: "del", text: "a" }]);
    expect(diffLines([], ["a"])).toEqual([{ kind: "add", text: "a" }]);
    const same = numbered(2000);
    expect(diffLines(same, same.slice())).toEqual(same.map((text) => ({ kind: "same", text })));
  });

  it("two totally different 2000-line texts: same rows as before, found without a table", () => {
    const a = numbered(2000, "old");
    const b = numbered(2000, "new");
    const { rows, reads, cells } = measured(a, b);
    expect(rows).toEqual(referenceDiff(a, b));
    // The table read both lines of all 4M cells: 8M reads. The bounded first
    // pass plus one pass to drop lines the other side lacks read ~138k, and
    // allocate ~133k cells, nearly all of it the first pass's trace.
    expect(reads).toBeLessThan(100 * 4000);
    expect(cells).toBeLessThan(1_000_000);
  });

  it("does work proportional to the edit, not to n × m", () => {
    const a = numbered(1000);
    const b = a.map((l, i) => (i % 50 === 25 ? `${l} (edited)` : l));
    const { rows, reads, cells } = measured(a, b);
    expect(rows).toEqual(referenceDiff(a, b));
    expect(kept(rows)).toBe(980);
    // 1000 × 1000 through the table was 2M reads and 1M cells; this is ~6.7k
    // reads and ~2k cells.
    expect(reads).toBeLessThan(20 * 2000);
    expect(cells).toBeLessThan(100_000);
  });

  it("when only a few shared lines moved, the second pass finds the diff without a table", () => {
    // 1000 shared lines with a 60-line block moved by 100, each side with 1000
    // lines of its own in between: the first pass gives up, the second one
    // sees a small edit.
    const shared = numbered(1000, "shared");
    const moved = shared.slice();
    const block = moved.splice(100, 60);
    moved.splice(200, 0, ...block);
    const a = shared.flatMap((l, i) => [l, `old only ${i}`]);
    const b = moved.flatMap((l, i) => [l, `new only ${i}`]);
    const { rows, reads, cells, tables } = measured(a, b);
    expect(rows).toEqual(referenceDiff(a, b));
    expect(tables).toBe(0);
    // A table over the shared lines alone would be 1M cells; this is ~290k
    // reads and cells together.
    expect(reads + cells).toBeLessThan(600_000);
  });

  it("past the search budget, the table over the shared lines keeps the old rows", () => {
    // A shuffled text shares every line but almost no order: no bounded search
    // finds its LCS, so the old table walk runs, on the lines both sides have.
    const r = rng(3);
    const a = numbered(400);
    const b = a.slice().sort(() => r() - 0.5);
    const got = diffLines(a, b);
    expect(got).toEqual(referenceDiff(a, b));
    expect(got).not.toEqual(referenceFast(a, b));

    // Lines only one side has stay out of that table: 1000 shuffled shared
    // lines between 1000 lines of each side's own need a 1000 × 1000 table,
    // not a 2000 × 2000 one (4M cells).
    const shared = numbered(1000, "shared");
    const shuffled = shared.slice().sort(() => r() - 0.5);
    const a2 = shared.flatMap((l, i) => [l, `old only ${i}`]);
    const b2 = shuffled.flatMap((l, i) => [l, `new only ${i}`]);
    const { rows, reads, cells, tables } = measured(a2, b2);
    expect(rows).toEqual(referenceDiff(a2, b2));
    expect(tables).toBe(1);
    expect(reads + cells).toBeLessThan(3_000_000);
  });

  it("a short text against a long one costs about the old table, not a search on top", () => {
    // n lines against m need at least |n − m| edits, more than the search can
    // afford when one side is much shorter; the first version ran out of two
    // budgets before it got to an answer. A new file is the everyday case.
    const skinny = [
      [1, 2000],
      [2000, 1],
      [5, 2000],
      [20, 2000],
      [2000, 20],
    ].map(([n, m]) => [
      Array.from({ length: n! }, (_, i) => `s${i % 3}`),
      Array.from({ length: m! }, (_, i) => `s${(i * 7) % 3}`),
    ]);
    const newFile = Array.from({ length: 200 }, (_, i) => `function f${i}() {\n  return ${i};\n}\n`).join("\n").split("\n");
    for (const [a, b] of [...skinny, [[""], newFile]]) {
      const n = a!.length;
      const m = b!.length;
      const { rows, reads, cells } = measured(a!, b!);
      expect(rows).toEqual(referenceDiff(a!, b!));
      expect(reads + cells, `${n} × ${m}`).toBeLessThan(1.5 * (n + 1) * (m + 1) + 8 * (n + m));
    }
  });

  it("keeps the linear fallback above 2000 lines, exactly as before", () => {
    const a = numbered(5000);
    const b = a.map((l, i) => (i % 20 === 7 ? `${l} // changed` : l));
    const got = diffLines(a, b);
    expect(got).toEqual(referenceDiff(a, b));
    expect(got).toEqual(referenceFast(a, b));
  });
});
