// Tolerant, incremental JSON for tool arguments that are still streaming.
//
// A provider streams a tool call's arguments as raw JSON fragments, and the
// only thing a UI can do with `{"kind":"table","spec":{"columns":[{"key":"na`
// is wait — unless something can read it as "a table spec whose columns have
// started". This is that something.
//
// What it promises, and what it does not:
//   • Every snapshot is a value `JSON.parse` could have produced from SOME
//     prefix-completion of the input: open containers are closed, an open
//     string VALUE shows the characters received so far.
//   • An open KEY is never shown — `{"ti` is `{}`, not `{ ti: undefined }`.
//   • An unterminated NUMBER is never shown either. `12` may be the start of
//     `1200`, and a magnitude that is wrong by a factor of a hundred is worse
//     than one that is late. A truncated string reads as truncated; a
//     truncated number reads as a different number.
//   • Literals (`true`/`false`/`null`) appear only once complete.
//   • A half-received escape (`\`, `\u00`) and a lone high surrogate are held
//     back until the rest arrives, so a snapshot never contains a broken char.
//   • Prose or a ``` fence before the first `{`/`[` is skipped. Anything else
//     malformed FREEZES the parser at its last good snapshot rather than
//     guessing — the authoritative, repaired and validated value still arrives
//     with the provider's `tool-call-end`. This is a preview, never a source of
//     truth.
//
// Incremental rather than re-parse-per-delta because a long spec arrives in
// thousands of fragments: re-reading the whole accumulated string each time is
// quadratic over the call. Here each character is read once, and a snapshot
// copies only the chain of containers that are still open — every finished
// object or array is frozen and SHARED between snapshots, so a table that has
// received 200 rows hands the UI the same 199 row objects it saw last time.

type ObjectFrame = {
  type: "object";
  value: Record<string, unknown>;
  /** The key whose value is being read, once its closing quote has arrived. */
  key: string | undefined;
  expect: "key" | "colon" | "value" | "comma";
};
type ArrayFrame = { type: "array"; value: unknown[]; expect: "value" | "comma" };
type Frame = ObjectFrame | ArrayFrame;

type Token =
  | { type: "string"; isKey: boolean; text: string; escape: "" | "\\" | "u"; hex: string }
  | { type: "number"; text: string }
  | { type: "literal"; text: string };

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const LITERALS: Record<string, unknown> = { true: true, false: false, null: null };
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const HEX = /^[0-9a-fA-F]$/;
const isSpace = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t";
const isNumberChar = (c: string) => (c >= "0" && c <= "9") || c === "-" || c === "+" || c === "." || c === "e" || c === "E";

