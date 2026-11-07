import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// super-chat is Apache-2.0. A GPL/AGPL package (super-editor, super-chart) must
// never be something it depends on: those plug in through @supersolutions/super-protocol.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// Every workspace package, whatever folder group it sits in (packages/*, packages/*/*, backends/*/*).
function manifestPaths(dir: string, depth: number): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === "dist") continue;
    const sub = join(dir, entry.name);
    if (existsSync(join(sub, "package.json"))) found.push(join(sub, "package.json"));
    else if (depth > 0) found.push(...manifestPaths(sub, depth - 1));
  }
  return found;
}
const manifestFiles = [...manifestPaths(join(repoRoot, "packages"), 2), ...manifestPaths(join(repoRoot, "backends"), 2)];
const copyleft = /^@(supersolutions|super-solution)\/super-(editor|chart)(-|$)|^super-(editor|chart)$/;

describe("license boundary", () => {
  it("finds every package", () => expect(manifestFiles.length).toBeGreaterThanOrEqual(9));
  for (const file of manifestFiles) {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown> & { name: string; license?: string };
    it(`${manifest.name} is Apache-2.0 and depends on no copyleft Super package`, () => {
      expect(manifest.license).toBe("Apache-2.0");
      for (const field of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
        const deps = Object.keys((manifest[field] as Record<string, string> | undefined) ?? {});
        expect(deps.filter((d) => copyleft.test(d))).toEqual([]);
      }
    });
  }
});
