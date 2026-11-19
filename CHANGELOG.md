# Changelog

## Unreleased

### Removed

- The "Your turn" chip on unanswered cards. The waiting border still marks them until they are answered.

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
