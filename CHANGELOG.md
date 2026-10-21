# Changelog

## Unreleased

### Added

- **Cards render while the model is still writing them.** A `visualize` card
  used to appear only after the whole tool-call JSON had arrived; a table
  now fills row by row (cell by cell) as its arguments stream, in stream mode,
  for all three wire dialects (OpenAI Responses, Chat Completions, Anthropic).
  - **core:** new run event `tool-call-input-delta { callId, name,
    partialInput, partialCard?, loading? }`, sent while a call's arguments
    stream and before its `tool-call`. `tool-call` stays the authoritative,
    repaired input, and only the tool's `execute` validates and emits a real
    `card`. `RunState.partialTools` holds the latest delta per call until its
    `tool-result`, and empties on `run-finish` or a fatal error.
  - **core:** `PartialJsonParser` / `parsePartialJson` — a tolerant,
    incremental JSON reader with no dependency. Each character is read once;
    finished objects are shared between snapshots. An open string value shows
    what has arrived; an open key, an unterminated number or literal, a
    half-received escape and a lone high surrogate never show. Malformed input
    freezes the preview rather than guessing.
  - **core:** `CardKindDefinition.partial` derives a renderable spec from an
    incomplete one, and `CardRegistry.partial()` is the gate: it refuses
    unknown kinds, interactive kinds (even if they define `partial`), and any
    preview the kind's own validator rejects. `table`, `stats`, `checklist`,
    `timeline` and `markdown` opt in; every other kind keeps its skeleton.
    `ToolDefinition.partialCard` lets a tool whose arguments ARE a card offer
    a preview; `visualize` routes it through the registry.
  - **react:** `usePartialTools()`. Previews are live-only: `AgentClient`
    never commits them, and clears any left by a run that died mid-stream.
  - **ui:** `LiveTurn` gives a streaming call its output slot as soon as its
    arguments start, and the preview holds that slot until the validated card
    replaces it. Renderers get `partial`: copy/download, column sorting and
    the checklist tally wait for the whole card. `CardRenderer` refuses a
    partial spec for any interactive kind and never passes `respond` with one.
    Fixed with it: the per-frame throttle behind streamed text left a
    cancelled frame id behind on unmount, so under StrictMode a component
    that mounted mid-stream froze on its first value.
  - **playground:** the demo transport streams tool arguments in fragments;
    "Streaming — table" on `/run` shows a shortlist filling in.
  - **ui (dev):** `react-dom` is a devDependency, for render tests.

### Performance

Timings are bun medians on a desktop shared with other jobs. Absolute times
moved by as much as 3.5x between runs; every speedup reproduced.

- **ui:** `DiffCardView` finds its line diff with a bounded Myers search
  instead of filling an n × m table. Two 2000-line texts with 5% of lines
  changed: 30 ms → 0.38 ms and 34 MB → 1.5 MB peak; two unrelated 2000-line
  texts: 20 ms → 0.8 ms. Where the search gives up (a reordered file), the
  old table walk runs over only the lines both sides share: a shuffled
  2000-line file, 27 ms → 11 ms and 34 MB → 15 MB. The rows are the same as
  before for every input.
- **ui:** `LiveTurn` no longer re-renders the whole answer's markdown every
  frame while it streams: blocks later text can no longer change are kept
  from earlier frames, and only the open tail is rendered again. An 80 KB
  answer: 9.9 ms → 0.06 ms per frame, 5.2 s → 0.13 s over a 1200-frame
  stream. The HTML is identical to rendering the whole text; the browser's
  own DOM update per frame is unchanged.

- **react:** `useBranches` reads each message's sibling position from one
  index per tree, shared by every `BranchNav`, instead of scanning the whole
  tree once per message on every store notify. Per streamed token, with a
  `BranchNav` on each message of the active path: 337-message thread
  8–46 ms -> 0.01–0.07 ms; 2,000 messages 0.4–0.9 s -> 0.13–0.3 ms. A notify
  that brings a new tree builds the index once (0.06–0.5 ms at 337). Positions
  and counts are unchanged for every change `AgentClient` makes. The index is
  keyed by the `tree` array, so `ThreadState.tree` must be replaced, never
  mutated in place: a host that edits the array, or a message's `id` or
  `parentId`, through `client.store` sees stale branch positions until the
  next replacement.

- **core:** `applyEdits` splices every edit into the document in one pass.
  It used to re-slice the rewritten document once per edit, so the cost grew
  with edits × length: on a 1 MB document, 200 block-scoped edits went from
  176 ms to 20 ms and 1,000 from 579 ms to 28 ms. Results are the same for any
  edit whose `find` is a string.
- **core:** `searchBlocks` splits the document once instead of twice and builds
  outline entries only for the blocks that match: 65 ms to 40 ms on a 2 MB
  document. Results are unchanged.
- **core:** `repairToolArguments` no longer rebuilds malformed arguments a
  character at a time, builds each repair only once the one before it has
  failed, and skips parses that cannot succeed: 1 MB of `createDocument`
  arguments with a trailing comma went from 410 ms to 7 ms. A long run of
  whitespace anywhere in the arguments, raw newlines included, no longer makes
  the closing-fence check quadratic (40,000 spaces: 0.7 s to 0.14 ms; 40,000
  newlines: 0.8 s to 1.8 ms). Results are unchanged.
- **core:** `parseSSE` and `parseSSEJson` no longer rescan a partial line each
  time a chunk arrives, so a long line costs time linear in its length. A 5 MB
  `data:` line (a base64 image) in 16 KB chunks: 3.3 s → 26 ms on Bun,
  2.4 s → 17 ms on Node. Events, the reads they follow and errors are
  unchanged.
- **core:** `bytesToBase64` and `base64ToBytes` hand the work to the platform
  codec (`Uint8Array` `toBase64` / `fromBase64` where the runtime has them,
  else `btoa` / `atob`) instead of a per-byte loop. 20 MB encode: 325 ms →
  7 ms on Bun, 1 s → 82 ms on Node; decode: 42 ms → 8 ms on Bun, 132 ms →
  43 ms on Node. Output and error messages are unchanged, including for input
  that is not a `Uint8Array`.

## 0.3.0

### Changed

- **core:** When a step runs tools in parallel, `runAgent` now sends each
  `tool-result` as soon as its tool finishes, in completion order. Before this,
  every result in the step was held until the slowest tool finished. Match
  results to calls by `callId`, not by position.
- **core:** The `role: "tool"` message written back to history still keeps
  call order. `confirm` tools still run one at a time after the parallel ones.
- **core:** `executeToolCalls` accepts `onOutcome`, called once per call as it
  settles, including failures and timeouts. The returned array stays in call
  order.
- **core:** A tool that has already timed out can no longer emit cards or ask
  the user a question. Anything it surfaced would have arrived after its own
  result.
- **react:** `AgentClient` commits a turn's tool results in call order, while
  live run state still shows them as they finish.
