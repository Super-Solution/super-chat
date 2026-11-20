# Changelog

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
