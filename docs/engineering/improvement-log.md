# Engineering improvement log

A short, append-only record of what was found, decided and verified, so the next review does
not repeat finished work. Newest entry first. Claims here are things that were run, not intended.

## Directive pass (rounds 1–15, branch `claude/project-thread-u93pss`)

Fifteen rounds of audit → fix → local gate (`pnpm verify`) on top of the earlier iterations. Constraints held
throughout: public API compatible, nothing published, licences and git history untouched, no new dependencies.
Each round is one commit with its own regression tests. Scores: [`scorecard.md`](scorecard.md).

### Round 1 — transport retry (`core/transport/retry.ts`)

* Audit: SSE decoder, retry, direct and proxy transports. SSE and the transports hold up. `retry.ts` had **no tests at
  all** although every provider call goes through it.
* Fix 1: `sleep()` attached an `abort` listener, which never fires for a signal that is *already* aborted. A caller
  that cancels from `onRetry` (or between a failed attempt and the backoff) waited out the full delay (up to
  `maxDelayMs`) before the cancellation surfaced. It now rejects immediately.
* Fix 2: `parseRetryAfter` accepted anything `Number()` parses (`1e3`, `0x10`, a negative). Delta-seconds is now digits
  only, per RFC 9110; anything else falls through to the HTTP-date parse, which never yields a negative wait.
* Tests: `transport/retry.test.ts` (16 tests: header parsing, jitter bounds, retry/give-up/non-retryable, abort while
  sleeping, abort before sleeping, listener detach, `errorFromResponse` classification). Two fail on the old code (the
  pre-aborted one only after sitting out the 5 s test timeout).
* Not changed on purpose: a `Retry-After` longer than `maxDelayMs` is still capped rather than treated as "do not
  retry"; that is a documented behaviour and changing it is a policy call.

### Round 2 — `runAgent` background mode (`core/runtime/run.ts`)

* Audit: the agent loop (stream / sync / background, tool channel, stop conditions, metering on every exit path).
  Metering and cancellation hold up. One declared-but-dead option: `RunConfig.onJobHandle` ("Persist a background job
  handle so a reload can resume it") was never called anywhere, and its type
  (`NonNullable<…> extends string ? unknown : never`) collapsed to `(handle: unknown) => void`. A host that set it
  persisted nothing and was never told. (`AgentClient` persists through the `job-started` event, so the in-repo path
  was unaffected; direct `runAgent` callers were.)
* Fix: it is now `(handle: JobHandle) => void | Promise<void>`, called once after the provider accepts the job and
  before polling. A throw is swallowed (the job is already running; losing the run would lose its result), and the
  same handle still rides on `job-started`. Source-compatible for existing callers (a `(h: unknown) => void` is
  still assignable).
* Test: `run.test.ts` "hands the background job handle to onJobHandle before polling, and survives it throwing".

### Round 3 — stop conditions leak state across runs (`core/runtime/stop.ts`)

* Audit: tool execution and the stop predicates. `consecutiveFailures(n)` kept its streak in a closure variable, but a
  condition is built once and reused: by `AgentClient` (`stopWhen` config, every turn), by the exported
  `DEFAULT_STOP_CONDITIONS`, and by concurrent runs. Two failing steps at the end of one turn made the *first* failing
  step of the next turn stop the run (`runAgent` ended with `finishReason: "stop"` before the model could try
  anything else); two interleaved runs summed their failures. `stop.ts` had no tests.
* Fix: the streak is kept per run. `StopContext` gains an optional `runId` (additive), which `runAgent` supplies.
  Without one (a caller evaluating conditions by hand) a step number that does not advance marks a new run. Entries are
  deleted on reset and on stop, and bounded (256) for runs that end mid-streak.
* Tests: `runtime/stop.test.ts` (8): every built-in predicate, streak reset, per-run isolation, interleaved runs, the
  shared default set reused across runs, no unbounded growth. Four fail on the old code.

### Round 4 — tool calls honour cancellation and timeouts (`core/runtime/execute-tools.ts`)

* Audit: `executeToolCall`. Three defects around the same seam:
  1. **Stop did not stop.** The run's `AbortSignal` was only handed to the tool. A tool that never looks at it (a plain
     `await fetch(url)`) kept the whole run, and so the UI's Stop, waiting until it finished by itself. Worse, a
     `requestCard` the host never answers (user closed the tab on a confirm dialog) held the run open forever.
  2. **A timed-out tool was abandoned but not told.** `withTimeout` raced a timer and walked away; the tool's signal
     stayed un-aborted, so a cooperative tool kept spending after the run had already reported a timeout.
  3. The timeout timer was never cleared, so every finished call kept a live timer for `toolTimeoutMs`.
