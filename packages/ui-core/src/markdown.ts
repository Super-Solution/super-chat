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

import { splitBlocks, type MarkdownBlock } from "@supersolutions/super-chat-core";
import { highlightCode } from "./highlight.js";

/**
 * What a host can change about how Markdown becomes HTML. Everything is optional, and the
 * defaults are the safe ones: no image is fetched, no maths is guessed at, code is coloured by
 * a small built-in highlighter.
 */
export type MarkdownOptions = {
  /**
   * Colour fenced code: `(code, lang) => html` for the inside of `<code>`, or `undefined` to
   * leave that block plain. The default knows JS/TS, JSON, Python, shell, SQL, HTML/CSS, YAML
   * and diffs; pass highlight.js or Shiki here for the rest, or `false` for none. The returned
   * HTML is inserted as it is, so it must come from code you trust.
   */
  highlight?: ((code: string, lang: string) => string | undefined) | false;
  /**
   * Typeset `$…$` and `$$…$$`: `(tex, display) => html`, or `undefined` to leave the source as
   * text. Without this, `$` is an ordinary character, so a price is never mistaken for maths.
   * The returned HTML is inserted as it is, so it must come from code you trust (KaTeX, Temml).
   */
  math?: (tex: string, display: boolean) => string | undefined;
  /**
   * What `![alt](https://…)` becomes. `"link"` (the default) is a link to the image: nothing is
   * fetched until the reader follows it, so a model cannot make a page load a URL it chose.
   * `"embed"` draws the picture, with lazy loading and no referrer.
   */
  images?: "link" | "embed";
  /**
   * Draw the buttons for code blocks and tables (copy, wrap, show all) as markup. They carry
   * `data-sc-act` and no words; `ProseHtml` in `super-chat-ui` gives them their labels and
   * answers them. Off by default so a plain `renderMarkdown` string has no dead buttons in it.
   */
  actions?: boolean;
};

type Ctx = {
  highlight: ((code: string, lang: string) => string | undefined) | false;
  math: MarkdownOptions["math"];
  embed: boolean;
  actions: boolean;
};

const contextOf = (o: MarkdownOptions | undefined): Ctx => ({
  highlight: o?.highlight === undefined ? highlightCode : o.highlight,
  math: o?.math,
  embed: o?.images === "embed",
  actions: o?.actions === true,
});

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

// A bare URL and a character reference also have to be seen, and they carry none of the above.
const AUTOLINKABLE = /https?:\/\//;
const ENTITY = /&(?:[a-z][a-z\d]{1,31}|#\d{1,7}|#x[\da-f]{1,6});/i;

const isPlainProse = (raw: string, ctx: Ctx) =>
  !MARKDOWN_SIGNIFICANT.test(raw) &&
  !ORDERED_ITEM.test(raw) &&
  !SETEXT_EQUALS.test(raw) &&
  !AUTOLINKABLE.test(raw) &&
  !ENTITY.test(raw) &&
  !(ctx.math && raw.includes("$"));

/** How deep a quote or list may nest before its interior is rendered flat. */
const MAX_DEPTH = 4;

// Quotes are escaped because link URLs are interpolated into href="…" — an
// unescaped quote in a URL would close the attribute and open a new one
// (browsers recover from the missing-whitespace parse error by reading
// `"onmouseover="…` as a fresh attribute).
//
// NUL is dropped here, at the one place every leaf is escaped, rather than only in
// `inline`: the inline placeholders below are built from it, so it must never come from
// the source, and code blocks and the plain-prose shortcut would otherwise let a raw
// U+0000 through into the output. (Block offsets are computed on the raw source, so
// removing it from the output moves no anchor.)
const escapeHtml = (s: string) =>
  s.replace(/\0/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Inline ───────────────────────────────────────────────────────────────────

/**
 * Escape, then transform. Every leaf goes through here and nothing else does.
 *
 * Code spans are lifted out FIRST and put back last, so `**not bold**` inside
 * backticks stays literal — the same protection fenced blocks get, which the
 * old chain gave only to fences. NUL is stripped from the input because the
 * placeholders are built from it; without that, text could forge one.
 */
// Only http(s) links — a javascript: URL must never survive. The destination may
// contain one level of balanced parentheses (`…/wiki/Foo_(bar)`), as CommonMark
// allows; the two alternatives cannot match the same character, so there is no
// backtracking blow-up on a hostile string.
//
// The other destination is a card reference, `ref:<card>?key=value&…` (super-protocol
// docs/CARD-REFS.md). It is not a link: it becomes a span the host wires to a card, and it
// stays plain text where no host does. The character set is the envelope's own, plus the `;`
// that escaping gives `&`, so nothing in it can close an attribute or open a tag. The limits
// are the parser's to enforce (a ref that breaks them degrades where it is used), not this
// regex's; the bound here only keeps a hostile string from costing a long scan.
const LINK = /\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+|ref:[A-Za-z0-9._:~%=&;?-]{1,3000})\)/g;

