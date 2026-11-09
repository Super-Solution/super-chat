# Backends

One folder per language. Each implements the same contract and is tested against the shared data in
[`../conformance`](../conformance/README.md).

| Folder | Status |
| --- | --- |
| `typescript/` | Reference implementation: `@supersolutions/super-chat-server` (`createProxyHandler`); the protocol reference lives in `packages/protocol` |
| `go/` | Proof of concept: `protocol` (plugin manifest, editor and chart card validators, SSE parser) |
| `python/` | Proof of concept: `super_protocol`, the same surface |

The proofs of concept cover the protocol's validators and the stream parser only. They have no HTTP
proxy yet.

`pnpm test:backends` runs the Go and Python suites (each skipped, loudly, if its toolchain is missing).
