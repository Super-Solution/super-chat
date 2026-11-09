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

### Round 6 — OpenAI streaming has the same cut-off hazard (`core/providers/openai`)

* Audit: both OpenAI dialects (Responses, Chat Completions — the latter being the path for every OpenAI-compatible
  server) against the rule round 5 established: *a tool call is run only if the model finished writing its arguments*.
* Defects, all reproduced against the old code:
  * **Chat stream cut with no `finish_reason` and no `[DONE]`:** pending calls were repaired into valid JSON, executed,
    and the turn finished as a normal `stop`/`tool-calls`.
  * **Chat `finish_reason: "length"` (output cap) mid-arguments:** same, in the stream and in the non-streamed
    `partsFromChat`.
  * **Responses `response.incomplete`** (cap or filter) with a call still being written, and the non-streamed
    `partsFromResponses`: same.
  * **Responses `response.failed`:** the sync path throws the response's `error`, the stream path emitted a quiet
    `finish: "error"` with no `error` event, so the user saw an empty turn with no reason. Now a typed `AgentError`
    (`rate_limit_*` → rate-limit, `server_error` → overloaded, `invalid_*` → invalid-request, …).
  * **Responses body with no terminal event:** returned silently, no finish, no error.
* Fix: truncated bodies are `AgentError("network")` (retryable) events; a call is dropped when its arguments needed
  repair *and* the response was cut off (output cap / filter). A call whose arguments are complete JSON is still run
  even then, and a *completed* Responses object still supplies calls that only lost their `.done` frame. A server that
  sends `[DONE]` without a `finish_reason` is still tolerated. `parseSSEJson` gained an optional `onDone` callback so the
  adapter can tell "the server said it finished" from "the body ended".
* Tests: nine in `openai/stream.test.ts`; six fail on the old code.

### Round 7 — `AgentClient` races on thread switches (`client/src/client.ts`)

* Audit: send / regenerate / edit / stop / thread switching / job resume, looking for state that outlives the run that
  set it.
* **Defect — Stop stops working after a quick switch.** `run()` ended with `this.controller = null`. A run superseded by
  `newThread()` or `openThread()` unwinds asynchronously, so a `send()` on the new thread had already stored *its*
  controller by then; the old run's `finally` wiped it, and `stop()` became a silent no-op for the new run (it
  could not be cancelled until it finished). Each run now clears only the controller it created.
* **Defect — the wrong thread opens.** `openThread()` awaited `store.load()` and applied whatever came back last, so
  clicking thread A (slow load) then thread B (fast load) ended on A. Loads now carry a ticket; a superseded load
  returns `false` without touching state, and `newThread()` also invalidates a load still in flight.
* Tests: two in `client.test.ts` (an abort-aware transport proves B really was aborted; an out-of-order store).
  Both fail on the old code.

### Round 8 — thread saves can no longer land out of order (`client/src/client.ts`)

* Audit: `persist()`. Every call started its own async save: `load()` (to recover `createdAt` and the title), then
  `save()`. The user turn and the assistant turn are saved a few milliseconds apart, and the first call of a new thread
  has no cached meta, so its `load()` is the slow one. Whenever the first load outlived the second call, the user-only
  snapshot was written *after* the one with the answer, and the next reload showed a thread without it. (Reproduced
  with a store whose first `load` takes 40 ms: the last write was the 1-message snapshot.)
* Fix: saves go through a single writer. The state is captured synchronously at the `persist()` call (a thread switch
  right after still saves the thread being left), a newer snapshot of the same thread replaces one still waiting, and
  `threadMeta` is only trusted for its own thread id. Fire-and-forget posture unchanged: a failed save is swallowed.
* Tests: `persistence ordering` (2). The first fails on the old code; the second guards the switch-after-save case.

### Round 9 — proxy hooks and forwarded headers (`backends/typescript/server`)

* Audit: the rest of `createProxyHandler` (round 9 of the earlier pass covered the request body and envelope).
* **Defect:** `onRequest` ("observe every forwarded call: metering, audit log") was awaited bare. A hook that threw
  (a down audit DB) failed the whole call after the upstream had already answered, and for a stream left the upstream
  body unread. It is still awaited (serverless hosts need the write flushed) but can no longer fail the request.
* **Defect:** an `authorize` that threw escaped the handler, so the framework answered with its own error page, which
  can carry the exception text (a connection string, a stack). It now fails closed with a fixed 500 message.
