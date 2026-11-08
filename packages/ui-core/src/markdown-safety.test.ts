import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownWithAnchors } from "./markdown.js";

// The HTML this renderer produces is assigned with dangerouslySetInnerHTML from model
// output, so "what can the output contain" is a security property, not a style one.

describe("links", () => {
  it("keeps a destination with balanced parentheses whole", () => {
    expect(renderMarkdown("[a](https://en.wikipedia.org/wiki/Foo_(bar))")).toBe(
      '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)" target="_blank" rel="noopener noreferrer">a</a></p>',
    );
  });

  it("does not swallow text after the closing parenthesis", () => {
    expect(renderMarkdown("see [a](https://e.com/x) (and more)")).toBe(
      '<p>see <a href="https://e.com/x" target="_blank" rel="noopener noreferrer">a</a> (and more)</p>',
    );
  });

  it.each([
    ["an asterisk pair", "https://e.com/a*b*c"],
    ["a double asterisk", "https://e.com/**bold**"],
    ["a strike-through marker", "https://e.com/~~a~~"],
    ["a backtick pair", "https://e.com/a`b`c"],
  ])("does not rewrite a destination containing %s", (_name, url) => {
    const html = renderMarkdown(`[x](${url})`);
    // The destination reaches href exactly as written, with no markup inside it.
    expect(html).toBe(`<p><a href="${url}" target="_blank" rel="noopener noreferrer">x</a></p>`);
  });

  it("still styles the link's text", () => {
    expect(renderMarkdown("[**bold** and `code`](https://e.com)")).toBe(
      '<p><a href="https://e.com" target="_blank" rel="noopener noreferrer"><strong>bold</strong> and <code>code</code></a></p>',
    );
  });

  it("does not turn a link written inside a code span into a link", () => {
    expect(renderMarkdown("`[a](https://e.com)`")).toBe("<p><code>[a](https://e.com)</code></p>");
  });

  it("lets emphasis wrap a link", () => {
    expect(renderMarkdown("**[a](https://e.com)**")).toBe(
      '<p><strong><a href="https://e.com" target="_blank" rel="noopener noreferrer">a</a></strong></p>',
    );
  });
});