/** JSON.parse semantics for an own `__proto__` key: a data property, not a prototype swap. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === "__proto__") Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

/** Drop a trailing high surrogate whose low half has not arrived yet. */
function visible(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

export class PartialJsonParser {
  private stack: Frame[] = [];
  private token: Token | null = null;
  private root: unknown = undefined;
  private started = false;
  private done = false;
  private broken = false;
  private changes = 0;
  private cache: { at: number; value: unknown } | null = null;

  /** True once the top-level value has closed. Input after it is ignored. */
  get complete(): boolean {
    return this.done;
  }

  /** True once the input stopped being JSON. The parser keeps its last good snapshot. */
  get failed(): boolean {
    return this.broken;
  }

  /**
   * Bumped whenever the snapshot would differ. Compare against the value you
   * last rendered to skip deltas that changed nothing visible — whitespace, a
   * key's characters, the digits of an unfinished number.
   */
  get version(): number {
    return this.changes;
  }

  push(chunk: string): void {
    let i = 0;
    const len = chunk.length;
    while (i < len && !this.done && !this.broken) {
      const token = this.token;
      if (token?.type === "string") {
        i = this.readString(token, chunk, i);
        continue;
      }
      const c = chunk[i]!;
      if (token?.type === "number") {
        if (isNumberChar(c)) {
          token.text += c;
          i += 1;
          continue;
        }
        this.token = null;
        if (!NUMBER.test(token.text)) {
          this.broken = true;
          return;
        }
        this.assign(Number(token.text));
        continue; // `c` still needs reading: it is what ended the number
      }
      if (token?.type === "literal") {
        token.text += c;
        i += 1;
        if (Object.hasOwn(LITERALS, token.text)) {
          this.token = null;
          this.assign(LITERALS[token.text]);
        } else if (!Object.keys(LITERALS).some((l) => l.startsWith(token.text))) {
          this.broken = true;
        }
        continue;
      }
      i += 1;
      if (isSpace(c)) continue;
      this.structural(c);
    }
  }

  /**
   * The value as far as it has arrived, or `undefined` before the top-level
   * container opens. Stable by reference until `version` changes.
   */
  snapshot(): unknown {
    if (this.done) return this.root;
    if (this.cache?.at === this.changes) return this.cache.value;
    let child: unknown = undefined;
    let hasChild = false;
    if (this.token?.type === "string" && !this.token.isKey) {
      child = visible(this.token.text);
      hasChild = true;
    }
    for (let i = this.stack.length - 1; i >= 0; i -= 1) {
      const frame = this.stack[i]!;
      if (frame.type === "object") {
        const copy = { ...frame.value };
        if (hasChild && frame.key !== undefined) setOwn(copy, frame.key, child);
        child = copy;
      } else {
        const copy = frame.value.slice();
        if (hasChild) copy.push(child);
        child = copy;
      }
      hasChild = true;
    }
    this.cache = { at: this.changes, value: child };
    return child;
  }

  private structural(c: string): void {
    const frame = this.stack[this.stack.length - 1];
    if (!frame) {
      // Before the root: tolerate whatever a model wraps JSON in. After it,
      // `done` has already stopped the loop.
      if (c === "{" || c === "[") {
        this.started = true;
        this.open(c);
      }
      return;
    }
    if (frame.type === "object") {
      switch (frame.expect) {
        case "key":
          if (c === '"') this.token = { type: "string", isKey: true, text: "", escape: "", hex: "" };
          else if (c === "}") this.close(); // `{}`, or a trailing comma
          else this.broken = true;
          return;
        case "colon":
          if (c === ":") frame.expect = "value";
          else this.broken = true;
          return;
        case "value":
          this.startValue(c);
          return;
        case "comma":
          if (c === ",") frame.expect = "key";
          else if (c === "}") this.close();
          else this.broken = true;
          return;
      }
    }
    if (frame.expect === "value") {
      if (c === "]") this.close(); // `[]`, or a trailing comma
      else this.startValue(c);
    } else if (c === ",") frame.expect = "value";
    else if (c === "]") this.close();
    else this.broken = true;
  }

  private startValue(c: string): void {
    if (c === '"') {
      this.token = { type: "string", isKey: false, text: "", escape: "", hex: "" };
      this.changes += 1; // the key now shows, with an empty value
    } else if (c === "{" || c === "[") this.open(c);
    else if (c === "-" || (c >= "0" && c <= "9")) this.token = { type: "number", text: c };
    else if (c === "t" || c === "f" || c === "n") this.token = { type: "literal", text: c };
    else this.broken = true;
  }

  private open(c: "{" | "["): void {
    this.stack.push(c === "{" ? { type: "object", value: {}, key: undefined, expect: "key" } : { type: "array", value: [], expect: "value" });
    this.changes += 1;
  }

  private close(): void {
    const frame = this.stack.pop()!;
    this.assign(frame.value);
  }

  /** A value finished: hand it to the container it belongs to, or finish the root. */
  private assign(value: unknown): void {
    this.changes += 1;
    const parent = this.stack[this.stack.length - 1];
    if (!parent) {
      this.root = value;
      this.done = this.started;
      return;
    }
    if (parent.type === "object") {
      setOwn(parent.value, parent.key!, value);
      parent.key = undefined;
    } else {
      parent.value.push(value);
    }
    parent.expect = "comma";
  }

  /** Consume string characters from `i`; returns where reading stopped. */
  private readString(token: Extract<Token, { type: "string" }>, chunk: string, i: number): number {
    const len = chunk.length;
    while (i < len) {
      if (token.escape === "u") {
        const c = chunk[i]!;
        if (!HEX.test(c)) {
          this.broken = true;
          return len;
        }
        token.hex += c;
        i += 1;
        if (token.hex.length === 4) {
          token.text += String.fromCharCode(parseInt(token.hex, 16));
          token.escape = "";
          token.hex = "";
          if (!token.isKey) this.changes += 1;
        }
        continue;
      }
      if (token.escape === "\\") {
        const c = chunk[i]!;
        i += 1;
        if (c === "u") {
          token.escape = "u";
          continue;
        }
        // An unknown escape keeps its character: lenient, and lossless enough
        // for a preview that the validated value will replace anyway.
        token.text += ESCAPES[c] ?? c;
        token.escape = "";
        if (!token.isKey) this.changes += 1;
        continue;
      }
      // Copy the plain run up to the next quote or backslash in one slice.
      let j = i;
      while (j < len) {
        const code = chunk.charCodeAt(j);
        if (code === QUOTE || code === BACKSLASH) break;
        j += 1;
      }
      if (j > i) {
        token.text += chunk.slice(i, j);
        if (!token.isKey) this.changes += 1;
        i = j;
      }
      if (i >= len) return i;
      if (chunk.charCodeAt(i) === BACKSLASH) {
        token.escape = "\\";
        i += 1;
        continue;
      }
      // Closing quote.
      this.token = null;
      if (token.isKey) {
        const frame = this.stack[this.stack.length - 1] as ObjectFrame;
        frame.key = token.text;
        frame.expect = "colon";
      } else {
        this.assign(token.text);
      }
      return i + 1;
    }
    return i;
  }
}

/** One-shot form: the best value `text` supports so far, and whether it is whole. */
export function parsePartialJson(text: string): { value: unknown; complete: boolean } {
  const parser = new PartialJsonParser();
  parser.push(text);
  return { value: parser.snapshot(), complete: parser.complete };
}