* Fix: each call gets a private `AbortSignal` (aborted by the run's signal *or* by the call's timeout) and a race
  against both. A cancelled run now ends the call immediately with the existing `denied` outcome, a timeout reports
  `execution-error` as before and also aborts the tool's signal, and the timer and the listener on the run's signal
  are released on every exit. A call for a run that is already cancelled is not started. `ToolExecutionContext.signal`
  is now always defined (it was optional); callers that read it keep working.
* Tests: six new in `execute-tools.test.ts`; all six fail on the old code.

### Round 5 — Anthropic streaming and usage (`core/providers/anthropic`)

* Audit: SSE dialect translation, stop reasons, usage mapping, error events.
* **Defect (safety):** when the body ended without `message_stop` (a proxy or load balancer cut the stream), the
  adapter closed every in-flight tool call by *repairing* its half-written arguments into valid JSON and reported a
  normal finish. The run then executed the tool with input the model never finished (`{"path":"/data/arch` became
  `{"path":"/data/arch"}`). Now such a stream is an `AgentError("network")` event: no `tool-call-end` is emitted for
  unfinished calls and nothing is reported as finished. A stream that did receive a `stop_reason` and only lost the
  final frame still closes out normally.
* **Defect:** the in-stream `error` event (`overloaded_error`, `rate_limit_error`, …) was turned into a bare `Error`, so
  the run saw `kind: "unknown"` (not retryable, wrong metering status). It is now typed like the equivalent HTTP status.
* **Gap:** cache *writes* (`cache_creation_input_tokens`) were dropped, so a host could not price them. Added
  `Usage.cacheCreationInputTokens` (optional, additive) and mapped it.
* **Recorded, not changed (needs a decision):** `Usage.inputTokens` means different things per provider. OpenAI and
  Super Router report it *including* cache hits; Anthropic reports it *excluding* cache reads and writes. A host that
  computes `inputTokens - cachedInputTokens` is therefore wrong for Anthropic. Making Anthropic inclusive would change
  numbers hosts already meter on, so it is only documented on `Usage` for now. Compatible alternative if wanted: an
  opt-in `inclusiveInput` flag on the Anthropic provider config.
* Refactor: `runAgent` and the event reducer each carried their own copy of "add two usages" (both missed new fields
  the same way). One exported `addUsage` in `content/parts.ts` now serves both.
* Tests: five stream/usage tests in `anthropic.test.ts` (three fail on the old code), `content/usage.test.ts`.

## 2026-11-08 — iteration 2

Started from iteration 1's open items.

### Findings

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| 1 | **Links were rewritten when the URL contained Markdown punctuation.** The emphasis rules ran over the whole string before links were extracted, so `[x](https://e.com/a*b*c)` rendered `href="https://e.com/a<em>b</em>c"`: the link pointed at a different URL than the text said. Same for `**`, `~~` and backticks in a URL. | Reproduced by rendering each input and reading the HTML. | Medium (silently wrong destination) |
| 2 | **A URL with balanced parentheses was cut at the first `)`.** `[a](https://en.wikipedia.org/wiki/Foo_(bar))` gave a link to `…/Foo_(bar` and a stray `)`. Common in citations. | Same. | Medium (broken, very common link shape) |
| 3 | NUL was stripped from prose but not from code blocks or the plain-prose shortcut, so a raw U+0000 could reach the output. NUL is also the renderer's placeholder character. | Found by the fuzz test below. | Low (browsers drop it; inconsistent) |
| 4 | No automated guard for the layering that iteration 1 verified by hand, and nothing ran build, typecheck or tests together. | `.github/workflows` held only publish and pages. | Medium (regressions land unnoticed) |

### Security review of the HTML path (no defect found)