describe("hostile input", () => {
  it.each([
    ["a javascript: link", "[click](javascript:alert(1))"],
    ["an upper-case JAVASCRIPT: link", "[click](JAVASCRIPT:alert(1))"],
    ["a data: link", "[click](data:text/html;base64,PHNjcmlwdD4=)"],
    ["a vbscript: link", "[click](vbscript:msgbox(1))"],
    ["a protocol-relative link", "[click](//evil.example/x)"],
  ])("never emits %s", (_name, src) => {
    expect(renderMarkdown(src)).not.toContain("<a ");
  });

  it("cannot close the href attribute with a quote", () => {
    const html = renderMarkdown('[click](https://e.com" onmouseover="alert(1))');
    expect(html).not.toContain("<a ");
    // `onmouseover=` survives only as inert text: every quote is escaped, so there is no attribute.
    expect(html).not.toContain('"');
    expect(html).toBe("<p>[click](https://e.com&quot; onmouseover=&quot;alert(1))</p>");
  });

  it("escapes markup in link text and in plain text", () => {
    expect(renderMarkdown("[<img src=x onerror=alert(1)>](https://e.com)")).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("cannot forge a placeholder with a NUL character", () => {
    const html = renderMarkdown("`secret` \0L0\0 \x000\0");
    expect(html).not.toContain("\0");
    expect(html).toBe("<p><code>secret</code> L0 0</p>");
  });

  it("drops a NUL everywhere it could appear, not only in inline text", () => {
    for (const src of ["plain\0text", "    indented\0code", "```\nfenced\0code\n```", "| a\0 | b |\n|---|---|\n| 1 | 2 |"]) {
      expect(renderMarkdown(src), JSON.stringify(src)).not.toContain("\0");
    }
  });
});

// ── fuzz ─────────────────────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set(["p", "br", "strong", "em", "del", "code", "pre", "a", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td"]);
const ALLOWED_ATTRS = new Set(["href", "target", "rel", "class", "start", "data-sc-block"]);

/** Checks every invariant the output must hold; returns the first violation, or null. */
function violation(html: string): string | null {
  let i = 0;
  while (i < html.length) {
    const c = html[i]!;
    if (c === ">" || c === '"' || c === "\0") return `raw ${JSON.stringify(c)} in text at ${i}`;
    if (c !== "<") { i++; continue; }

    const close = html[i + 1] === "/";
    const nameStart = i + (close ? 2 : 1);
    const m = /^[a-z][a-z0-9]*/.exec(html.slice(nameStart));
    if (!m) return `a "<" that does not start a tag at ${i}`;
    const name = m[0];
    if (!ALLOWED_TAGS.has(name)) return `tag <${name}> is not allowed`;
    let j = nameStart + name.length;

    // attributes: name="value" only, double-quoted, no markup in the value
    for (;;) {
      while (html[j] === " ") j++;
      if (html[j] === ">" || (html[j] === "/" && html[j + 1] === ">")) { j += html[j] === ">" ? 1 : 2; break; }
      const a = /^[a-z][a-z-]*/.exec(html.slice(j));
      if (!a) return `malformed tag <${name} at ${j}: ${JSON.stringify(html.slice(j, j + 30))}`;
      if (close) return `attributes on a closing tag </${name}>`;
      if (!ALLOWED_ATTRS.has(a[0])) return `attribute ${a[0]} is not allowed`;
      j += a[0].length;
      if (html[j] !== "=" || html[j + 1] !== '"') return `attribute ${a[0]} has no double-quoted value`;
      const end = html.indexOf('"', j + 2);
      if (end === -1) return `unterminated value for ${a[0]}`;
      const value = html.slice(j + 2, end);
      if (/[<>]/.test(value)) return `markup inside ${a[0]}="${value}"`;
      if (a[0] === "href" && !/^https?:\/\//.test(value)) return `href is not http(s): ${value}`;
      j = end + 1;
    }
    i = j;
  }
  return null;
}

// A small deterministic generator, so a failure reproduces from its seed.
function* inputs(count: number): Generator<string> {
  let seed = 0x2f6e2b1;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const tokens = [
    // Whole links, ordinary and hostile, so that link handling is reached often.
    "[a](https://e.com/x)", "[**b**](http://x.test/p(q))", "[c](https://e.com/*x*)", "[d](https://e.com/~~y~~)",
    '[e](https://e.com/"x)', "[<b>f</b>](https://e.com)", "[g](https://e.com/`h`)", "[i](javascript:alert(1))",
    "[`j`](https://e.com/k_l_m)", "**[n](https://e.com)**", "[o](https://e.com/a)(b)",
    // Whole blocks, so tables, lists, quotes and headings are reached too.
    "\n\n| a | b |\n|---|:-:|\n| 1 | [x](https://e.com) |\n| <i> | `c` |\n\n", "\n\n- item\n  - nested *e*\n- two\n\n",
    "\n\n> quote\n> > deeper\n\n", "\n\n1. one\n2. [two](http://x.test/)\n\n", "\n\n## Title <b>\n\n", "\n\nSetext\n=====\n\n",
    "[", "]", "(", ")", "![", "](https://e.com/", "](http://x.test/", "](javascript:", "](data:", "https://e.com/", "https://e.com/a(b)",
    "`", "``", "```", "~~~", "*", "**", "***", "~~", "_", '"', "'", "<", ">", "&", "&amp;", "<script>", "</p>", "<img src=x onerror=1>",
    "\n", "\n\n", "# ", "## ", "- ", "1. ", "> ", "| a | b |", "|---|---|", "---", "===", "\\", "\0", "\t", "    ", " ",
    "a", "b", "x y", "é", "日本", "javascript:alert(1)", "onmouseover=", "\u2028",
  ];
  for (let n = 0; n < count; n++) {
    let s = "";
    for (let k = 1 + Math.floor(next() * 40); k > 0; k--) s += tokens[Math.floor(next() * tokens.length)];
    yield s;
  }
}

describe("fuzz: whatever the input, the HTML stays inside the allowlist", () => {
  it("holds for 6000 generated documents", () => {
    let checked = 0;
    const reached = { link: 0, table: 0, code: 0, list: 0, quote: 0, heading: 0 };
    for (const src of inputs(6000)) {
      for (const [label, html] of [["renderMarkdown", renderMarkdown(src)], ["anchored", renderMarkdownWithAnchors(src).html]] as const) {
        const problem = violation(html);
        if (problem) throw new Error(`${label} broke an invariant: ${problem}\n  source: ${JSON.stringify(src)}\n  html:   ${JSON.stringify(html)}`);
      }
      const html = renderMarkdown(src);
      if (html.includes("<a ")) reached.link++;
      if (html.includes("<table")) reached.table++;
      if (html.includes("<code>")) reached.code++;
      if (html.includes("<li>")) reached.list++;
      if (html.includes("<blockquote>")) reached.quote++;
      if (/<h[2-6]>/.test(html)) reached.heading++;
      checked++;
    }
    expect(checked).toBe(6000);
    // A fuzz test that never reaches a construct proves nothing about it.
    for (const [construct, count] of Object.entries(reached)) expect(count, `${construct} outputs`).toBeGreaterThan(60);
  });

  it("the checker itself rejects what it should", () => {
    // Guards the guard: a checker that accepts everything would make the fuzz test meaningless.
    expect(violation("<p>ok</p>")).toBeNull();
    expect(violation('<a href="https://e.com" target="_blank" rel="noopener noreferrer">x</a>')).toBeNull();
    expect(violation("<script>x</script>")).toMatch(/not allowed/);
    expect(violation('<a href="javascript:alert(1)">x</a>')).toMatch(/not http/);
    expect(violation('<a href="https://e.com/a<em>b</em>c">x</a>')).toMatch(/markup inside/);
    expect(violation('<p onclick="x">a</p>')).toMatch(/attribute onclick/);
    expect(violation("<p>a > b</p>")).toMatch(/raw ">"/);
    expect(violation('<p>say "hi"</p>')).toMatch(/raw "\\""/);
    expect(violation("<p>a < b</p>")).toMatch(/does not start a tag/);
  });
});
