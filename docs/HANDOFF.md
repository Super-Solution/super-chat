# Handoff

## Release and downstream checkpoint (2026-09-28)

The tracked manifests prepare **0.3.1**, an unpublished candidate. Public npm
latest remains **0.3.0** for core, react and ui (registry checked 2026-09-28).
The candidate contains the performance changes merged through upstream
`21630da7044bdef19332372248f1fd8d7ba4a3e1` plus ESM export resolver fallbacks.
`default` points to the same ESM file as `import`; this does not provide CommonJS
execution support. Keep `types` first and `default` last in condition maps.

Full Repo already consumes exact npm 0.3.0 versions in Web, Mobile and Agent
Service. Its `1e711aca6` migration removed the vendor copy; it is downstream
adoption, not a second authoritative core implementation. Wallet transaction
cards and animations belong to Full Repo's `@workspace/transaction-ui` package
and must not be copied into this generic framework merely to regain parity.
Mobile retains two Jest entry mappers for the published 0.3.0 exports. Do not
remove those or update any consumer pin until a reviewed package version is
actually available from npm and the consumer's regressions pass.

Open PR #4 owns the quote-only composer fix (`packages/ui/src/Thread.tsx` and
`Thread.test.ts`). It is separate from this release-parity candidate and remains
a known mouse/touch composer bug until reviewed and merged. Recheck it and the
latest upstream source before publication. Source review, local test success,
package publication, consumer adoption and deployment are separate checkpoints.
This lane has not published, merged or deployed anything. Its contract and
review handoff are tracked in upstream Issue #9.

Written 2026-08-04, at the end of the session that built this. For whoever picks
it up next — probably a future me with no memory of any of it.

Read this before `README.md`. The README says what the framework *is*; this says
what you need to know to *change it safely*.

---

## Orientation, in 60 seconds

```
packages/core     the whole engine. isomorphic, no React, no LLM SDK.
packages/react    hooks over an AgentClient store. thin.
packages/ui       card renderers + chat primitives + context inspector.
apps/playground   Next.js dev panels. runs with NO API key.
```

```bash
pnpm install && pnpm build && pnpm dev     # → http://localhost:3210
pnpm test                                  # 359 tests, ~4s
pnpm test:rwd                              # 152 browser checks, 4 viewports
```

The playground is **not a product**. It is one panel per capability, aimed at a
developer evaluating the framework: `/cards` `/agent-ui` `/skills` `/tools`
`/requests` `/app-state` `/documents` `/run`. That framing was an explicit
instruction — don't quietly turn it back into an app. A new capability gets a
panel; it does not get a feature in an app that happens to live here.

**Naming**: the framework is **superchat**, matching the repo — CSS prefix
`sc-`, storage keys `superchat:*`. Keep both consistent when you add a surface:
a stray prefix is how a theme override silently stops applying.

**Publish scope**: the three publishable packages (`core`, `react`, `ui`) are
scoped `@zzyzxlabs/super-chat-*` and publish to the **public npm registry**
under the ZzyzxLabs org. `apps/playground` stays `@superchat/playground`: it's
`private: true` and never published. "superchat" the *project* is still called
superchat everywhere else (README, CSS prefix, storage keys) — only the three
registry-facing package names carry the scope.

**Publish with `pnpm`, never `npm`.** `react` and `ui` depend on `core` through
`workspace:*`, and it is *pnpm* that rewrites that to a real version at pack
time. `npm publish` ships the literal `workspace:*` and every install of those
two packages fails. `pnpm -r publish` also walks the workspace in dependency
order and skips `private: true`, so it is the only command that needs to exist:

```bash
pnpm -r publish --access public
```

---

## The load-bearing decisions

These were chosen deliberately, some of them against the obvious alternative.
Changing one is fine — reversing it *by accident* is not.

**Hand-rolled provider adapters, no Vercel AI SDK.** The explicit ask was to own
the request shape. `packages/core/src/providers/openai/map-in.ts` is the heart of
the project. Two builders, sharing no object literals, because Responses and Chat
Completions disagree about nearly every field and conflating them is the single
largest source of 400s. If you ever feel like factoring out "the common parts",
read the comparison table at the top of `wire.ts` first.

