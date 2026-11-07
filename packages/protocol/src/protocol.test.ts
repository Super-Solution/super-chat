import { describe, expect, it } from "vitest";
import {
  CHART_CARD_KIND,
  EDITOR_CARD_KIND,
  chartCardKind,
  validateChartAnnotations,
  validateChartCardSpec,
  GatewayError,
  collectText,
  editorCardKind,
  isTerminalEvent,
  parseSSE,
  validateChatPlugin,
  validateEditorCardSpec,
  validatePluginManifest,
  type ChatPlugin,
  type StreamEvent,
} from "./index.js";

const manifest = {
  manifestVersion: 0 as const,
  name: "@supersolutions/super-editor-chat-plugin",
  version: "0.1.0",
  license: "GPL-3.0-or-later",
  capabilities: [{ id: "editor.document", surface: "card" as const, cardKind: EDITOR_CARD_KIND }],
};

describe("plugin manifest", () => {
  it("accepts a valid manifest", () => expect(validatePluginManifest(manifest)).toEqual([]));
  it("rejects non-objects", () => expect(validatePluginManifest(null)).toHaveLength(1));
  it("requires cardKind on card capabilities and toolName on tool capabilities", () => {
    const paths = validatePluginManifest({ ...manifest, capabilities: [{ id: "a.b", surface: "card" }, { id: "a.c", surface: "tool" }] }).map((i) => i.path);
    expect(paths).toEqual(["capabilities[0].cardKind", "capabilities[1].toolName"]);
  });
  it("reports duplicate ids and bad versions", () => {
    const paths = validatePluginManifest({ ...manifest, version: "x", capabilities: [manifest.capabilities[0], manifest.capabilities[0]] }).map((i) => i.path);
    expect(paths).toEqual(["version", "capabilities[1].id"]);
  });
  it("rejects a non-http service url", () => expect(validatePluginManifest({ ...manifest, service: { baseUrl: "ftp://x" } })[0]?.path).toBe("service.baseUrl"));
});

describe("chat plugin", () => {
  const mount = () => ({ update() {}, destroy() {} });
  const plugin: ChatPlugin = { manifest, cardKinds: [editorCardKind], mounts: { [EDITOR_CARD_KIND]: mount } };
  it("is loadable when every capability is implemented", () => expect(validateChatPlugin(plugin)).toEqual([]));
  it("flags a missing card kind and a missing mount", () => {
    expect(validateChatPlugin({ manifest }).map((i) => i.message)).toEqual([`plugin does not define card kind "${EDITOR_CARD_KIND}"`, `plugin has no mount for card kind "${EDITOR_CARD_KIND}"`]);
  });
  it("flags an undefined tool", () => {
    const m = { ...manifest, capabilities: [{ id: "x.run", surface: "tool" as const, toolName: "run" }] };
    expect(validateChatPlugin({ manifest: m })[0]?.path).toBe("capabilities[0].toolName");
  });
});

describe("editor card", () => {
  const document = { schemaVersion: 1 as const, id: "d", title: "T", blocks: [] };
  it("accepts an inline document or a service reference", () => {
    expect(validateEditorCardSpec({ kind: EDITOR_CARD_KIND, document })).toEqual({ ok: true });
    expect(validateEditorCardSpec({ kind: EDITOR_CARD_KIND, service: { baseUrl: "https://e.example.com", documentId: "d" } })).toEqual({ ok: true });
  });
  it("needs exactly one source", () => {
    expect(validateEditorCardSpec({ kind: EDITOR_CARD_KIND }).ok).toBe(false);
    expect(validateEditorCardSpec({ kind: EDITOR_CARD_KIND, document, service: { baseUrl: "https://x", documentId: "d" } }).ok).toBe(false);
  });
  it("keeps service-backed documents read-only", () => {
    expect(validateEditorCardSpec({ kind: EDITOR_CARD_KIND, service: { baseUrl: "https://e.example.com", documentId: "d" }, mode: "edit" }).ok).toBe(false);
  });
  it("rejects malformed documents, services and modes", () => {
    expect(validateEditorCardSpec({ kind: EDITOR_CARD_KIND, document: { schemaVersion: 2 } }).ok).toBe(false);
    expect(validateEditorCardSpec({ kind: EDITOR_CARD_KIND, service: { baseUrl: "nope", documentId: "d" } }).ok).toBe(false);
    expect(validateEditorCardSpec({ kind: EDITOR_CARD_KIND, document, mode: "write" }).ok).toBe(false);
    expect(validateEditorCardSpec({ kind: "other", document }).ok).toBe(false);
  });
});

