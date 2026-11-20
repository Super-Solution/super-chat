# Connecting Router, Chart and Editor

Super Chat reaches the other Super products through two small seams: a `Provider` for the model and a `ChatPlugin`
for cards and tools. A working app that uses all of them is in
[`examples/full-stack`](../../examples/full-stack/README.md).

## Serve the agent through Super Router

```ts
import { createSuperRouterGateway, createSuperRouterProvider } from "@supersolutions/super-chat-router";

const gateway = createSuperRouterGateway({ baseUrl: "/api/router", apiKey: "held-by-your-server" });
const provider = createSuperRouterProvider({ gateway, customerId: "customer_123" });
```

Keep the router key on your server: point `baseUrl` at a route that adds it. The request's `model` is the Super
Router service id.

The provider carries tool calls, tool results, usage and images. Files and audio are dropped with a warning. Tool
calling needs the TypeScript Super Router server; the Go, Python and Rust data planes refuse these requests.

## Add Chart and Editor

```ts
import { installChatPlugin, pluginRenderers } from "@supersolutions/super-chat-plugin";
import { createChartChatPlugin } from "@supersolutions/super-chart-chat-plugin";
import { createEditorChatPlugin } from "@supersolutions/super-editor-chat-plugin";

const plugins = [createChartChatPlugin(), createEditorChatPlugin()];
for (const plugin of plugins) installChatPlugin(cards, plugin, { tools });

const renderers = { ...BUILTIN_RENDERERS, ...pluginRenderers(plugins) };
```

Load `@supersolutions/super-editor-ui/styles.css` once on the page.

**Licence:** the Chart and Editor plugins are GPL-3.0-or-later. Super Chat stays Apache-2.0 because it never depends
on them, but an app that imports them takes on the GPL unless it has a commercial licence.

## Make words point at a card

An assistant can write `[the support level](ref:btc?key=support)` in its answer. In the transcript that is a
dotted-underlined phrase: hover or focus it and the card it names (here the one with `id` `btc`) highlights what the
phrase means; click it, or press Enter or Space, and the card scrolls that into view. Escape puts the highlight away
without moving the pointer.

```tsx
import { CardRefProvider } from "@supersolutions/super-chat-ui";
import { pluginCardRefHost } from "@supersolutions/super-chat-plugin";

<CardRefProvider host={pluginCardRefHost}>
  <Thread />
</CardRefProvider>
```

That is all a host does. Super Chat parses the link, finds the mounted card whose spec `id` it names, and hands it
the reference through the card's `ref()` handler. It never reads the params, so it works for any card that
implements `ref()`: the chart plugin's vocabulary is `key=<mark>` or `from=&to=` with an optional `low=&high=`
price band, and a plot or a document can define its own. The link format is defined once in super-protocol
(`docs/CARD-REFS.md`).

- **No provider, no links.** Without a `CardRefProvider` a `ref:` link is plain text, so a transcript exported or
  shown elsewhere stays readable. It is never an `<a>`, and never leaves the page.
- **A reference that cannot be answered reads as text.** If no card has that id (an old turn, a card the user
  closed), the card does not implement `ref()`, or the link does not parse, the phrase turns into plain text with
  the reason as its tooltip. Nothing throws.
- **Two cards, one id** resolve to the newest, the one the sentence was written about.
- **Screen readers:** the phrase is a focusable button, and the label a card returns on focus or activation is
  announced through a polite live region the provider renders.
- **Other hosts:** `CardRefHost` is a one-method interface, `ref(ref | null, event)`. Implement it to route
  references to cards you mount yourself; `ProseHtml` is what makes the spans live wherever you render rendered
  Markdown.

## What the agent may do

Each plugin tool declares an authority, and the run's presets decide what the agent is offered.

| Authority | Offered by | Examples |
| --- | --- | --- |
| `read` | `observer`, `draft`, `executor` | `chart_state`, `editor_get_outline` |
| `draft` | `draft`, `executor` | `chart_annotate`, `editor_insert_blocks` |
| `act` | `executor` | `chart_clear_annotations`, `editor_delete_blocks` |

A tool with a missing or unknown authority is offered to nobody. Tools that overwrite or remove document content
show a confirm card first; if the user declines, they do not run. `installChatPlugin` returns a report of what was
installed and what was refused.

## Theme

Plugin cards receive the page's colours and fonts and follow theme changes. Override the `--sc-*` variables and the
cards follow.

## Not supported yet

Super Chat renders `card` capabilities and offers `tool` capabilities. It does not render the `panel` or `canvas`
surfaces a plugin manifest can declare; `installChatPlugin` lists them in `unsupportedSurfaces`.