// An image: the destination follows the same rules as a link's, and only http(s) is one.
const IMAGE = /!\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g;
// `<https://…>` (escaped, by now) and a bare URL. A URL stops at whitespace, at an escaped quote
// or angle bracket, and at a parenthesis that is not part of a balanced pair, so a sentence
// that ends with "(see https://example.com)" does not take the bracket with it.
const URL_BODY = String.raw`(?:(?!&(?:quot|lt|gt);)[^\s\0()]|\([^\s\0()]*\))+`;
const ANGLE_URL = /* @__PURE__ */ new RegExp(String.raw`&lt;(https?:\/\/${URL_BODY})&gt;`, "g");
const BARE_URL = /* @__PURE__ */ new RegExp(String.raw`(?<![\w/=@])https?:\/\/${URL_BODY}`, "g");
// Punctuation that ends a sentence, or the emphasis around a URL, is not part of it.
const URL_TAIL = /[.,;:!?*_~]+$/;
// A character reference in text stays one (`&amp;` shows `&`), and everything it can name is text.
const ESCAPED_ENTITY = /&amp;([a-z][a-z\d]{1,31}|#\d{1,7}|#x[\da-f]{1,6});/gi;
// `$$…$$`, then `$…$` where the opening `$` is followed and the closing one preceded by
// something that is not a space, and the closing one is not followed by a digit or letter, so
// "costs $5 and $10" is two prices and not a formula.
const MATH_DISPLAY = /\$\$([^\0]+?)\$\$/g;
const MATH_INLINE = /(?<![\\$\w])\$(?=[^\s$])((?:[^$\n\\]|\\.)+?)(?<=[^\s\\])\$(?![\d\w$])/g;

/** Strike-through, strong, emphasis. Runs on already-escaped text. */
const emphasize = (s: string) =>
  s
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/\*\*\*(?=[^\s*])([^*\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(?=\S)((?:[^*]|\*(?!\*))+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)((?:[^_]|_(?!_))+?)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*])\*(?=[^\s*])([^*\n]*[^\s*])\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*[^\s_])_(?![\w])/g, "$1<em>$2</em>");

const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

type Link = { text: string; url: string; ref: boolean; plain: boolean; image?: boolean };

