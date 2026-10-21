# Changelog

## Unreleased

### Fixed

- **core:** `undoDocument` walks back instead of ping-ponging. Every undo
  restored the body from before the last write, and after an undo that is the
  text just undone, so the second undo was a redo. An undo now records the
  revision it restored as `restoredFrom` on the new snapshot, and the next one
  steps back from there. It still mints a new revision. A new `toRevision`
  input restores one exact stored revision, and the result says whether
  `canUndoFurther`. `DocumentStore.update` takes an optional
  `{ restoredFrom }`: both reference stores persist it and drop it on any
  other write. A custom store has to do the same, or the second undo walks
  forward again.
- **core:** `editDocument` re-reads the document after the user answers the
  review instead of applying the accepted hunks to the body it read before.
  If the document moved while the review was open, nothing is written and the
  model gets `{ reason: "stale-revision", revision }`. A store revision
  conflict on the write now returns that same refusal; other store errors are
  still thrown. A proposal that is already behind now carries
  `reason: "stale-revision"` too.
- **core, react:** A document quote's revision is now compared. `quoteDrift`
  and `checkQuoteDrift` report a quote whose document has moved past it (with
  whether the quoted text is still there) or been removed. With
  `AgentClientConfig.documentStore` set, `send()` stamps that drift at send
  time: as a note in the message text for the model, and as
  `DocumentQuoteRef.drift` on the message metadata for the UI. A failed lookup
  leaves the quote unstamped and does not block the send. The playground run
  page passes its document store.

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
