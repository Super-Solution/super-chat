// repairToolArguments against the code it replaced.
//
// The rewrite changed what a repair costs — slices instead of a string built a
// character at a time, candidates built only when needed, no parse that is known
// to fail — and none of what it returns. The reference below is that earlier
// code, kept only for this file; every input in a seeded corpus of malformed
// arguments has to come out deep-equal to it.

import { isDeepStrictEqual } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repairToolArguments, type RepairResult } from "./repair.js";

// ── Pre-fix reference: tools/repair.ts at 6a965ed. Test-only. ────────────────

function referenceEscapeControlCharsInStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch < " ") {
      const map: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
      out += map[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function referenceDropTrailingCommas(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (!inString && ch === ",") {
      const rest = input.slice(i + 1);
      const nextNonSpace = rest.match(/^\s*(.)/)?.[1];
      if (nextNonSpace === "}" || nextNonSpace === "]") continue; // drop it
    }
    out += ch;
  }
  return out;
}

function referenceExtractJsonObject(input: string): string | null {
  const start = input.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i += 1) {
    const ch = input[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

function referenceRepairToolArguments(raw: unknown): RepairResult {
  if (raw == null) return { value: {}, repaired: false };
  if (typeof raw === "object") return { value: raw, repaired: false };
  if (typeof raw !== "string") return { value: {}, repaired: true, error: `Unexpected argument type ${typeof raw}` };

  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "{}") {
    return { value: {}, repaired: trimmed !== "{}" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      try {
        return { value: JSON.parse(parsed) as unknown, repaired: true };
      } catch {
        return { value: { value: parsed }, repaired: true };
      }
    }
    return { value: parsed, repaired: false };
  } catch {
    /* fall through to repairs */
  }

  const candidates: string[] = [];
  const defenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const controlCharsEscaped = referenceEscapeControlCharsInStrings(defenced);
  const noTrailingCommas = referenceDropTrailingCommas(controlCharsEscaped);
  candidates.push(defenced);
  candidates.push(controlCharsEscaped);
  candidates.push(noTrailingCommas);
  candidates.push(
    noTrailingCommas
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null"),
  );
  candidates.push(noTrailingCommas.replace(/'([^'\\]*)'(\s*[:,}\]])/g, '"$1"$2'));
  const extracted = referenceExtractJsonObject(defenced);
  if (extracted) {
    candidates.push(extracted, referenceDropTrailingCommas(referenceEscapeControlCharsInStrings(extracted)));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") return { value: parsed, repaired: true };
    } catch {
      continue;
    }
  }

  return { value: {}, repaired: true, error: `Could not parse tool arguments: ${trimmed.slice(0, 200)}` };
}

// ── Corpus ──────────────────────────────────────────────────────────────────

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

// String content that trips the scanners: quotes, backslashes, control
// characters, structural characters, Python-looking words, non-Latin text.
const STRING_PIECES = [
  "a", "b c", "it's", "None of the above", "True", "False", "\n", "\r\n", "\t", "\u0001", "\u001f", "\b", "\f",
  '"', "\\", "/", "é", "資金費率", "😀", "\uD800", "{", "}", "[", "]", ",", ":", "'", "```", " , }", "\u00a0", "\u2028",
] as const;

function stringValue(r: Rand): string {
  let s = "";
  for (let n = int(r, 6); n > 0; n -= 1) s += pick(r, STRING_PIECES);
  return s;
}

function jsonValue(r: Rand, depth: number): unknown {
  switch (int(r, depth > 3 ? 5 : 8)) {
    case 0:
      return int(r, 2000) - 1000;
    case 1:
      return pick(r, [true, false, null, 0.5, -0, 1e21]);
    case 2:
    case 3:
    case 4:
      return stringValue(r);
    case 5:
    case 6:
      return Array.from({ length: int(r, 4) }, () => jsonValue(r, depth + 1));
    default: {
      const o: Record<string, unknown> = {};
      for (let n = int(r, 4); n > 0; n -= 1) o[pick(r, ["a", "key", "note", "it's", "x y", "資金"]) + n] = jsonValue(r, depth + 1);
      return o;
    }
  }
}

/** A valid JSON text for an object or array, in one of several layouts. */
function jsonText(r: Rand): string {
  const v = r() < 0.8 ? { args: jsonValue(r, 1), more: jsonValue(r, 2) } : [jsonValue(r, 1)];
  return JSON.stringify(v, null, pick(r, [undefined, 2, "\t", " "]));
}

// Arguments shaped like real tool calls, streamed a chunk at a time.
const STREAMED = [
  '{"symbol":"BTCUSDT","interval":"1h","limit":200}',
  '{"title":"Q3 report","markdown":"# Q3\\n\\n- revenue up\\n- costs flat\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |"}',
  '{"title":"Q3 report","markdown":"# Q3\n\n- revenue up, costs \"flat\"\n\n```ts\nconst x = {a: 1,};\n```"}',
  '{"docId":"doc_1","revision":3,"edits":[{"block":2,"find":"The cap is 12 months.","replace":"The cap is 24 months."},]}',
  '{"query":"funding rate \\"BTC\\"","limit":5,}',
  "{'symbol': 'ETH', 'limit': 10, 'include': True, 'cursor': None}",
  '```json\n{"kind":"table","spec":{"columns":[{"key":"sym","label":"Sym"}],"rows":[{"sym":"BTC","px":60000.5}]}}\n```',
  'Sure, calling it now: {"to":["a@example.com"],"subject":"Hi","body":"Line 1\nLine 2"} Let me know.',
  '"{\\"a\\":1,\\"b\\":[1,2]}"',
];

/** A malformed variant of a valid JSON text. */
function malform(r: Rand, j: string): string {
  switch (int(r, 16)) {
    case 0: // trailing comma before a closer, whitespace of every kind between
      return j.replace(/[}\]]/, (c) => `,${pick(r, ["", " ", "\n  ", "\u00a0", "\u2028", "\ufeff"])}${c}`);
    case 1: // single quotes, everywhere or only on keys
      return r() < 0.5 ? j.replace(/"/g, "'") : j.replace(/"(\w+)":/g, "'$1':");
    case 2: // unquoted keys
      return j.replace(/"(\w+)":/g, "$1:");
    case 3: // code fences
      return pick(r, ["```json\n", "```\n", "```JSON ", "", "```json"]) + j + pick(r, ["\n```", "```", "  \n```  ", "", "\n``` "]);
    case 4: // comments
      return j.replace("{", pick(r, ["{ // note\n", "{/* c */", "{#"]));
    case 5: // raw control characters inside strings
      return j.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\u0001/g, "\u0001");
    case 6: // Python literals
      return j.replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False").replace(/\bnull\b/g, "None");
    case 7: // prose around, with braces and quotes of its own
      return pick(r, ["Sure! ", 'He said "go" {', "{not json} ", ""]) + j + pick(r, [" Hope that helps.", " }", ' "', ""]);
    case 8: // double-encoded, possibly cut short
      return JSON.stringify(j).slice(0, r() < 0.5 ? undefined : int(r, j.length + 3));
    case 9: // whitespace runs, JSON's and JavaScript's
      return insert(r, j, pick(r, [" ", "\n", "\t", "\u00a0", "\u3000", "\ufeff"]).repeat(1 + int(r, 300)));
    case 10: // leading/trailing whitespace JSON does not allow
      return pick(r, ["\u00a0", "\ufeff", "\u2028", " "]) + j + pick(r, ["\u2029", "\u00a0", "\n"]);
    case 11: // a stray escape, an escaped quote, a backslash at the very end
      return insert(r, j, pick(r, ["\\", '\\"', '"', "\\\\"])) + (r() < 0.3 ? "\\" : "");
    case 12: // random edits with JSON-significant characters
    case 13: {
      let s = j;
      for (let n = 1 + int(r, 4); n > 0; n -= 1) {
        const at = int(r, s.length + 1);
        const ch = pick(r, ["{", "}", "[", "]", '"', "'", ",", ":", "\\", " ", "\n", "t", "N", "0", "`"]);
        s = int(r, 3) === 0 ? s.slice(0, at) + s.slice(at + 1) : s.slice(0, at) + ch + s.slice(at);
      }
      return s;
    }
    default: // two malformations at once
      return malform(r, malform(r, j));
  }
}