* **Gap:** the envelope's client-chosen headers were filtered only against `authorization`, `x-api-key`, `cookie`, `host`
  and the body framing headers. A browser could still send `api-key` / `x-goog-api-key` (pick its own credential for a
  provider that accepts them), hop-by-hop headers (`transfer-encoding`, `connection`, `upgrade`, `te`, `expect`) and
  `x-forwarded-for` / `x-real-ip` / `forwarded` (tell the upstream's rate limiter or audit log it is someone else).
  All stripped now; ordinary upstream headers (org ids, beta flags, MCP session) still pass.
* Tests: four in `server.test.ts`, all failing on the old code.
* Not changed: a bare allowlist entry still matches every method (documented), and a failed upstream fetch still
  returns the fetch error's text in the 502 body, which helps debugging but can name an internal host; a host that
  cares can wrap the handler. Worth deciding whether that message should be generic by default.

### Round 10 — React bindings and job resume (`bindings/react`, `client`)

* Audit: every hook in `bindings/react/src/hooks.tsx` for subscription granularity, stale closures, effect
  dependencies and SSR. The store-selector design holds up (`useAgentState` with an equality function, per-tree branch
  index, rAF-coalesced `useStreamingText`, a ref-backed `useAppState`); `subscribe` only runs on the client, so no
  `window` access leaks into server rendering. Two real problems:
* **Defect — duplicate answers.** `useJobs()` calls `resumeBackgroundJobs()` once per hook instance. Mounted in more
  than one place (a badge and a panel), each call listed the same stored jobs, polled them, and appended each finished
  answer to the thread, so it showed up once per mount. `resumeBackgroundJobs()` is now single-flight: concurrent
  callers share one run, and the guard is released when it settles. (Two browser tabs can still both resume a job;
  that needs a cross-tab lock the stores do not offer.)
* **Defect — stale thread list.** `useThreadList` refreshes on a thread switch and on a status change, so two
  `store.list()` calls can be in flight; the older one answering last overwrote the newer list (a freshly created
  thread missing from the picker). A small `createLatestGate` orders them: only the latest request applies.
* Tests: the concurrent-resume test fails on the old code. The gate has a unit test only; the wiring inside
  `useThreadList` is not covered because the package has no DOM test renderer (the existing hook tests drive React's
  dispatcher by hand and only implement the hooks `useBranches` reaches). Adding one is a candidate for a later round.

### Round 11 — composer accessibility (`bindings/react-ui`)

* Audit: every `<button>`, `<input>`, `<textarea>`, `<select>`, `<img>`, live region and dialog in `react-ui`. Most of it
  is already careful (all icon buttons have names, errors use `role="alert"`, the status line is `aria-live`, the document
  dialog closes on Escape, IME composition is respected). The composer, the one control every user reaches, had four gaps:
  1. **The message field had no accessible name** — only a placeholder, which is not a name and is empty if the host
     sets `placeholder=""`. Now `aria-label="Message"`.
  2. **File attach was unreachable by keyboard.** It was a `<label>` around a `display:none` file input; neither is
     focusable. It is now a real `<button>` that opens the picker (the input stays hidden, out of the tab order and
     the accessibility tree).
  3. **The `/` skills and `@` tools menu was invisible to a screen reader.** Arrow keys moved a highlight that nothing
     announced, the listbox owned `<li>` wrappers instead of options, and the options had no ids. The listbox now
     owns only options (`<li role="presentation">`), options have ids and stay out of the tab order, and while the menu
     is open the textarea carries `aria-controls` and `aria-activedescendant` (plus `aria-autocomplete="list"`). No
     dangling reference when it is closed. (`role="combobox"` is not valid on a `<textarea>`, so it is not used.)
  4. The inline "edit message" textarea had no name; now `aria-label="Edit message"`.
* Tests: `a11y.test.tsx` (4) renders the composer and the menu to static markup and asserts names, roles, ids and the
  absence of dangling references. All four fail on the old code.
* Not verified: behaviour with a real screen reader and focus order in a browser. The Playwright suite (not part of
  `pnpm verify`) selects the composer by class, so it is unaffected by these changes, but it was not run here.

### Round 12 — Go and Python ports vs the reference (`backends/go`, `backends/python`, `conformance`)

* Audit method: a **differential fuzz** against the TypeScript reference, since the committed conformance data can only
  catch what its author thought of. 12,000 random SSE streams (random chunking, LF/CRLF/CR mixes, multi-byte text,
  odd field names, tiny frame limits) and 27,000 mutated plugin-manifest / editor-card / chart-card values (types
  swapped, keys deleted, arrays spliced, 40 awkward values: `1e21`, `-0`, NUL, lookalike URLs, 300-char strings…) were run
  through the reference, Go and Python and compared. The harness was throwaway (not committed).
* **Defect (both ports):** a UTF-8 byte order mark at the start of a stream. The reference's `TextDecoder` drops it
  (SSE does too); Go and Python kept `U+FEFF`, so the first line read `﻿data: …`, did not match `data:`, and **the
  first frame was silently lost** (a BOM also counted toward the frame-size limit). Found by the fuzz in 3 of 4,000 cases
  per seed. Fixed in both (Python: the `utf-8-sig` incremental decoder; Go: strip a leading mark from the first decoded
  text, which also covers a mark split across chunks). A `U+FEFF` anywhere else is still ordinary text, as in the reference.
* The conformance data now pins it: `export-conformance.mjs` appends 28 BOM cases (every split position, a second BOM,
  a mid-stream BOM, BOM-only, BOM against the frame limit). They are added after the existing generators, so the
  committed file only grows; 12 Python tests and the Go SSE test fail without the fix.
* Result: after the fix, 0 differences in 36,000 SSE cases (3 further seeds) and 0 in the 27,000 validator cases, so the
  validators were left alone.
* DX: `pnpm test:backends` runs both ports (skipping, loudly, a missing toolchain; `--require` makes a skip fail). It is
  not part of `pnpm verify`, which keeps needing only Node.
* Not changed (performance, noted): the Python parser re-measures the whole pending buffer in UTF-16 units and re-scans
  it from the start on every `feed()`, so one very long frame is quadratic; Go already avoids the re-scan. Worth a
  benchmark before changing, since the default limit (2 MB) bounds it.

### Round 13 — MCP time budgets, and a measurement (`core/mcp/client.ts`, `ui-core`)

* Measurement first (the streaming render path was listed as unmeasured). `renderMarkdownStream` fed 40 characters per
  frame, per frame: 60 KB of ordinary paragraphs 1.7 ms worst, a 40 KB single paragraph 0.2 ms, a 40 KB open code fence
  1.2 ms, a 3,000-row list 9.8 ms (5.6 s over all frames), a 1,500-row table 6.4 ms (2.2 s). The settled-block cache works;
  only a single enormous list or table is quadratic, and its worst frame stays under one 60 fps frame while the UI
  already throttles to one render per frame. No change made.
* Audit: the MCP client. Every JSON-RPC call, `tools/call` included, was bound to a fixed 30 s `AbortSignal.timeout`
  that also covers reading the response stream. Two consequences: **no MCP tool could run longer than 30 s**, and **a
  person taking longer than 30 s to answer an elicitation form** (the server asked mid-call, the client waits for the
  user) aborted the call, so the form they were filling in was thrown away.
* Fix: `initialize` / `tools/list` keep the 30 s budget (`timeoutMs`, now configurable). `tools/call` gets its own
  (`callTimeoutMs`, default 120 s; the run-level `toolTimeoutMs` still applies on top). The call's deadline is
  pausable: the clock stops while the client waits for the user's elicitation answer and resumes with what was left. A
  timeout is an `AgentError("timeout")` (it used to be a bare `TimeoutError` DOMException).
* Tests: four in `mcp/client.test.ts` using fake timers (budgets, hung call, elicitation pause). Two fail on the old
  code (the hung-call and listing-budget tests); the other two guard the new behaviour but cannot distinguish it
  from the old one, because `AbortSignal.timeout` is not driven by fake timers. The old 30 s ceiling is evident in the
  code, and was not reproduced against a real 30 s wait.

### Round 14 — the Super Router provider ends a bad stream silently (`integrations/router`, `protocol/router.ts`)

* Audit first: `repairJson` / `partial-json` (the tool-argument repair path). No defect found; recorded as verified.
* Audit: the Super Router provider. Three defects, all in `provider.ts`:
  1. A `request.failed` event was turned into `finish: "error"` with **no message**, so a failed router request
     (quota, upstream error) ended as an empty assistant turn.
  2. A stream that ended without any terminal event (`request.completed` / `failed` / `replayed`) ended quietly as if
     finished. A cut connection looked like a short answer, and a half-written tool call could be treated as complete.
  3. `generate()` could not be cancelled: the abort signal never reached `gateway.infer`.
* Fix: a failure with `execution_status: "cancelled"` finishes as `cancelled`; any other failure yields an `error`
  event carrying the router's error code and request id; a stream without a terminal event throws a retryable
  `AgentError("network")`. `InferenceGateway.infer` takes an optional `signal` (compatible: existing gateways ignore it),
  and the default gateway passes it to `fetch`.
* Tests in `router.test.ts`: the failed-request test now asserts the error and its code; new tests for a cut stream, a
  cancelled failure, and the signal reaching `infer` (provider `generate` and the HTTP gateway's `fetch`).

### Round 15 — the Python SSE parser was quadratic (`backends/python`)

* Measurement: `SSEParser` recounted the UTF-16 length of the whole pending buffer and rescanned it for a blank line on
  every chunk, and sliced the buffer once per frame. A 1.9 MB frame arriving in 1 KB chunks took **15.6 s**; 50,000 frames in
  one chunk took 2.6 s. (The Go port already tracks the length incrementally and keeps a scan offset; the TypeScript
  reference rescans, but V8 makes that cheap.)
* Fix: the length is kept as text is added and removed, the search resumes at the last three characters (the only place an
  unfinished frame end can start), and consumed frames are cut off the buffer once per drain. Same results: 20,000 random
  inputs with random chunking and random limits gave identical frames and errors against the old parser. Now 0.19 s and 0.10 s.
* Tests: `tests/test_sse_scaling.py` (a long frame in small chunks, many frames in one chunk — both fail on the old code —
  and chunking never changes the frames). The timing budget is 3 s, generous on purpose; a very slow machine could still flake.
* Not done: the Go and Python suites are not part of `pnpm verify` (use `pnpm test:backends`).

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
