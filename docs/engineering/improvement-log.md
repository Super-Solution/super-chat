# Engineering improvement log

A short, append-only record of what was found, decided and verified, so the next review does
not repeat finished work. Newest entry first. Claims here are things that were run, not intended.

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
