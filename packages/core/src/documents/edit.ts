// Reading and rewriting a Markdown document, as pure functions.
//
// Everything here is string in, string out. That is deliberate: the hard parts
// of in-chat editing are addressing and refusal, both of which are decidable
// without a store, a model or a browser — so they are decided in code that a
// unit test can pin exactly.

import { splitBlocks, type MarkdownBlock } from "../content/blocks.js";
import type {
  AppliedEdit,
  DocumentEdit,
  DocumentOutlineEntry,
  EditResult,
} from "./types.js";

const headingLevel = (line: string): number | undefined => {
  const m = /^ {0,3}(#{1,6})\s/.exec(line);
  return m ? m[1]!.length : undefined;
};

/**
 * A map of the document, cheap enough to send every turn.
 *
 * Editing is a directed activity — "the third section", "the bit about
 * renewal" — not a similarity search, so the model needs to navigate rather
 * than retrieve. An outline costs a line per block and lets it ask for exactly
 * the span it wants; without one it either guesses or is handed the whole
 * document, and the whole document is what this design exists to avoid.
 */
export function outlineOf(markdown: string): DocumentOutlineEntry[] {
  return splitBlocks(markdown).map((block, i) => entryOf(markdown, block, i));
}

/** The outline entry for one block, which is block `i` of `markdown`. */
function entryOf(markdown: string, block: MarkdownBlock, i: number): DocumentOutlineEntry {
  const raw = markdown.slice(block.start, block.end);
  const firstLine = raw.split("\n", 1)[0] ?? "";
  const level = block.kind === "text" ? headingLevel(firstLine) : undefined;
  return {
    block: i,
    kind: block.kind,
    ...(level ? { level } : {}),
    preview: firstLine.trim().slice(0, 100),
    chars: raw.length,
  };
}

/** Source text of a block range, inclusive. Out-of-range yields "". */
export function spanOf(markdown: string, from: number, to = from): string {
  const blocks = splitBlocks(markdown);
  const first = blocks[Math.max(0, from)];
  const last = blocks[Math.min(blocks.length - 1, to)];
  if (!first || !last || first.start > last.end) return "";
  return markdown.slice(first.start, last.end);
}

/** Blocks whose text contains `query`, case-insensitively. */
export function searchBlocks(markdown: string, query: string): DocumentOutlineEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  // One split, and an outline entry only for the blocks that match. Going
  // through outlineOf split the document a second time and described every
  // block only to throw most of them away.
  const out: DocumentOutlineEntry[] = [];
  splitBlocks(markdown).forEach((block, i) => {
    if (markdown.slice(block.start, block.end).toLowerCase().includes(needle)) {
      out.push(entryOf(markdown, block, i));
    }
  });
  return out;
}

/**
 * Where `needle` first occurs in `haystack`, and how many times it occurs in
 * all, overlaps included. Only the count is needed past the first hit — it is
 * what the ambiguity message reports — so the hits are counted, not collected.
 */
function occurrences(haystack: string, needle: string, offset = 0): { first: number; count: number } {
  let first = -1;
  let count = 0;
  if (!needle) return { first, count };
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    if (count === 0) first = i + offset;
    count += 1;
  }
  return { first, count };
}

const blockOf = (blocks: MarkdownBlock[], index: number): number =>
  Math.max(
    0,
    blocks.findIndex((b) => index >= b.start && index < b.end),
  );

/**
 * Apply edits to a document, or refuse.
 *
 * Refusing is half the job and the more important half. A find that matches
 * nothing means the model is quoting text that is not there; a find that
 * matches twice means it has not said which one. Guessing either — taking the
 * first match, say — produces a change in the wrong place that the diff will
 * present as if it were intended, and the user approves it. So both are
 * rejections with a reason the model can act on, exactly as tools/repair.ts
 * treats malformed arguments: an invalid input to retry, not a result.
 *
 * Edits are resolved against the ORIGINAL text and spliced into it in one pass,
 * so earlier edits cannot shift the offsets of later ones. Two edits that
 * overlap are a contradiction rather than a merge, and are refused.
 */
export function applyEdits(markdown: string, edits: readonly DocumentEdit[]): EditResult {
  if (!edits.length) return { ok: true, markdown, applied: [] };

  const blocks = splitBlocks(markdown);
  const applied: AppliedEdit[] = [];

  for (const edit of edits) {
    if (!edit.find) {
      return { ok: false, reason: "not-found", message: "An edit needs a non-empty `find`.", edit };
    }

    let hits: { first: number; count: number };
    if (edit.block === undefined) {
      hits = occurrences(markdown, edit.find);
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
      hits = occurrences(markdown.slice(block.start, block.end), edit.find, block.start);
    }

    if (hits.count === 0) {
      return {
        ok: false,
        reason: "not-found",
        message:
          `Could not find that text${edit.block === undefined ? "" : ` in block ${edit.block}`}. ` +
          "Re-read the document and quote it exactly, whitespace included.",
        edit,
      };
    }
    if (hits.count > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        message:
          `That text appears ${hits.count} times. Include more surrounding text, or name the block.`,
        edit,
      };
    }

    const start = hits.first;
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

    applied.push({ edit, start, end, block: blockOf(blocks, start) });
  }

  // Front to back, cutting every unchanged stretch straight from the original.
  // Overlaps were refused above, so no edit needs text another one produced —
  // and re-slicing the rewritten string once per edit made this quadratic.
  let out = "";
  let from = 0;
  for (const a of [...applied].sort((x, y) => x.start - y.start)) {
    out += markdown.slice(from, a.start) + a.edit.replace;
    from = a.end;
  }

  return { ok: true, markdown: out + markdown.slice(from), applied };
}

/** Line-level view of one edit, for the approval card. */
export type EditHunk = {
  index: number;
  block: number;
  removed: string[];
  added: string[];
};

/**
 * One hunk per edit, rather than a computed diff.
 *
 * The point of hunks here is that the user can accept some and reject others,
 * and an edit is already the smallest independently-applicable unit — it
 * carries its own anchor. Deriving hunks from a text diff instead would produce
 * regions that are not separately applicable, which is the wrong shape for the
 * question being asked.
 */
export function hunksOf(applied: readonly AppliedEdit[]): EditHunk[] {
  return applied.map((a, index) => ({
    index,
    block: a.block,
    removed: a.edit.find.split("\n"),
    added: a.edit.replace === "" ? [] : a.edit.replace.split("\n"),
  }));
}
