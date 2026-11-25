# Make the transcript yours

What the UI package lets a host decide, without wrapping it. Each section is one decision and the
smallest code that makes it. Everything here is exported from `@supersolutions/super-chat-ui`, and
the pieces that matter to size also from a subpath (see the last section).

## Say it in your language

Every word the kit writes (buttons, status lines, card chrome, errors) comes from one table, `Labels`.
English is the default; `zhTW` is a preset; a host overrides any subset, and providers nest.

```tsx
import { LabelsProvider, zhTW } from "@supersolutions/super-chat-ui";

<LabelsProvider labels={zhTW}>
  <LabelsProvider labels={{ send: "Ask" }}>{/* a panel that says "Ask" in zh-TW otherwise */}
    <Thread />
  </LabelsProvider>
</LabelsProvider>
```

Parametrised strings are functions (`thoughtFor(seconds)` receives only the number, and the label owns the
unit), so a language with a different word order or plural rule needs no string surgery. The zh-TW preset is
a first translation: improve it by overriding, or send a fix.

## Markdown: what it does and the three slots

The renderer handles what models write: headings, lists (including task lists), tables with alignment,
fenced code, block quotes, links, images, inline code, strikethrough. Three
choices are the host's, through `MarkdownProvider`:

```tsx
import { MarkdownProvider } from "@supersolutions/super-chat-ui";

<MarkdownProvider
  highlight={(code, lang) => myHighlighter(code, lang)} // HTML for the inside of <code>, or undefined
  math={(tex, display) => katex.renderToString(tex, { displayMode: display })}
  images="embed"
>
  <Thread />
</MarkdownProvider>
```

- **`highlight`.** Default is a small built-in tokenizer (JS/TS, Python, JSON, shell, SQL, HTML/CSS, YAML, diff)
  of about two kilobytes. Pass highlight.js, Shiki or anything that turns code into HTML to replace it, or
  `false` for plain code. Super Chat bundles none of them.
- **`math`.** Off by default, so `$5 and $6` is never mistaken for maths. Pass a typesetter and `$…$` and
  `$$…$$` are handed to it. Its output is inserted as HTML, so give it one that escapes.
- **`images`.** `"link"` (default) shows an image as a link and fetches nothing, because an `<img>` sends the
  reader's address to whoever the model named. `"embed"` loads them. There is no list of allowed origins to
  configure: a host that wants one decides inside its own `embed` path.

Pass functions that are stable between renders (define them outside the component): a new function starts a
streamed answer over.

Every fenced block gets a copy button; every table gets copy as TSV (pastes into a spreadsheet) and copy as
Markdown. Their words are labels like any other.

## Starting points

`Thread` shows an empty state (a title, one line, your suggestions) until the first message. Nothing is
invented: you supply every prompt.

```tsx
<Thread suggestions={["Summarise this contract", { label: "Find risks", prompt: "List the main risks in clause 3." }]} />
<Thread empty={<MyWelcome />} />   // your own
<Thread empty={null} />            // none
```

`Suggestions` is the same list, usable on its own (under the composer, after an answer), with `onPick` to
override what pressing one does.

## Attachments the host can bound

```tsx
<Composer accept="image/*,application/pdf" maxFileBytes={2 * 1024 * 1024} />
```

A file that is the wrong type or too large is not attached silently: it is listed under the composer
(`role="alert"`) with the reason, in the active language. Editing a sent message keeps its attachments.

## Ratings, extra controls, error text

```tsx
<Thread
  onFeedback={(message, value) => save(message.id, value)}      // "up" | "down" | null
  actions={(message, markdownSource) => <button>Share</button>} // beside copy and regenerate
  formatError={(error) => myFriendlyText(error)}                // what a failed turn shows
/>
```

The thumbs are `aria-pressed` toggles. Without `onFeedback` they are not drawn: the kit does not imply a
rating goes anywhere. `Copy` copies the answer's Markdown source, not its rendered text.

## Point words at a source

A citations card may give itself an `id` and each of its items one (both optional, so older cards still
validate). The model is told to write `[[1]](ref:<card id>?cite=<item id or its number>)`; in the
transcript that is a numbered marker that, on hover, focus or click, points at the item. It uses the same
card-ref mechanism as everything in [Connecting Router, Chart and Editor](integrations.md#make-words-point-at-a-card):
`Thread` installs `builtinCardRefHost` when nothing above it provides a host, and `chainCardRefHosts` joins
it with another, so a chart link and a citation link can live in one answer.

```tsx
import { CardRefProvider, builtinCardRefHost, chainCardRefHosts } from "@supersolutions/super-chat-ui";
import { pluginCardRefHost } from "@supersolutions/super-chat-plugin";

<CardRefProvider host={chainCardRefHosts(builtinCardRefHost, pluginCardRefHost)}>
  <Thread />
</CardRefProvider>
```

A marker whose card is not mounted (an old turn, a card the user closed) reads as plain text with the reason
as its tooltip.

## How a tool call reads

By default a call shows the tool's name. A tool can say how it reads:

```ts
const search: ToolDefinition = {
  name: "search_precedent",
  // ...
  display: {
    label: (input) => `Search “${(input as { query: string }).query}”`,
    summary: (output) => `${(output as { hits: unknown[] }).hits.length} results`,
  },
};
```

Both functions are optional, run inside a guard (a throw falls back to the name), and are clamped to 140
characters. The tool's real name stays in the row's tooltip.

## Reading and look

| Token | Default | What it does |
| --- | --- | --- |
| `--sc-measure` | `72ch` | Widest a paragraph, list or heading gets, so long lines stay readable on a wide column |
| `--sc-density` / `[data-sc-density="compact"]` | `1` / `0.7` | Vertical rhythm between blocks and messages |
| `--sc-fade-in` | `0ms` | A block arriving while an answer streams fades in over this long. Off by default; ignored when the reader prefers reduced motion |
| `--sc-fs-h2`, `--sc-fs-h3` | `19px`, `17px` | The heading ramp (`#` renders as `h2`: a chat answer is never the page's `h1`) |

The stylesheet also answers `forced-colors: active` (Windows high contrast): borders, focus rings, the
selected and pointed states and the thumbs keep a visible outline instead of relying on colour.

## What a screen reader gets

The transcript is `role="log"` and says `aria-busy` while a turn streams; a polite live region announces
that an answer started and finished (not each token). Controls that were icons now have names. The
streamed answer renders block by block and only touches the block that changed, which is also why a reader
can select text in an answer that is still arriving.

## Weight of what you import

A bundler can only drop what it can prove is unused, and it could not here. This now holds, and
`pnpm check:size` (part of `pnpm verify`) fails when it stops being true. Gzip sizes of one import, React
and super-protocol external, minified:

| Import | Before 0.5 | Now |
| --- | --- | --- |
| `{ CodeBlock }` | 40.1 KB | 3.0 KB |
| `{ Thread, Composer }` | 51.5 KB | 35.7 KB |
| `{ renderMarkdown }` (ui-core) | 5.2 KB | 8.1 KB (adds the highlighter, task lists, maths and image handling) |
| `styles.css` as served | 32.7 KB | 36.1 KB |

Subpaths for the parts you may want without the rest: `/cards` (every card renderer, lazily registered),
`/agent`, `/surfaces`, `/labels`. The budgets in `scripts/check-size.mjs` are proposals; change one in the
same commit that says why.
