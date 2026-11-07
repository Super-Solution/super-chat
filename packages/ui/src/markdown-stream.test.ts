import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { newMarkdownStream, renderMarkdown, renderMarkdownStream, type MarkdownStream } from "./markdown.js";

// Counts the characters the renderer splits into blocks, the insides of lists
// and quotes included: whatever it renders in a frame went through splitBlocks
// in that frame, so this measures the work, not the cache's bookkeeping.
const split = vi.hoisted(() => ({ chars: 0 }));
vi.mock("@super-solution/super-chat-core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@super-solution/super-chat-core")>();
  return {
    ...core,
    splitBlocks: (src: string) => {
      split.chars += src.length;
      return core.splitBlocks(src);
    },
  };
});

// renderMarkdownStream must return exactly renderMarkdown(src) for every text
// it is handed, whatever it saw before. These tests stream texts one character
// at a time — every prefix — and compare each frame with a from-scratch render.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stream `src` at the given frame boundaries through one stream, checking every frame. */
function expectStreamsLikeScratch(src: string, stream: MarkdownStream = newMarkdownStream(), step: () => number = () => 1) {
  for (let end = 0; end <= src.length; end += step()) {
    const prefix = src.slice(0, end);
    const got = renderMarkdownStream(prefix, stream);
    if (got !== renderMarkdown(prefix)) expect({ prefix, got }).toEqual({ prefix, got: renderMarkdown(prefix) });
  }
  expect(renderMarkdownStream(src, stream)).toBe(renderMarkdown(src));
}

// Every construct where text further down changes how text above renders, or
// where a line means something different once it is complete.
const ADVERSARIAL = [
  // Setext underlines and their look-alikes.
  "Title\n===\n\nnext para",
  "Title\n---\n\npara",
  "a\nb\n===\nc",
  "para\n\n---\n\nafter a rule",
  "Heading\n=\n\n=\n",
  "- item\n---\n",
  // Lists: continuation across blank lines, ordered markers completed late,
  // nesting, looseness.
  "- a\n- b\n\n- c\n\npara",
  "- a\n\n1\n\n2. x\n\n3",
  "1. a\n2. b\n\n   continued\n\n3) c\n\nend",
  "- a\n  - nested\n\n    indented under item\n\nend",
  "* a\n\n\n* b\n\nx",
  "10. x\n11. y\n\n12\n",
  "+ a\n\n    code in item\n\n+ b",
  // Quotes.
  "> q\n\n> q2\n\nafter",
  "> a\n>\n> b\n\nc",
  "> - list in quote\n> - b\n\n> > deeper\n\nx",
  // Tables.
  "| a | b |\n| --- | ---: |\n| 1 | 2 |\n\nafter",
  "a | b\n--|--\n1|2\n\nx",
  "| h |\n|:-:|\n| c \\| d |\n",
  "| not | a table |\ntext\n\n| x |\n| - |",
  // Fences: unterminated, nested, tilde, info strings, closers completed late.
  "```js\ncode\n```\n\nafter",
  "```\nunclosed\n\nmore",
  "````\n```\ninner\n```\n````\nx",
  "~~~\na\n~~~\n\n~~~~\nb\n~~~\n",
  "``` `a` ```\npara\n\nx",
  "para\n```a`\nmore\n\ny",
  "```\nx\n```js\n```\n\ny",
  "para\n```\nfenced\n```\npara again",
  // Indented code.
  "    code\n\n    more\n\npara",
  "para\n\n    code\n\n\n    code2\nend",
  "\tcode\n\n\tmore\n",
  // Rules, ATX headings, inline, escaping.
  "***\n\n___\n\n- - -\n\n* * *",
  "# h1\n## h2 ##\npara\n#no\n",
  "**bold** `code` [l](https://x.y) ~~del~~ *em*\n\n`unclosed code\n\nspan`",
  "<div>\n\n</div>\n\n&amp; \"q\" [x](javascript:alert(1))",
  "a\u0000b\n\n\u0000\n",
  // Line-ending and whitespace oddities.
  "a\r\n\r\n- b\r\n- c\r\n\r\ntext\r\n",
  "a\n   \nb\n\t\n\n  \n",
  "\n\n\n",
  "1\n\n1.\n\n1)\n\n1.x",
];

