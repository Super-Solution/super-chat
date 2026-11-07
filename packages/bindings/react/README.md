# @supersolutions/super-chat-react

React bindings for [@supersolutions/super-chat-client](../client/README.md): thread state, run
control, card actions, and context inspection. `AgentClient` (from the client package) is one
store per thread; the hooks here are fine-grained selectors over it so a component that only
reads `status` doesn't re-render on every streamed token.

Part of the [superchat](../../README.md) monorepo. See
[../../docs/HANDOFF.md](../../docs/HANDOFF.md) for load-bearing design
decisions.

## What's in here

- `hooks.tsx` — `useRun`, `useThread`, `useCards`, `useSkills`, `useTools`, `useAttachments`, `useCardAction`, `useAgentState`, and friends.

## Install

```bash
pnpm add @supersolutions/super-chat-core @supersolutions/super-chat-client @supersolutions/super-chat-react
```

## Develop

```bash
pnpm --filter @supersolutions/super-chat-react build       # tsup, emits dist/
pnpm --filter @supersolutions/super-chat-react typecheck   # tsc --noEmit
pnpm vitest run packages/bindings/react             # this package's tests
```
