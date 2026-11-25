# Conformance data

Copies of the shared agent-loop conformance files of [Super Protocol](https://github.com/Super-Solution/super-protocol)
(`conformance/agent-loop.v0.json` and `conformance/tool-repair.v0.json`), the data every implementation of the loop
is tested against: this one, the TypeScript reference machine and the Rust crate in that repository.

| File | Used by | What it pins |
| --- | --- | --- |
| `agent-loop.v0.json` | `../runtime/agent-loop.conformance.test.ts` | what `runAgent` decides and reports, as transcripts: steps, parallel tools, approvals, stop conditions, errors, cancel |
| `tool-repair.v0.json` | `../tools/repair.conformance.test.ts` | what `repairToolArguments` and `normalizeToolName` return for malformed model output |

The files are **owned by Super Protocol**. Do not edit them here. To refresh, copy them over from a
Super Protocol checkout (or run the tests with `SUPER_PROTOCOL_DIR=/path/to/super-protocol` and they fail when
a copy has drifted). If `runAgent` changes behaviour on purpose, change the cases in Super Protocol first
(`scripts/agent-loop/cases.mjs`, `docs/AGENT-LOOP.md`), regenerate, then copy.

`tool-repair.v0.json` is generated *from* `../tools/repair.ts` (`SUPER_CHAT_DIR=... node scripts/export-tool-repair.mjs`
in Super Protocol); the test here fails when `repair.ts` and the file disagree.

Cases that need a feature `runAgent` does not have (`requires: ["repeat-guard"]`, `["checkpoint"]`) are listed as
skipped, not dropped: they are what a second implementation has to do on top.