const stream = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });

describe("router", () => {
  it("parses SSE across chunk and CRLF boundaries", async () => {
    const frames: { event: string; data: string }[] = [];
    for await (const f of parseSSE(stream(["event: output.delta\r\ndata: {\"a\"", ":1}\r\n\r\nevent: request.completed\ndata: {}\n", "\n"]))) frames.push(f);
    expect(frames).toEqual([{ event: "output.delta", data: '{"a":1}' }, { event: "request.completed", data: "{}" }]);
  });
  it("rejects oversized frames", async () => {
    await expect((async () => { for await (const _ of parseSSE(stream(["data: " + "x".repeat(50)]), 10)); })()).rejects.toBeInstanceOf(GatewayError);
  });
  const events = (types: StreamEvent[]) => (async function* () { yield* types; })();
  it("collects text and requires a terminal event", async () => {
    const delta = (text: string, sequence: number): StreamEvent => ({ type: "output.delta", request_id: "r", sequence, text });
    const done: StreamEvent = { type: "request.completed", request_id: "r", sequence: 3, execution_status: "succeeded", billing_status: "settled" };
    expect(await collectText(events([delta("Hel", 1), delta("lo", 2), done]))).toBe("Hello");
    await expect(collectText(events([delta("Hel", 1)]))).rejects.toMatchObject({ code: "stream_interrupted" });
    expect(isTerminalEvent(done)).toBe(true);
    expect(isTerminalEvent(delta("x", 1))).toBe(false);
  });
});

describe("chart", () => {
  const bar = (timestamp: number, close = 10) => ({ timestamp, open: 10, high: 12, low: 9, close });
  const base = { kind: CHART_CARD_KIND, symbol: { ticker: "BTCUSDT" }, period: { multiplier: 1, timespan: "hour", text: "1h" } };
  it("accepts inline bars or a feed reference, and exactly one of them", () => {
    expect(validateChartCardSpec({ ...base, bars: [bar(1), bar(2)] }).ok).toBe(true);
    expect(validateChartCardSpec({ ...base, feed: { id: "binance" } }).ok).toBe(true);
    expect(validateChartCardSpec(base).ok).toBe(false);
    expect(validateChartCardSpec({ ...base, bars: [bar(1)], feed: { id: "x" } }).ok).toBe(false);
    expect(chartCardKind.validate({ ...base, feed: { id: "x" } }).ok).toBe(true);
  });
  it("rejects unsorted, impossible or empty bars", () => {
    expect(validateChartCardSpec({ ...base, bars: [bar(2), bar(1)] }).ok).toBe(false);
    expect(validateChartCardSpec({ ...base, bars: [bar(1), bar(1)] }).ok).toBe(false);
    expect(validateChartCardSpec({ ...base, bars: [{ timestamp: 1, open: 10, high: 9, low: 8, close: 10 }] }).ok).toBe(false);
    expect(validateChartCardSpec({ ...base, bars: [] }).ok).toBe(false);
  });
  it("validates symbol, period, chart type and height", () => {
    expect(validateChartCardSpec({ ...base, feed: { id: "x" }, symbol: { ticker: "" } }).ok).toBe(false);
    expect(validateChartCardSpec({ ...base, feed: { id: "x" }, period: { multiplier: 0, timespan: "hour", text: "0h" } }).ok).toBe(false);
    expect(validateChartCardSpec({ ...base, feed: { id: "x" }, chartType: "renko" }).ok).toBe(false);
    expect(validateChartCardSpec({ ...base, feed: { id: "x" }, height: 10 }).ok).toBe(false);
  });
  it("checks the shape of each annotation kind and rejects duplicate keys", () => {
    const level = { key: "support", kind: "level", anchors: [{ time: 1, price: 9 }], tone: "bull" };
    const zone = { key: "ob", kind: "zone", anchors: [{ time: 1, price: 9 }, { time: 2, price: 11 }] };
    const marker = { key: "m", kind: "marker", anchors: [{ time: 1 }], text: "break" };
    expect(validateChartAnnotations([level, zone, marker])).toBeNull();
    expect(validateChartAnnotations([{ ...level, anchors: [{ time: 1 }] }])).not.toBeNull();
    expect(validateChartAnnotations([{ ...zone, anchors: [zone.anchors[0]] }])).not.toBeNull();
    expect(validateChartAnnotations([{ ...marker, tone: "purple" }])).not.toBeNull();
    expect(validateChartAnnotations([level, level])).toMatch(/duplicate/);
  });
});
