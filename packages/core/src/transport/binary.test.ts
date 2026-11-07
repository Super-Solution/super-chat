import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./binary.js";

const roundTrip = (bytes: Uint8Array) => base64ToBytes(bytesToBase64(bytes));

describe("base64", () => {
  it("matches the platform encoder on simple input", () => {
    const bytes = new TextEncoder().encode("hello world");
    expect(bytesToBase64(bytes)).toBe("aGVsbG8gd29ybGQ=");
  });

  it("round-trips every remainder length (padding cases)", () => {
    for (const len of [0, 1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(len).map((_, i) => i * 37);
      expect([...roundTrip(bytes)]).toEqual([...bytes]);
    }
  });

  it("round-trips all 256 byte values", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect([...roundTrip(bytes)]).toEqual([...bytes]);
  });

  it("round-trips input large enough to cross the chunk boundary", () => {
    // 100k bytes exceeds the 0x8000-char flush threshold several times over —
    // the case where a naive `btoa(String.fromCharCode(...bytes))` blows the stack.
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) & 0xff;
    const back = roundTrip(bytes);
    expect(back.length).toBe(bytes.length);
    expect(back[99_999]).toBe(bytes[99_999]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("tolerates whitespace and padding in decode input", () => {
    expect(new TextDecoder().decode(base64ToBytes("aGVs\nbG8=\n"))).toBe("hello");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base64ToBytes("aGV!bG8=")).toThrow(/Invalid base64/);
  });
});

// ── Pre-fix reference ────────────────────────────────────────────────────────
// bytesToBase64 and base64ToBytes exactly as they were at 6a965ed, when both
// ran the hand-rolled table for every input. Used only by the differential
// tests below.

const REF_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const REF_REVERSE: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < REF_ALPHABET.length; i += 1) table[REF_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

function referenceBytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out +=
      REF_ALPHABET[b0 >> 2]! +
      REF_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]! +
      (i + 1 < bytes.length ? REF_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : "=") +
      (i + 2 < bytes.length ? REF_ALPHABET[b2 & 0x3f]! : "=");
    if (out.length >= 0x8000) {
      chunks.push(out);
      out = "";
    }
  }
  chunks.push(out);
  return chunks.join("");
}

function referenceBase64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[\s=]+/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outPos = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    const value = code < 128 ? REF_REVERSE[code]! : -1;
    if (value < 0) throw new Error(`Invalid base64 character "${clean[i]}" at position ${i}.`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outPos] = (buffer >> bits) & 0xff;
      outPos += 1;
    }
  }
  return out.subarray(0, outPos);
}

// ── Differential tests, once per codec the runtime can offer ─────────────────

/** Seeded PRNG (mulberry32), so any failure reproduces exactly. */
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

function randomBytes(rand: () => number, n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) bytes[i] = Math.floor(rand() * 256);
  return bytes;
}

// Stand-ins for Uint8Array.prototype.toBase64 / Uint8Array.fromBase64 on
// runtimes that do not ship them yet (Node 24), faithful to the TC39 semantics
// for everything bytesToBase64 / base64ToBytes can hand them: a TypeError for
// anything but a Uint8Array or on a detached buffer, the view's own bytes only,
// a SyntaxError on anything outside the alphabet or a lone trailing character.
const typedArrayName = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;
function standInToBase64(this: Uint8Array): string {
  if (typedArrayName.call(this) !== "Uint8Array") throw new TypeError("not a Uint8Array");
  if ((this.buffer as ArrayBuffer & { detached?: boolean }).detached) throw new TypeError("detached");
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
}
function standInFromBase64(s: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) throw new SyntaxError("invalid base64");
  return new Uint8Array(Buffer.from(s, "base64"));
}

type NativeSlot = { target: object; key: string; saved: PropertyDescriptor | undefined; standIn: unknown };
const NATIVE: NativeSlot[] = [
  { target: Uint8Array.prototype, key: "toBase64", saved: undefined, standIn: standInToBase64 },
  { target: Uint8Array, key: "fromBase64", saved: undefined, standIn: standInFromBase64 },
];
for (const slot of NATIVE) slot.saved = Object.getOwnPropertyDescriptor(slot.target, slot.key);