const insert = (r: Rand, s: string, piece: string) => {
  const at = int(r, s.length + 1);
  return s.slice(0, at) + piece + s.slice(at);
};

function corpus(): unknown[] {
  const r = prng(0x7e9a1);
  const out: unknown[] = [];
  // Truncated at every position: valid JSON, its malformed variants, streams.
  for (let n = 0; n < 300; n += 1) {
    const j = jsonText(r);
    for (let i = 0; i <= j.length; i += 1) out.push(j.slice(0, i));
    for (let m = 0; m < 30; m += 1) out.push(malform(r, j));
    const bad = malform(r, j);
    for (let i = 0; i <= bad.length; i += 3) out.push(bad.slice(0, i));
  }
  for (const s of STREAMED) {
    for (let i = 0; i <= s.length; i += 1) out.push(s.slice(0, i), `\`\`\`json\n${s.slice(0, i)}`);
  }
  // Not strings at all.
  out.push(undefined, null, 0, 1, true, false, 10n, Symbol("s"), () => 1, { a: 1 }, [1], "", "null", " {} ", "{}");
  return out;
}

const describeInput = (raw: unknown) => (typeof raw === "string" ? JSON.stringify(raw).slice(0, 300) : String(raw));

describe("repairToolArguments matches the pre-fix implementation", () => {
  it("on a seeded corpus of malformed, truncated and streamed arguments", () => {
    const inputs = corpus();
    const mismatches: string[] = [];
    const seen = { valid: 0, repaired: 0, failed: 0 };
    for (const raw of inputs) {
      const got = repairToolArguments(raw);
      const want = referenceRepairToolArguments(raw);
      if (!isDeepStrictEqual(got, want) || (typeof raw === "object" && raw && got.value !== raw)) {
        mismatches.push(describeInput(raw));
      }
      if (want.error) seen.failed += 1;
      else if (want.repaired) seen.repaired += 1;
      else seen.valid += 1;
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    // Every branch has to be exercised in bulk, not just reached once.
    expect(inputs.length).toBeGreaterThan(30_000);
    expect(seen.valid).toBeGreaterThan(2_000);
    expect(seen.repaired).toBeGreaterThan(2_500);
    expect(seen.failed).toBeGreaterThan(20_000);
  });

  it("at every stage of the repair", () => {
    const cases = [
      '```json\n{"a":1}\n```', // fence
      '```json\n{"a":1}   \n\t```', // fence with whitespace before the close
      "```\n```", // nothing inside the fence
      '{"a":"line\nbreak"}', // control character
      '{"a":[1,2,],}', // trailing commas
      '{"a":"x",\u00a0}', // trailing comma before JavaScript-only whitespace, still refused
      '{"a":True,"b":None}', // Python literals
      "{'a': 'b'}", // single quotes
      'Result: {"a":1} done', // extracted
      'Result: {"a":"x\ny",} done', // extracted, then repaired
      '{"a":1,} trailing prose', // extracted equals nothing earlier
      '{"a":1,}', // extracted is the whole input
      "[1,2,]", // array, not object
      '"{\\"a\\":1}"', // double-encoded
      '"not json"', // double-encoded, but only a string
      "42", // a primitive
      "{", // truncated to nothing useful
      "[}", // opens like one thing, closes like another
      '{"a":"\\', // ends mid-escape
    ];
    for (const raw of cases) expect(repairToolArguments(raw), raw).toEqual(referenceRepairToolArguments(raw));
  });

  it("looks past a comma over whitespace as /\\s/ counts it, not only JSON's", () => {
    // Which whitespace the trailing-comma pass skips shows only where a later
    // candidate parses anyway: in a single-quoted value, whose comma the pass
    // drops before the quotes are rewritten. Elsewhere JavaScript-only
    // whitespace fails the parse whether the comma goes or not.
    const cases: string[] = [];
    for (let c = 0; c <= 0xffff; c += 1) {
      const ch = String.fromCharCode(c);
      if (/\s/.test(ch)) cases.push(`{'k': 'x,${ch}}'}`, `['x,${ch}]']`);
    }
    expect(cases).toHaveLength(50);
    for (const raw of cases) expect(repairToolArguments(raw), JSON.stringify(raw)).toEqual(referenceRepairToolArguments(raw));
    expect(repairToolArguments("{'k': 'x, }'}")).toEqual({ value: { k: "x }" }, repaired: true });
  });

  it("relies on /\\s/ and trim() agreeing on what whitespace is", () => {
    // The closing fence is cut and the whitespace before it left to trim(), where
    // the old regex removed it with \s. That is the same only if the two sets are
    // the same, which the spec says and this pins, code unit by code unit.
    const disagree: number[] = [];
    for (let c = 0; c <= 0xffff; c += 1) {
      const ch = String.fromCharCode(c);
      if (/\s/.test(ch) !== (ch.trim() === "")) disagree.push(c);
    }
    expect(disagree).toEqual([]);
  });
});

// ── Cost ────────────────────────────────────────────────────────────────────

describe("repair cost", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses each distinct candidate at most once, and only one that could be an object", () => {
    const parse = vi.spyOn(JSON, "parse");
    const parses = (raw: string) => {
      parse.mockClear();
      repairToolArguments(raw);
      return parse.mock.calls.length;
    };
    // The fast path, then the candidate without the comma. Before: the fast
    // path's text again, and the unchanged control-character pass, as well.
    expect(parses('{"a":1,}')).toBe(2);
    // Truncated: nothing after the fast path can close, so nothing is parsed.
    const cut = `{"title":"Report","markdown":"line one\nline two, it's True`;
    expect(parses(cut)).toBe(1);
    expect(parses("{" + "x".repeat(1000))).toBe(1);
    // A fenced object is parsed on its first candidate and nothing more.
    expect(parses('```json\n{"a":1}\n```')).toBe(2);
  });

  it("builds a candidate only once everything before it has failed", () => {
    const replace = vi.spyOn(String.prototype, "replace");
    repairToolArguments('{"a":1,"b":[1,2,],}');
    // The opening fence only: the Python and quote rewrites come after the
    // candidate that parses. Before, all six regex passes ran up front.
    expect(replace.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("reads the arguments by character code and copies them in stretches", () => {
    // The old passes stepped a string iterator through every character, appended
    // each one back to the output, and sliced off the rest of the input at every
    // comma to look past it. The appends cannot be counted; the iterator steps
    // and the slices can, and they went with them.
    const rows = Array.from({ length: 5_000 }, (_, i) => `{"id":${i},"sym":"BTC","px":${60_000 + i}}`);
    const raw = `{"rows":[${rows.join(",")}],}`;
    const next = vi.spyOn(Object.getPrototypeOf(""[Symbol.iterator]()), "next");
    const slice = vi.spyOn(String.prototype, "slice");
    const result = repairToolArguments(raw);
    const [steps, slices] = [next.mock.calls.length, slice.mock.calls.length];
    vi.restoreAllMocks();
    expect(result).toMatchObject({ repaired: true, value: { rows: expect.any(Array) } });
    expect(steps).toBe(0);
    // One for the text before the dropped comma, one for the text after it.
    expect(slices).toBeLessThan(10);
  });

  it("looks for a closing fence in time linear in a run of whitespace", () => {
    // /\s*```$/ was retried at every offset of a whitespace run anywhere in the
    // text and rescanned the rest of it. In node, 100,000 spaces took about 3 s
    // before and take about 1 ms now: the limit is over 10x below the one and
    // over 100x above the other.
    const raw = `{"note": "${" ".repeat(100_000)}x`;
    const started = performance.now();
    expect(repairToolArguments(raw).error).toBeDefined();
    expect(performance.now() - started).toBeLessThan(250);
  });
});
