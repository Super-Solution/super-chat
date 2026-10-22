import { describe, expect, it } from "vitest";
import { splitBlocks } from "@super-solution/super-chat-core";
import { renderMarkdown, renderMarkdownWithAnchors } from "./markdown.js";

describe("renderMarkdown", () => {
  it("escapes HTML so model output cannot inject markup", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not linkify a javascript: URL", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript');
  });

  it("cannot break out of the href attribute with a quote in the URL", () => {
    const html = renderMarkdown('[x](https://a.example/"onmouseover="location=name)');
    // The quote is entity-escaped, so it stays inside the href VALUE instead of
    // closing the attribute and smuggling in an onmouseover attribute.
    expect(html).toContain('href="https://a.example/&quot;onmouseover=&quot;location=name"');
    expect(html).not.toContain('/"onmouseover');
  });

  it("still linkifies an http(s) URL", () => {
    const html = renderMarkdown("[docs](https://example.com/page)");
    expect(html).toContain('<a href="https://example.com/page" target="_blank" rel="noopener noreferrer">docs</a>');
  });

  it("protects fenced code content from inline transforms", () => {
    const html = renderMarkdown("```\n**bold** and _stuff_ and [link](https://example.com)\n```");
    expect(html).toContain("<pre><code>**bold** and _stuff_ and [link](https://example.com)</code></pre>");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<a ");
  });

  it("does not paragraph-wrap or <br/>-ify fenced code content spanning multiple lines", () => {
    const html = renderMarkdown("```js\nline one\n\nline two\n```");
    expect(html).toContain("<pre><code>line one\n\nline two</code></pre>");
    expect(html).not.toContain("<br/>");
    expect(html).not.toContain("<p>line");
  });

  it("renders a basic paragraph and list", () => {
    const html = renderMarkdown("Hello world\n\n- one\n- two");
    expect(html).toContain("<p>Hello world</p>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toMatch(/<ul>[\s\S]*<\/ul>/);
  });

  // A code span used to be transformed and then transformed again: the chain
  // ran on the produced HTML, so `**x**` inside backticks came out bold. Fences
  // were protected and spans were not, for no reason anyone chose.
  it("protects an inline code span from the transforms that follow it", () => {
    const html = renderMarkdown("use `**not bold**` here");
    expect(html).toContain("<code>**not bold**</code>");
    expect(html).not.toContain("<strong>");
  });
});

