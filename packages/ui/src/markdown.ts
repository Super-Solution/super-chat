// Minimal markdown renderer for assistant text, markdown cards and document
// artifacts.
//
// Deliberately not a full parser — a chat message or card body is short, and
// pulling in a markdown library plus a sanitizer for this is disproportionate.
//
// It does now split into blocks before rendering, and that is not a stylistic
// change. A document previewer has to answer "the user selected this on screen;
// where is it in the source?", because that span is both what gets quoted into
// the next request and what an edit has to anchor against. The previous shape —
// escape the whole string, pull fences out into placeholders, then run a chain
// of global regexes — destroyed source positions in its first statement.
//
// So the order is inverted: split on the RAW source and record offsets, then
// escape and transform each block independently. Escaping per block rather than
// up front is load-bearing, not tidiness: `&` → `&amp;` changes the string
// length, so escaping first would shift every offset recorded afterwards. That
// failure is invisible on screen — the page renders perfectly and the anchors
// silently point at the wrong text — which is why markdown.test.ts asserts the
// offsets round-trip rather than trusting the output to look right.
//
// ── Why it grew ──────────────────────────────────────────────────────────────
//
// The block set used to be headings, emphasis, code, links and bullet lists,
// and for a chat bubble that is the right amount of renderer. A document
// artifact changed the requirement under it: a document is a thing the user
// KEEPS, reads in a previewer and downloads as `.md`, and a report whose table
// renders as a column of literal pipes is not a document — it is the source of
// one. Tables, quotes, ordered lists and indented code are not exotic; they are
// what anyone writing a report reaches for in the first paragraph.
//
// The structure changed with the scope. A chain of global regexes over one
// escaped string cannot tell a table from a paragraph, so each block is now
// CLASSIFIED first and rendered by shape, and only the leaves run inline
// transforms. Nesting (a list inside a quote, a quote inside a list) falls out
// of rendering a block's interior through the same splitter, with a depth cap
// so a pathological `> > > > …` cannot recurse without end.

import { splitBlocks, type MarkdownBlock } from "@super-solution/super-chat-core";

export type AnchoredMarkdown = {
  html: string;
  /** Index-aligned with the `data-sc-block` attribute on the rendered HTML. */
  blocks: MarkdownBlock[];
};

// Cheap pre-check carried over from main: with none of these characters
// present, no heading, emphasis, code, link, list, quote or table rule below
// could match, so the whole chain is skippable. Applied per BLOCK rather than
// per document — one fenced snippet in an otherwise plain artifact should not
// cost the other forty paragraphs their shortcut.
const MARKDOWN_SIGNIFICANT = /[`*_#[\]>~|-]/;
// Two constructs carry no character the test above would catch: an ordered
// item, and a setext heading underlined with `=`. Adding `=` and the digits to
// MARKDOWN_SIGNIFICANT would cost the shortcut on most prose, so they get their
// own (equally cheap) look instead.
const ORDERED_ITEM = /^ {0,3}\d{1,9}[.)]\s/m;
const SETEXT_EQUALS = /\n {0,3}=+[ \t]*$/;

const isPlainProse = (raw: string) =>
  !MARKDOWN_SIGNIFICANT.test(raw) && !ORDERED_ITEM.test(raw) && !SETEXT_EQUALS.test(raw);

/** How deep a quote or list may nest before its interior is rendered flat. */
const MAX_DEPTH = 4;

// Quotes are escaped because link URLs are interpolated into href="…" — an
// unescaped quote in a URL would close the attribute and open a new one
// (browsers recover from the missing-whitespace parse error by reading
// `"onmouseover="…` as a fresh attribute).
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Inline ───────────────────────────────────────────────────────────────────

/**
 * Escape, then transform. Every leaf goes through here and nothing else does.
 *
 * Code spans are lifted out FIRST and put back last, so `**not bold**` inside
 * backticks stays literal — the same protection fenced blocks get, which the
 * old chain gave only to fences. NUL is stripped from the input because the
 * placeholders are built from it; without that, text could forge one.
 */
function inline(raw: string): string {
  const spans: string[] = [];
  let s = escapeHtml(raw.replace(/\0/g, ""));

  s = s.replace(/(`+)([\s\S]+?)\1(?!`)/g, (_all, _ticks, body: string) => {
    spans.push(body);
    return `\0${spans.length - 1}\0`;
  });

  s = s
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    // Only http(s) links — a javascript: URL must never survive.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  return s.replace(/\0(\d+)\0/g, (_all, i: string) => `<code>${spans[Number(i)]}</code>`);
}

// ── Verbatim blocks ──────────────────────────────────────────────────────────

const CLOSING_FENCE = /^ {0,3}(?:`{3,}|~{3,})\s*$/;

