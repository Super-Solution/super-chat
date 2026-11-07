import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSSE, parseSSEJson, SSEDecoder, type SSEMessage } from "./sse.js";

/** Build a stream that emits the given byte chunks, to simulate arbitrary splits. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("parseSSE", () => {
  it("parses simple events", async () => {
    const events = await collect(parseSSE(streamOf(["event: ping\ndata: hello\n\n"])));
    expect(events).toEqual([{ event: "ping", data: "hello" }]);
  });

  it("reassembles events split mid-line across chunks", async () => {
    // The failure this guards: naive split("\n\n") on each chunk loses events.
    const events = await collect(parseSSE(streamOf(["event: msg\nda", "ta: par", "tial\n\n"])));
    expect(events).toEqual([{ event: "msg", data: "partial" }]);
  });

  it("handles a UTF-8 character split across a chunk boundary", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("data: 你好\n\n");
    // Split inside the multi-byte sequence for 你.
    const first = bytes.slice(0, 8);
    const second = bytes.slice(8);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    const events = await collect(parseSSE(stream));
    expect(events[0]?.data).toBe("你好");
  });

  it("joins multiple data lines with a newline", async () => {
    const events = await collect(parseSSE(streamOf(["data: one\ndata: two\n\n"])));
    expect(events[0]?.data).toBe("one\ntwo");
  });

  it("ignores comment/heartbeat lines", async () => {
    const events = await collect(parseSSE(streamOf([": keep-alive\n\ndata: real\n\n"])));
    expect(events).toEqual([{ event: "message", data: "real" }]);
  });

  it("accepts CRLF and bare CR terminators", async () => {
    const crlf = await collect(parseSSE(streamOf(["data: a\r\n\r\n"])));
    expect(crlf[0]?.data).toBe("a");
    const cr = await collect(parseSSE(streamOf(["data: b\r\r"])));
    expect(cr[0]?.data).toBe("b");
  });

  it("waits on a trailing CR that might be half of CRLF", async () => {
    const events = await collect(parseSSE(streamOf(["data: x\r", "\ndata: y\r\n\r\n"])));
    expect(events.map((e) => e.data)).toEqual(["x\ny"]);
  });

  it("strips exactly one leading space after the colon", async () => {
    const events = await collect(parseSSE(streamOf(["data:  two-spaces\n\n"])));
    expect(events[0]?.data).toBe(" two-spaces");
  });

  it("flushes a trailing event with no final blank line", async () => {
    const events = await collect(parseSSE(streamOf(["data: last\n"])));
    expect(events[0]?.data).toBe("last");
  });

  it("reassembles one long line spread over many chunks", async () => {
    const text = `event: images\r\ndata: ${"0123456789".repeat(5000)}\r\n\r\n`;
    const chunks = text.match(/[^]{1,7}/g)!;
    expect(chunks.filter((c) => c.endsWith("\r"))).toHaveLength(2); // two of the "\r\n" straddle chunks
    const events = await collect(parseSSE(streamOf(chunks)));
    expect(events).toEqual([{ event: "images", data: "0123456789".repeat(5000) }]);
  });

  it("scans a long line once, not once per chunk", async () => {
    // A 512 KB `data:` line in 256-byte chunks spans 2048 chunks. Before the fix
    // every chunk rescanned the whole partial line (~537M characters here, some
    // 900x the cost of the same bytes as short lines); now each character is
    // scanned once, so the long line costs about what 2048 short lines of the
    // same bytes cost (~1x). Both go through parseSSE, one right after the
    // other, so machine load cancels out, and each sample parses 4 times (~10 ms)
    // so that one preemption by the scheduler cannot reach the 20x threshold.
    const encoder = new TextEncoder();
    const longLine = encoder.encode(`data: ${"A".repeat(512 * 1024)}\n\n`);
    const shortLines = encoder.encode(`${`data: ${"A".repeat(249)}\n`.repeat(2048)}\n`);
    const time = async (bytes: Uint8Array, times: number) => {
      const t0 = performance.now();
      for (let n = 0; n < times; n += 1) {
        let offset = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset >= bytes.length) return controller.close();
            controller.enqueue(bytes.subarray(offset, offset + 256));
            offset += 256;
          },
        });
        expect(await collect(parseSSE(stream))).toHaveLength(1);
      }
      return performance.now() - t0;
    };
    await time(shortLines, 1); // warm-up
    await time(longLine, 1);
    // The fastest of at least 3 rounds: a stall can only make a round slower, so
    // one clean round settles it. Gives up after 15 rounds or 20 s.
    const start = performance.now();
    let shortMs = Infinity;
    let longMs = Infinity;
    for (
      let round = 0;
      round < 15 && performance.now() - start < 20_000 && !(round >= 3 && longMs < shortMs * 20);
      round += 1
    ) {
      shortMs = Math.min(shortMs, await time(shortLines, 4));
      longMs = Math.min(longMs, await time(longLine, 4));
    }
    expect(longMs).toBeLessThan(shortMs * 20);
  }, 120_000);

  it("keeps concurrent streams isolated", async () => {
    // Per-instance decoder state: interleaved reads must not bleed together.
    const a = parseSSE(streamOf(["data: A1\n\ndata: A2\n\n"]));
    const b = parseSSE(streamOf(["data: B1\n\ndata: B2\n\n"]));
    const [a1, b1, a2, b2] = [await a.next(), await b.next(), await a.next(), await b.next()];
    expect([a1.value?.data, b1.value?.data, a2.value?.data, b2.value?.data]).toEqual(["A1", "B1", "A2", "B2"]);
  });
});

describe("parseSSEJson", () => {
  it("parses JSON payloads and stops at [DONE]", async () => {
    const events = await collect(
      parseSSEJson<{ n: number }>(streamOf(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]\n\n'])),
    );
    expect(events.map((e) => e.data.n)).toEqual([1, 2]);
  });

  it("skips a malformed frame rather than killing the stream", async () => {
    const events = await collect(parseSSEJson<{ n: number }>(streamOf(['data: {broken\n\ndata: {"n":9}\n\n'])));
    expect(events.map((e) => e.data.n)).toEqual([9]);
  });
});

// ── Pre-fix reference ────────────────────────────────────────────────────────
// parseSSE, parseSSEJson and findLineEnd exactly as they were at 6a965ed, before
// the unterminated line was kept as pieces. Used only by the differential tests
// below. SSEDecoder did not change, so both sides share the real one.

function referenceFindLineEnd(buf: string, from = 0): { index: number; length: number } | null {
  for (let i = from; i < buf.length; i += 1) {
    const ch = buf[i];
    if (ch === "\n") return { index: i, length: 1 };
    if (ch === "\r") {
      if (i === buf.length - 1) return null;
      return buf[i + 1] === "\n" ? { index: i, length: 2 } : { index: i, length: 1 };
    }
  }
  return null;
}

async function* referenceParseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  const sse = new SSEDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let offset = 0;
      let end = referenceFindLineEnd(buffer, offset);
      while (end) {
        const line = buffer.slice(offset, end.index);
        offset = end.index + end.length;
        const msg = sse.push(line);
        if (msg) yield msg;
        end = referenceFindLineEnd(buffer, offset);
      }
      if (offset > 0) buffer = buffer.slice(offset);
    }
    buffer += decoder.decode();
    for (const line of buffer.split(/\r\n|\n|\r/)) {
      const msg = sse.push(line);
      if (msg) yield msg;
    }
    const tail = sse.flush();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

async function* referenceParseSSEJson<T = unknown>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: T }> {
  for await (const msg of referenceParseSSE(stream)) {
    if (msg.data === "[DONE]") return;
    if (!msg.data) continue;
    try {
      yield { event: msg.event, data: JSON.parse(msg.data) as T };
    } catch {
      // skipped, as before
    }
  }
}

// ── Differential tests: the fixed parser against the pre-fix reference ───────

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

const VALUES = [
  ...["hello", "", " ", "  two", "a:b", "你好", "😀x", "é", " ", "﻿", "\0", "[DONE]", "{broken"],
  ...['{"n":1}', '{"s":"你好"}', "[1,2]", "42", "null", '"str"', '{"a":{"b":[true]}}'],
];
const FIELDS = ["data", "data", "data", "event", "id", "retry", "", "unknown", "Data"];

/** A random event stream as raw bytes: every field shape, all three terminators, BOMs, bad UTF-8, odd endings. */
function randomStream(rand: () => number): Uint8Array {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const text = (s: string) => parts.push(encoder.encode(s));
  if (rand() < 0.3) text("﻿"); // leading BOM, which the decoder strips
  const lines = Math.floor(rand() * 30);
  for (let i = 0; i < lines; i += 1) {
    const r = rand();
    if (r < 0.2) {
      // blank line: dispatch
    } else if (r < 0.28) {
      text(pick([":", ": heartbeat", ":comment: with colon"]));
    } else if (r < 0.34) {
      text(pick(["data", "event", "retry", "id", "nocolon"])); // field without a colon
    } else if (r < 0.38) {
      text(`retry: ${pick(["3000", "12x", "", " 5", "-1", "1.5"])}`);
    } else if (r < 0.42) {
      // invalid or truncated UTF-8 mid-line
      parts.push(new Uint8Array(pick([[0xff], [0xe4, 0xbd], [0xf0, 0x9f, 0x98], [0xc3]])));
      text(pick(VALUES));
    } else if (r < 0.47) {
      text(`data: ${"x".repeat(200 + Math.floor(rand() * 3000))}`); // spans many chunks
    } else {
      text(`${pick(FIELDS)}${pick([":", ": ", ":  "])}${pick(VALUES)}${rand() < 0.3 ? pick(VALUES) : ""}`);
    }
    text(pick(["\n", "\n", "\r\n", "\r"]));
  }
  // Odd endings: no final blank line, a lone CR, a dangling partial line or UTF-8 sequence.
  const end = rand();
  if (end < 0.15) text("\r");
  else if (end < 0.3) text("data: unterminated");
  else if (end < 0.4) parts.push(new Uint8Array([0xe4, 0xbd]));
  else if (end < 0.55) text(pick(["\n", "\r\n", "\r"]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const CHUNKINGS: Record<string, (bytes: Uint8Array, rand: () => number) => Uint8Array[]> = {
  single: (b) => [b],
  "1-byte": (b) => Array.from(b, (x) => new Uint8Array([x])),
  // Sizes 0-8: empty chunks, and sooner or later a split inside every CRLF, BOM and UTF-8 sequence.
  tiny: (b, rand) => {
    const out: Uint8Array[] = [];
    for (let i = 0; i < b.length; ) {
      const n = Math.floor(rand() * 9);
      out.push(b.subarray(i, i + n));
      i += n;
    }
    return out;
  },
  random: (b, rand) => {
    const out: Uint8Array[] = [];
    for (let i = 0; i < b.length; ) {
      const n = 1 + Math.floor(rand() * (rand() < 0.2 ? 4096 : 64));
      out.push(b.subarray(i, i + n));
      i += n;
    }
    return out;
  },
  // Every chunk ends right after a CR, so every CRLF straddles a boundary.
  "cut-after-CR": (b) => {
    const out: Uint8Array[] = [];
    let start = 0;
    for (let i = 0; i < b.length; i += 1) {
      if (b[i] === 0x0d) {
        out.push(b.subarray(start, i + 1));
        start = i + 1;
      }
    }
    out.push(b.subarray(start));
    return out;
  },
};

/**
 * One chunk per read and nothing pulled ahead (highWaterMark 0), with every
 * read logged, so a trace pins down which bytes had arrived when each line was
 * pushed and each message was yielded.
 */
function tracedStream(chunks: Uint8Array[], log: string[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (i === chunks.length) {
          log.push("read: done");
          controller.close();
          return;
        }
        log.push(`read: chunk ${i}`);
        controller.enqueue(chunks[i]!.slice());
        i += 1;
      },
    },
    { highWaterMark: 0 },
  );
}

function bytesStreamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c.slice());
      controller.close();
    },
  });
}

