// Block structure of a Markdown source, addressed by offsets.
//
// This lives in core rather than beside the renderer because two very different
// consumers have to agree on it exactly: the previewer, which turns a DOM
// selection into a block index, and the edit protocol, which resolves that same
// index back to text it is allowed to rewrite. Two implementations would drift,
// and the drift would be silent — a quote pointing at block 4 and an edit
// landing in block 5 both look fine until someone reads the result.
//
// Which is exactly why the first version's shortcuts had to go. It matched a
// fence with `startsWith("```")` and nothing else, so a four-backtick block
// containing a three-backtick one closed on the inner fence and shattered into
// four blocks with the code stranded in the middle as prose — and a `~~~` fence
// was not a fence at all, which left the NEXT ``` in the document opening one
// that ran to the end. Both produce anchors that point at the wrong text while
// the page still renders plausibly, which is the failure mode this file exists
// to prevent.

export type MarkdownBlockKind =
  /** A fenced code block, ``` or ~~~. Verbatim: no inline transforms. */
  | "fence"
  /** An indented (four-space or tab) code block. Also verbatim. */
  | "code"
  /** Everything else: a paragraph, heading, list, quote or table. */
  | "text";

/** A top-level block, addressed by its half-open span in the SOURCE string. */
export type MarkdownBlock = {
  start: number;
  end: number;
  kind: MarkdownBlockKind;
};

type Line = { text: string; start: number; end: number };

function scanLines(src: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (let i = 0; i <= src.length; i += 1) {
    if (i === src.length || src[i] === "\n") {
      out.push({ text: src.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  return out;
}

const isBlank = (text: string) => text.trim() === "";

/** Up to three leading spaces still counts as the left margin, per CommonMark. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const INDENTED = /^(?: {4}|\t)/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const QUOTE = /^ {0,3}>/;

type Fence = { marker: string; char: string };

/**
 * A fence opener, or null.
 *
 * The info string is rejected when it contains a backtick: ``` `a` ``` on one
 * line is an inline code span, not the start of a code block, and treating it
 * as one swallows the rest of the paragraph.
 */
function fenceOpen(text: string): Fence | null {
  const m = FENCE_OPEN.exec(text);
  if (!m) return null;
  const marker = m[1]!;
  const char = marker[0]!;
  if (char === "`" && m[2]!.includes("`")) return null;
  return { marker, char };
}

/**
 * Does this line close `open`?
 *
 * Same character, at least as long, and nothing but whitespace after it. The
 * length rule is the whole point: a ``` inside a ```` block is content, and
 * closing on it is what split a code sample into four bogus blocks.
 */
function closesFence(text: string, open: Fence): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(text);
  if (!m) return false;
  const marker = m[1]!;
  return marker[0] === open.char && marker.length >= open.marker.length;
}

/**
 * Whether a blank line inside `construct` is an interior gap rather than a
 * boundary.
 *
 * A loose list — items separated by blank lines — is one list, and splitting it
 * per item is not merely cosmetic: the previewer would render three `<ul>`s
 * where the document has one, and the outline would report three entries the
 * user reads as one thing. A quote continues the same way, but only through a
 * line that is still quoted; lazy continuation after a blank is not a thing.
 */
function continues(construct: "list" | "quote" | "other", text: string): boolean {
  if (construct === "list") return LIST_ITEM.test(text) || INDENTED.test(text);
  if (construct === "quote") return QUOTE.test(text);
  return false;
}

const constructOf = (text: string): "list" | "quote" | "other" =>
  QUOTE.test(text) ? "quote" : LIST_ITEM.test(text) ? "list" : "other";

/**
 * Top-level blocks in source order, with their spans.
 *
 * Blank lines that separate blocks belong to none of them, so a span always
 * slices back to exactly the block's own text. Blank lines *inside* a block —
 * within a fence, between the items of a loose list — are part of it.
 */
export function splitBlocks(src: string): MarkdownBlock[] {
  const lines = scanLines(src);
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line.text)) {
      i += 1;
      continue;
    }

    const open = fenceOpen(line.text);
    if (open) {
      let j = i + 1;
      while (j < lines.length && !closesFence(lines[j]!.text, open)) j += 1;
      // An unterminated fence runs to the end of the source rather than
      // swallowing the rest as prose — a half-streamed code block is a normal
      // state to render, not a malformed document.
      const closing = j < lines.length ? lines[j]! : lines[lines.length - 1]!;
      blocks.push({ start: line.start, end: closing.end, kind: "fence" });
      i = j + 1;
      continue;
    }

    if (INDENTED.test(line.text)) {
      // Indented code, with its interior blank lines kept and its trailing ones
      // returned to the separator. Only reachable at a block boundary: inside a
      // list the same indentation is item content, and the list branch below
      // consumes it first.
      let j = i;
      let last = i;
      while (j < lines.length && (isBlank(lines[j]!.text) || INDENTED.test(lines[j]!.text))) {
        if (!isBlank(lines[j]!.text)) last = j;
        j += 1;
      }
      blocks.push({ start: line.start, end: lines[last]!.end, kind: "code" });
      i = last + 1;
      continue;
    }

    const construct = constructOf(line.text);
    let j = i;
    let last = i;
    for (;;) {
      // Run to the next blank line or fence opener.
      while (j < lines.length && !isBlank(lines[j]!.text) && !fenceOpen(lines[j]!.text)) {
        last = j;
        j += 1;
      }
      // Then decide whether the gap is interior. Look past the blanks: if what
      // follows still belongs to this list or quote, absorb them and keep going.
      let k = j;
      while (k < lines.length && isBlank(lines[k]!.text)) k += 1;
      if (k > j && k < lines.length && continues(construct, lines[k]!.text)) {
        j = k;
        continue;
      }
      break;
    }
    blocks.push({ start: line.start, end: lines[last]!.end, kind: "text" });
    i = last + 1;
  }

  return blocks;
}
