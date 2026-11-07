// The TypeScript reference must still produce every expectation in conformance/protocol.v1.json,
// the data the Go and Python ports are tested against. Regenerate with
// `pnpm --filter @supersolutions/super-protocol build && node scripts/export-conformance.mjs`
// when behaviour changes on purpose, then update every port.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isTerminalEvent,
  parseSSE,
  validateChartCardSpec,
  validateEditorCardSpec,
  validatePluginManifest,
} from "./index.js";

const data = JSON.parse(readFileSync(new URL("../../../conformance/protocol.v1.json", import.meta.url), "utf8"));

describe("conformance data", () => {
  it("plugin manifest", () => {
    expect(data.plugin_manifest.length).toBeGreaterThanOrEqual(100);
    for (const c of data.plugin_manifest) expect(validatePluginManifest(c.value)).toEqual(c.expect);
  });
  it("editor card", () => {
    for (const c of data.editor_card) expect(validateEditorCardSpec(c.value)).toEqual(c.expect);
  });
  it("chart card", () => {
    expect(data.chart_card.length).toBeGreaterThanOrEqual(200);
    for (const c of data.chart_card) expect(validateChartCardSpec(c.value)).toEqual(c.expect);
  });
  it("terminal events", () => {
    for (const c of data.terminal_event) expect(isTerminalEvent({ type: c.type } as never)).toBe(c.expect);
  });
  it("sse", async () => {
    expect(data.sse.length).toBeGreaterThanOrEqual(300);
    for (const c of data.sse) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const h of c.chunks as string[]) controller.enqueue(Uint8Array.from(Buffer.from(h, "hex")));
          controller.close();
        },
      });
      const frames: { event: string; data: string }[] = [];
      let error: string | undefined;
      try {
        for await (const f of c.max_frame_bytes === undefined ? parseSSE(body) : parseSSE(body, c.max_frame_bytes)) frames.push(f);
      } catch (e) {
        error = (e as { code?: string }).code;
      }
      expect(error === undefined ? { frames } : { frames, error }).toEqual(c.expect);
    }
  });
});