describe("parseSSE against the pre-fix reference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Everything observable about one parse, in order: reads, lines pushed into SSEDecoder, messages yielded. */
  async function trace(
    parse: (s: ReadableStream<Uint8Array>) => AsyncGenerator<SSEMessage>,
    chunks: Uint8Array[],
  ): Promise<string[]> {
    const log: string[] = [];
    const push = SSEDecoder.prototype.push;
    const spy = vi.spyOn(SSEDecoder.prototype, "push").mockImplementation(function (this: SSEDecoder, line: string) {
      log.push(`push: ${JSON.stringify(line)}`);
      return push.call(this, line);
    });
    try {
      for await (const msg of parse(tracedStream(chunks, log))) log.push(`yield: ${JSON.stringify(msg)}`);
    } finally {
      spy.mockRestore();
    }
    return log;
  }

  it("reads, pushes and yields the same things in the same order for every chunking", async () => {
    const rand = prng(0x5eed);
    let messages = 0;
    let splitCRLF = 0;
    let emptyChunks = 0;
    for (let n = 0; n < 300; n += 1) {
      const bytes = randomStream(rand);
      for (const [name, chunking] of Object.entries(CHUNKINGS)) {
        if (name === "1-byte" && n % 3 !== 0) continue; // the slowest; a third of the streams is plenty
        const chunks = chunking(bytes, rand);
        const expected = await trace(referenceParseSSE, chunks);
        const actual = await trace(parseSSE, chunks);
        expect(actual, `stream #${n}, ${name} chunking`).toEqual(expected);
        messages += expected.filter((l) => l.startsWith("yield")).length;
        splitCRLF += chunks.filter((c, i) => c[c.length - 1] === 0x0d && chunks[i + 1]?.[0] === 0x0a).length;
        emptyChunks += chunks.filter((c) => c.length === 0).length;
      }
    }
    // The generator really produced the cases it claims to.
    expect(messages).toBeGreaterThan(2000);
    expect(splitCRLF).toBeGreaterThan(1000);
    expect(emptyChunks).toBeGreaterThan(5000);
  }, 60_000);

  it("matches the reference through parseSSEJson", async () => {
    const rand = prng(0xd0e);
    let frames = 0;
    for (let n = 0; n < 200; n += 1) {
      const bytes = randomStream(rand);
      const chunks = CHUNKINGS.tiny!(bytes, rand);
      const expected = await collect(referenceParseSSEJson(bytesStreamOf(chunks)));
      const actual = await collect(parseSSEJson(bytesStreamOf(chunks)));
      expect(actual, `stream #${n}`).toEqual(expected);
      frames += expected.length;
    }
    expect(frames).toBeGreaterThan(30);
  });

  it("stops at the same read once a line outgrows the longest string the engine allows", async ({ skip }) => {
    // The pre-fix `buffer += chunk` threw a RangeError on the read that took the
    // line past that length, which also capped the memory a line that never ends
    // can take. A stand-in TextDecoder turns a marker byte into a string a few
    // characters short of the limit, so the read after "data: AA" goes past it.
    // V8 builds `"A".repeat(n)` from linked halves (a rope), so neither these
    // checks nor those strings copy anything, and neither parser scans them.
    const longest = 2 ** 29 - 24; // V8's longest string, on 64-bit
    const fits = (n: number) => {
      try {
        return "A".repeat(n).length === n;
      } catch {
        return false;
      }
    };
    if (fits(longest + 1) || !fits(longest)) return skip(); // another engine: not worth finding its limit
    const almost = "A".repeat(longest - 6);
    const almostAfterTerminator = `\n${"A".repeat(longest - 7)}`;
    const RealTextDecoder = TextDecoder;
    vi.stubGlobal(
      "TextDecoder",
      class {
        private real = new RealTextDecoder("utf-8");
        decode(bytes?: Uint8Array, options?: TextDecodeOptions): string {
          if (bytes?.length === 1 && bytes[0] === 0x01) return almost;
          if (bytes?.length === 1 && bytes[0] === 0x02) return almostAfterTerminator;
          return this.real.decode(bytes, options);
        }
      },
    );
    const run = async (parse: (s: ReadableStream<Uint8Array>) => AsyncGenerator<SSEMessage>, chunks: Uint8Array[]) => {
      const log: string[] = [];
      try {
        for await (const msg of parse(tracedStream(chunks, log))) log.push(`yield: ${msg.data.length} characters`);
      } catch (err) {
        log.push(`throw: ${(err as Error).constructor.name}: ${(err as Error).message}`);
      }
      return log;
    };
    const encoder = new TextEncoder();
    const start = [encoder.encode("data: "), encoder.encode("AA")];
    const marker = (byte: number) => new Uint8Array([byte]);
    try {
      for (const chunks of [
        [...start, marker(0x01), marker(0x01), marker(0x01)], // never terminated
        [...start, marker(0x02), encoder.encode("\n\n")], // terminated in the chunk that overflows
      ]) {
        const expected = await run(referenceParseSSE, chunks);
        expect(expected.slice(-2)).toEqual(["read: chunk 2", expect.stringMatching(/^throw: RangeError/)]);
        expect(await run(parseSSE, chunks)).toEqual(expected);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  }, 60_000);
});