function renderFence(raw: string): string {
  // Drop the opening fence line (which may carry a language) and the closing
  // one if it is there — an unterminated fence has none. Content is escaped but
  // never sees an inline transform.
  const lines = raw.split("\n").slice(1);
  if (lines.length && CLOSING_FENCE.test(lines[lines.length - 1]!)) lines.pop();
  return `<pre><code>${escapeHtml(lines.join("\n"))}</code></pre>`;
}

function renderIndentedCode(raw: string): string {
  const body = raw.split("\n").map((l) => l.replace(/^(?: {4}|\t)/, "")).join("\n");
  return `<pre><code>${escapeHtml(body)}</code></pre>`;
}

// ── Tables ───────────────────────────────────────────────────────────────────

type Align = "left" | "center" | "right" | null;

const DELIMITER_CELL = /^:?-+:?$/;

/** Split a pipe row into cells, honouring `\|` as a literal pipe. */
function cellsOf(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

const alignOf = (cell: string): Align => {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
};

function renderTable(lines: string[]): string | null {
  if (lines.length < 2 || !lines[0]!.includes("|")) return null;
  const delimiter = cellsOf(lines[1]!);
  if (!delimiter.length || !delimiter.every((c) => DELIMITER_CELL.test(c))) return null;

  const head = cellsOf(lines[0]!);
  if (head.length !== delimiter.length) return null;
  const align = delimiter.map(alignOf);

  // Alignment rides on a class rather than a style attribute: a host with a
  // strict CSP can ship this without allowing inline styles.
  const cell = (tag: "th" | "td", text: string, i: number) => {
    const a = align[i];
    return `<${tag}${a ? ` class="sc-md-${a}"` : ""}>${inline(text)}</${tag}>`;
  };

  const body = lines
    .slice(2)
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const row = cellsOf(l);
      // Short rows are padded and long ones cut, so a ragged table still lines
      // up under its header instead of leaking cells into a new column.
      const cells = Array.from({ length: head.length }, (_, i) => cell("td", row[i] ?? "", i));
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  return `<table class="sc-md-table"><thead><tr>${head
    .map((h, i) => cell("th", h, i))
    .join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

// ── Lists ────────────────────────────────────────────────────────────────────

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

type ParsedList = { ordered: boolean; start: number; items: string[] };

function parseList(lines: string[]): ParsedList | null {
  const first = LIST_ITEM.exec(lines[0] ?? "");
  if (!first) return null;
  const base = first[1]!.length;
  const marker = first[2]!;
  const ordered = /^\d/.test(marker);
  // Everything indented at least as far as the first item's text belongs to
  // that item — its wrapped lines, its paragraphs, and any list nested under it.
  const strip = new RegExp(`^ {0,${base + marker.length + 1}}`);

  const items: string[][] = [];
  for (const line of lines) {
    const m = LIST_ITEM.exec(line);
    if (m && m[1]!.length <= base) {
      items.push([m[3]!]);
      continue;
    }
    if (!items.length) return null;
    items[items.length - 1]!.push(line.replace(strip, ""));
  }

  return { ordered, start: ordered ? Number.parseInt(marker, 10) : 1, items: items.map((l) => l.join("\n")) };
}

/**
 * One item's interior.
 *
 * A single-paragraph item stays tight — `<li>text</li>`, not
 * `<li><p>text</p></li>` — because the paragraph margin inside a list item is
 * the classic "why is my list double-spaced" bug. Anything with a blank line or
 * a nested list goes back through the block pipeline, which is where nesting
 * comes from.
 */
function renderItem(item: string, depth: number): string {
  const lines = item.replace(/\s+$/, "").split("\n");
  const nestedAt = lines.findIndex((l, i) => i > 0 && LIST_ITEM.test(l));
  const head = (nestedAt === -1 ? lines : lines.slice(0, nestedAt)).filter((l) => l.trim() !== "");
  const rest = nestedAt === -1 ? [] : lines.slice(nestedAt);
  const loose = /\n[ \t]*\n/.test(item.trim());

  const headHtml = head.length
    ? loose
      ? renderSource(head.join("\n"), depth + 1)
      : inline(head.join(" ").trim())
    : "";
  return headHtml + (rest.length ? renderSource(rest.join("\n"), depth + 1) : "");
}

function renderList(lines: string[], depth: number): string | null {
  const parsed = parseList(lines);
  if (!parsed) return null;
  const items = parsed.items.map((item) => `<li>${renderItem(item, depth)}</li>`).join("");
  if (!parsed.ordered) return `<ul>${items}</ul>`;
  return `<ol${parsed.start !== 1 ? ` start="${parsed.start}"` : ""}>${items}</ol>`;
}

// ── Prose ────────────────────────────────────────────────────────────────────

const QUOTE_MARK = /^ {0,3}> ?/;
const THEMATIC_BREAK = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
// Headings shift down one: the card or page owns the h1, so a document's own
// `#` must not compete with it for the document outline a screen reader builds.
const ATX = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

function renderProse(lines: string[]): string {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    out.push(`<p>${para.map(inline).join("<br/>")}</p>`);
    para = [];
  };

  for (const line of lines) {
    const h = ATX.exec(line);
    if (h) {
      flush();
      const level = Math.min(h[1]!.length + 1, 6);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      continue;
    }
    para.push(line);
  }
  flush();
  return out.join("");
}

function renderTextBlock(raw: string, depth: number): string {
  if (isPlainProse(raw)) {
    // Escaping still happens — safety is not what the shortcut skips.
    return `<p>${escapeHtml(raw).replace(/\n/g, "<br/>")}</p>`;
  }

  const lines = raw.split("\n");

  const table = renderTable(lines);
  if (table) return table;

  if (depth < MAX_DEPTH && QUOTE_MARK.test(lines[0]!)) {
    const inner = lines.map((l) => l.replace(QUOTE_MARK, "")).join("\n");
    return `<blockquote>${renderSource(inner, depth + 1)}</blockquote>`;
  }

  if (depth < MAX_DEPTH) {
    const list = renderList(lines, depth);
    if (list) return list;
  }

  if (lines.length === 1 && THEMATIC_BREAK.test(lines[0]!)) return "<hr/>";

  // Setext: the underline belongs to the lines above it, and reading it as a
  // paragraph followed by a rule is the wrong document — the title stops being
  // a heading, which is exactly what the outline is built from.
  const last = lines[lines.length - 1]!;
  if (lines.length >= 2 && SETEXT.test(last)) {
    const level = last.trim().startsWith("=") ? 2 : 3;
    const text = lines.slice(0, -1).join(" ").trim();
    return `<h${level}>${inline(text)}</h${level}>`;
  }

  return renderProse(lines);
}

// ── Assembly ─────────────────────────────────────────────────────────────────

function renderBlock(src: string, block: MarkdownBlock, depth: number): string {
  const raw = src.slice(block.start, block.end);
  if (block.kind === "fence") return renderFence(raw);
  if (block.kind === "code") return renderIndentedCode(raw);
  return renderTextBlock(raw, depth);
}

/** Split and render a source, with no anchors. Also the recursion step. */
function renderSource(src: string, depth: number): string {
  return splitBlocks(src)
    .map((b) => renderBlock(src, b, depth))
    .join("");
}

/** Render for the transcript: no anchors, because chat prose is not addressed. */
export function renderMarkdown(src: string): string {
  return renderSource(src, 0);
}

/** What renderMarkdownStream keeps between calls. Start from newMarkdownStream(). */
export type MarkdownStream = {
  /** The source the cached blocks were decided on; valid while the text starts with it. */
  settled: string;
  /** Rendered HTML of those blocks. */
  html: string;
  /** Where the block after them starts looking: the line after the last one. */
  resume: number;
};

export const newMarkdownStream = (): MarkdownStream => ({ settled: "", html: "", resume: 0 });

/**
 * renderMarkdown for text that grows while it is shown — always the same
 * string renderMarkdown(src) returns, but blocks that can no longer change are
 * rendered once and reused, so a streamed answer costs its open tail per
 * frame instead of its whole length.
 *
 * Every block renders from its own source slice alone, so the only question
 * is which blocks later text can still move. splitBlocks decides a block's
 * extent from its own lines and, at most, the first line of the block after
 * it: the blank line or fence opener that ends it, and for a list or quote the
 * next non-blank line, which may continue it. Whether a line is blank, a fence
 * opener or closer, a list item or a quote can change while it is the last,
 * unterminated line — `1` becomes `1.`, a closing ``` becomes ```js, ``` gains
 * a backtick and stops opening a fence, a blank line gets text. Every line
 * before the last is final. So a block is settled once the block after it
 * starts before the last line: a setext underline, a loose list's next item,
 * a table's delimiter row or the rest of an open fence all belong to the
 * block that is still open. (This renderer has no reference definitions,
 * footnotes or raw HTML blocks, the other constructs that reach back.) And
 * splitBlocks never looks behind the line it stands on, so splitting from the
 * line after the settled blocks yields the same blocks the whole text would.
 *
 * Text that does not start with `stream.settled` — a new run, an edit — drops
 * the cache and renders from scratch.
 */
export function renderMarkdownStream(src: string, stream: MarkdownStream): string {
  if (!src.startsWith(stream.settled)) Object.assign(stream, newMarkdownStream());

  const from = stream.resume;
  const tail = src.slice(from);
  const blocks = splitBlocks(tail);
  const lastLine = src.lastIndexOf("\n") + 1 - from;
  let html = stream.html;
  for (let i = 0; i < blocks.length; i += 1) {
    const rendered = renderBlock(tail, blocks[i]!, 0);
    html += rendered;
    if (i + 1 < blocks.length && blocks[i + 1]!.start < lastLine) {
      stream.html += rendered;
      stream.resume = from + blocks[i]!.end + 1;
    }
  }
  stream.settled = src.slice(0, lastLine + from);
  return html;
}

/**
 * Render for a document previewer: every block carries `data-sc-block`, so a
 * DOM selection resolves to a source span by walking up to the nearest one.
 *
 * Kept separate from renderMarkdown rather than added as an option, because
 * assistant prose has nothing to address and the extra attributes would be
 * noise in every message bubble.
 */
export function renderMarkdownWithAnchors(src: string): AnchoredMarkdown {
  const blocks = splitBlocks(src);
  const html = blocks
    .map((block, i) => {
      const rendered = renderBlock(src, block, 0);
      // Every branch of renderBlock returns markup, so the first tag always
      // exists; the anchor rides on it instead of an extra wrapper element,
      // which keeps the DOM (and therefore .sc-prose's spacing rules) unchanged.
      return rendered.replace(/^(\s*<[a-z][a-z0-9]*)/i, `$1 data-sc-block="${i}"`);
    })
    .join("");
  return { html, blocks };
}
