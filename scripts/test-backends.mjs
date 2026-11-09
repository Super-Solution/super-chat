// Runs the Go and Python ports against conformance/protocol.v1.json.
//
//   node scripts/test-backends.mjs        (or: pnpm test:backends)
//
// Not part of `pnpm verify`, which needs only Node: a contributor without Go or Python should still
// be able to run the gate. A toolchain that is missing is reported as skipped, never as a pass, and
// `--require` turns a skip into a failure (for a machine that is meant to have both).
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = process.argv.includes("--require");

const suites = [
  { name: "go", probe: ["go", ["version"]], run: ["go", ["test", "-count=1", "./..."]], cwd: "backends/go" },
  {
    name: "python",
    probe: ["python3", ["-m", "pytest", "--version"]],
    run: ["python3", ["-m", "pytest", "-q"]],
    cwd: "backends/python",
    env: { PYTHONPATH: "src" },
  },
];

let failed = false;
for (const s of suites) {
  const probe = spawnSync(s.probe[0], s.probe[1], { cwd: join(root, s.cwd), encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    console.log(`${s.name}: SKIPPED (${s.probe[0]} ${s.probe[1].join(" ")} is not available)`);
    if (require) failed = true;
    continue;
  }
  const run = spawnSync(s.run[0], s.run[1], { cwd: join(root, s.cwd), stdio: "inherit", env: { ...process.env, ...s.env } });
  console.log(`${s.name}: ${run.status === 0 ? "ok" : "FAILED"}`);
  if (run.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
