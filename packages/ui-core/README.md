# @supersolutions/super-chat-ui-core

Framework-free helpers that every superchat UI binding shares, so a Vue, Svelte or native
binding does not have to reimplement them:

- `markdown.ts` — `renderMarkdown`, incremental `renderMarkdownStream` and
  `renderMarkdownWithAnchors` (a source-span map for quoting).
- `format.ts` — `formatValue`, `formatDelta`, `toneClass`, `deltaTone` for card values.
- `export.ts` — `threadToMarkdown`, `downloadThread`.

No React, no DOM framework. Part of the [superchat](../../README.md) monorepo. The React
components live in [`@supersolutions/super-chat-ui`](../ui/README.md); the shared stylesheet still
ships with that package for now.

## Install

```bash
pnpm add @supersolutions/super-chat-core @supersolutions/super-chat-ui-core
```

## Develop

```bash
pnpm --filter @supersolutions/super-chat-ui-core build
pnpm --filter @supersolutions/super-chat-ui-core typecheck
pnpm vitest run packages/ui-core
```