**Transport is a seam, not a config flag.** The adapter never holds a credential;
it describes a call and hands it to a `Transport`. That is why the same adapter
code runs server-proxied, BYOK-direct, and against a scripted demo. It is also
what makes `apps/playground/src/agent/demo-transport.ts` an honest demo rather
than a mock — it replaces the network and nothing else.

**Context is derived, never accumulated.** `ContextBuilder.build()` runs fresh
every turn and emits a `ContextTrace` recording why each layer was included,
truncated or dropped. Determinism matters here: same inputs must produce the same
request, or prompt caching never hits.

**Presets are allowlists.** A newly registered tool is invisible until someone
puts it in one. Do not "improve" this into a denylist.

**A document is a sixth persistence seam, deliberately not an app-state
binding.** The other five all mismatch: `FileStore` holds immutable provider
refs and a document changes; `ThreadStore` is trimmed by compaction and a
document outlives its thread; `MemoryStore` has no notion of position, so
nothing to address; `Retriever` is read-only; and `app-state`'s own header rules
out "diffing, CRDT, bidirectional sync". That last exclusion is right for UI
state and wrong for documents, because **for a document the diff IS the
product** — it is what the user approves. Don't merge the two into a "general
state seam" later; the reasoning is written down in
`packages/core/src/documents/types.ts` for exactly that reason.

**Block indices are anchors, and `splitBlocks` is their only definition.** A
quote resolves a DOM selection to a block index; an edit resolves that same
index back to text it may rewrite. Both call
`packages/core/src/content/blocks.ts`, which is why it lives in core rather than
beside the renderer. Changing how it splits changes what every existing anchor
points at, and the damage is silent — a quote pointing at block 4 and an edit
landing in block 5 both look correct until someone reads the result. The
markdown renderer must keep classifying blocks on the RAW source too: escaping
before recording offsets shifts every span by the growth of `&` → `&amp;`, and
the page still renders perfectly while every anchor is wrong.

**Cards register validator + renderer together.** `BUILTIN_CARDS` (core) and
`BUILTIN_RENDERERS` (ui) are asserted equal by
`packages/ui/src/cards/registry-sync.test.ts`. This exists because the reference
implementation kept them in two hand-maintained lists and a card that had a
parser but no render branch silently degraded to a "ran ✓" chip in production.
Adding a kind means editing both; the test will tell you if you forgot.

---

## Bugs already found and fixed — do not reintroduce

Every one of these was caught by driving the real UI, not by reading code. Each
has a regression test now; the test names spell out the failure.

1. **Human-in-the-loop deadlock.** `awaiting-user` was collected into an array
   and yielded *after* tool execution finished. But execution waits on the user,
   who waits to see the card. Fixed with `runtime/channel.ts`, drained
   concurrently. The original test passed only because its responder resolved
   immediately — the new one refuses to answer until it has observed the event.

2. **Skills could escalate privilege.** A matched skill's `allow` list bypassed
   preset gating entirely, so any skill could hand out the executor tier just by
   naming a tool. Now: a tool with *no* preset is skill-gated (private until a
   skill surfaces it); a tool *with* a preset still requires that preset.
   Skills grant relevance; presets grant authority.

3. **`withCard()` was a dead path.** Tools can attach a card three ways — the
   explicit `card` field, `withCard()` embedding, or `ctx.emitCard()` — and
   `executeToolCall` only checked the first. Cards from the other two never
   appeared.

4. **Card payloads were re-billed every step.** Stripping happened only when the
   *next* turn rebuilt context, so within one multi-step turn every chart spec
   was resent. Now stripped before each provider call, while the event keeps the
   full payload for the UI.

5. **Interactive cards rendered twice.** `requestCard` surfaces the card, then
   the tool returned it *again* as `result.card` with a fresh id.

6. **Compaction discarded the summary it had just paid for.** A secondary trim
   walks newest-first, so the summary (oldest) went first. It is pinned now.

7. **SSE decoder state was module-level**, so two concurrent streams would
   interleave into garbage. Per-instance now.

8. **Showing the quote bar destroyed the selection it was about.** Passing a
   fresh `{__html}` object to `dangerouslySetInnerHTML` on every render makes
   React re-apply `innerHTML` even when the string is identical; that rebuilds
   every child node, and a selection living in those nodes collapses with them.
   The `Range` was right, the offsets were right, every unit test passed —
   nothing outside a real browser could see it. `inner` in
   `packages/ui/src/cards/Document.tsx` is memoised for IDENTITY, not for cost.

