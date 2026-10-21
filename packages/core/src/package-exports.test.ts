import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type Conditions = { types: string; import: string; default?: string };
type Manifest = { name: string; exports: Record<string, Conditions | string> };
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtures: string[] = [];

// Real Node resolution exercises the require/Jest condition set without
// pretending the ESM build provides CommonJS execution support.
function fixture(manifest: Manifest) {
  const root = mkdtempSync(join(tmpdir(), "superchat-export-resolution-"));
  fixtures.push(root);
  const installed = join(root, "node_modules", manifest.name);
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, "package.json"), JSON.stringify(manifest));
  for (const entry of Object.values(manifest.exports)) {
    for (const target of typeof entry === "string" ? [entry] : Object.values(entry)) {
      const path = resolve(installed, target);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "");
    }
  }
  return { installed, require: createRequire(join(root, "consumer.cjs")) };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("published package export resolution", () => {
  for (const name of ["core", "react", "ui"]) {
    const manifest: Manifest = JSON.parse(readFileSync(join(packageRoot, name, "package.json"), "utf8"));
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      const specifier = manifest.name + (subpath === "." ? "" : subpath.slice(1));
      it(`resolves ${specifier} without the import condition`, () => {
        const host = fixture(manifest);
        if (typeof entry !== "string") {
          expect(Object.keys(entry)[0]).toBe("types");
          expect(Object.keys(entry).at(-1)).toBe("default");
          expect(entry.default).toBe(entry.import);
        }
        expect(host.require.resolve(specifier)).toBe(resolve(host.installed, typeof entry === "string" ? entry : entry.import));
      });

      if (typeof entry !== "string") {
        it(`detects the missing-fallback regression for ${specifier}`, () => {
          const broken: Manifest = structuredClone(manifest);
          delete (broken.exports[subpath] as Conditions).default;
          const host = fixture(broken);
          let failure: unknown;
          try { host.require.resolve(specifier); } catch (error) { failure = error; }
          expect(failure).toMatchObject({ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
        });
      }
    }
  }
});
