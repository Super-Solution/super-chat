# @super-solution/super-chat-ui

Card renderers and chat primitives for [@super-solution/super-chat-core](../core/README.md) +
[@super-solution/super-chat-react](../react/README.md). Ships a self-contained plain-CSS
baseline — no Tailwind, no preprocessor, no build step imposed on the host.

Part of the [superchat](../../README.md) monorepo. Design tokens, breakpoints,
theming and the full component spec live in
[../../docs/UI-SPEC.md](../../docs/UI-SPEC.md); load-bearing decisions are in
[../../docs/HANDOFF.md](../../docs/HANDOFF.md).

## What's in here

- `Thread.tsx` — the main chat surface: message list, composer, live streaming turn.
- `cards/` — one renderer per built-in card kind (table, chart, funnel, diff, confirm, …), registered in `cards/index.ts` and validated against `@super-solution/super-chat-core`'s `BUILTIN_CARDS` (`cards/registry-sync.test.ts` keeps the two in sync).
- `renderer-registry.tsx` — the `CardRenderer` dispatch + provider for host-supplied renderer overrides.
- `ContextInspector.tsx` — renders a context-build trace (what was included/truncated/dropped and why).
- `markdown.ts`, `format.ts`, `export.ts` — supporting utilities for message rendering and card export.
- `styles.css` — the token baseline. Import it from source (`@super-solution/super-chat-ui/styles.css`), not from `dist`.
- `mobile-agent` — framework-neutral action, model-selection, loading and Orb
  contracts for native ports.
- `mobile-agent/react-native` — RN-specific window-class, small-screen,
  accessibility and skeleton recipes. Neither entry forces an animation or
  navigation library; see [MOBILE-AGENT.md](MOBILE-AGENT.md).

## Install

```bash
pnpm add @super-solution/super-chat-core @super-solution/super-chat-react @super-solution/super-chat-ui
```

```ts
import "@super-solution/super-chat-ui/styles.css";
```

Native hosts should import only the portable contract entry:

```ts
import {
  SUPERCHAT_MOBILE_AGENT_ACTIONS,
  SUPERCHAT_MOBILE_AGENT_ORB,
} from "@super-solution/super-chat-ui/mobile-agent";

import {
  resolveSuperChatMobileAgentRNLayout,
  resolveSuperChatMobileAgentRNSkeleton,
} from "@super-solution/super-chat-ui/mobile-agent/react-native";
```

## Loading states

`LiveTurn` distinguishes uncertain prose from predictable output geometry:

- streamed prose renders real text with a steady caret while deltas arrive and
  blinks only after a 420 ms quiet gap;
- a tool with `ToolDefinition.loading` gets a delayed, kind-specific card
  skeleton in a stable `callId` slot;
- generated media keeps that slot through the provider response, then retains a
  media skeleton until image decode or audio/video metadata completes;
- `prefers-reduced-motion` keeps the status and geometry but stops the shimmer,
  blink, and decode fade.

Use `CardSkeleton` directly for host-managed work. Pass `hint.kind` as `media`,
`chart`, `table`, `document`, or `generic`; include a real media `count` and
`aspectRatio` whenever the request already determines them.

## Develop

```bash
pnpm --filter @super-solution/super-chat-ui build       # tsup, emits dist/
pnpm --filter @super-solution/super-chat-ui typecheck   # tsc --noEmit
pnpm vitest run packages/ui             # unit tests (jsdom — no real layout)
pnpm test:rwd                           # Playwright — real layout at 360/390/768/1280px
```
