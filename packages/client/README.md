# @supersolutions/super-chat-client

The framework-agnostic client for [@supersolutions/super-chat-core](../core/README.md). One
`AgentClient` store per thread: it owns the state, drives `runAgent()`, and persists
threads and jobs. It has no UI framework dependency, so React, Vue, Svelte, React Native or a
plain script can all bind to the same client.

Part of the [superchat](../../README.md) monorepo.

## What's in here

- `client.ts` — `AgentClient`.
- `store.ts` — the subscribe/notify primitive that framework bindings select over.

Framework bindings live in their own packages, for example
[`@supersolutions/super-chat-react`](../react/README.md).

## Install

```bash
pnpm add @supersolutions/super-chat-core @supersolutions/super-chat-client
```

## Develop

```bash
pnpm --filter @supersolutions/super-chat-client build
pnpm --filter @supersolutions/super-chat-client typecheck
pnpm vitest run packages/client
```
