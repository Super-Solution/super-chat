// A small syntax highlighter for the code a chat answer is most likely to contain.
//
// This is the default for fenced code, and it is deliberately modest: one lexer per language
// family, no grammar, no scopes, a couple of kilobytes. A host that wants more (every language,
// theme-grade accuracy) passes its own `highlight` to the Markdown renderer — highlight.js,
// Shiki, anything that turns code into HTML — and this is not used at all. Bundling a real
// highlighter would cost more than the whole Markdown renderer (highlight.js with seven
// languages is about three times its size), which is why the choice is the host's.
//
// Input is code; output is HTML for the inside of `<code>`. Every character of the code is
// escaped, and a token is a `<span class="sc-tok-X">` around escaped text, so nothing the model
// wrote can become markup. Each lexer is a single alternation tried left to right, with no
// nested quantifiers, so a hostile string costs a linear scan.

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One alternation, and the token class each of its groups stands for (undefined = plain). */
type Lexer = { re: RegExp; classes: (string | undefined)[] };

const words = (list: string) => `\\b(?:${list.trim().split(/\s+/).join("|")})\\b`;

const STRING = `"(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?`;
const NUMBER = `\\b(?:0x[\\da-fA-F]+|\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\b`;

const lexer = (groups: [cls: string | undefined, source: string][], flags = "g"): Lexer => ({
  re: new RegExp(groups.map(([, source]) => `(${source})`).join("|"), flags),
  classes: groups.map(([cls]) => cls),
});

const JS_WORDS = /* @__PURE__ */ words(`
  as async await break case catch class const continue debugger default delete do else enum export
  extends finally for from function if implements import in instanceof interface let new of package
  private protected public readonly return static super switch this throw try type typeof var void
  while with yield satisfies declare namespace abstract keyof
`);
const LITERALS = /* @__PURE__ */ words("true false null undefined NaN Infinity None True False nil");

const SOURCES: Record<string, () => Lexer> = {
  js: () => lexer([
    ["c", "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)"],
    ["s", `${STRING}|\`(?:[^\`\\\\]|\\\\[\\s\\S])*\`?`],
    ["k", JS_WORDS],
    ["l", LITERALS],
    ["n", NUMBER],
    ["f", "\\b[A-Za-z_$][\\w$]*(?=\\s*\\()"],
  ]),
  py: () => lexer([
    ["c", "#[^\\n]*"],
    ["s", `(?:[rbfRBF]{0,2})(?:"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$))|(?:[rbfRBF]{0,2})(?:${STRING})`],
    [
      "k",
      words(`
        and as assert async await break class continue def del elif else except finally for from global
        if import in is lambda nonlocal not or pass raise return try while with yield match case
      `),
    ],
    ["l", LITERALS],
    ["n", NUMBER],
    ["f", "\\b[A-Za-z_]\\w*(?=\\s*\\()"],
  ]),
  json: () => lexer([
    ["p", `"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:)`],
    ["s", `"(?:[^"\\\\\\n]|\\\\.)*"?`],
    ["l", words("true false null")],
    ["n", "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?"],
  ]),
  sh: () => lexer([
    ["c", "(?:^|(?<=\\s))#[^\\n]*"],
    ["s", STRING],
    ["v", "\\$(?:\\{[^}\\n]*\\}|[A-Za-z_]\\w*|[0-9?!#@*$])"],
    ["f", "(?:^|(?<=[;|&(]))[ \\t]*(?:sudo\\s+)?[A-Za-z_.\\/-][\\w./-]*"],
    ["a", "(?<=\\s)--?[A-Za-z][\\w-]*"],
    ["k", words("if then else elif fi for while do done case esac function in export return exit")],
    ["n", NUMBER],
  ], "gm"),
  sql: () => lexer(
    [
      ["c", "--[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)"],
      ["s", "'(?:[^']|'')*'?"],
      [
        "k",
        words(`
          select from where and or not null is in as on join left right inner outer full cross group by
          order having limit offset insert into values update set delete create alter drop table index
          view distinct union all case when then else end exists between like ilike asc desc primary key
          foreign references default returning with
        `),
      ],
      ["n", NUMBER],
      ["f", "\\b[A-Za-z_]\\w*(?=\\s*\\()"],
    ],
    "gi",
  ),
  markup: () => lexer([
    ["c", "<!--[\\s\\S]*?(?:-->|$)|\\/\\*[\\s\\S]*?(?:\\*\\/|$)"],
    ["s", STRING],
    ["k", "<\\/?[A-Za-z][\\w:-]*|\\/?>|@[A-Za-z-]+"],
    ["a", "\\b[A-Za-z-]+(?==)"],
    ["p", "(?<=[{;\\s])[a-z-]+(?=\\s*:)"],
    ["n", "#[\\da-fA-F]{3,8}\\b|\\b\\d+(?:\\.\\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\\b"],
  ]),
  yaml: () => lexer([
    ["c", "(?:^|(?<=\\s))#[^\\n]*"],
    ["p", "^[ \\t-]*[\\w.\"'/-]+(?=\\s*:(?:\\s|$))"],
    ["s", STRING],
    ["l", words("true false null yes no on off")],
    ["n", NUMBER],
  ], "gm"),
};

