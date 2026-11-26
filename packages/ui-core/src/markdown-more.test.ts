import { describe, expect, it } from "vitest";
import { highlightCode } from "./highlight.js";
import { newMarkdownStream, renderMarkdown, renderMarkdownBlocks, renderMarkdownStream } from "./markdown.js";
import { tableToMarkdown, tableToTsv } from "./table.js";

// What a model writes most often and the renderer used to print as source: nested and
// underscore emphasis, task lists, bare URLs, images, character references, maths, and code
// that names its language.
describe("emphasis", () => {
  it("nests emphasis inside strong", () => {
    expect(renderMarkdown("**bold *and italic* inside**")).toBe("<p><strong>bold <em>and italic</em> inside</strong></p>");
    expect(renderMarkdown("***both***")).toBe("<p><strong><em>both</em></strong></p>");
  });

  it("reads _x_ and __x__ but not the underscores inside a word", () => {
    expect(renderMarkdown("_under_ and __dunder__")).toBe("<p><em>under</em> and <strong>dunder</strong></p>");
    expect(renderMarkdown("call snake_case_name and my_var_ok")).toBe("<p>call snake_case_name and my_var_ok</p>");
  });

  it("does not take spaced asterisks for emphasis", () => {
    expect(renderMarkdown("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>");
  });
});

describe("task lists", () => {
  it("draws a checkbox that is shown and cannot be changed, named by its text", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done");
    expect(html).toContain('<li class="sc-md-task"><label><input type="checkbox" disabled> todo</label></li>');
    expect(html).toContain('<li class="sc-md-task"><label><input type="checkbox" disabled checked> done</label></li>');
  });

  it("names the box of a loose item by its mark, since a paragraph cannot sit in a label", () => {
    expect(renderMarkdown("- [x] one\n\n  - sub\n- [ ] two")).toContain('<input type="checkbox" disabled checked aria-label="[x]">');
  });
});

describe("links the writer did not bracket", () => {
  it("links a bare URL, leaving the sentence's punctuation outside it", () => {
    expect(renderMarkdown("see https://example.com/a_b_c.")).toBe(
      '<p>see <a href="https://example.com/a_b_c" target="_blank" rel="noopener noreferrer">https://example.com/a_b_c</a>.</p>',
    );
  });

  it("does not take the closing bracket of a parenthetical, or keep the angle brackets of <url>", () => {
    const html = renderMarkdown("(https://e.com/z) and <https://x.dev/p?a=1&b=2>");
    expect(html).toContain('(<a href="https://e.com/z"');
    expect(html).toContain('</a>) and <a href="https://x.dev/p?a=1&amp;b=2"');
    expect(html).not.toContain("&lt;");
  });

  it("does not link what is inside a code span", () => {
    expect(renderMarkdown("`https://e.com`")).toBe("<p><code>https://e.com</code></p>");
  });
});

