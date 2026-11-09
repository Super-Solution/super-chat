# Engineering scorecard

Self-assessed 1–10 per dimension for the whole repository. A score moves only when a round produced
evidence for it (a fixed defect with a failing-then-passing test, a new gate, a measurement); the evidence
is in [`improvement-log.md`](improvement-log.md). These are judgements, not measurements: use them to see
where the next round should go, not to compare with other projects.

| Dimension | Start | Now | Last moved by |
| --- | --- | --- | --- |
| Correctness | 7 | 8 | rounds 1–14: about thirty defects fixed, each with a test that fails on the old code (the exceptions are listed in the log) |
| Performance | 6 | 7 | round 13 (streaming render measured, no change needed), round 15 (Python SSE 15 s → 0.2 s) |
| Simplicity | 7 | 7 | — |
| Extensibility | 7 | 7 | round 2 (`onJobHandle`), round 3 (`StopContext.runId`): small additions, no new extension point |
| Composability | 7 | 7 | — |
| Customizability | 7 | 7 | round 13 (`timeoutMs`, `callTimeoutMs`) |
| Consistency | 7 | 8 | rounds 5, 6, 14: the Anthropic, OpenAI and Super Router providers now treat a cut or failed stream the same way |
| Developer experience | 7 | 7 | round 12 (`pnpm test:backends`); no change to docs or onboarding |
| Reliability | 7 | 8 | rounds 1, 4, 5, 6, 8, 13, 14: cancellation, truncated streams, save ordering and time budgets |
| Maintainability | 7 | 7 | — |

Not moved, and why: Simplicity, Composability, Maintainability and Developer experience had no round aimed at them.

Still unmeasured or unverified: bundle size; real-browser rendering and a real screen reader (accessibility was checked on
static markup only, never in Playwright); the Go and Python backends run only under `pnpm test:backends`, outside `pnpm verify`;
there is no hosted CI to run any of this.