describe("renderMarkdownStream (LiveTurn)", () => {
  it("renders every prefix of each adversarial snippet exactly like renderMarkdown", () => {
    for (const src of ADVERSARIAL) expectStreamsLikeScratch(src);
  });

  it("renders every prefix of snippets glued together in seeded random orders", () => {
    // Juxtaposition is where a closed-looking block gets reopened: a list
    // followed by `1`, a paragraph followed by a fence opener, and so on.
    const r = rng(11);
    const glue = ["\n", "\n\n", "\n\n\n", " ", "\n  \n", "\n> ", "\n- ", "\n1", "\n```", "\n    "];
    for (let doc = 0; doc < 60; doc += 1) {
      let src = "";
      const pieces = 2 + Math.floor(r() * 6);
      for (let p = 0; p < pieces; p += 1) {
        src += ADVERSARIAL[Math.floor(r() * ADVERSARIAL.length)]!;
        src += glue[Math.floor(r() * glue.length)]!;
      }
      expectStreamsLikeScratch(src);
    }
  });

  it("renders every prefix of realistic answers exactly like renderMarkdown", () => {
    for (let seed = 1; seed <= 4; seed += 1) expectStreamsLikeScratch(answer(rng(seed), 3000));
  });

  it("renders long answers streamed in token-sized chunks exactly like renderMarkdown", () => {
    const r = rng(99);
    for (let seed = 10; seed < 13; seed += 1) {
      expectStreamsLikeScratch(answer(rng(seed), 16_000), newMarkdownStream(), () => 1 + Math.floor(r() * 80));
    }
  });

  it("drops its cache when the text is not an extension of what it saw", () => {
    const r = rng(5);
    const stream = newMarkdownStream();
    let src = "";
    for (let op = 0; op < 3000; op += 1) {
      const k = r();
      if (k < 0.7) src += ADVERSARIAL[Math.floor(r() * ADVERSARIAL.length)]!.slice(0, 1 + Math.floor(r() * 12));
      else if (k < 0.8) src = src.slice(0, Math.floor(r() * (src.length + 1))); // truncated
      else if (k < 0.9 && src.length) {
        const at = Math.floor(r() * src.length); // edited in place, maybe far back
        src = src.slice(0, at) + "\n#-1`>|".charAt(Math.floor(r() * 7)) + src.slice(at + 1);
      } else if (k < 0.95) src = ADVERSARIAL[Math.floor(r() * ADVERSARIAL.length)]!; // a new run
      if (src.length > 4000) src = src.slice(-2000);
      expect(renderMarkdownStream(src, stream)).toBe(renderMarkdown(src));
    }
  });

  it("re-renders only the open tail each frame, not the whole answer", () => {
    const src = answer(rng(3), 40_000);
    const stream = newMarkdownStream();
    let whole = 0;
    split.chars = 0;
    for (let end = 100; end <= src.length; end += 100) {
      whole += end;
      renderMarkdownStream(src.slice(0, end), stream);
    }
    // Without the cache every frame splits and renders everything (whole ≈ 8M
    // chars over 400 frames, 9M with list and quote insides); with it, only
    // the last block or two (~134k).
    expect(whole).toBeGreaterThan(7_000_000);
    expect(split.chars).toBeGreaterThanOrEqual(src.length); // it did see the whole answer
    expect(split.chars).toBeLessThan(whole / 20);
    expect(src.length - stream.resume).toBeLessThan(2_000);
  });

  it("is what LiveTurn renders its streamed text with", () => {
    // There is no DOM renderer in this package's tests, so this reads the
    // component's source, the way rwd.test.ts reads the stylesheet: going back
    // to renderMarkdown(throttledText) would pass every other test here.
    const thread = readFileSync(fileURLToPath(new URL("./Thread.tsx", import.meta.url)), "utf8");
    const start = thread.indexOf("export function LiveTurn(");
    expect(start).toBeGreaterThan(-1);
    const liveTurn = thread.slice(start, thread.indexOf("\n}\n", start));
    expect(liveTurn).toMatch(/renderMarkdownStream\(throttledText, /);
    expect(liveTurn).not.toMatch(/renderMarkdown\(/);
  });
});

/** A markdown answer shaped like the product's: sections, prose, lists, tables, code, quotes. */
function answer(r: () => number, targetChars: number): string {
  const words = "the price moved higher after funding turned negative while open interest dropped **bold** `code` *em* [link](https://example.com/x) 價格 支撐 BTC".split(" ");
  const sentence = (n: number) => Array.from({ length: n }, () => words[Math.floor(r() * words.length)]!).join(" ");
  const parts: string[] = [];
  let size = 0;
  while (size < targetChars) {
    const k = r();
    let block: string;
    if (k < 0.08) block = `## ${sentence(4)}`;
    else if (k < 0.12) block = `${sentence(3)}\n${r() < 0.5 ? "===" : "---"}`;
    else if (k < 0.45) block = Array.from({ length: 1 + Math.floor(r() * 3) }, () => sentence(8 + Math.floor(r() * 20))).join("\n");
    else if (k < 0.58) {
      const ordered = r() < 0.4;
      const loose = r() < 0.3;
      block = Array.from({ length: 2 + Math.floor(r() * 5) }, (_, i) => {
        const item = `${ordered ? `${i + 1}.` : "-"} ${sentence(5)}`;
        return r() < 0.2 ? `${item}\n  - ${sentence(3)}` : item;
      }).join(loose ? "\n\n" : "\n");
    } else if (k < 0.7) {
      const rows = Array.from({ length: 2 + Math.floor(r() * 6) }, () => `| BTC | ${(r() * 1e5).toFixed(2)} | ${(r() * 20 - 10).toFixed(2)}% |`);
      block = ["| Symbol | Price | Change |", "| --- | ---: | ---: |", ...rows].join("\n");
    } else if (k < 0.82) {
      const fence = r() < 0.8 ? "```" : "~~~";
      const body = Array.from({ length: 2 + Math.floor(r() * 10) }, (_, i) => `const v${i} = compute("${sentence(2)}");`);
      block = [`${fence}ts`, ...body, fence].join("\n");
    } else if (k < 0.9) block = `> ${sentence(10)}\n> ${sentence(6)}`;
    else if (k < 0.95) block = `    indented ${sentence(4)}\n    more`;
    else block = r() < 0.5 ? "---" : `# ${sentence(3)}`;
    parts.push(block);
    size += block.length + 2;
  }
  return parts.join(r() < 0.1 ? "\n\n\n" : "\n\n");
}
