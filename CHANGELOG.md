# Changelog

## Unreleased

No change to super-protocol: every shared shape stays as it was. Everything below is additive unless it is under Changed.

### Added

- **Accessibility.** The thread is `role="log"` with `aria-busy` while a turn streams, and a polite live region announces that an answer started and finished (not each token). Icon-only controls have names, and `forced-colors: active` (Windows high contrast) keeps borders, focus rings and the selected, pointed and rated states visible without colour.
- **Selection survives streaming.** The live answer is patched block by block instead of replaced, so text selected in an answer that is still arriving stays selected (a Playwright test holds this). One loss remains: the selection is lost once, at the moment the turn commits.
- **Markdown renders what models write** (`@supersolutions/super-chat-ui-core`): task lists, bare links, safe images (a link unless the host opts in), and `$…$` / `$$…$$` maths. Fenced code is coloured by a small built-in highlighter (JS/TS, Python, JSON, shell, SQL, HTML/CSS, YAML, diff). Slots, through `MarkdownProvider` or `MarkdownOptions`: `highlight` (replace the highlighter, or `false`), `math` (a typesetter; off by default so a price is never maths) and `images` (`"link"` by default, which fetches nothing; `"embed"` loads them). `highlightCode`, `HIGHLIGHT_LANGUAGES`, `tableToTsv` and `tableToMarkdown` are exported. No new dependency.
- **Code block and table actions.** Copy on a fenced block; copy as TSV and as Markdown on a table, in rendered Markdown and on the `table` card.
- **`Suggestions` and `EmptyThread`**, and `Thread` props `suggestions` and `empty`. Nothing is invented: the host supplies every prompt.
- **`Composer` `accept` and `maxFileBytes`.** A refused file is listed under the composer (`role="alert"`) with the reason, never dropped silently.
- **`LabelsProvider`, `useLabels`, `enLabels`, `zhTW`, `formatBytes`.** Every word the kit writes comes from one typed table, with a zh-TW preset (a first translation) and nested partial overrides. Subpath `/labels`.
- **`Thinking` splits CJK sentences** with `Intl.Segmenter` (a CJK-aware fallback where it is missing).
- **Inline citations.** `[[1]](ref:<card id>?cite=<item id or number>)` points into a citations card through the existing card-ref mechanism. `CitationsCard` gains an optional `id`, and each item an optional `id` (validated; duplicates refused). New: `builtinCardRefHost`, `chainCardRefHosts`, `useCardRefTarget`. `Thread` installs `builtinCardRefHost` when no host is above it; to keep another host as well, chain them.
- **Per-answer controls.** `Thread` / `MessageView` props `onFeedback` (thumbs, `aria-pressed`; not drawn without a handler), `actions` (extra controls beside copy and regenerate) and `formatError`.
- **`ToolDefinition.display`** (`label(input)`, `summary(output)`): how a call reads on its row. A throw falls back to the tool name; text is clamped to 140 characters. A finished call also shows a duration bar.
- **Reading tokens:** `--sc-measure` (72ch), `--sc-density` with `[data-sc-density="compact"]`, `--sc-fade-in` (0ms: off; the fade is CSS-only and never runs under reduced motion), and a heading ramp (`--sc-fs-h2`, `--sc-fs-h3`).
- **Subpath exports** of `@supersolutions/super-chat-ui`: `/cards`, `/agent`, `/surfaces`, `/labels`.
- **`pnpm check:size`** (`scripts/check-size.mjs`, part of `pnpm verify` after the build): bundles single imports the way an app would and fails past a budget. The budgets are proposals, not decisions.
- A guide page, [Make the transcript yours](docs/guide/ui.md).

### Changed