// Everything below is what a DOCUMENT needs and a chat bubble did not. A report
// whose table renders as a column of literal pipes is the source of a document,
// not a document.
describe("renderMarkdown: document constructs", () => {
  it("renders a pipe table, with the header separator carrying alignment", () => {
    const html = renderMarkdown("| Item | Cost |\n|:-----|-----:|\n| SSO  | 120  |");
    expect(html).toContain("<table");
    expect(html).toContain('<th class="sc-md-left">Item</th>');
    expect(html).toContain('<th class="sc-md-right">Cost</th>');
    expect(html).toContain('<td class="sc-md-right">120</td>');
    expect(html).not.toContain("|");
  });

  it("pads a ragged row instead of leaking cells into a new column", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 |");
    expect(html.match(/<td/g)).toHaveLength(2);
  });

  it("does not read a paragraph containing a pipe as a table", () => {
    const html = renderMarkdown("costs are 3 | 4 depending on tier");
    expect(html).toContain("<p>");
    expect(html).not.toContain("<table");
  });

  it("renders a blockquote, and the blocks inside it", () => {
    const html = renderMarkdown("> The clause is unenforceable.\n>\n> - no notice period\n> - no cap");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<p>The clause is unenforceable.</p>");
    expect(html).toContain("<li>no notice period</li>");
  });

  it("renders an ordered list and keeps a start other than 1", () => {
    expect(renderMarkdown("1. first\n2. second")).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(renderMarkdown("3. third\n4. fourth")).toContain('<ol start="3">');
  });

  it("nests a list under its parent item", () => {
    const html = renderMarkdown("- outer\n  - inner\n- second");
    expect(html).toContain("<li>outer<ul><li>inner</li></ul></li>");
    expect(html).toContain("<li>second</li>");
  });

  it("keeps a single-paragraph item tight so a list is not double-spaced", () => {
    expect(renderMarkdown("- one\n- two")).not.toContain("<li><p>");
  });

  it("renders an indented code block verbatim rather than as prose", () => {
    const html = renderMarkdown("Example:\n\n    const rate = **not bold**\n    return rate");
    expect(html).toContain("<pre><code>const rate = **not bold**\nreturn rate</code></pre>");
    expect(html).not.toContain("<strong>");
  });

  it("renders a thematic break", () => {
    expect(renderMarkdown("above\n\n---\n\nbelow")).toContain("<hr/>");
  });

  it("reads a setext underline as a heading, not a paragraph plus a rule", () => {
    expect(renderMarkdown("Vendor review\n===")).toBe("<h2>Vendor review</h2>");
    expect(renderMarkdown("Findings\n---")).toBe("<h3>Findings</h3>");
  });

  it("supports the heading levels a real document uses, shifted down one", () => {
    const html = renderMarkdown("#### Deep\n\n###### Deepest");
    expect(html).toContain("<h5>Deep</h5>");
    expect(html).toContain("<h6>Deepest</h6>");
  });

  it("escapes inside a table cell and a quote, not just in prose", () => {
    expect(renderMarkdown("| a |\n|---|\n| <img src=x> |")).toContain("&lt;img src=x&gt;");
    expect(renderMarkdown("> <script>alert(1)</script>")).not.toContain("<script>");
  });

  it("stops nesting rather than recursing without end", () => {
    const html = renderMarkdown("> ".repeat(40) + "deep");
    expect(html).toContain("deep");
    expect(html.match(/<blockquote>/g)!.length).toBeLessThanOrEqual(4);
  });
});

