// Server-Sent Events parser, per the WHATWG spec's event-stream algorithm.
//
// Hand-rolled rather than using EventSource because EventSource cannot POST and
// cannot set an Authorization header — both of which every LLM streaming API
// requires. The subtleties that a naive `split("\n\n")` gets wrong and this
// does not:
//   • chunk boundaries can land mid-line, mid-event, or mid-UTF-8-codepoint;
//   • line terminators may be \n, \r\n or a bare \r;
//   • a leading space after "field:" is stripped, but only one;
//   • multiple `data:` lines in one event join with \n;
//   • comment lines (":heartbeat") keep the connection warm and must be ignored.

export type SSEMessage = {
  event: string;
  data: string;
  id?: string;
  retry?: number;
};

/**
 * Incremental line-oriented decoder. State is per-instance, not module-level —
 * a background job poll and a foreground stream can run concurrently, and
 * shared accumulator state would interleave their events into garbage.
 */
export class SSEDecoder {
  private event = "";
  private data: string[] = [];
  private id: string | undefined;
  private retry: number | undefined;

  /** Feed one line (terminator already removed). Returns an event when dispatched. */
  push(line: string): SSEMessage | null {
    if (line === "") return this.flush(); // blank line dispatches
    if (line.startsWith(":")) return null; // comment / heartbeat

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1); // exactly one leading space

    switch (field) {
      case "event":
        this.event = value;
        break;
      case "data":
        this.data.push(value);
        break;
      case "id":
        if (!value.includes("\0")) this.id = value;
        break;
      case "retry": {
        const n = Number(value);
        if (Number.isInteger(n)) this.retry = n;
        break;
      }
      default:
        break; // unknown fields ignored per spec
    }
    return null;
  }

  /** Dispatch whatever has accumulated. Called on a blank line and at stream end. */
  flush(): SSEMessage | null {
    if (this.data.length === 0 && !this.event) return null;
    const msg: SSEMessage = {
      event: this.event || "message",
      data: this.data.join("\n"),
      ...(this.id !== undefined ? { id: this.id } : {}),
      ...(this.retry !== undefined ? { retry: this.retry } : {}),
    };
    this.event = "";
    this.data = [];
    this.id = undefined;
    this.retry = undefined;
    return msg;
  }
}

/** Locate the next line terminator at or after `from`, or null if the buffer may still be mid-terminator. */
function findLineEnd(buf: string, from = 0): { index: number; length: number } | null {
  for (let i = from; i < buf.length; i += 1) {
    const ch = buf[i];
    if (ch === "\n") return { index: i, length: 1 };
    if (ch === "\r") {
      // A trailing \r could be the first half of \r\n — wait for more bytes.
      if (i === buf.length - 1) return null;
      return buf[i + 1] === "\n" ? { index: i, length: 2 } : { index: i, length: 1 };
    }
  }
  return null;
}

/**
 * Decode a byte stream into SSE messages. `TextDecoder({stream:true})` is what
 * makes multi-byte characters split across chunks safe — decoding each chunk
 * independently corrupts any emoji or CJK text that straddles a boundary.
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  const sse = new SSEDecoder();
  let buffer = "";
  // Whether `buffer` ends in a "\r" held back as a possible half of "\r\n".
  let cr = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      // Appending links the two strings (engines build a rope) and copies
      // nothing until a character is read. So only the new text is scanned,
      // plus a held "\r" so that a "\r\n" split across chunks still reads as one
      // terminator, and an unterminated line is copied once, when its terminator
      // shows up. Scanning `buffer` from the start read, and so copied, the
      // whole line again with every chunk: quadratic for a long line (a base64
      // image in one `data:` field).
      buffer += text;
      const scan: string = cr ? "\r" + text : text;
      const shift = buffer.length - scan.length; // where `scan` starts in `buffer`

      // Track a read offset instead of slicing the buffer after every line —
      // a chunk with many short lines would otherwise re-copy the (shrinking)
      // remainder once per line. Slice once, after every complete line in
      // this chunk has been extracted.
      let offset = 0;
      let end = findLineEnd(scan);
      while (end) {
        const line = buffer.slice(offset, shift + end.index);
        offset = shift + end.index + end.length;
        const msg = sse.push(line);
        if (msg) yield msg;
        end = findLineEnd(scan, offset - shift);
      }
      if (offset > 0) buffer = buffer.slice(offset);
      cr = scan.endsWith("\r");
    }

    // Flush a trailing event that arrived without its final blank line — some
    // proxies close the connection right after the last data line.
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

/**
 * SSE messages whose `data` is JSON, skipping the `[DONE]` sentinel that
 * OpenAI's Chat Completions stream terminates with.
 */
export async function* parseSSEJson<T = unknown>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: T }> {
  for await (const msg of parseSSE(stream)) {
    if (msg.data === "[DONE]") return;
    if (!msg.data) continue;
    try {
      yield { event: msg.event, data: JSON.parse(msg.data) as T };
    } catch {
      // A malformed frame is not worth killing a live stream over; the finish
      // event still arrives and the turn completes with what it got.
    }
  }
}
