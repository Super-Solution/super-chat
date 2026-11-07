# Engineering improvement log

A short, append-only record of what was found, decided and verified, so the next review does
not repeat finished work. Newest entry first. Claims here are things that were run, not intended.

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
