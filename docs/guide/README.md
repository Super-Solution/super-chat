# Guide

Task-oriented docs for [superchat](../../README.md). The root README says what the
framework *is*; these pages say how to build with it.

Package READMEs ([core](../../packages/core/README.md), [react](../../packages/react/README.md),
[ui](../../packages/ui/README.md)) are module-level reference — what lives where.
This guide is the other axis: one page per subsystem, in the order you meet them.

## Reading order

| # | page | you'll have |
| --- | --- | --- |
| 1 | [Getting started](getting-started.md) | A working agent — proxy route, registries, first turn |
| 2 | [Context assembly](context.md) | A budgeted context you can read a trace out of |

Still being written: requests & transports, skills, tools, cards, React. Until
they land, the package READMEs ([core](../../packages/core/README.md),
[react](../../packages/react/README.md), [ui](../../packages/ui/README.md)) and
the root [README](../../README.md) cover the same ground in less depth.

Every page is written against the real exported API. If a snippet drifts from the
code, the code wins — and that's a bug worth [reporting](https://github.com/Super-Solution/super-chat/issues).

## Run the examples

Most pages link to a **live panel** in the playground, which runs with **no API key**:

```bash
pnpm install && pnpm build && pnpm dev     # → http://localhost:3210
```

A scripted demo transport replaces the network while the real adapter, runtime,
tools and context builder do the actual work — so what you see is the framework,
not a mock of it.

## Also worth reading

- [HANDOFF.md](../HANDOFF.md) — load-bearing decisions and what will bite you. Read before changing core.
- [UI-SPEC.md](../UI-SPEC.md) — design tokens, breakpoints, theming, component spec for `packages/ui`.