function setNative(present: boolean) {
  for (const { target, key, saved, standIn } of NATIVE) {
    if (!present) delete (target as Record<string, unknown>)[key];
    else Object.defineProperty(target, key, saved ?? { value: standIn, writable: true, configurable: true });
  }
}
function restoreNative() {
  for (const { target, key, saved } of NATIVE) {
    if (saved) Object.defineProperty(target, key, saved);
    else delete (target as Record<string, unknown>)[key];
  }
}

const RUNTIMES: [string, () => void][] = [
  ["toBase64 / fromBase64", () => setNative(true)],
  ["btoa / atob", () => setNative(false)],
  [
    "neither (the table)",
    () => {
      setNative(false);
      vi.stubGlobal("btoa", undefined);
      vi.stubGlobal("atob", undefined);
    },
  ],
];

/** Everything observable about a decode: the bytes and how they are held, or the exact error. */
function decodeOutcome(decode: (s: string) => Uint8Array, s: string) {
  try {
    const out = decode(s);
    return {
      proto: Object.getPrototypeOf(out) === Uint8Array.prototype,
      byteOffset: out.byteOffset,
      bufferLength: out.buffer.byteLength,
      bytes: Array.from(out),
    };
  } catch (err) {
    return { error: `${(err as Error).constructor.name}: ${(err as Error).message}` };
  }
}