Five `dangerouslySetInnerHTML` / `innerHTML` sinks in `react-ui` are fed by `renderMarkdown`,
`renderMarkdownStream` and `renderMarkdownWithAnchors`. Reading the renderer and then probing it with
hostile input: `javascript:`, `data:`, `vbscript:` and protocol-relative links never become links; a
quote cannot close `href`; `<script>` and `<img onerror>` are escaped. A fuzz test now asserts this for
6,000 generated documents (see below). The pill in `AgentInput` escapes its only interpolated value.

### Changes

* `ui-core` Markdown: links are lifted out before emphasis (so the destination is never rewritten, and
  a code span inside a URL stays literal), the destination may hold one level of balanced
  parentheses, and `escapeHtml` drops NUL for every path. Output for ordinary documents is unchanged:
  all 59 pre-existing Markdown tests pass untouched, including streaming-equals-batch.
* `ui-core/src/markdown-safety.test.ts`: named regression tests for both link bugs and for the hostile
  cases, plus a seeded fuzz test. The fuzz test tokenizes the HTML and asserts: only allow-listed tags
  and attributes, double-quoted values with no markup in them, every `href` is `http(s)://`, no raw
  `>` `"` or NUL in text. It asserts it reaches links, tables, code, lists, quotes and headings (>60
  documents each), because a fuzz test that never reaches a construct proves nothing about it (the
  first version reached links in only 29 of 6,000 and tables in none; the generator was fixed). A
  self-test checks the checker rejects each kind of violation. Without the fix, 7 of these tests fail.
* `scripts/check-architecture.mjs` (`pnpm check:architecture`): strict layering table, no cycles,
  framework-free packages cannot depend on a UI framework, and public packages must declare
  `sideEffects`, a types-first `exports` map, `files` and a licence. A new public package must be
  given a layer on purpose. Each rule was mutation-tested (an upward dependency, a React dependency in
  `core`, a missing `sideEffects` each fail the check).
* `pnpm verify` runs the whole gate locally: `check:architecture`, build, typecheck and test. There is
  deliberately no hosted CI workflow (the maintainers do not use hosted CI), so this is the gate to run
  before pushing.

### Validation

The whole gate (`pnpm verify`) was run locally from a locked install: architecture check passes, build and typecheck
report no errors, 55 test files / 690 tests pass (iteration 1: 54 / 670).

### Not verified / remaining opportunities

* Nothing enforces `pnpm verify` before a push; it relies on being run. A local pre-push hook is the
  option if that proves unreliable.
* The Markdown renderer is still a deliberately small subset (no reference links, no raw HTML, no
  underscore emphasis). Whether to adopt a maintained parser plus sanitizer is a product decision.
* Accessibility of `react-ui` and its visual-token/theme architecture remain unaudited; benchmarks of
  the streaming render path remain unmeasured.
* The Go and Python backends added on `main` were still not reviewed.

## 2026-11-07 — iteration 1

