# @supersolutions/super-chat-router

`createSuperRouterGateway` is an `InferenceGateway` over the Super Router HTTP API.
`createSuperRouterProvider` wraps any gateway as a super-chat `Provider` (text only; the request's
`model` is the Super Router service id). Errors are mapped to `AgentError` kinds; a replayed
idempotency key is reported, never passed off as a fresh answer.

See [docs/PACKAGES.md](../../docs/PACKAGES.md).
