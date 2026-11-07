# @supersolutions/super-chat-server

The server-side half of superchat's `ProxyTransport` from
[@supersolutions/super-chat-core](../core/README.md). `createProxyHandler` takes a `Request` and
returns a `Response`, so it drops into a Next.js route handler, a Hono route, a Cloudflare Worker
or `Bun.serve` unchanged.

This package holds your provider key and forwards client-supplied paths, so it is kept apart from
the browser-safe core on purpose: nothing in `core`, `client` or the UI bindings imports it.
Providers must be registered explicitly with an allowlist of paths; the client can never set
`Authorization`; `authorize` receives the raw `Request` so you can attach a session check.

Part of the [superchat](../../README.md) monorepo.

## Install

```bash
pnpm add @supersolutions/super-chat-core @supersolutions/super-chat-server
```

## Develop

```bash
pnpm --filter @supersolutions/super-chat-server build
pnpm --filter @supersolutions/super-chat-server typecheck
pnpm vitest run packages/server
```
