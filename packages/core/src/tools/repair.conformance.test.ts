// repairToolArguments and normalizeToolName against the shared data (../conformance/tool-repair.v0.json, owned by
// Super Protocol). The data is generated FROM this code (`node scripts/export-tool-repair.mjs` in Super Protocol),
// so this test fails when repair.ts changes and the file was not regenerated: the Rust port reads the same file.

import { existsSync, readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { normalizeToolName, repairToolArguments } from "./repair.js";

const dataUrl = new URL("../conformance/tool-repair.v0.json", import.meta.url);
const file = JSON.parse(readFileSync(dataUrl, "utf8")) as {
  version: string;
  repair: { input: unknown; expect: unknown }[];
  normalize_name: { input: string; expect: string }[];
};

describe("tool-repair.v0 conformance", () => {
  it("repairToolArguments returns what the file says, for every input", () => {
    expect(file.version).toBe("tool-repair.v0");
    expect(file.repair.length).toBeGreaterThanOrEqual(700);
    const wrong = file.repair.filter((c) => !isDeepStrictEqual(JSON.parse(JSON.stringify(repairToolArguments(c.input))), c.expect));
    expect(wrong.slice(0, 3).map((c) => c.input)).toEqual([]);
  });

  it("normalizeToolName returns what the file says, for every name", () => {
    for (const c of file.normalize_name) expect(normalizeToolName(c.input), JSON.stringify(c.input)).toBe(c.expect);
  });

  const protocolDir = process.env.SUPER_PROTOCOL_DIR;
  it.skipIf(!protocolDir || !existsSync(`${protocolDir}/conformance/tool-repair.v0.json`))("is the same file as Super Protocol's", () => {
    expect(readFileSync(dataUrl, "utf8")).toBe(readFileSync(`${protocolDir}/conformance/tool-repair.v0.json`, "utf8"));
  });
});
