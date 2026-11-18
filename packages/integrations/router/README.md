# @supersolutions/super-chat-router

`createSuperRouterGateway` is an `InferenceGateway` over the Super Router HTTP API.
`createSuperRouterProvider` wraps any gateway as a super-chat `Provider`; the request's `model` is the Super Router
service id. Errors are mapped to `AgentError` kinds; a replayed idempotency key is reported, never passed off as a
fresh answer.

The provider carries text, tool declarations, streaming tool calls, tool results, usage, and images as `https:`
URLs or base64 PNG, JPEG, GIF and WebP. Files and audio are dropped with a warning. Tool calling needs a Super Router
TypeScript server that supports it; the Go, Python and Rust data planes refuse these requests. For an older server,
set `toolCalling: false`.

See [docs/PACKAGES.md](../../docs/PACKAGES.md).