const ALIASES: Record<string, string> = {
  js: "js", jsx: "js", mjs: "js", cjs: "js", javascript: "js", ts: "js", tsx: "js", typescript: "js",
  py: "py", python: "py",
  json: "json", jsonc: "json", json5: "json",
  sh: "sh", bash: "sh", zsh: "sh", shell: "sh", console: "sh", shellsession: "sh",
  sql: "sql", psql: "sql", postgres: "sql", mysql: "sql", sqlite: "sql",
  html: "markup", xml: "markup", svg: "markup", css: "markup", scss: "markup", vue: "markup",
  yaml: "yaml", yml: "yaml", toml: "yaml",
};

const built = new Map<string, Lexer | null>();
/** Built on first use: a lexer with a lookbehind must not be able to stop the module loading. */
function lexerFor(key: string): Lexer | null {
  if (!built.has(key)) {
    try {
      built.set(key, SOURCES[key]!());
    } catch {
      built.set(key, null);
    }
  }
  return built.get(key)!;
}

function run({ re, classes }: Lexer, code: string): string {
  let out = "";
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m[0] === "") {
      re.lastIndex += 1;
      continue;
    }
    let group = 1;
    while (group < m.length && m[group] === undefined) group += 1;
    const cls = classes[group - 1];
    out += escape(code.slice(last, m.index));
    out += cls ? `<span class="sc-tok-${cls}">${escape(m[0])}</span>` : escape(m[0]);
    last = m.index + m[0].length;
  }
  return out + escape(code.slice(last));
}

/** A diff is read line by line: what was added, what was taken out, where the hunk is. */
function diff(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const cls = /^(?:\+\+\+|---)/.test(line) ? "k" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "k" : "";
      return cls ? `<span class="sc-tok-${cls}">${escape(line)}</span>` : escape(line);
    })
    .join("\n");
}

/** The languages the built-in highlighter knows, by every name it answers to. */
export const HIGHLIGHT_LANGUAGES: readonly string[] = /* @__PURE__ */ (() => [...Object.keys(ALIASES), "diff", "patch"])();

/**
 * Highlight `code` written in `lang`, as HTML for the inside of `<code>`.
 * Returns `undefined` for a language it does not know, which leaves the code as plain text.
 */
export function highlightCode(code: string, lang: string): string | undefined {
  const name = lang.toLowerCase();
  if (name === "diff" || name === "patch") return diff(code);
  const key = ALIASES[name];
  const lex = key ? lexerFor(key) : null;
  return lex ? run(lex, code) : undefined;
}
