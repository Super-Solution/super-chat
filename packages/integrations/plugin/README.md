# @supersolutions/super-chat-plugin

Plugin host for super-chat. It connects a `ChatPlugin` from `@supersolutions/super-protocol` to the card registry,
the tool registry and the React renderer.

```ts
import { installChatPlugin, pluginRenderers } from "@supersolutions/super-chat-plugin";

const report = installChatPlugin(cards, plugin, { tools });
// report.tools, report.refusedTools, report.unsupportedSurfaces
// <CardRendererProvider renderers={{ ...BUILTIN_RENDERERS, ...pluginRenderers([plugin]) }}>
```

An invalid plugin, or a card kind or tool name that is already registered, throws and installs nothing. A mount
that throws is contained to its own card.

## Tool authority

| Declared `authority` | Presets that offer the tool |
| --- | --- |
| `read` | `observer`, `draft`, `executor` |
| `draft` | `draft`, `executor` |
| `act` | `executor` |
| missing or unknown | none; listed in `refusedTools` |

A tool is also refused if the manifest does not declare it, or if its name or input schema is invalid. A tool with
`confirm: true` shows a confirm card before each run. If the user declines, or the host has no way to ask, the tool
does not run. Hosts need `onUserDecision` wired for these tools; `AgentClient` does this.

## Theme

`PluginCard` passes the page's colours and fonts to each card as `hostTheme`, and updates the card when the page
switches theme.

## Surfaces

This host renders `card` capabilities and offers `tool` capabilities. It does **not** render `panel` or `canvas`.
A plugin may declare them, nothing is shown for them, and `installChatPlugin` lists them in `unsupportedSurfaces`.


See [docs/PACKAGES.md](../../docs/PACKAGES.md).
