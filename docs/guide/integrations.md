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