### Findings

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| 1 | The proxy allowlist was matched against a path that is not the one requested. The upstream URL is built with `new URL(base + path)`, which resolves `%2e%2e`, treats `\` as `/`, starts a query at `?`, and strips control characters. | With `allowPaths: ["/responses/*"]`, `/responses/%2e%2e` was forwarded to the provider root `/v1/` and `/responses/x?admin=1` reached upstream with an injected query. Reproduced against the unmodified handler. | **High**: a browser client could reach endpoints the operator had not opened, while the server held the provider key |
| 2 | No public package declared `sideEffects`, so bundlers could not assume tree-shaking is safe. | `package.json` audit of all 9 public packages. | Medium (consumer bundle size) |
| 3 | `docs/NPM-PUBLISHING.md` described a three-package release; the workflow it documents checks and publishes nine, in a fixed order. | Compared the doc with `.github/workflows/npm-publish.yml`. | Low (a maintainer following the doc would misconfigure npm Trusted Publishing) |

### Checked and found sound

* **Layering.** The package graph has no cycles and flows `core` ← `client` / `ui-core` / `server` / `router`
  ← `react` ← `ui` ← `plugin`. `super-protocol` has no dependencies. (Script over every
  `package.json`; not an import-level analysis.)
* **Import-time purity.** All nine built packages import in plain Node without adding a global or
  changing `Object.prototype`. Only `super-chat-ui` ships CSS, as an explicit `./styles.css` export.

### Changes

* `@supersolutions/super-chat-server`: `normalizePath` now refuses a backslash, `?`, `#`, control
  characters, an encoded `/` or `\`, and percent-encoded `.` / `..` segments (403). Names that merely
  look unusual (`resp%20id`, `100%25`, `a.b`, `...`, `%2e%2e%2e`) still pass. Public API unchanged; only
  hostile paths behave differently. Ten regression tests fail without the change; one asserts the
  legitimate names are unaffected.
* `sideEffects: false` on eight packages and `["**/*.css"]` on `super-chat-ui`, justified by the
  import-time check above.
* `docs/NPM-PUBLISHING.md` corrected to the nine packages and the real order.

### Validation

`pnpm build`, `pnpm typecheck` and `pnpm vitest run` (54 files, 670 tests) pass after the changes.

### Not verified / remaining opportunities

* The Go and Python backends added on `main` were not reviewed in this iteration.
* Framework adapters for the Node server (Express, Fastify) were prototyped and then dropped; the
  proxy handler is still fetch-style only. Worth revisiting as a shared package.
* No benchmarks were run. Candidate hot paths: the proxy handler's per-request allowlist matching
  (it already precompiles patterns) and `react` rerender behaviour under streaming.
* Accessibility of `super-chat-ui` and the visual-theme/token architecture were not audited.
* `engines` is unset on every package; whether to pin one for the Node-only server is undecided.
* The `.github/workflows` build has no test job (only publish and pages); adding a PR check is the
  highest-leverage CI change.

## Rounds of 15 (audit, fix, local gate, push)

### Round 3 (2026-11-08) — citation links

* Audit: every `dangerouslySetInnerHTML`, `href` and `src` sink in the React bindings. Markdown
  links were already http(s)-only; image and audio `src` cannot run script. The citations card
  (`cards/General.tsx`) put the model-supplied `item.url` straight into `<a href>`. React 19 refuses
  a `javascript:` href, but the peer range includes React 18, which only warns and then navigates.
* Fix: `safeHref()` in `ui-core` (http(s) only, control characters rejected so `java\tscript:` cannot
  slip past); the card renders plain text for any URL it rejects. Exported from `ui-core`.
* Tests: `safe-href.test.ts` (accepts web links, rejects eleven hostile or malformed inputs).
* Gate: `pnpm verify` (architecture check, build, typecheck, 693 tests) passes.

### Round 7 (2026-11-08) — a send cannot cross threads

* Audit: `AgentClient` (send, regenerate, edit, thread switching). `send()` awaits the quote-drift lookup
  before it appends the user message, and nothing checked that the thread was still the one the user typed
  into: `newThread()` or `openThread()` during that await put the message, and a whole run, into the other
  thread.
* Fix: `send()` captures `generation` before the await and returns without appending if it moved.
* Test: `drops a quoted send when the thread changed during the drift lookup` (fails without the fix).
* Gate: `pnpm verify` (architecture check, build, typecheck, 694 tests) passes.

### Round 9 (2026-11-08) — the proxy envelope is bounded and validated

* Audit: `createProxyHandler`. Path allowlisting and credential handling hold up. Two gaps before any
  check: `request.json()` buffered a body of any size, and `authorize` runs only after parsing, so an
  unauthenticated caller could make the server buffer it; and a JSON body that parsed but was not an
  envelope (`null`, a number, a missing provider, path or method) threw further down instead of a 400.
* Fix: the body is read as a stream and cut off (stream cancelled) at `maxBodyBytes` (default 64 MiB, room
  for base64 file parts; 413); the envelope shape is checked up front (400).
* Tests: three, in `server.test.ts` (bad shapes, size limit before `authorize`, a body with no declared
  length that never ends).
* Gate: `pnpm verify` passes.

### Round 14 (2026-11-08) — MCP tool listing cannot loop

* Audit: the MCP client (`tools/list` pagination, SSE framing, session handling) and the tool registry.
  Prototype-named keys are already handled where they matter (`partial-json`, the card registry). One real
  loop: `listTools()` followed `nextCursor` until it was empty, so a server that kept returning the same
  cursor made the client loop and grow its tool list without end. A `tools` value that was not an array also
  threw a `TypeError` from the spread.
* Fix: a repeated cursor, or more than 1000 pages, ends the call with an `McpRpcError`; a non-array `tools`
  counts as an empty page.
* Tests: two in `mcp/client.test.ts` (the first would not terminate against the old code, so it was not run
  against it).
* Gate: `pnpm verify` passes.