function inline(raw: string, ctx: Ctx): string {
  const spans: string[] = [];
  const spanSource: string[] = []; // what each code span looked like, for where it must stay literal
  let s = escapeHtml(raw);

  s = s.replace(/(`+)([\s\S]+?)\1(?!`)/g, (all, _ticks, body: string) => {
    spans.push(body);
    spanSource.push(all);
    return `\0${spans.length - 1}\0`;
  });

  // Maths is lifted next, so its underscores and asterisks are not read as emphasis, and only
  // when the host supplied the typesetter: otherwise a `$` is a dollar sign.
  const maths: string[] = [];
  const mathSource: string[] = [];
  if (ctx.math) {
    const typeset = (tex: string, display: boolean, whole: string) => {
      const out = ctx.math!(unescapeHtml(tex).trim(), display);
      if (out === undefined) return whole;
      maths.push(out);
      mathSource.push(whole);
      return `\0M${maths.length - 1}\0`;
    };
    s = s.replace(MATH_DISPLAY, (all, tex: string) => typeset(tex, true, all));
    s = s.replace(MATH_INLINE, (all, tex: string) => typeset(tex, false, all));
  }

  // Links are lifted out the same way, BEFORE emphasis. Otherwise the emphasis rules
  // run over the destination too, and `…/a*b*c` becomes `href="…/a<em>b</em>c"`: the
  // link silently points somewhere else. Only the link's text is emphasised.
  const links: Link[] = [];
  const lift = (link: Link) => {
    links.push(link);
    return `\0L${links.length - 1}\0`;
  };
  // A backtick pair inside a URL (or an image's alt text, which lands in an attribute) is part of
  // it, not a code span.
  const literalUrl = (url: string) =>
    url
      .replace(/\0M(\d+)\0/g, (_m, i: string) => mathSource[Number(i)]!)
      .replace(/\0(\d+)\0/g, (_m, i: string) => spanSource[Number(i)]!);

  s = s.replace(IMAGE, (_all, alt: string, url: string) =>
    lift({ text: literalUrl(alt), url: literalUrl(url), ref: false, plain: true, image: true }),
  );
  s = s.replace(LINK, (_all, text: string, url: string) => {
    const literal = literalUrl(url);
    return lift({ text, url: literal, ref: literal.startsWith("ref:"), plain: false });
  });
  s = s.replace(ANGLE_URL, (_all, url: string) => lift({ text: url, url, ref: false, plain: true }));
  s = s.replace(BARE_URL, (all: string) => {
    const url = all.replace(URL_TAIL, "");
    return lift({ text: url, url, ref: false, plain: true }) + all.slice(url.length);
  });

  s = emphasize(s.replace(ESCAPED_ENTITY, "&$1;"));

  // A link's text may hold another lifted construct (an image inside a link). Drawn from the
  // outside in, so the image can know it is inside one: an anchor never holds an anchor.
  const draw = (index: number, inside: boolean): string => {
    const link = links[index]!;
    const nest = (text: string) => text.replace(/\0L(\d+)\0/g, (_all, j: string) => draw(Number(j), true));
    if (link.image) {
      const alt = link.text;
      if (ctx.embed) {
        return `<img class="sc-md-img" src="${link.url}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
      }
      // A link to the picture, not the picture: the model chose this URL, and fetching it is
      // how a conversation leaks to a third party. The words stay readable and the `!` is gone.
      if (inside) return alt || link.url;
      return `<a class="sc-md-image" href="${link.url}" target="_blank" rel="noopener noreferrer">${alt || link.url}</a>`;
    }
    if (link.ref) return `<span class="sc-ref" data-ref="${link.url}">${nest(emphasize(link.text))}</span>`;
    return `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${nest(link.plain ? link.text : emphasize(link.text))}</a>`;
  };
  s = s.replace(/\0L(\d+)\0/g, (_all, i: string) => draw(Number(i), false));

  return s
    .replace(/\0M(\d+)\0/g, (_all, i: string) => maths[Number(i)]!)
    .replace(/\0(\d+)\0/g, (_all, i: string) => `<code>${spans[Number(i)]}</code>`);
}

// ── Verbatim blocks ──────────────────────────────────────────────────────────

const CLOSING_FENCE = /^ {0,3}(?:`{3,}|~{3,})\s*$/;
// The first word of the info string, if it is a name and not prose: `js`, `c++`, `c#`, `shell-session`.
const FENCE_LANG = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9][A-Za-z0-9_+#.-]{0,31})(?:[ \t{].*)?$/;

// Lines running on to a second row. Part of the markup, not a mask image or a decoration pass, so
// it needs no stylesheet request and survives the page's strictest content security policy.
const WRAP_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h12M2 8h8.5a2.5 2.5 0 0 1 0 5H8m0 0 1.6-1.6M8 13l1.6 1.6M2 12h2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The code, its language, and the buttons a host may wire, in one box. */
function codeBox(source: string, lang: string, ctx: Ctx): string {
  // NUL never reaches a highlighter or the page, whichever of them writes the markup.
  const code = source.replace(/\0/g, "");
  const colored = lang && ctx.highlight ? ctx.highlight(code, lang) : undefined;
  const body = colored ?? escapeHtml(code);
  const attr = lang ? ` data-lang="${lang}"` : "";
  const pre = `<pre${attr}><code${lang ? ` class="language-${lang}"` : ""}>${body}</code></pre>`;
  if (!ctx.actions) return pre;
  return (
    `<div class="sc-mdcode"${attr}><div class="sc-mdcode__bar"><span class="sc-mdcode__lang">${lang}</span>` +
    `<span class="sc-mdcode__tools"><button type="button" class="sc-mdcode__btn" data-sc-act="wrap">${WRAP_ICON}</button>` +
    `<button type="button" class="sc-mdcode__btn" data-sc-act="copy"></button></span></div>${pre}` +
    `<button type="button" class="sc-mdcode__more" data-sc-act="more"></button></div>`
  );
}

function renderFence(raw: string, ctx: Ctx): string {
  // Drop the opening fence line (which may carry a language) and the closing
  // one if it is there — an unterminated fence has none. Content is escaped but
  // never sees an inline transform.
  const lines = raw.split("\n");
  const lang = (FENCE_LANG.exec(lines[0]!)?.[1] ?? "").toLowerCase();
  lines.shift();
  if (lines.length && CLOSING_FENCE.test(lines[lines.length - 1]!)) lines.pop();
  return codeBox(lines.join("\n"), lang, ctx);
}

function renderIndentedCode(raw: string, ctx: Ctx): string {
  const body = raw.split("\n").map((l) => l.replace(/^(?: {4}|\t)/, "")).join("\n");
  return codeBox(body, "", ctx);
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

function renderTable(lines: string[], ctx: Ctx): string | null {
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
    return `<${tag}${a ? ` class="sc-md-${a}"` : ""}>${inline(text, ctx)}</${tag}>`;
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

  // The table scrolls inside a box of its own, and the box takes focus: a wide table is
  // otherwise unreachable by keyboard. (A `display:block` table would scroll without the box,
  // but a block table is no longer a table to some assistive technology.)
  const table =
    `<div class="sc-md-scroll" tabindex="0"><table class="sc-md-table"><thead><tr>${head
      .map((h, i) => cell("th", h, i))
      .join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  if (!ctx.actions) return table;
  return (
    `<div class="sc-md-tablebox"><div class="sc-md-tablebar">` +
    `<button type="button" class="sc-md-tablebtn" data-sc-act="copy-tsv"></button>` +
    `<button type="button" class="sc-md-tablebtn" data-sc-act="copy-md"></button></div>${table}</div>`
  );
}

// ── Lists ────────────────────────────────────────────────────────────────────

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TASK_MARK = /^\[([ xX])\][ \t]+/;

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
 *
 * A task item (`[ ] todo`, `[x] done`) gets a checkbox that is shown and cannot be changed:
 * the reader is looking at an answer, not filling in a form. In a tight item the checkbox and
 * the text share a `<label>`, which is what names the box for a screen reader.
 */
function renderItem(item: string, depth: number, ctx: Ctx): { html: string; task: boolean } {
  const mark = TASK_MARK.exec(item);
  const body = mark ? item.slice(mark[0].length) : item;
  const lines = body.replace(/\s+$/, "").split("\n");
  const nestedAt = lines.findIndex((l, i) => i > 0 && LIST_ITEM.test(l));
  const head = (nestedAt === -1 ? lines : lines.slice(0, nestedAt)).filter((l) => l.trim() !== "");
  const rest = nestedAt === -1 ? [] : lines.slice(nestedAt);
  const loose = /\n[ \t]*\n/.test(body.trim());

  const headHtml = head.length
    ? loose
      ? renderSource(head.join("\n"), depth + 1, ctx)
      : inline(head.join(" ").trim(), ctx)
    : "";
  const nested = rest.length ? renderSource(rest.join("\n"), depth + 1, ctx) : "";
  if (!mark) return { html: headHtml + nested, task: false };

  const checked = mark[1] !== " " ? " checked" : "";
  const box = `<input type="checkbox" disabled${checked}`;
  return {
    html: (loose ? `${box} aria-label="[${mark[1]}]">${headHtml}` : `<label>${box}> ${headHtml}</label>`) + nested,
    task: true,
  };
}

function renderList(lines: string[], depth: number, ctx: Ctx): string | null {
  const parsed = parseList(lines);
  if (!parsed) return null;
  const items = parsed.items
    .map((item) => {
      const { html, task } = renderItem(item, depth, ctx);
      return `<li${task ? ' class="sc-md-task"' : ""}>${html}</li>`;
    })
    .join("");
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
// A paragraph that is nothing but `$$ … $$`, which may span lines.
const DISPLAY_MATH = /^\s*\$\$([\s\S]+?)\$\$\s*$/;

function renderProse(lines: string[], ctx: Ctx): string {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const display = ctx.math ? DISPLAY_MATH.exec(para.join("\n")) : null;
    const typeset = display ? ctx.math!(display[1]!.trim(), true) : undefined;
    out.push(
      typeset !== undefined
        ? `<div class="sc-math-block">${typeset}</div>`
        : `<p>${para.map((l) => inline(l, ctx)).join("<br/>")}</p>`,
    );
    para = [];
  };

  for (const line of lines) {
    const h = ATX.exec(line);
    if (h) {
      flush();
      const level = Math.min(h[1]!.length + 1, 6);
      out.push(`<h${level}>${inline(h[2]!, ctx)}</h${level}>`);
      continue;
    }
    para.push(line);
  }
  flush();
  return out.join("");
}

function renderTextBlock(raw: string, depth: number, ctx: Ctx): string {
  if (isPlainProse(raw, ctx)) {
    // Escaping still happens — safety is not what the shortcut skips.
    return `<p>${escapeHtml(raw).replace(/\n/g, "<br/>")}</p>`;
  }

  const lines = raw.split("\n");

  const table = renderTable(lines, ctx);
  if (table) return table;

  if (depth < MAX_DEPTH && QUOTE_MARK.test(lines[0]!)) {
    const inner = lines.map((l) => l.replace(QUOTE_MARK, "")).join("\n");
    return `<blockquote>${renderSource(inner, depth + 1, ctx)}</blockquote>`;
  }

  if (depth < MAX_DEPTH) {
    const list = renderList(lines, depth, ctx);
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
    return `<h${level}>${inline(text, ctx)}</h${level}>`;
  }

  return renderProse(lines, ctx);
}

// ── Assembly ─────────────────────────────────────────────────────────────────

function renderBlock(src: string, block: MarkdownBlock, depth: number, ctx: Ctx): string {
  const raw = src.slice(block.start, block.end);
  if (block.kind === "fence") return renderFence(raw, ctx);
  if (block.kind === "code") return renderIndentedCode(raw, ctx);
  return renderTextBlock(raw, depth, ctx);
}

/** Split and render a source, with no anchors. Also the recursion step. */
function renderSource(src: string, depth: number, ctx: Ctx): string {
  return splitBlocks(src)
    .map((b) => renderBlock(src, b, depth, ctx))
    .join("");
}

/** Render for the transcript: no anchors, because chat prose is not addressed. */
export function renderMarkdown(src: string, options?: MarkdownOptions): string {
  return renderSource(src, 0, contextOf(options));
}

/** What renderMarkdownStream keeps between calls. Start from newMarkdownStream(). */
export type MarkdownStream = {
  /** The source the cached blocks were decided on; valid while the text starts with it. */
  settled: string;
  /** Rendered HTML of those blocks, one string each, in order. They never change once here. */
  parts: string[];
  /** Where the block after them starts looking: the line after the last one. */
  resume: number;
  /** The options the cache was rendered with; a different set starts it over. */
  options: MarkdownOptions | undefined;
};

export const newMarkdownStream = (): MarkdownStream => ({ settled: "", parts: [], resume: 0, options: undefined });

/**
 * renderMarkdown for text that grows while it is shown — always the same
 * HTML renderMarkdown(src) returns, but blocks that can no longer change are
 * rendered once and reused, so a streamed answer costs its open tail per
 * frame instead of its whole length.
 *
 * Returned block by block: the strings of blocks that cannot change again are the very same
 * strings from one call to the next, which is what lets `ProseHtml` leave their DOM alone
 * (and a selection inside them standing) while the tail grows.
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
export function renderMarkdownBlocks(src: string, stream: MarkdownStream, options?: MarkdownOptions): string[] {
  if (!src.startsWith(stream.settled) || stream.options !== options) {
    Object.assign(stream, newMarkdownStream());
    stream.options = options;
  }
  const ctx = contextOf(options);

  const from = stream.resume;
  const tail = src.slice(from);
  const blocks = splitBlocks(tail);
  const lastLine = src.lastIndexOf("\n") + 1 - from;
  const shown = stream.parts.slice();
  for (let i = 0; i < blocks.length; i += 1) {
    const rendered = renderBlock(tail, blocks[i]!, 0, ctx);
    shown.push(rendered);
    if (i + 1 < blocks.length && blocks[i + 1]!.start < lastLine) {
      stream.parts.push(rendered);
      stream.resume = from + blocks[i]!.end + 1;
    }
  }
  stream.settled = src.slice(0, lastLine + from);
  return shown;
}

/** `renderMarkdownBlocks`, joined: the string `renderMarkdown(src, options)` would give. */
export function renderMarkdownStream(src: string, stream: MarkdownStream, options?: MarkdownOptions): string {
  return renderMarkdownBlocks(src, stream, options).join("");
}

/**
 * Render for a document previewer: every block carries `data-sc-block`, so a
 * DOM selection resolves to a source span by walking up to the nearest one.
 *
 * Kept separate from renderMarkdown rather than added as an option, because
 * assistant prose has nothing to address and the extra attributes would be
 * noise in every message bubble.
 */
export function renderMarkdownWithAnchors(src: string, options?: MarkdownOptions): AnchoredMarkdown {
  const ctx = contextOf(options);
  const blocks = splitBlocks(src);
  const html = blocks
    .map((block, i) => {
      const rendered = renderBlock(src, block, 0, ctx);
      // Every branch of renderBlock returns markup, so the first tag always
      // exists; the anchor rides on it instead of an extra wrapper element,
      // which keeps the DOM (and therefore .sc-prose's spacing rules) unchanged.
      return rendered.replace(/^(\s*<[a-z][a-z0-9]*)/i, `$1 data-sc-block="${i}"`);
    })
    .join("");
  return { html, blocks };
}