describe("splitBlocks", () => {
  // The whole point of splitting on the raw source: a span has to slice back to
  // exactly the text it came from, or every anchor built on it is off.
  it("gives spans that slice back to their own source text", () => {
    const src = "# Title\n\nFirst para\nsecond line\n\n- a\n- b\n";
    const blocks = splitBlocks(src);
    expect(blocks.map((b) => src.slice(b.start, b.end))).toEqual([
      "# Title",
      "First para\nsecond line",
      "- a\n- b",
    ]);
  });

  // This is the regression test for the bug the rewrite exists to avoid.
  // Escaping before recording offsets shifts every span by the growth of
  // "&" -> "&amp;", and nothing on screen looks wrong when it happens.
  it("keeps offsets aligned when the source contains escapable characters", () => {
    const src = 'A & B < C\n\n"quoted" & <tagged>\n\nplain';
    const blocks = splitBlocks(src);
    expect(blocks.map((b) => src.slice(b.start, b.end))).toEqual([
      "A & B < C",
      '"quoted" & <tagged>',
      "plain",
    ]);
    // And the rendered output still escapes, so alignment is not bought by
    // skipping the escape.
    expect(renderMarkdown(src)).toContain("&amp;");
    expect(renderMarkdown(src)).not.toContain("<tagged>");
  });

  it("treats a blank line inside a fence as code, not a block boundary", () => {
    const src = "```js\nline one\n\nline two\n```\n\nafter";
    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.kind).toBe("fence");
    expect(src.slice(blocks[0]!.start, blocks[0]!.end)).toBe("```js\nline one\n\nline two\n```");
    expect(src.slice(blocks[1]!.start, blocks[1]!.end)).toBe("after");
  });

  it("runs an unterminated fence to the end rather than swallowing prose", () => {
    // Half-streamed code is a normal state to render, not a malformed document.
    const src = "intro\n\n```ts\nconst x = 1;";
    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.kind).toBe("fence");
    expect(src.slice(blocks[1]!.start, blocks[1]!.end)).toBe("```ts\nconst x = 1;");
  });

  it("excludes blank separators from every span", () => {
    const src = "one\n\n\n\ntwo";
    const blocks = splitBlocks(src);
    expect(blocks.map((b) => src.slice(b.start, b.end))).toEqual(["one", "two"]);
  });

  // The bug this whole file guards against, in its purest form. Matching a
  // fence on `startsWith("```")` alone closed a ````-block on the ``` inside
  // it, stranding the code as a prose block — and every anchor after that point
  // addressed the wrong text while the page still rendered plausibly.
  it("does not close a four-backtick fence on the three-backtick one inside it", () => {
    const src = "````md\nintro\n```js\nconst a = 1\n```\ntail\n````\n\nafter";
    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.kind).toBe("fence");
    expect(src.slice(blocks[0]!.start, blocks[0]!.end)).toContain("const a = 1");
    expect(src.slice(blocks[1]!.start, blocks[1]!.end)).toBe("after");
  });

  it("recognises a ~~~ fence, so the next ``` does not open one that never closes", () => {
    const src = "~~~js\nconst a = 1\n~~~\n\n```\nplain\n```\n\ntail";
    const blocks = splitBlocks(src);
    expect(blocks.map((b) => b.kind)).toEqual(["fence", "fence", "text"]);
    expect(src.slice(blocks[2]!.start, blocks[2]!.end)).toBe("tail");
  });

  it("does not read an inline code span as a fence opener", () => {
    const src = "```a``` is a span\n\nnext";
    expect(splitBlocks(src).map((b) => b.kind)).toEqual(["text", "text"]);
  });

  // A loose list is ONE list. Splitting it per item would render three <ul>s
  // where the document has one, and report three outline entries the user reads
  // as a single thing.
  it("keeps a loose list whole across its blank lines", () => {
    const src = "- one\n\n- two\n\n- three\n\nAfter the list.";
    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(src.slice(blocks[0]!.start, blocks[0]!.end)).toBe("- one\n\n- two\n\n- three");
    expect(src.slice(blocks[1]!.start, blocks[1]!.end)).toBe("After the list.");
  });

  it("keeps a quote whole across a blank line that is still quoted", () => {
    const src = "> one\n>\n> two\n\nplain";
    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(src.slice(blocks[0]!.start, blocks[0]!.end)).toBe("> one\n>\n> two");
  });

  it("gives indented code its own kind so it is not rendered as prose", () => {
    const src = "Example:\n\n    const x = 1\n    const y = 2\n\nafter";
    const blocks = splitBlocks(src);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "code", "text"]);
    expect(src.slice(blocks[1]!.start, blocks[1]!.end)).toBe("    const x = 1\n    const y = 2");
  });
});

describe("renderMarkdownWithAnchors", () => {
  it("anchors every block, index-aligned with the returned spans", () => {
    const src = "# Title\n\nsome prose\n\n```\ncode\n```";
    const { html, blocks } = renderMarkdownWithAnchors(src);
    expect(blocks).toHaveLength(3);
    for (let i = 0; i < blocks.length; i += 1) {
      expect(html, `block ${i} must be addressable`).toContain(`data-sc-block="${i}"`);
    }
    expect(html).toContain('<h2 data-sc-block="0">Title</h2>');
    expect(html).toContain('<pre data-sc-block="2">');
  });

  // The transcript renderer must stay clean: assistant prose has nothing to
  // address, and stray attributes in every bubble are noise.
  it("leaves renderMarkdown free of anchors", () => {
    const src = "# Title\n\nsome prose";
    expect(renderMarkdown(src)).not.toContain("data-sc-block");
    expect(renderMarkdownWithAnchors(src).html).toContain("data-sc-block");
  });

  it("renders the same markup as renderMarkdown once anchors are stripped", () => {
    const src = "# H\n\ntext with **bold**\n\n- a\n- b\n\n```js\nx\n```";
    const stripped = renderMarkdownWithAnchors(src).html.replace(/ data-sc-block="\d+"/g, "");
    expect(stripped).toBe(renderMarkdown(src));
  });
});
