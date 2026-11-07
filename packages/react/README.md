# @supersolutions/super-chat-react

React bindings for [@supersolutions/super-chat-core](../core/README.md): thread state, run
control, card actions, and context inspection. One `AgentClient` store per
thread; hooks are fine-grained selectors over it so a component that only
reads `status` doesn't re-render on every streamed token.

Part of the [superchat](../../README.md) monorepo. See
[../../docs/HANDOFF.md](../../docs/HANDOFF.md) for load-bearing design
decisions.

## What's in here

- `client.ts` — `AgentClient`: owns the store, drives `runAgent()`, persists threads/jobs.
- `store.ts` — the subscribe/notify primitive the hooks select over.
- `hooks.tsx` — `useRun`, `useThread`, `useCards`, `useSkills`, `useTools`, `useAttachments`, `useCardAction`, `useAgentState`, and friends.

## Install

```bash
pnpm add @supersolutions/super-chat-core @supersolutions/super-chat-react
```

## Develop

```bash
pnpm --filter @supersolutions/super-chat-react build       # tsup, emits dist/
pnpm --filter @supersolutions/super-chat-react typecheck   # tsc --noEmit
pnpm vitest run packages/react             # this package's tests
```
