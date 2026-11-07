# @supersolutions/super-protocol

The Apache-2.0 contract layer shared by the Super Solution libs. It holds types and small
validators only, with no runtime dependencies, so an Apache-licensed host such as super-chat can
depend on it while a plugin (super-editor, super-chart, ...) stays GPL/AGPL or commercial.

Rule: this package must never import from a GPL/AGPL package.

| subpath | what it defines |
| --- | --- |
| `@supersolutions/super-protocol/plugin` | `PluginManifest` v0 and `validatePluginManifest` |
| `@supersolutions/super-protocol/chat` | `ChatPlugin`: card kinds, framework-neutral `CardMount`, tools, `validateChatPlugin` |
| `@supersolutions/super-protocol/router` | `InferenceGateway`, request/usage/stream-event types, `parseSSE`, `collectText` |
| `@supersolutions/super-protocol/editor` | the `super-editor.document` card kind, its spec and validator |
| `@supersolutions/super-protocol/chart` | market-data contracts (`Datafeed`, `MarketBar`, `SymbolInfo`, `Period`), the annotation spec and the `super-chart.chart` card kind with its validator |

The root entry re-exports all of them.

```ts
import { validateChatPlugin } from "@supersolutions/super-protocol/chat";
const issues = validateChatPlugin(plugin); // [] when the plugin is loadable
```

Status: v0. Shapes may change before 1.0; the router types match the Super Router HTTP API as
implemented today.

License: Apache-2.0. Copyright 2026 SUPER SOLUTION LABS INC.