9. **A fence was anything starting with ```` ``` ````.** So a four-backtick
   block closed on the three-backtick one inside it and shattered into four
   blocks with the code stranded as prose, and a `~~~` fence was not recognised
   at all — which left the next ``` in the document opening one that ran to the
   end. Both mis-place every anchor after them while the page still renders
   plausibly. Fences now match on character and length.

---

## Things that will bite you

- **`.next` and `dist` are shared with the dev server.** Running `next build`
  while `next dev` is live corrupts the running server and the page goes blank.
  Stop the server first.
- **`tsup --clean` wipes `dist` on every rebuild.** That is why
  `@zzyzxlabs/super-chat-ui`'s `styles.css` export points at `src/`, not `dist/` — a
  consuming dev server that compiles during the wipe fails on a missing
  stylesheet. Don't "tidy" it back into dist.
- **Next's webpack does not resolve `.js` specifiers to `.ts`** in app source.
  Inside `apps/playground/src`, import without the extension. The workspace
  packages are fine because they resolve to built `dist`.
- **Typecheck order matters.** `packages/react` and `packages/ui` resolve
  `@zzyzxlabs/super-chat-core` through its built `dist`, so build core before typechecking
  them. `pnpm -r typecheck` after `pnpm build` is the safe order.
- **G: is slow.** Scope searches; avoid unscoped recursive `find`/`du` here.
- **Still nobody has looked at these panels with human eyes.** A headless
  browser now drives them at 360/390/768/1280 and asserts that nothing overflows,
  that a message can be sent, and that touch targets are big enough — which
  is a real floor, and is not the same as design review. Proportion, rhythm
  and colour remain unexamined. Open it before trusting the visual design.
- **`pnpm test:rwd` needs a Chromium the runner can launch.** The version
  Playwright expects and the one installed here are usually different builds;
  `playwright.config.ts` points at a preinstalled binary and
  `PLAYWRIGHT_CHROMIUM_PATH` overrides it. Do not "fix" this by running
  `playwright install` in an environment that ships its own.

---

## Domain neutrality is a requirement, not a preference

This nearly went wrong and is easy to get wrong again.

The user's pipeline includes legal, marketing and "超多領域". An early draft was
built entirely around market data, and the tell was subtle: the *card kinds* were
generic, but each kind's one-line `summary` said things like "portfolio totals",
"holdings", and — for `choice` option metadata — "APR, price, size".

**Those summaries are what the model reads when choosing a card.** Not the
schemas. Industry vocabulary there skews every agent built on the kit toward that
industry. If you add a card kind, write its summary with no domain nouns in it.

The 23 kinds are grouped in `cards/builtin.ts` by what they *do*: structured data,
quantitative shape, sequence and state, prose and evidence, interactive. The
demo agent covers contract review, marketing analytics and market data through
one registry — keep it that way; it is the proof that the machinery is neutral.

`comparison` (options × criteria) is the most portable kind and the one to reach
for first. `citations` matters specifically for agents: it is what lets a reader
check the work instead of trusting a summary.

---

## Where to pick up

Since the original handoff, the roadmap items were built (file upload, thread
persistence + branching, MCP import + elicitation, the Anthropic adapter, the
memory and retrieval seams — see README's Status section), and an integration
audit fixed the seams that existed but didn't connect (loadSkill unlock,
updateCard upsert, shared playground registry, thread-switch generation guard,
job-resume routing, foreign-file degrade). What remains:

Nothing on the previous roadmap is outstanding — concurrent proxy streaming now
has a test, the REST `ThreadStore` ships, provider-native tools pass through,
and the app-state seam landed.

Responsive support landed since then (UI-SPEC Phase 5, batches M1–M3): two
container-query tiers for width, media queries for device traits, and a
phone can now hold a conversation end to end. Two things about it are worth
knowing before touching the stylesheet:

- **Width asks `@container`, not `@media`.** The kit is embedded, so a host
  can drop `Thread` into a 380px sidebar inside a 1920px window, where a
  media query answers confidently and wrongly. Device traits — touch
  targets, iOS focus zoom, safe areas — stay on `@media`, and `.sc-toasts`
  is on `@media` too because a `position: fixed` element's container really
  is the viewport.