describe("images", () => {
  it("is a link, not a fetch, and leaves no stray !", () => {
    const html = renderMarkdown("![a diagram](https://e.com/i.png)");
    expect(html).toBe('<p><a class="sc-md-image" href="https://e.com/i.png" target="_blank" rel="noopener noreferrer">a diagram</a></p>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("!");
  });

  it("draws the picture only when the host asks, lazily and without a referrer", () => {
    const html = renderMarkdown("![a diagram](https://e.com/i.png)", { images: "embed" });
    expect(html).toBe('<p><img class="sc-md-img" src="https://e.com/i.png" alt="a diagram" loading="lazy" decoding="async" referrerpolicy="no-referrer"></p>');
  });

  it("never nests a link inside a link", () => {
    const html = renderMarkdown("[![a](https://e.com/i.png)](https://e.com)");
    expect(html).toBe('<p><a href="https://e.com" target="_blank" rel="noopener noreferrer">a</a></p>');
  });

  it("leaves a non-http source as the text it is", () => {
    expect(renderMarkdown("![x](javascript:alert(1))")).toBe("<p>![x](javascript:alert(1))</p>");
    expect(renderMarkdown("![x](data:image/png;base64,AAAA)")).not.toMatch(/<(a|img)\b/);
  });
});

describe("character references", () => {
  it("shows what they name, never as markup", () => {
    expect(renderMarkdown("R&amp;D &lt;b&gt; &copy; 2026")).toBe("<p>R&amp;D &lt;b&gt; &copy; 2026</p>");
    expect(renderMarkdown("`&amp;`")).toBe("<p><code>&amp;amp;</code></p>");
  });
});

describe("maths", () => {
  const math = (tex: string, display: boolean) => `<m ${display ? "d" : "i"}>${tex}</m>`.replace(/</g, "&lt;");
  const options = { math };

  it("is literal text without a typesetter, so a price is a price", () => {
    expect(renderMarkdown("E = $E=mc^2$ costs $5 and $10")).toBe("<p>E = $E=mc^2$ costs $5 and $10</p>");
  });

  it("hands inline and display maths to the slot, and keeps prices out of it", () => {
    expect(renderMarkdown("E = $E=mc^2$, costs $5 and $10", options)).toBe(
      "<p>E = &lt;m i>E=mc^2&lt;/m>, costs $5 and $10</p>",
    );
    expect(renderMarkdown("$$\\int_0^1 x\\,dx$$", options)).toBe('<div class="sc-math-block">&lt;m d>\\int_0^1 x\\,dx&lt;/m></div>');
    expect(renderMarkdown("$$\nx^2\n$$", options)).toContain("sc-math-block");
  });

  it("does not read emphasis inside a formula", () => {
    expect(renderMarkdown("$a_1 * b_2$", options)).toBe("<p>&lt;m i>a_1 * b_2&lt;/m></p>");
  });

  it("leaves the source as text where the slot declines", () => {
    expect(renderMarkdown("$x$", { math: () => undefined })).toBe("<p>$x$</p>");
  });
});

describe("fenced code", () => {
  it("carries its language and colours what it knows", () => {
    const html = renderMarkdown("```ts\nconst x: number = 1; // hi\n```");
    expect(html).toContain('<pre data-lang="ts"><code class="language-ts">');
    expect(html).toContain('<span class="sc-tok-k">const</span>');
    expect(html).toContain('<span class="sc-tok-c">// hi</span>');
  });

  it("leaves a language it does not know plain, and a fence without one", () => {
    expect(renderMarkdown("```klingon\nqapla\n```")).toBe('<pre data-lang="klingon"><code class="language-klingon">qapla</code></pre>');
    expect(renderMarkdown("```\nplain\n```")).toBe("<pre><code>plain</code></pre>");
  });

  it("uses the host's highlighter, or none", () => {
    const seen: string[][] = [];
    const html = renderMarkdown("```go\nfunc main() {}\n```", {
      highlight: (code, lang) => {
        seen.push([code, lang]);
        return "<b>X</b>";
      },
    });
    expect(seen).toEqual([["func main() {}", "go"]]);
    expect(html).toContain("<code class=\"language-go\"><b>X</b></code>");
    expect(renderMarkdown("```ts\nconst a = 1\n```", { highlight: false })).not.toContain("sc-tok");
  });

  it("draws the copy, wrap and show-all buttons only when asked", () => {
    const plain = renderMarkdown("```js\na\n```");
    const wired = renderMarkdown("```js\na\n```", { actions: true });
    expect(plain).not.toContain("<button");
    expect(wired).toContain('data-sc-act="copy"');
    expect(wired).toContain('data-sc-act="wrap"');
    expect(wired).toContain('data-sc-act="more"');
    expect(wired).toContain('<span class="sc-mdcode__lang">js</span>');
  });

  it("escapes what the highlighter colours", () => {
    expect(highlightCode('<script>alert("x")</script>', "html")).not.toContain("<script>");
    expect(highlightCode("a < b && c", "js")).toBe("a &lt; b &amp;&amp; c");
  });
});

describe("highlightCode", () => {
  it("knows the common languages and says nothing about the rest", () => {
    for (const lang of ["js", "tsx", "json", "py", "bash", "sql", "html", "css", "yaml", "diff"]) {
      expect(highlightCode("x", lang), lang).toBeTypeOf("string");
    }
    expect(highlightCode("x", "cobol")).toBeUndefined();
  });

  it("marks JSON keys apart from values", () => {
    const html = highlightCode('{"a": [1, true, "b"]}', "json")!;
    expect(html).toContain('<span class="sc-tok-p">&quot;a&quot;</span>');
    expect(html).toContain('<span class="sc-tok-n">1</span>');
    expect(html).toContain('<span class="sc-tok-l">true</span>');
  });

  it("marks what a diff added and removed", () => {
    const html = highlightCode("+a\n-b\n c", "diff")!;
    expect(html).toBe('<span class="sc-tok-add">+a</span>\n<span class="sc-tok-del">-b</span>\n c');
  });

  it("finishes in linear time on a hostile string", () => {
    const hostile = `"${"\\".repeat(50_000)}`;
    const start = Date.now();
    for (const lang of ["js", "json", "py", "sh", "sql", "html", "yaml"]) highlightCode(hostile, lang);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});

describe("tables", () => {
  it("sit in a focusable scroll box, with copy buttons when asked", () => {
    const src = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(renderMarkdown(src)).toMatch(/^<div class="sc-md-scroll" tabindex="0"><table class="sc-md-table">/);
    const wired = renderMarkdown(src, { actions: true });
    expect(wired).toContain('data-sc-act="copy-tsv"');
    expect(wired).toContain('data-sc-act="copy-md"');
  });

  it("export as TSV and Markdown", () => {
    expect(tableToTsv(["a", "b"], [["1", "x\ty"], ["3", "4"]])).toBe("a\tb\n1\tx y\n3\t4");
    expect(tableToMarkdown(["a", "b"], [["1", "x|y"]], ["left", "right"])).toBe("| a | b |\n| :--- | ---: |\n| 1 | x\\|y |");
  });
});

describe("renderMarkdownBlocks", () => {
  const src = "First paragraph.\n\nSecond paragraph.\n\n- one\n- two\n\nThird, still being wri";

  it("returns the blocks whose joined HTML is exactly renderMarkdown", () => {
    const parts = renderMarkdownBlocks(src, newMarkdownStream());
    expect(parts.length).toBe(4);
    expect(parts.join("")).toBe(renderMarkdown(src));
    expect(renderMarkdownStream(src, newMarkdownStream())).toBe(renderMarkdown(src));
  });

  it("hands back the same strings for a block that is settled, while the tail grows", () => {
    const stream = newMarkdownStream();
    const first = renderMarkdownBlocks(src, stream);
    const second = renderMarkdownBlocks(`${src}tten now.\n\nFourth`, stream);
    expect(second.slice(0, 3)).toEqual(first.slice(0, 3));
    expect(second[3]).not.toBe(first[3]);
    expect(stream.parts.length).toBeGreaterThanOrEqual(2);
  });

  it("starts over when the options change", () => {
    const stream = newMarkdownStream();
    const options = { highlight: false as const };
    const a = renderMarkdownBlocks("```ts\nconst a = 1\n```\n\nafter\n\nend", stream);
    const b = renderMarkdownBlocks("```ts\nconst a = 1\n```\n\nafter\n\nend", stream, options);
    expect(a.join("")).toContain("sc-tok");
    expect(b.join("")).not.toContain("sc-tok");
  });
});

// A citation marker is a link whose text has brackets in it: `[[1]](ref:…)`.
describe("citation markers", () => {
  it("reads [[1]](ref:…) as a reference whose text is [1]", () => {
    const html = renderMarkdown("Not entirely [[1]](ref:authority?cite=photo), and [[2]](ref:authority?cite=2).");
    expect(html).toContain('data-ref="ref:authority?cite=photo"');
    expect(html).toContain(">[1]</span>");
    expect(html).toContain('data-ref="ref:authority?cite=2"');
    expect(html).not.toContain("](ref:");
  });

  it("still ends a link at the first unbalanced bracket", () => {
    expect(renderMarkdown("[a [b](https://example.com/x)")).toContain('[a <a href="https://example.com/x"');
    expect(renderMarkdown("[[1]](https://example.com/x)")).toContain(">[1]</a>");
  });
});
