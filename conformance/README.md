# Conformance data

Language-neutral test data for `@supersolutions/super-protocol`. The TypeScript package in
`packages/protocol` is the reference; every other backend must reproduce these cases exactly,
error messages included.

| File | What it pins |
| --- | --- |
| `protocol.v1.json` | `plugin_manifest` (issue lists), `editor_card` and `chart_card` (result objects), `terminal_event`, and `sse` (hex-encoded byte chunks, optional frame limit, expected frames or the error code) |

Known limits of the data: URLs are realistic base URLs (no percent-encoded or internationalised
hosts), strings are valid UTF-8 (a multi-byte character may be split across SSE chunks), and string
lengths count UTF-16 code units, as JavaScript does.

```bash
pnpm --filter @supersolutions/super-protocol build && node scripts/export-conformance.mjs   # regenerate
pnpm vitest run packages/protocol                                                           # TypeScript still matches
(cd backends/go && go test ./...)                                                           # Go port
(cd backends/python && pytest)                                                              # Python port
```

If behaviour changes on purpose, regenerate, review the diff, and update every port. A closed-source
Rust backend, if one exists, lives in a private repository and tests against this same file.
