# @super-solution/super-chat-core

Provider-agnostic agent core: content model, skills, context assembly, tools,
runtime, and hand-rolled provider adapters. No React — isomorphic, runs on a
server or in a browser tab.

Part of the [superchat](../../README.md) monorepo. See the root README for the
full pitch and [../../docs/HANDOFF.md](../../docs/HANDOFF.md) for load-bearing
design decisions.

## What's in here

| module | responsibility |
| --- | --- |
| `providers/openai`, `providers/anthropic` | hand-rolled request/response mapping for each wire dialect |
| `transport` | SSE parsing, retry, proxy handler, multipart upload |
| `context` | derives a token-budgeted context from named sources every turn |
| `skills` | trigger + cost units that inject prompt text and unlock tools |
| `tools` | capability registry with explicit preset allowlists |
| `cards` | validator + schema for the 23 built-in agent-card kinds |
| `runtime` | the agent loop, tool execution, background job polling |
| `runtime/metering` | provider-neutral step/run usage records and an optional delivery sink |
| `memory`, `retrieval` | pluggable long-term memory and cited-evidence retrieval seams |
| `mcp` | Streamable HTTP MCP client and tool import |
| `app-state` | lets the agent read/operate host application state |
| `documents` | the document seam: store, anchored edit protocol, `.eml` exit |
| `content/blocks` | the block split every document anchor is defined against |

## Install

```bash
pnpm add @super-solution/super-chat-core
```

## Develop

```bash
pnpm --filter @super-solution/super-chat-core build       # tsup, emits dist/
pnpm --filter @super-solution/super-chat-core typecheck   # tsc --noEmit
pnpm vitest run packages/core             # this package's tests
```

## Metering

`runAgent` emits one `metering` event for every attempted provider step and
one terminal run summary. Records contain stable ids, the provider, requested
and reported model ids, normalized token usage, source, timing, and terminal
status. They deliberately contain no currency or pricing assumptions.

For direct delivery, pass a host-owned sink:

```ts
const meter: MeterSink = {
  async record(record) {
    await usageLog.append(record); // persistence and retries are host policy
  },
  onError(error, record) {
    console.warn("metering delivery failed", record.id, error);
  },
};

for await (const event of runAgent(messages, {
  ...config,
  meter,
  meteringMetadata: { tenantId: "acme" },
})) {
  // Existing event consumers continue to work unchanged.
}
```

`scope: "step"` records are the non-overlapping units to aggregate. The
`scope: "run"` record is an authoritative reconciliation summary, not another
billable unit. Sink failures are fail-open and optionally reach `onError`;
durability, quotas, pricing, billing, and payment protocols stay outside core.