- **Tree-shaking works again.** `import { CodeBlock }` was 40.1 KB gzip and is 3.0 KB; `{ Thread, Composer }` went from 51.5 KB to 35.7 KB. The cause was a spread of a call in `BUILTIN_RENDERERS` that ran at load and kept every card view; `BUILTIN_RENDERERS` is now a plain object and the default registry is built on first use (`getDefaultRegistry()`). Pure annotations were added where a `createContext` or a table was built at load. The Markdown renderer grew from 5.2 KB to 8.1 KB (the highlighter, task lists, maths and image handling), and `styles.css` from 32.7 KB to 36.1 KB.
- `Thread` shows a default empty state (title, one line, any suggestions) before the first message. Pass `empty={null}` for none.
- `thoughtFor(seconds)` in the labels receives the number only; the label owns the unit.
- Heading levels in rendered Markdown are unchanged (`#` is still `h2`); sizes now follow a ramp.
- `Copy` on an answer copies its Markdown source, not its rendered text.

### Fixed

- **The file picker attached nothing.** The input's live `FileList` was emptied (`value = ""`) before it was read. It is copied first, and a file the reader cannot read is reported rather than lost.
- Editing a sent message dropped its non-text parts (attachments). They are kept, and the editor takes focus, closes on Escape and sends on Ctrl or Cmd+Enter.

## 0.4.4

Requires `@supersolutions/super-protocol` 0.4.1 (the plugin and router packages pin it).

### Added

