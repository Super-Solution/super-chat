// Packs the Super packages this example uses from local checkouts into .tarballs/, under names without a version.
// Build each repository first. Checkouts are found next to this repository, or through these variables:
//   SUPER_SOLUTION_ROOT, SUPER_PROTOCOL_DIR, SUPER_CHAT_DIR, SUPER_ROUTER_DIR, SUPER_CHART_DIR, SUPER_EDITOR_DIR
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const example = resolve(here, "..");
const root = resolve(process.env.SUPER_SOLUTION_ROOT ?? join(example, "../../.."));
const out = join(example, ".tarballs");
const dir = (name, variable) => resolve(process.env[variable] ?? join(root, name));

const repos = [
  { dir: dir("super-protocol", "SUPER_PROTOCOL_DIR"), tool: "pnpm", packages: { "super-protocol": "implementations/typescript" } },
  {
    dir: resolve(process.env.SUPER_CHAT_DIR ?? join(example, "../..")),
    tool: "pnpm",
    packages: {
      "super-chat-core": "packages/core",
      "super-chat-client": "packages/client",
      "super-chat-ui-core": "packages/ui-core",
      "super-chat-react": "packages/bindings/react",
      "super-chat-ui": "packages/bindings/react-ui",
      "super-chat-plugin": "packages/integrations/plugin",
      "super-chat-router": "packages/integrations/router",
    },
  },
  {
    dir: dir("super-router", "SUPER_ROUTER_DIR"),
    tool: "npm",
    packages: {
      "super-router-contracts": "packages/contracts",
      "super-router-core": "packages/core",
      "super-router-storage-memory": "packages/adapters/storage-memory",
      "super-router-storage-postgres": "packages/adapters/storage-postgres",
      "super-router-payments": "packages/adapters/payments",
      "super-router-fetch-adapters": "packages/adapters/http",
      "super-router-server": "backends/typescript/server",
    },
  },
  {
    dir: dir("super-chart", "SUPER_CHART_DIR"),
    tool: "npm",
    packages: {
      "super-chart-core": "packages/core",
      "super-chart-superscript": "packages/superscript",
      "super-chart-web": "packages/bindings/web",
      "super-chart-chat-plugin": "packages/integrations/chat-plugin",
    },
  },
  {
    dir: dir("super-editor", "SUPER_EDITOR_DIR"),
    tool: "npm",
    packages: {
      "super-editor-core": "packages/core",
      "super-editor-ui": "packages/ui",
      "super-editor-chat-plugin": "packages/integrations/chat-plugin",
    },
  },
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const repo of repos) {
  for (const [name, path] of Object.entries(repo.packages)) {
    const cwd = join(repo.dir, path);
    if (!existsSync(join(cwd, "package.json"))) throw new Error(`${name}: no package at ${cwd}. Set the checkout's variable (see the top of this file).`);
    const staging = mkdtempSync(join(tmpdir(), "super-pack-"));
    // pnpm rewrites workspace:* to real versions at pack time; npm would ship the literal.
    execFileSync(repo.tool === "pnpm" ? "npx" : "npm", repo.tool === "pnpm" ? ["-y", "pnpm@9.12.0", "pack", "--pack-destination", staging] : ["pack", "--silent", "--pack-destination", staging], { cwd, stdio: ["ignore", "ignore", "inherit"] });
    const [file] = readdirSync(staging).filter((f) => f.endsWith(".tgz"));
    renameSync(join(staging, file), join(out, `${name}.tgz`));
    rmSync(staging, { recursive: true, force: true });
    console.log(`packed ${name}`);
  }
}
