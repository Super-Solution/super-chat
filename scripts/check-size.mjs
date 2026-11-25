// Fails when what a consumer downloads for a few common imports grows past its budget.
//
//   node scripts/check-size.mjs        (or: pnpm check:size; `pnpm verify` runs it after the build)
//
// Each case is one import, bundled the way an app's bundler would: minified, tree-shaken, ESM,
// with React and super-protocol left external (the app brings them). The number is the gzip size
// of that bundle, which is what crosses the wire. Workspace packages resolve to their built
// `dist`, so run the build first.
//
// Why imports and not files: what matters to someone who wants a code block is what `import
// { CodeBlock }` costs, and that is exactly what tree-shaking can silently lose. It did: one
// statement in a module that ran at load time kept every card view in the bundle, so a code block
// cost 40 KB gzip. A budget on the single-import cases is what notices that coming back.
//
// The budgets are PROPOSALS from the 2026-11-26 competitive review, not decisions. Raise one on
// purpose, in the same change that explains why, rather than letting it drift. esbuild is the one
// tsup already depends on, found through it, so this adds no dependency of its own.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const UI = "packages/bindings/react-ui";

/** `budget` is gzip KB (1 KB = 1024 bytes). `note` says where the number came from when it is not the review's. */
const CASES = [
  { name: "core: runAgent", dir: "packages/core", code: `export { runAgent } from "@supersolutions/super-chat-core";`, budget: 15 },
  {
    name: "ui-core: renderMarkdown",
    dir: "packages/ui-core",
    code: `export { renderMarkdown } from "@supersolutions/super-chat-ui-core";`,
    budget: 9,
    note: "review proposed 8, before the built-in highlighter, task lists, maths and image handling (+2.9 KB measured)",
  },
  { name: "ui: Thread + Composer", dir: UI, code: `export { Thread, Composer } from "@supersolutions/super-chat-ui";`, budget: 45 },
  { name: "ui: CodeBlock only", dir: UI, code: `export { CodeBlock } from "@supersolutions/super-chat-ui";`, budget: 5 },
  { name: "ui/agent: CodeBlock", dir: UI, code: `export { CodeBlock } from "@supersolutions/super-chat-ui/agent";`, budget: 5 },
  {
    name: "ui/labels: zh-TW preset",
    dir: UI,
    code: `export { LabelsProvider, zhTW } from "@supersolutions/super-chat-ui/labels";`,
    budget: 5,
    note: "no review figure; measured 3.7 KB",
  },
  {
    name: "ui/cards: every card renderer",
    dir: UI,
    code: `export { BUILTIN_RENDERERS } from "@supersolutions/super-chat-ui/cards";`,
    budget: 55,
    note: "no review figure; measured 46.7 KB, about 15% headroom",
  },
];

/** A stylesheet cannot be tree-shaken, so it is measured as the file is served. */
const FILES = [
  {
    name: "styles.css (as served)",
    file: `${UI}/src/styles.css`,
    budget: 36,
    note: "review proposed 30, which the file did not meet before this change either (32.7 KB); now 34.6 KB",
  },
];

const kb = (bytes) => bytes / 1024;
const fmt = (n) => n.toFixed(1).padStart(6);

const require = createRequire(join(root, "package.json"));
const esbuild = createRequire(require.resolve("tsup/package.json"))("esbuild");

const problems = [];
const rows = [];

for (const c of CASES) {
  const dist = join(root, c.dir, "dist");
  if (!existsSync(dist)) {
    console.error(`check-size: ${c.dir}/dist does not exist. Run \`pnpm build\` first.`);
    process.exit(2);
  }
  const out = await esbuild.build({
    stdin: { contents: c.code, resolveDir: join(root, c.dir), loader: "js" },
    bundle: true,
    minify: true,
    treeShaking: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "error",
    external: ["react", "react/jsx-runtime", "react-dom", "@supersolutions/super-protocol"],
  });
  const code = out.outputFiles[0].contents;
  rows.push({ name: c.name, min: kb(code.length), gzip: kb(gzipSync(code).length), budget: c.budget, note: c.note });
}

for (const f of FILES) {
  const bytes = readFileSync(join(root, f.file));
  rows.push({ name: f.name, min: kb(bytes.length), gzip: kb(gzipSync(bytes).length), budget: f.budget, note: f.note });
}

console.log(`${"case".padEnd(34)} ${"min KB".padStart(7)} ${"gzip KB".padStart(8)} ${"budget".padStart(7)}  status`);
for (const r of rows) {
  const over = r.gzip > r.budget;
  if (over) problems.push(`${r.name}: ${r.gzip.toFixed(1)} KB gzip is over its budget of ${r.budget} KB.`);
  console.log(`${r.name.padEnd(34)} ${fmt(r.min)}  ${fmt(r.gzip)}  ${String(r.budget).padStart(6)}  ${over ? "OVER" : "ok"}`);
}

if (problems.length) {
  console.error(`\ncheck-size: ${problems.length} budget(s) exceeded:\n  - ${problems.join("\n  - ")}`);
  console.error("\nIf the growth is intended, raise the budget in scripts/check-size.mjs in the same change and say why.");
  process.exit(1);
}
console.log("\ncheck-size: all within budget.");