describe.each(RUNTIMES)("base64 against the pre-fix reference, with %s", (_name, setup) => {
  beforeEach(setup);
  afterEach(() => {
    vi.restoreAllMocks(); // first: a spy restores what it wrapped, which may be a stand-in
    restoreNative();
    vi.unstubAllGlobals();
  });

  it("encodes every length 0-300 the same (all padding cases)", () => {
    const rand = prng(1);
    for (let len = 0; len <= 300; len += 1) {
      for (let k = 0; k < 4; k += 1) {
        const bytes = randomBytes(rand, len);
        expect(bytesToBase64(bytes), `length ${len}`).toBe(referenceBytesToBase64(bytes));
      }
    }
    const all = new Uint8Array(256).map((_, i) => i);
    expect(bytesToBase64(all)).toBe(referenceBytesToBase64(all));
  });

  it("encodes only the view's own bytes, wherever it sits in its buffer", () => {
    const rand = prng(2);
    const backing = randomBytes(rand, 4096);
    for (let n = 0; n < 500; n += 1) {
      const offset = Math.floor(rand() * 2048);
      const length = Math.floor(rand() * 300);
      const views = [new Uint8Array(backing.buffer, offset, length), backing.subarray(offset, offset + length)];
      for (const view of views) {
        expect(bytesToBase64(view), `offset ${offset}, length ${length}`).toBe(referenceBytesToBase64(view));
      }
    }
    // Node's Buffer.from() slices a shared pool: a non-zero byteOffset in a subclass.
    const pooled = Buffer.from([1, 2, 3, 4, 5]);
    expect(pooled.byteOffset).toBeGreaterThan(0);
    expect(bytesToBase64(pooled)).toBe(referenceBytesToBase64(pooled));
    const shared = new Uint8Array(new SharedArrayBuffer(64), 7, 40).fill(0xa5);
    expect(bytesToBase64(shared)).toBe(referenceBytesToBase64(shared));
  });

  it("encodes a detached buffer as the empty string, as before", () => {
    const buffer = new ArrayBuffer(16);
    const view = new Uint8Array(buffer, 4, 8);
    (buffer as ArrayBuffer & { transfer(): ArrayBuffer }).transfer(); // ES2024; detaches `buffer`
    expect(bytesToBase64(view)).toBe(referenceBytesToBase64(view));
  });

  it("encodes what it always did for input outside the declared type", () => {
    // Untyped callers can pass other byte containers, which the old loop read
    // index by index. The platform encoders reject them or read them differently.
    const inputs: unknown[] = [
      new Uint8ClampedArray([1, 2, 3, 255]),
      new Int8Array([1, -2, 3, -128]),
      new Uint16Array([104, 300]),
      [104, 105, 0, 255],
      { length: 2, 0: 104, 1: 105 },
    ];
    const outcome = (encode: (bytes: Uint8Array) => string, input: unknown) => {
      try {
        return encode(input as Uint8Array);
      } catch (err) {
        return `${(err as Error).constructor.name}: ${(err as Error).message}`;
      }
    };
    for (const input of inputs) {
      expect(outcome(bytesToBase64, input), Object.prototype.toString.call(input)).toBe(
        outcome(referenceBytesToBase64, input),
      );
    }
  });

  it("encodes large inputs the same across every internal batch boundary", () => {
    const rand = prng(3);
    const sizes = [0x2000 - 1, 0x2000, 0x2000 + 1, 3 * 0x2000 + 2, 0x8000 * 3, 100_000, 262_147];
    for (let n = 0; n < 8; n += 1) sizes.push(Math.floor(rand() * 70_000));
    for (const size of sizes) {
      const bytes = randomBytes(rand, size);
      expect(bytesToBase64(bytes), `size ${size}`).toBe(referenceBytesToBase64(bytes));
      const view = randomBytes(rand, size + 13).subarray(5, 5 + size);
      expect(bytesToBase64(view), `view of size ${size}`).toBe(referenceBytesToBase64(view));
    }
  });

  it("decodes valid, sloppy and invalid input the same, error messages included", () => {
    const rand = prng(4);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const insert = (s: string, what: string) => {
      const at = Math.floor(rand() * (s.length + 1));
      return s.slice(0, at) + what + s.slice(at);
    };
    const WHITESPACE = [" ", "\n", "\r\n", "\t", "\f", "\v", " ", " ", "﻿", "　"];
    const INVALID = ["!", "-", "_", ".", "é", "😀", "\0", "~", "Ā", "ÿ"];
    let errors = 0;
    for (let n = 0; n < 3000; n += 1) {
      let s = referenceBytesToBase64(randomBytes(rand, Math.floor(rand() * 200)));
      const mode = rand();
      if (mode < 0.15) s = s.replace(/=+$/, ""); // unpadded
      else if (mode < 0.3) s = s.slice(0, Math.floor(rand() * (s.length + 1))); // truncated: any length % 4
      else if (mode < 0.45) for (let k = 0; k < 5; k += 1) s = insert(s, pick(WHITESPACE)); // wrapped / spaced
      else if (mode < 0.55) for (let k = 0; k < 3; k += 1) s = insert(s, "="); // stray padding anywhere
      else if (mode < 0.7) s = insert(s, pick(INVALID)); // one bad character
      else if (mode < 0.75) s = pick(["", "=", "==", "A", "AA", "AAA", "A===", " \n ", "Zg", "Zm8", "Zg=", "Zg==="]);
      const expected = decodeOutcome(referenceBase64ToBytes, s);
      expect(decodeOutcome(base64ToBytes, s), JSON.stringify(s)).toEqual(expected);
      if ("error" in expected) errors += 1;
    }
    expect(errors).toBeGreaterThan(300); // the invalid cases really were exercised
  });

  it("decodes large input the same", () => {
    const rand = prng(5);
    for (const size of [0x2000 * 3 + 1, 100_000, 262_147]) {
      const s = referenceBytesToBase64(randomBytes(rand, size));
      expect(decodeOutcome(base64ToBytes, s)).toEqual(decodeOutcome(referenceBase64ToBytes, s));
      const wrapped = s.replace(/.{76}/g, "$&\r\n");
      expect(decodeOutcome(base64ToBytes, wrapped)).toEqual(decodeOutcome(referenceBase64ToBytes, wrapped));
    }
  });
});

// ── Guards: the bulk of the work goes to the platform codec ──────────────────
// Deterministic stand-ins for a speed test: the pre-fix code ran every byte
// through a JavaScript loop (a 20 MB encode took ~1 s where the platform
// encoder takes ~50 ms), and never touched these functions.

