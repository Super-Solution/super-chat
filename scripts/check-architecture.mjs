// Fails when the package structure drifts from the architecture in docs/PACKAGES.md.
//
//   node scripts/check-architecture.mjs        (or: pnpm check:architecture)
//
// Rules, each of which was true when this was written and is cheap to keep true:
//   1. Layering. A public package may depend only on packages in a strictly lower layer, so
//      the graph stays acyclic by construction and `core` can never reach for React.
//   2. No cycles, in any dependency field (a belt-and-braces check on rule 1).
//   3. Framework-free packages do not depend on a UI framework.
//   4. Public packages are publishable: `sideEffects` declared (so bundlers may tree-shake),
//      an `exports` map with `types` first, a `files` whitelist, and a licence.
//   5. A new public package must be given a layer here on purpose.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Lower layers know nothing of higher ones. Edit this table when the architecture changes. */
const LAYERS = {
  "@supersolutions/super-protocol": 0,
  "@supersolutions/super-chat-core": 0,
  "@supersolutions/super-chat-client": 1,
  "@supersolutions/super-chat-ui-core": 1,
  "@supersolutions/super-chat-server": 1,
  "@supersolutions/super-chat-router": 1,
  "@supersolutions/super-chat-react": 2,
  "@supersolutions/super-chat-ui": 3,
  "@supersolutions/super-chat-plugin": 4,
};
/** Layers that must stay independent of any UI framework. */
const FRAMEWORK_FREE_MAX_LAYER = 1;
const UI_FRAMEWORKS = ["react", "react-dom", "preact", "solid-js", "vue", "svelte", "next"];

// Workspace globs from pnpm-workspace.yaml (each is `dir/*` or `dir/*/*`).
const globs = [...readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").matchAll(/^\s*-\s*"?([^"\n]+)"?\s*$/gm)].map((m) => m[1].trim());
const dirsOf = (glob) => {
  let level = [root];
  for (const part of glob.split("/")) {
    level = level.flatMap((d) => {
      if (part !== "*") return existsSync(join(d, part)) ? [join(d, part)] : [];
      return existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "node_modules").map((e) => join(d, e.name)) : [];
    });
  }
  return level;
};
const packages = globs
  .flatMap(dirsOf)
  .filter((d) => existsSync(join(d, "package.json")))
  .map((d) => ({ dir: d.slice(root.length + 1).replace(/\\/g, "/"), json: JSON.parse(readFileSync(join(d, "package.json"), "utf8")) }));

const byName = new Map(packages.map((p) => [p.json.name, p]));
const FIELDS = ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"];
const depsOf = (p) => FIELDS.flatMap((f) => Object.keys(p.json[f] ?? {}));
const problems = [];
const fail = (p, msg) => problems.push(`${p.json.name} (${p.dir}): ${msg}`);

for (const p of packages) {
  const isPublic = !p.json.private;
  const layer = LAYERS[p.json.name];

  if (isPublic && layer === undefined) {
    fail(p, "is public but has no layer in scripts/check-architecture.mjs; decide where it sits and add it");
    continue;
  }

  for (const dep of depsOf(p)) {
    const target = byName.get(dep);
    if (!target) continue;
    if (isPublic && target.json.private) fail(p, `depends on the private package ${dep}`);
    if (!isPublic) continue; // apps may use anything public
    const targetLayer = LAYERS[dep];
    if (targetLayer !== undefined && targetLayer >= layer) {
      fail(p, `(layer ${layer}) depends on ${dep} (layer ${targetLayer}); a package may only depend on a strictly lower layer`);
    }
  }

  if (isPublic && layer <= FRAMEWORK_FREE_MAX_LAYER) {
    for (const dep of depsOf(p)) {
      if (UI_FRAMEWORKS.includes(dep)) fail(p, `is framework-free (layer ${layer}) but depends on ${dep}`);
    }
  }

  if (isPublic) {
    const j = p.json;
    if (j.sideEffects === undefined) fail(p, 'does not declare "sideEffects" (bundlers cannot tree-shake it safely)');
    if (!j.exports || typeof j.exports !== "object") fail(p, 'has no "exports" map');
    else {
      for (const [entry, target] of Object.entries(j.exports)) {
        if (target && typeof target === "object" && Object.keys(target)[0] !== "types") fail(p, `exports["${entry}"] must list "types" first`);
      }
    }
    if (!Array.isArray(j.files)) fail(p, 'has no "files" whitelist (the whole directory would be published)');
    if (!j.license) fail(p, 'has no "license"');
  }
}

// Cycles, over every field.
const state = new Map();
const visit = (name, path) => {
  if (state.get(name) === 2) return;
  if (state.get(name) === 1) {
    problems.push(`dependency cycle: ${[...path.slice(path.indexOf(name)), name].join(" -> ")}`);
    return;
  }
  state.set(name, 1);
  for (const dep of depsOf(byName.get(name))) if (byName.has(dep)) visit(dep, [...path, name]);
  state.set(name, 2);
};
for (const name of byName.keys()) visit(name, []);

if (problems.length) {
  console.error(`Architecture check failed (${problems.length}):\n${problems.map((m) => `  - ${m}`).join("\n")}`);
  process.exit(1);
}
const publicCount = packages.filter((p) => !p.json.private).length;
console.log(`Architecture check passed: ${packages.length} packages (${publicCount} public) respect the layering, have no cycles, and are publishable.`);
