# Changelog

## 0.1.0 (unreleased)

First release of the reset `@supersolutions/super-chat-{core,react,ui}` line (the packages move from the `@super-solution` npm scope to `@supersolutions`).

The repository history and version numbers were reset on 2026-11-07. Earlier
`0.x` versions published under `@super-solution/super-chat-*` or the former
`@zzyzxlabs/super-chat-*` names remain Apache-2.0 licensed for everyone who
received them, but are superseded by this line and receive no further updates.

The code is the same Apache-2.0 framework; the copyright holder is now
SUPER SOLUTION LABS INC. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

### Added

- **Surfaces**: agents can assemble an interactive interface from layout, display and input components plus any registered card kind, with a local data model, declarative bindings and a closed set of actions. See [`docs/guide/surfaces.md`](docs/guide/surfaces.md).
- Text and interface parts now render in the order they happened, in live and finished turns. Threads saved earlier keep their original layout.
- `AgentClientConfig.cards` and `CardRendererProvider`'s `registry` prop: interactive behaviour now comes from the card registry, so `editreview` and plugin kinds are treated as interactive.

### Fixed

- Bars on a category axis are centred in their band instead of being cut off at the plot edges.
- A card updated in place keeps the output slot of the call that first drew it.