- **An element is never its own query container.** A host rendering cards
  outside a `Thread` must declare `container-type: inline-size` on its own
  wrapper, or those cards keep desktop padding at any width. Card internals
  are fine either way.

`pnpm test:rwd` runs the browser layer (140 checks across 360/390/768/1280 —
the last a desktop regression guard, not a tier). It
needs Chromium; see the note in `playwright.config.ts` about pointing at a
preinstalled binary.

**Documents landed after that** (UI-SPEC Phase 6, batches N1–N6): an artifact
the user keeps, a previewer they can quote from, an edit protocol that lands
only through a diff they approved hunk by hunk, and `.eml` as the way out. Six
things to know before touching it:

- **The refusals are the feature.** Half of `applyEdits` rejects: a `find` that
  matches nothing means the model is quoting text that is not there, and one
  that matches twice means it has not said which. First-match-wins is the
  tempting fallback and the dangerous one — it puts a change somewhere nobody
  asked for and then presents it for approval as though it were intended. The
  diff reads fine, so the user says yes.
- **Undo is a checkout, never an inverse edit**, and it mints a *new* revision
  rather than rolling the number back, so an edit proposed against the undone
  text is refused instead of silently applied to text that no longer exists.
  The new revision records which one it restored (`restoredFrom`), and the next
  undo steps back from *that* — without it the second undo restored the body
  the first had just replaced. A custom `DocumentStore` has to persist the
  field and drop it on every other write; `toRevision` jumps straight to one.
- **A write that loses a race is refused, not thrown.** `editDocument` re-reads
  after the approval await: an approved diff was against the revision it was
  proposed on and does not transfer to one that moved while the review was
  open. The store's own check still closes the last gap, and its throw comes
  back as the same `stale-revision` refusal.
- **A quote belongs to the user's message, not to app-state.** app-state is
  re-read every turn (history would replay the wrong span), goes stale on the
  next selection, and is droppable under budget pressure — and dropping a
  paragraph the user deliberately highlighted loses part of what they *said*.
  It flattens into the message text; the structured form rides on `metadata`,
  which never reaches a provider. No adapter changes. Drift follows the same
  rule: with `documentStore` on the client, a quote from a revision the
  document has moved past is stamped at send time — a note in the text for
  the model, `drift` on the metadata for the UI — and never re-derived later.
  No kit component renders sent quotes yet, so the metadata half has no
  reader in the box.
- **The previewer renders and selects. It is not an editor.** No toolbar, no
  caret, no `contentEditable`. That boundary is what keeps it a component rather
  than the visual builder this document rules out. If a host wants typing, what
  the framework hands them is Markdown plus anchors.
- **`listDocuments` is what makes the rest reachable.** A docId otherwise lives
  only in the transcript, which compaction trims and a new thread never had.

What is genuinely open:

1. **A third provider (Gemini).** Two adapters proved the normalized content
   model holds; a third is now routine rather than risky.
2. **Nobody has driven the app-state or documents panels against a live model.**
   The demo transport is scripted, so the board actions and the document tools
   are exercised by tests and by hand — not by an actual model deciding to call
   them. For documents specifically, whether the outline is a good enough map to
   steer by is a question only a real model answers.
3. **Layer 3 (real device) is still unrun**, and nobody has looked at the
   document surfaces with human eyes. iOS's native selection UI fighting the
   quote affordance is the known high-risk item — the classic "fine on desktop,
   unusable on a phone" shape.


Deliberately *not* done, and worth leaving alone unless asked: multi-agent
orchestration, a plugin system, and any kind of visual builder. The framework's
value is that it is a library with sharp edges in the right places.

---

## Reference material

Read for landscape rather than code: Open WebUI's tools/functions/knowledge
split, and LibreChat's multi-provider handling.

Five rules carried in from earlier production work. Reread them before changing
the registry, skills, or card dispatch — each one is load-bearing:

- provider-resolve is a single source of truth, never re-derived per call site;
- presets are explicit allowlists, never blocklists;
- skills are alias-matched and retrievable, not one system-prompt blob;
- `CardBoundary` isolates a failing renderer, so one bad card cannot take the
  whole thread down with it;
- actionable cards are never collapsed — a hidden form is an unreachable form.

The card *registry* exists because of the obvious alternative's failure mode: a
hand-maintained if-chain dispatching on card kind drifts as kinds are added,
until one silently degrades to a "ran ✓" chip and nobody notices for a month.