- `runAgent` and `repairToolArguments` are now tested against the shared agent-loop conformance data of [Super Protocol](https://github.com/Super-Solution/super-protocol) (`agent-loop.v0.json`, `tool-repair.v0.json`), the same files the TypeScript reference machine and the Rust crate there are tested against, so a second implementation of the loop can be held to what this one does. Copies live in `packages/core/src/conformance/` (see its README); the tests that read them are `runtime/agent-loop.conformance.test.ts` and `tools/repair.conformance.test.ts`. Tests only: nothing in the published packages changes for this.

### Changed

- A person declining an approval only tells the model; the run goes on. This is what the code always did for a runtime approval (`side: "confirm"`), now stated and made consistent: `userDeclined` never fired for it (it looked for `output.cancelled`, which only a tool that asks for itself receives), so `DEFAULT_STOP_CONDITIONS` quietly did not include a stop on decline. `userDeclined` now fires on every shape of a person's no (a declined runtime approval, `{ cancelled: true }` from a tool that asks for itself, a declined `visualize` card), is documented as opt-in, and is no longer in `DEFAULT_STOP_CONDITIONS`, which is now `[consecutiveFailures(3)]`. A host that wants a "no" to end the turn adds `userDeclined` to `stopWhen`. `isUserDecline` and `USER_DECLINED` are exported. No change to what a run does by default: the defaults were never applied by `runAgent` itself, and no package in this repository passes them.
- A plot card refused for a missing `spec` now shows a real nested example in `expected` (a small valid plot spec inside `spec`, with `alt` beside it) instead of `spec: { ...a plot spec }`. A model that sent the plot's fields flat inside the card spec gave up on the plot after one refusal; this comes with super-protocol 0.4.1. Error text only.

## 0.4.3

### Changed

- `visualize` refusals now carry the card kind's own `summary` as `expected` when the kind's validator gave no shape of its own. A refusal such as "symbol must be an object." named the wrong field but not the right one, so a model guessed again on the next step; it now sees how the card is built (its `summary`) at the point of failure. A kind that already returns `expected` keeps it, and a kind with an empty summary adds nothing. Additive and only on refusals.

## 0.4.2

### Added

- A failed tool call that left out a required argument now says so. Models sometimes send a call with no arguments for a tool whose `inputSchema` lists required ones; the tool's own error is short and specific to the tool ("No symbol given."), and a model that does not see why often sends the same call again. When a call failed (the output has an `error`, or the tool reported a failure) and a top-level `required` key is absent or null in its input, the output gains `missing` (the names) and `expected` (each one's `type`, `enum`, bounds and `description` from the tool's own schema) beside the tool's error. Additive and only on failures: a call that succeeded is never checked, so a tool may still default a required key, and an output that already carries `missing` or `expected` is left as it is. `explainMissingInput` is exported from `runtime/execute-tools`.

## 0.4.1

### Fixed

- A card shown in the side panel opens there again when the thread is reloaded. The committed message now keeps `placement: "panel"` on the card's `artifact` part (`ContentPart` gains an optional `placement`), and `MessageView` restores it, so a saved turn no longer draws its panel card in the chat. Turns saved by 0.4.0 have no placement and stay inline.

## 0.4.0

Requires `@supersolutions/super-protocol` 0.4.0 (the plugin and router packages pin it).

### Added

- A turn can run on your server while the same client and UI follow it. `AgentClientConfig.runner` (`TurnRunner`) replaces the in-process loop with a function that starts the turn elsewhere and yields its `RunEvent`s; `serverRunConfig({ runner })` builds a config with no provider, tools or context builder in this process. The runner is told what started the turn (`TurnContext.kind`) and whether the person asked for a stop (`stopRequested`), so opening another thread leaves a server-run turn running where pressing stop cancels it. `client.resume()` follows a turn that is already running, for a reload or a turn the server started. See [Run the agent on your server](docs/guide/server-run.md).
- Cards can open beside the chat. `createBuiltinTools({ placements: ["inline", "panel"] })` (or `createVisualizeTool`) lets the agent send `placement: "panel"` with a card; any tool can return `placement: "panel"` next to its `card`. Interactive cards always stay in the chat, a placement the host did not enable is refused, and panel cards are not previewed while they stream. The placement is kept on `Card.placement` and in `$card`, so history restores it. super-chat-ui adds `ChatPanelProvider`, `ChatPanel`, `useChatPanel` and `PanelCardLine`: inside a provider a panel card leaves a line in the thread that reopens it, and `ChatPanel` draws it wherever the host lays it out. Without a provider nothing changes. Renderers get a `placement` prop, plugin mounts get `placement` in `CardMountContext`, and `installChatPlugin` reports a plugin's `panel` card kinds as `panelKinds`. See [Cards beside the chat](docs/guide/panel.md). Requires `@supersolutions/super-protocol` 0.4.0.
- `run-snapshot`, a `RunEvent` that replaces what a consumer holds for a run with the parts and cards so far. For joining a run part-way, or recovering a stream that dropped when the missed events cannot be replayed. `runAgent` never emits it.

### Fixed

- A turn left behind by a thread switch no longer clears the next turn's abort controller when it unwinds late, which could leave `stop()` unable to stop the new turn.

## 0.3.0

Requires `@supersolutions/super-protocol` 0.3.0 (the plugin and router packages pin it).

### Changed

- Approval cards speak to the person approving. Before a tool that asks first runs, the card says what will happen in a sentence, lists any details worth checking, and ends with one question above buttons named for the action. It no longer shows tool names, package names or raw JSON. A tool can word its own card with the new optional `approval(input)` on `ToolDefinition`, and plugin tools can pass the same; without it the card uses the description's first sentence, the input's plain fields, "Allow this?", and Allow / Not now. `approvalCard()` builds it. A confirm card may now have no detail rows when its `description` already says everything.
- A card that can't be drawn shows its own `alt` text, or a line naming it by its title, instead of its error, its kind or its JSON. The details go to the console. This covers plugin cards that fail to mount (`PluginCardFallback`, `onCardError` on `pluginRenderers`), renderers that throw, and kinds with no registered renderer. The expired-card line no longer names the kind.

### Added

- Words in an answer can point at a card. A `[text](ref:<card id>?…)` link renders as a phrase that, inside a `CardRefProvider`, highlights what it means when hovered or focused, and reveals it when chosen (click, Enter, Space or tap). Escape dismisses it. Without a provider it stays plain text, and a reference nothing can answer turns into text with the reason as its tooltip. `pluginCardRefHost` routes references to mounted plugin cards through their `ref()` handler, so any card kind that implements it works, not only Chart. `ProseHtml` makes the spans live wherever rendered Markdown is shown; `parseCardRef` reads the link. The format is defined in super-protocol (`docs/CARD-REFS.md`).

## 0.2.3

### Fixed

- A turn no longer jumps when it is saved. The streaming caret sits at the end of the last line instead of on a line of its own, and the meta row's place is held while the turn is written.
- A surface streamed into the thread stays one element from its first part to its finished card, so it is not drawn twice.
- Charts stay legible in narrow containers. A narrow layout with fewer ticks replaces the scaled-down wide one below 600px, and one axis uses one unit, such as 50K and 150K instead of 50,000 and 150K.
- A table header no longer wraps or clips its label. The agent composer's send button no longer clips its arrow.

### Changed

- The edit control sits beside the user's message instead of inside it. It shows on hover or focus with a mouse, and stays visible on touch.
- A labelled orb (`pill`) shows the orb and its words without a capsule around them.

## 0.2.2

### Fixed

- A streaming surface no longer jumps or redraws. The part the model is still writing holds its place with a placeholder sized for its kind, parts that have not arrived get a single line, and each part fades in where its placeholder stood. A surface card keeps one view from its first streamed part to the finished interface, so charts and tables are not drawn twice.
- A card's Copy and Download no longer leave an empty row under a well inside a surface. With a mouse they float over the card's top corner.

### Added

- `previewSurface` reports the part still being written as `pending`, and `AgentSurface` takes a `streaming` spec to show it before the client knows the surface.

## 0.2.1

### Removed

- The "Your turn" chip on unanswered cards. The waiting border still marks them until they are answered.

### Fixed

- `installChatPlugin` installs a plugin again when one of its tools has an invalid `authority` or `confirm`. Since 0.2.0 the whole plugin was rejected; now only that tool is refused and listed in `refusedTools`, as before.

## 0.2.0

### Added

- New optional tokens: `--sc-accent-strong`, `--sc-accent-tint` and `--sc-radius-lg` (derived from `--sc-accent` and `--sc-radius` unless set), plus `--sc-line-strong`, `--sc-radius-pill`, `--sc-scrim` and the `--sc-turn`, `--sc-turn-strong`, `--sc-turn-tint`, `--sc-turn-line` and `--sc-on-turn` waiting colours.
- **Surfaces**: agents can assemble an interactive interface from layout, display and input components plus any registered card kind, with a local data model, declarative bindings and a closed set of actions. See [`docs/guide/surfaces.md`](docs/guide/surfaces.md).
- Text and interface parts now render in the order they happened, in live and finished turns. Threads saved earlier keep their original layout.
- `AgentClientConfig.cards` and `CardRendererProvider`'s `registry` prop: interactive behaviour now comes from the card registry, so `editreview` and plugin kinds are treated as interactive.

### Changed

- **The kit's default look now follows the Super Chat design system.** Hosts that set no tokens of their own will see a different interface: violet accent in place of blue, neutral light and dark palettes, new chart series colours, a person's message as an ink slab, 16px composer and overlay corners, and JetBrains Mono first in the mono stack. Every `--sc-*` token still works. Hosts that set `--sc-accent` or `--sc-radius` keep their theme, and focus rings, links and selection follow that accent.
- An unanswered choice, form, confirm or edit review now shows a "Your turn" chip and a waiting border until it is answered.
- Controls share one focus ring and reach 44px touch targets on coarse pointers. Movement stops under `prefers-reduced-motion`.
- **`side: "confirm"` is now enforced by the runtime.** A tool with that flag shows an approval card before it starts, and does not run if the person declines or the host cannot ask. A tool that already asks through `ctx.requestCard` should set `confirmation: "tool"`, or the person is asked twice.

### Fixed

- Bars on a category axis are centred in their band instead of being cut off at the plot edges.
- A card updated in place keeps the output slot of the call that first drew it.

## 0.1.0

First release of the reset `@supersolutions/super-chat-{core,react,ui}` line (the packages move from the `@super-solution` npm scope to `@supersolutions`).

The repository history and version numbers were reset on 2026-11-07. Earlier
`0.x` versions published under `@super-solution/super-chat-*` or the former
`@zzyzxlabs/super-chat-*` names remain Apache-2.0 licensed for everyone who
received them, but are superseded by this line and receive no further updates.

The code is the same Apache-2.0 framework; the copyright holder is now
SUPER SOLUTION LABS INC. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