describe("base64 hands the bulk work to the platform codec", () => {
  afterEach(() => {
    vi.restoreAllMocks(); // first: a spy restores what it wrapped, which may be a stand-in
    restoreNative();
    vi.unstubAllGlobals();
  });

  it("encodes with one toBase64 call on the view itself, when it exists", () => {
    setNative(true);
    const spy = vi.spyOn(Uint8Array.prototype as unknown as { toBase64: () => string }, "toBase64");
    const view = randomBytes(prng(6), 1 << 20).subarray(3);
    const out = bytesToBase64(view);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.contexts[0] === view, "called on the view itself").toBe(true); // no 1 MB diff on failure
    expect(out).toBe(referenceBytesToBase64(view));
  });

  it("otherwise encodes with one btoa call, building its input in bounded batches", () => {
    setNative(false);
    const btoaSpy = vi.spyOn(globalThis, "btoa");
    const fromCharCode = vi.spyOn(String, "fromCharCode");
    const bytes = randomBytes(prng(7), 1 << 20);
    const out = bytesToBase64(bytes);
    expect(btoaSpy).toHaveBeenCalledTimes(1);
    // Batches, not a call per byte; and each batch far below engine argument limits (JSC: 65536).
    expect(fromCharCode.mock.calls.length).toBeLessThanOrEqual(bytes.length / 1024);
    expect(Math.max(...fromCharCode.mock.calls.map((args) => args.length))).toBeLessThanOrEqual(0x4000);
    expect(out).toBe(referenceBytesToBase64(bytes));
  });

  it("decodes with one fromBase64 call, when it exists", () => {
    setNative(true);
    const spy = vi.spyOn(Uint8Array as unknown as { fromBase64: (s: string) => Uint8Array }, "fromBase64");
    const atobSpy = vi.spyOn(globalThis, "atob");
    for (const size of [1 << 20, (1 << 20) + 1, (1 << 20) + 2]) {
      const s = referenceBytesToBase64(randomBytes(prng(size), size)).replace(/=+$/, "");
      spy.mockClear();
      expect(Buffer.compare(base64ToBytes(s), referenceBase64ToBytes(s))).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(atobSpy).not.toHaveBeenCalled();
  });

  it("otherwise decodes with one atob call", () => {
    setNative(false);
    const spy = vi.spyOn(globalThis, "atob");
    for (const size of [1 << 20, (1 << 20) + 1, (1 << 20) + 2]) {
      const s = referenceBytesToBase64(randomBytes(prng(size), size)).replace(/=+$/, "");
      spy.mockClear();
      expect(Buffer.compare(base64ToBytes(s), referenceBase64ToBytes(s))).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ["fromBase64", true],
    ["atob", false],
  ])("finds a bad character without decoding a second time when %s rejects it", (_name, native) => {
    setNative(native);
    const valid = referenceBytesToBase64(randomBytes(prng(9), 1 << 20)).replace(/=+$/, "");
    // Decoding allocates the output up front; finding the bad character needs nothing.
    const allocated: number[] = [];
    const CountingUint8Array = class extends Uint8Array {
      constructor(length: number) {
        super(length);
        allocated.push(this.length);
      }
    };
    // Near the end and last; U+0080 is one past the lookup table, 😀 a surrogate pair.
    for (const bad of ["!", "\u0080", "😀"]) {
      for (const s of [`${valid.slice(0, -10)}${bad}${valid.slice(-10)}`, `${valid}${bad}`]) {
        const expected = decodeOutcome(referenceBase64ToBytes, s);
        vi.stubGlobal("Uint8Array", CountingUint8Array);
        let actual: ReturnType<typeof decodeOutcome>;
        try {
          actual = decodeOutcome(base64ToBytes, s);
        } finally {
          vi.unstubAllGlobals();
        }
        expect(actual, JSON.stringify(bad)).toEqual(expected);
        expect(allocated, `Uint8Array lengths allocated for ${JSON.stringify(bad)}`).toEqual([]);
      }
    }
  });
});
