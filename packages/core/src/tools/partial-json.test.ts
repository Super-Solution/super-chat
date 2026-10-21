import { describe, expect, it } from "vitest";
import { PartialJsonParser, parsePartialJson } from "./partial-json.js";

const feed = (...chunks: string[]) => {
  const parser = new PartialJsonParser();
  for (const c of chunks) parser.push(c);
  return parser;
};

const SAMPLES: unknown[] = [
  {},
  [],
  { kind: "table", spec: { columns: [{ key: "a", label: "A" }], rows: [{ a: 1 }, { a: -2.5e3 }, { a: null }] } },
  { s: 'quote " backslash \\ slash / tab \t newline \n unicode é ü 中文 😀', n: 0, f: false, t: true },
  [[[]], [{}], [1, [2, [3]]], "x"],
  { nested: { deeper: { deepest: [true, false, null, 1e-7, 12345678901234] } } },
];

describe("PartialJsonParser — agrees with JSON.parse once complete", () => {
  for (const sample of SAMPLES) {
    const text = JSON.stringify(sample, null, 1);

    it(`at every split point: ${text.slice(0, 40).replace(/\s+/g, " ")}`, () => {
      for (let i = 0; i <= text.length; i += 1) {
        const parser = feed(text.slice(0, i), text.slice(i));
        expect(parser.complete).toBe(true);
        expect(parser.snapshot()).toEqual(sample);
      }
    });

    it(`one character at a time, never showing a value the input did not contain: ${text.slice(0, 30).replace(/\s+/g, " ")}`, () => {
      const parser = new PartialJsonParser();
      for (const ch of text) {
        parser.push(ch);
        expect(parser.failed).toBe(false);
      }
      expect(parser.snapshot()).toEqual(sample);
    });
  }

  it("matches JSON.parse with \\u escapes, including an escaped surrogate pair", () => {
    const text = '{"a":"\\u00e9\\u4e2d\\ud83d\\ude00\\"\\\\\\/\\b\\f\\n\\r\\t"}';
    for (let i = 0; i <= text.length; i += 1) {
      expect(feed(text.slice(0, i), text.slice(i)).snapshot()).toEqual(JSON.parse(text));
    }
  });
});

describe("PartialJsonParser — what a partial snapshot shows", () => {
  it("is undefined before the top-level container opens", () => {
    expect(parsePartialJson("").value).toBeUndefined();
    expect(parsePartialJson("   ").value).toBeUndefined();
    expect(parsePartialJson("{").value).toEqual({});
  });

  it("shows an open string VALUE as far as it has arrived", () => {
    const parser = feed('{"title":"Vendor sh');
    expect(parser.snapshot()).toEqual({ title: "Vendor sh" });
    parser.push('ortlist"}');
    expect(parser.snapshot()).toEqual({ title: "Vendor shortlist" });
    expect(parser.complete).toBe(true);
  });

  it("never shows an open KEY, or a key whose value has not started", () => {
    expect(parsePartialJson('{"a":"x","ti').value).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":"x","title"').value).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":"x","title":').value).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":"x","title": "').value).toEqual({ a: "x", title: "" });
  });

  it("holds back an unterminated number — a short magnitude is a wrong one", () => {
    expect(parsePartialJson('{"cost":12').value).toEqual({});
    expect(parsePartialJson('{"cost":1200').value).toEqual({});
    expect(parsePartialJson('{"cost":1200,').value).toEqual({ cost: 1200 });
    expect(parsePartialJson('{"cost":-1.5e3}').value).toEqual({ cost: -1500 });
    expect(parsePartialJson("[1,2,3").value).toEqual([1, 2]);
    expect(parsePartialJson("[1,2,3 ").value).toEqual([1, 2, 3]);
  });

  it("shows a literal only once it is whole", () => {
    expect(parsePartialJson('{"a":tr').value).toEqual({});
    expect(parsePartialJson('{"a":true').value).toEqual({ a: true });
    expect(parsePartialJson('{"a":nul').value).toEqual({});
    expect(parsePartialJson('{"a":null').value).toEqual({ a: null });
    expect(parsePartialJson('{"a":fals').value).toEqual({});
  });

  it("closes every open container, at any depth", () => {
    expect(parsePartialJson('{"spec":{"rows":[{"a":"x"},{"b":"y').value).toEqual({
      spec: { rows: [{ a: "x" }, { b: "y" }] },
    });
    expect(parsePartialJson('{"spec":{"rows":[{"a":"x"},{').value).toEqual({ spec: { rows: [{ a: "x" }, {}] } });
    expect(parsePartialJson('{"spec":{"rows":[').value).toEqual({ spec: { rows: [] } });
  });
});

describe("PartialJsonParser — strings split mid-token", () => {
  it("holds a half-received escape until its second character", () => {
    const parser = feed('{"a":"line one\\');
    expect(parser.snapshot()).toEqual({ a: "line one" });
    parser.push('nline two"}');
    expect(parser.snapshot()).toEqual({ a: "line one\nline two" });
  });

  it("holds a half-received \\u escape until all four hex digits arrive", () => {
    const parser = feed('{"a":"caf\\u00');
    expect(parser.snapshot()).toEqual({ a: "caf" });
    parser.push("e");
    expect(parser.snapshot()).toEqual({ a: "caf" });
    parser.push('9"}');
    expect(parser.snapshot()).toEqual({ a: "café" });
  });

  it("never shows a lone high surrogate — escaped or raw", () => {
    const escaped = feed('{"a":"ok \\ud83d');
    expect(escaped.snapshot()).toEqual({ a: "ok " });
    escaped.push('\\ude00"}');
    expect(escaped.snapshot()).toEqual({ a: "ok 😀" });

    // A fragment boundary inside a raw pair: "😀" is two UTF-16 units.
    const emoji = "😀";
    const raw = feed(`{"a":"ok ${emoji[0]}`);
    expect(raw.snapshot()).toEqual({ a: "ok " });
    raw.push(`${emoji[1]}"}`);
    expect(raw.snapshot()).toEqual({ a: "ok 😀" });
  });

  it("treats quotes and braces inside a string as text", () => {
    const parser = feed('{"a":"say \\"{[,:]}\\" twice","b":');
    expect(parser.snapshot()).toEqual({ a: 'say "{[,:]}" twice' });
  });

  it("keeps CJK text whole across fragment boundaries", () => {
    const text = JSON.stringify({ title: "供應商比較表", rows: [{ 名稱: "甲公司" }] });
    const parser = new PartialJsonParser();
    for (const ch of text) parser.push(ch);
    expect(parser.snapshot()).toEqual(JSON.parse(text));
  });
});

describe("PartialJsonParser — tolerance and refusal", () => {
  it("skips prose or a code fence before the first bracket", () => {
    expect(parsePartialJson('```json\n{"a":1}').value).toEqual({ a: 1 });
    expect(parsePartialJson('Here you go: {"a":"b"').value).toEqual({ a: "b" });
  });

  it("accepts a trailing comma, as tool-argument repair does", () => {
    expect(parsePartialJson('{"a":[1,2,],}').value).toEqual({ a: [1, 2] });
  });

  it("freezes at the last good snapshot when the input stops being JSON", () => {
    const parser = feed('{"a":1,"b":x');
    expect(parser.failed).toBe(true);
    expect(parser.snapshot()).toEqual({ a: 1 });
    parser.push('"ignored"}');
    expect(parser.snapshot()).toEqual({ a: 1 });
    expect(parser.complete).toBe(false);
  });

  it("refuses single-quoted keys rather than guessing", () => {
    const parser = feed("{'a': 1}");
    expect(parser.failed).toBe(true);
    expect(parser.snapshot()).toEqual({});
  });

  it("ignores anything after the top-level value closes", () => {
    const parser = feed('{"a":1} trailing {"b":2}');
    expect(parser.complete).toBe(true);
    expect(parser.snapshot()).toEqual({ a: 1 });
  });

  it("gives a `__proto__` key JSON.parse semantics, not a prototype swap", () => {
    const value = parsePartialJson('{"__proto__":{"polluted":true},"a":1}').value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(["__proto__", "a"]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("PartialJsonParser — cheap to call per fragment", () => {
  it("bumps `version` only for visible change", () => {
    const parser = feed('{"rows":[{');
    let v = parser.version;
    for (const quiet of ["  ", "\n", '"na',"me", '"', ":", " ", "12", "34"]) {
      parser.push(quiet);
      expect(parser.version, `after ${JSON.stringify(quiet)}`).toBe(v);
    }
    parser.push(",");
    expect(parser.version).toBeGreaterThan(v); // the number landed
    v = parser.version;
    parser.push('"x":"a');
    expect(parser.version).toBeGreaterThan(v); // a string value is visible as it grows
  });

  it("returns the same snapshot object until something visible changes", () => {
    const parser = feed('{"rows":[{"a":"x"}');
    const first = parser.snapshot();
    parser.push("   ");
    expect(parser.snapshot()).toBe(first);
  });

  it("shares finished objects between snapshots instead of copying them", () => {
    const parser = feed('{"spec":{"rows":[{"a":"x"},{"a":"y"}');
    const before = parser.snapshot() as { spec: { rows: object[] } };
    parser.push(',{"a":"z"');
    const after = parser.snapshot() as { spec: { rows: object[] } };
    expect(after).not.toBe(before);
    expect(after.spec.rows).toHaveLength(3);
    expect(after.spec.rows[0]).toBe(before.spec.rows[0]);
    expect(after.spec.rows[1]).toBe(before.spec.rows[1]);
    // And an earlier snapshot is never mutated by later input.
    expect(before.spec.rows).toHaveLength(2);
  });

  it("reads a long argument stream in one pass", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `row ${i}`, note: "x".repeat(20) }));
    const text = JSON.stringify({ kind: "table", spec: { rows } });
    const parser = new PartialJsonParser();
    const started = performance.now();
    for (let i = 0; i < text.length; i += 4) {
      parser.push(text.slice(i, i + 4));
      parser.snapshot();
    }
    // Re-parsing the accumulated text per fragment is quadratic and takes
    // seconds here; one pass plus spine copies stays well under that.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(parser.snapshot()).toEqual({ kind: "table", spec: { rows } });
  });
});
