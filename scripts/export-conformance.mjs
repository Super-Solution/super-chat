// Writes conformance/protocol.v1.json: language-neutral cases generated from the TypeScript
// reference in packages/protocol (plugin manifest, editor card spec, chart card spec, SSE parser,
// terminal-event check). Go and Python must reproduce every case exactly.
//
// Run `pnpm --filter @supersolutions/super-protocol build` first: the generator imports the built
// package. packages/protocol/src/conformance.test.ts fails if the file drifts from the reference.
import { writeFileSync } from "node:fs";
import {
  isTerminalEvent,
  parseSSE,
  validateChartCardSpec,
  validateEditorCardSpec,
  validatePluginManifest,
} from "../packages/protocol/dist/index.js";

let seed = 20261108;
const rand = (n) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed % n);
const pick = (items) => items[rand(items.length)];
const clone = (v) => JSON.parse(JSON.stringify(v));
/** A deep copy of `base` after `fn` edited it; `fn` returns nothing. */
const mut = (base, fn) => {
  const c = clone(base);
  fn(c);
  return c;
};

// ---- plugin manifest -------------------------------------------------------------------------
const manifest = {
  manifestVersion: 0,
  name: "@supersolutions/super-editor-chat-plugin",
  version: "0.1.0",
  license: "GPL-3.0-or-later",
  capabilities: [
    { id: "editor.document", surface: "card", cardKind: "super-editor.document" },
    { id: "editor.open-tool", surface: "tool", toolName: "open_document", inputSchema: { type: "object" } },
    { id: "editor.side-panel", surface: "panel" },
    { id: "editor.canvas", surface: "canvas" },
  ],
  service: { baseUrl: "https://editor.example.com" },
};
const manifests = [
  manifest,
  mut(manifest, (m) => delete m.service),
  mut(manifest, (m) => (m.capabilities = [m.capabilities[0]])),
  mut(manifest, (m) => (m.manifestVersion = 1)),
  mut(manifest, (m) => delete m.manifestVersion),
  mut(manifest, (m) => (m.manifestVersion = "0")),
  null,
  [],
  "manifest",
  42,
  {},
];
for (const name of [
  "plain",
  "@scope/pkg",
  "@scope/pkg.name-x_y",
  "a",
  "~tilde",
  "UPPER",
  "@Scope/pkg",
  "@scope",
  "@/pkg",
  "a b",
  "",
  "a/b",
  "@a/b/c",
  ".dot",
  "-dash",
  "pkg~",
  7,
  null,
])
  manifests.push(mut(manifest, (m) => (m.name = name)));
for (const version of [
  "1.0.0",
  "0.0.0",
  "10.20.30",
  "1.0.0-beta.1",
  "1.0.0+build.5",
  "1.0.0-rc.1+sha.abc",
  "01.0.0",
  "1.0",
  "1",
  "v1.0.0",
  "1.0.0.0",
  "1.0.0-",
  "1.0.0-bad_char",
  "",
  " 1.0.0",
  1,
  null,
])
  manifests.push(mut(manifest, (m) => (m.version = version)));
for (const license of ["MIT", "GPL-3.0-or-later", "Apache-2.0 OR MIT", "", "   ", "\t", 3, null])
  manifests.push(mut(manifest, (m) => (m.license = license)));
for (const caps of [
  [],
  "x",
  null,
  {},
  [null],
  ["x"],
  [[]],
  [{ id: "editor.document", surface: "card", cardKind: "k" }, { id: "editor.document", surface: "panel" }],
  [{ id: "a.b", surface: "panel" }, { id: "a.c", surface: "panel" }],
  [{ id: "Editor.document", surface: "panel" }],
  [{ id: "editor", surface: "panel" }],
  [{ id: "editor.", surface: "panel" }],
  [{ id: "a.b.c.d", surface: "panel" }],
  [{ id: "1a.b", surface: "panel" }],
  [{ id: "a-b.c-d", surface: "panel" }],
  [{ id: "a.b c", surface: "panel" }],
  [{ id: 5, surface: "panel" }],
  [{ surface: "panel" }],
  [{ id: "a.b" }],
  [{ id: "a.b", surface: "window" }],
  [{ id: "a.b", surface: 1 }],
  [{ id: "a.b", surface: "card" }],
  [{ id: "a.b", surface: "card", cardKind: "" }],
  [{ id: "a.b", surface: "card", cardKind: 3 }],
  [{ id: "a.b", surface: "tool" }],
  [{ id: "a.b", surface: "tool", toolName: "" }],
  [{ id: "a.b", surface: "tool", toolName: "t" }],
  [{ id: "a.b", surface: "panel", inputSchema: [] }],
  [{ id: "a.b", surface: "panel", inputSchema: null }],
  [{ id: "a.b", surface: "panel", inputSchema: "s" }],
  [{ id: "a.b", surface: "panel", inputSchema: {} }],
  [{ id: "a.b", surface: "card" }, { id: "a.b", surface: "tool" }, { surface: "x" }],
])
  manifests.push(mut(manifest, (m) => (m.capabilities = caps)));
for (const service of [
  null,
  "https://x.com",
  [],
  {},
  { baseUrl: 3 },
  { baseUrl: "" },
  { baseUrl: "http://localhost:8080/path?q=1#frag" },
  { baseUrl: "https://user:pw@host.example/" },
  { baseUrl: "HTTPS://EXAMPLE.COM" },
  { baseUrl: "http://[::1]:8080" },
  { baseUrl: "http://192.168.0.1:3000" },
  { baseUrl: "http://example.com:99999" },
  { baseUrl: "http://example.com:abc" },
  { baseUrl: "http://exa mple.com" },
  { baseUrl: "ftp://example.com" },
  { baseUrl: "ws://example.com" },
  { baseUrl: "javascript:alert(1)" },
  { baseUrl: "file:///etc/passwd" },
  { baseUrl: "//example.com" },
  { baseUrl: "example.com" },
  { baseUrl: "not a url" },
  { baseUrl: "http://" },
  { baseUrl: "https:///path" },
  { baseUrl: "http://a" },
  { baseUrl: "https://xn--nxasmq6b.example" },
  { baseUrl: "https://example.com", extra: true },
])
  manifests.push(mut(manifest, (m) => (m.service = service)));
const manifestCases = manifests.map((value) => ({ value, expect: validatePluginManifest(value) }));

// ---- editor card -----------------------------------------------------------------------------
const doc = { schemaVersion: 1, id: "d1", title: "T", blocks: [] };
const editor = { kind: "super-editor.document", title: "A", mode: "edit", document: doc };
const editors = [
  editor,
  mut(editor, (s) => delete s.title),
  mut(editor, (s) => delete s.mode),
  mut(editor, (s) => (s.mode = "view")),
  mut(editor, (s) => (s.mode = "write")),
  mut(editor, (s) => (s.title = 5)),
  mut(editor, (s) => (s.kind = "other")),
  mut(editor, (s) => delete s.kind),
  mut(editor, (s) => delete s.document),
  mut(editor, (s) => (s.service = { baseUrl: "https://e.example", documentId: "x" })),
  { kind: "super-editor.document", service: { baseUrl: "https://e.example", documentId: "x" } },
  { kind: "super-editor.document", mode: "view", service: { baseUrl: "https://e.example", documentId: "x" } },
  { kind: "super-editor.document", mode: "edit", service: { baseUrl: "https://e.example", documentId: "x" } },
  { kind: "super-editor.document", service: { baseUrl: "https://e.example", documentId: "" } },
  { kind: "super-editor.document", service: { baseUrl: "ftp://e.example", documentId: "x" } },
  { kind: "super-editor.document", service: { baseUrl: "nope", documentId: "x" } },
  { kind: "super-editor.document", service: { baseUrl: "https://e.example" } },
  { kind: "super-editor.document", service: { documentId: "x" } },
  { kind: "super-editor.document", service: null },
  { kind: "super-editor.document", service: "s" },
  { kind: "super-editor.document", service: [] },
  { kind: "super-editor.document", document: null },
  { kind: "super-editor.document", document: [] },
  { kind: "super-editor.document", document: "d" },
  { kind: "super-editor.document", document: { ...doc, schemaVersion: 2 } },
  { kind: "super-editor.document", document: { ...doc, schemaVersion: "1" } },
  { kind: "super-editor.document", document: { ...doc, id: 1 } },
  { kind: "super-editor.document", document: { ...doc, title: null } },
  { kind: "super-editor.document", document: { ...doc, blocks: {} } },
  { kind: "super-editor.document", document: { schemaVersion: 1, id: "d", title: "t" } },
  { kind: "super-editor.document", document: { ...doc, extra: [1, 2] } },
  { kind: "super-editor.document", document: doc, service: { baseUrl: "https://e.example", documentId: "x" } },
  null,
  [],
  "x",
  7,
  {},
];
const editorCases = editors.map((value) => ({ value, expect: validateEditorCardSpec(value) }));

// ---- chart card ------------------------------------------------------------------------------
const bar = (t, o, h, l, c, v) => (v === undefined ? { timestamp: t, open: o, high: h, low: l, close: c } : { timestamp: t, open: o, high: h, low: l, close: c, volume: v });
const chart = {
  kind: "super-chart.chart",
  id: "c1",
  title: "BTC",
  symbol: { ticker: "BTCUSDT", name: "Bitcoin", pricePrecision: 2 },
  period: { multiplier: 1, timespan: "day", text: "1D" },
  height: 420,
  chartType: "candles",
  bars: [bar(1000, 10, 12, 9, 11, 100), bar(2000, 11, 13, 10, 12), bar(3000, 12, 12, 12, 12, 0)],
  indicators: [{ name: "MA", params: [5, 10] }, { name: "RSI" }],
  annotations: [
    { key: "a1", kind: "level", anchors: [{ time: 1000, price: 10 }], text: "support", tone: "bull" },
    { key: "a2", kind: "zone", anchors: [{ time: 1000, price: 9 }, { time: 3000, price: 13 }], color: "#fff" },
    { key: "a3", kind: "marker", anchors: [{ time: 2000 }] },
  ],
};
const charts = [
  chart,
  mut(chart, (s) => delete s.id),
  mut(chart, (s) => delete s.title),
  mut(chart, (s) => delete s.height),
  mut(chart, (s) => delete s.chartType),
  mut(chart, (s) => delete s.indicators),
  mut(chart, (s) => delete s.annotations),
  mut(chart, (s) => (s.kind = "x")),
  mut(chart, (s) => (s.id = "")),
  mut(chart, (s) => (s.id = "  ")),
  mut(chart, (s) => (s.id = "x".repeat(128))),
  mut(chart, (s) => (s.id = "x".repeat(129))),
  mut(chart, (s) => (s.id = 5)),
  mut(chart, (s) => (s.title = 5)),
];
for (const symbol of [
  undefined,
  null,
  [],
  "BTC",
  {},
  { ticker: "" },
  { ticker: "  " },
  { ticker: 3 },
  { ticker: "A", name: 1 },
  { ticker: "A", logo: "u", timezone: "UTC", exchange: "X", market: "m", priceCurrency: "USD", type: "t", shortName: "s" },
  { ticker: "A", timezone: 5 },
  { ticker: "A", pricePrecision: "auto" },
  { ticker: "A", pricePrecision: 0 },
  { ticker: "A", pricePrecision: 12 },
  { ticker: "A", pricePrecision: 13 },
  { ticker: "A", pricePrecision: -1 },
  { ticker: "A", pricePrecision: 1.5 },
  { ticker: "A", pricePrecision: "2" },
  { ticker: "A", pricePrecision: null },
])
  charts.push(mut(chart, (s) => (symbol === undefined ? delete s.symbol : (s.symbol = symbol))));
for (const period of [
  undefined,
  null,
  [],
  {},
  { multiplier: 0, timespan: "day", text: "x" },
  { multiplier: -1, timespan: "day", text: "x" },
  { multiplier: 1.5, timespan: "day", text: "x" },
  { multiplier: "1", timespan: "day", text: "x" },
  { multiplier: 9007199254740991, timespan: "day", text: "x" },
  { multiplier: 9007199254740992, timespan: "day", text: "x" },
  { multiplier: 5, timespan: "", text: "x" },
  { multiplier: 5, timespan: " ", text: "x" },
  { multiplier: 5, timespan: 1, text: "x" },
  { multiplier: 5, timespan: "minute", text: "" },
  { multiplier: 5, timespan: "minute", text: "5m" },
])
  charts.push(mut(chart, (s) => (period === undefined ? delete s.period : (s.period = period))));
for (const height of [159, 160, 420, 1200, 1201, "420", null, 300.5, -5, 0])
  charts.push(mut(chart, (s) => (s.height = height)));
for (const t of ["candles", "hollow-candles", "ohlc", "line", "area", "baseline", "heikin-ashi", "renko", "", 1, null])
  charts.push(mut(chart, (s) => (s.chartType = t)));
// bars xor feed, and bar shape
charts.push(mut(chart, (s) => ((s.feed = { id: "f" }), 0)));
charts.push(mut(chart, (s) => (delete s.bars, (s.feed = { id: "f" }))));
for (const feed of [{ id: "" }, { id: "  " }, { id: 1 }, {}, null, "f", []])
  charts.push(mut(chart, (s) => (delete s.bars, (s.feed = feed))));
charts.push(mut(chart, (s) => delete s.bars));
for (const bars of [
  [],
  null,
  "x",
  {},
  [null],
  [1],
  [bar(1, 1, 1, 1, 1)],
  [bar(2, 1, 1, 1, 1), bar(1, 1, 1, 1, 1)],
  [bar(1, 1, 1, 1, 1), bar(1, 1, 1, 1, 1)],
  [bar(1, 1, 2, 0, 1), bar(2, 1, 2, 0, 1), bar(3, 1, 2, 0, 1)],
  [bar(1, 5, 4, 1, 3)],
  [bar(1, 5, 6, 5.5, 5.8)],
  [bar(1, 5, 6, 4, 7)],
  [bar(1, 5, 6, 4, 3)],
  [bar(1, 5, 6, 4, 5)],
  [bar(1, 5, 5, 5, 5)],
  [{ timestamp: 1, open: 1, high: 1, low: 1 }],
  [{ timestamp: "1", open: 1, high: 1, low: 1, close: 1 }],
  [{ timestamp: 1, open: null, high: 1, low: 1, close: 1 }],
  [{ ...bar(1, 1, 1, 1, 1), volume: "10" }],
  [{ ...bar(1, 1, 1, 1, 1), volume: null }],
  [bar(1, 1, 1, 1, 1, 7)],
  [bar(-5, 1, 1, 1, 1), bar(0, 1, 1, 1, 1), bar(1.5, 1, 1, 1, 1)],
  [bar(1e15, 1e300, 1e300, 1e-300, 1e300)],
  [{ ...bar(1, 1, 1, 1, 1), extra: true }],
])
  charts.push(mut(chart, (s) => (s.bars = bars)));
// random valid and slightly broken bar series
for (let n = 0; n < 30; n++) {
  const bars = [];
  let t = rand(5000) - 2000;
  for (let i = 0; i < 1 + rand(8); i++) {
    t += 1 + rand(3600);
    const o = rand(1000) / 8,
      c = rand(1000) / 8;
    const h = Math.max(o, c) + rand(50) / 8,
      l = Math.min(o, c) - rand(50) / 8;
    bars.push(rand(10) === 0 ? bar(t, o, h, l, c, rand(1e6)) : bar(t, o, h, l, c));
  }
  if (n % 3 === 1 && bars.length > 1) bars[1].timestamp = bars[0].timestamp - rand(2);
  if (n % 3 === 2) bars[bars.length - 1].high = Math.min(bars[bars.length - 1].open, bars[bars.length - 1].close) - 1;
  charts.push(mut(chart, (s) => (s.bars = bars)));
}
// indicators
const many = (k) => Array.from({ length: k }, (_, i) => ({ name: "I" + i }));
for (const indicators of [
  [],
  many(12),
  many(13),
  null,
  "MA",
  {},
  [null],
  ["MA"],
  [{}],
  [{ name: "" }],
  [{ name: " " }],
  [{ name: 1 }],
  [{ name: "MA", params: [] }],
  [{ name: "MA", params: [1, 2.5, -3] }],
  [{ name: "MA", params: "5" }],
  [{ name: "MA", params: [1, "2"] }],
  [{ name: "MA", params: [1, null] }],
  [{ name: "MA", params: {} }],
])
  charts.push(mut(chart, (s) => (s.indicators = indicators)));
// annotations
const lvl = (key, extra = {}) => ({ key, kind: "level", anchors: [{ time: 1, price: 2 }], ...extra });
const manyAnn = (k) => Array.from({ length: k }, (_, i) => lvl("k" + i));
for (const annotations of [
  [],
  manyAnn(256),
  manyAnn(257),
  null,
  "a",
  {},
  [null],
  [1],
  [[]],
  [lvl("")],
  [lvl("  ")],
  [lvl("x".repeat(128))],
  [lvl("x".repeat(129))],
  [lvl("😀".repeat(64))],
  [lvl("😀".repeat(65))],
  [lvl(5)],
  [lvl("a"), lvl("a")],
  [lvl("a"), lvl("b")],
  [{ key: "a", kind: "line", anchors: [{ time: 1, price: 2 }] }],
  [{ key: "a", anchors: [{ time: 1, price: 2 }] }],
  [{ key: "a", kind: "level" }],
  [{ key: "a", kind: "level", anchors: [] }],
  [{ key: "a", kind: "level", anchors: "x" }],
  [{ key: "a", kind: "level", anchors: [{ time: 1, price: 2 }, { time: 2, price: 3 }, { time: 3, price: 4 }] }],
  [{ key: "a", kind: "level", anchors: [{ time: 1 }] }],
  [{ key: "a", kind: "level", anchors: [{ time: 1, price: 2 }, { time: 2, price: 3 }] }],
  [{ key: "a", kind: "level", anchors: [{ price: 2 }] }],
  [{ key: "a", kind: "level", anchors: [{ time: "1", price: 2 }] }],
  [{ key: "a", kind: "level", anchors: [{ time: 1, price: "2" }] }],
  [{ key: "a", kind: "level", anchors: [{ time: 1, price: null }] }],
  [{ key: "a", kind: "level", anchors: [null] }],
  [{ key: "a", kind: "level", anchors: [[]] }],
  [{ key: "a", kind: "zone", anchors: [{ time: 1, price: 2 }] }],
  [{ key: "a", kind: "zone", anchors: [{ time: 1, price: 2 }, { time: 2 }] }],
  [{ key: "a", kind: "zone", anchors: [{ time: 1, price: 2 }, { time: 2, price: 3 }] }],
  [{ key: "a", kind: "marker", anchors: [{ time: 1 }] }],
  [{ key: "a", kind: "marker", anchors: [{ time: 1, price: 5 }] }],
  [{ key: "a", kind: "marker", anchors: [{ time: 1 }, { time: 2 }] }],
  [lvl("a", { text: "t".repeat(2048) })],
  [lvl("a", { text: "t".repeat(2049) })],
  [lvl("a", { text: "😀".repeat(1024) })],
  [lvl("a", { text: "😀".repeat(1025) })],
  [lvl("a", { text: 5 })],
  [lvl("a", { text: "" })],
  [lvl("a", { tone: "bull" })],
  [lvl("a", { tone: "bear" })],
  [lvl("a", { tone: "neutral" })],
  [lvl("a", { tone: "accent" })],
  [lvl("a", { tone: "loud" })],
  [lvl("a", { tone: 1 })],
  [lvl("a", { color: "red" })],
  [lvl("a", { color: "c".repeat(128) })],
  [lvl("a", { color: "c".repeat(129) })],
  [lvl("a", { color: 5 })],
])
  charts.push(mut(chart, (s) => (s.annotations = annotations)));
charts.push(null, [], "x", 3, {}, { kind: "super-chart.chart" });
const chartCases = charts.map((value) => ({ value, expect: validateChartCardSpec(value) }));

// ---- terminal events -------------------------------------------------------------------------
const terminalCases = [
  "request.started",
  "output.delta",
  "request.completed",
  "request.failed",
  "request.replayed",
  "",
  "request.Completed",
  "x",
].map((type) => ({ type, expect: isTerminalEvent({ type }) }));

// ---- SSE parser ------------------------------------------------------------------------------
const enc = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
async function runSSE(chunks, maxFrameBytes) {
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  const frames = [];
  try {
    for await (const f of maxFrameBytes === undefined ? parseSSE(body) : parseSSE(body, maxFrameBytes)) frames.push(f);
  } catch (e) {
    return { frames, error: e.code ?? String(e) };
  }
  return { frames };
}
function split(bytes, parts) {
  const cuts = new Set();
  for (let i = 0; i < parts - 1; i++) cuts.add(rand(bytes.length + 1));
  const sorted = [...cuts].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const c of [...sorted, bytes.length]) {
    out.push(bytes.slice(prev, c));
    prev = c;
  }
  return out;
}
const sseTexts = [
  "event: output.delta\ndata: {\"text\":\"hi\"}\n\n",
  "data: one\n\ndata: two\n\n",
  "event: a\r\ndata: b\r\n\r\nevent: c\r\ndata: d\r\n\r\n",
  "data: line1\ndata: line2\ndata: line3\n\n",
  "event: x\n\n",
  "data:\n\n",
  "data: \n\n",
  "data:  two spaces\n\n",
  "data:nospace\n\n",
  "event:  padded  \ndata: v\n\n",
  "event: first\nevent: second\ndata: v\n\n",
  "data: only\n",
  "data: only\n\ndata: unterminated",
  ": comment\ndata: after comment\n\n",
  "id: 7\nretry: 100\ndata: ignored fields\n\n",
  "dataX: no\n\ndata: yes\n\n",
  "data\n\ndata: bare\n\n",
  "data: a\r\n\ndata: b\n\r\n",
  "data: lone\rcarriage\n\n",
  "\n\n\n\ndata: leading blanks\n\n",
  "data: é日本😀\n\n",
  "event: 事件\ndata: 😀😀😀\n\n",
  "data: x\n\n\n\ndata: y\n\n",
  "event: e\n\n\ndata: d\n\n",
  "data: a\n \ndata: b\n\n",
  "",
  "\n\n",
  "garbage without terminator",
];
for (let i = 0; i < 40; i++) {
  let t = "";
  for (let f = 0; f < 1 + rand(6); f++) {
    const eol = rand(3) === 0 ? "\r\n" : "\n";
    if (rand(2)) t += "event: " + pick(["output.delta", "request.started", "request.completed", "ping", "é"]) + eol;
    for (let l = 0; l < 1 + rand(3); l++)
      t += "data: " + pick(["{\"text\":\"a\"}", "x", "日本語", "😀 emoji", "", "  lead", "a:b"]) + eol;
    t += eol;
  }
  sseTexts.push(t);
}
const sseCases = [];
for (const text of sseTexts) {
  const bytes = enc.encode(text);
  for (const parts of [1, 2, 3, 7, bytes.length || 1]) {
    const chunks = split(bytes, parts);
    const maxFrameBytes = undefined;
    sseCases.push({ chunks: chunks.map(hex), expect: await runSSE(chunks, maxFrameBytes) });
  }
}
// frame size limits
for (const [text, limit] of [
  ["data: " + "x".repeat(100) + "\n\n", 50],
  ["data: " + "x".repeat(100) + "\n\n", 200],
  ["data: x\n\n", 8],
  ["data: x\n\n", 9],
  ["data: x\n\n", 10],
  ["data: x\n\ndata: y\n\n", 10],
  ["data: " + "x".repeat(30), 20],
  ["data: " + "😀".repeat(10) + "\n\n", 30],
  ["data: " + "😀".repeat(10) + "\n\n", 26],
  ["data: " + "😀".repeat(10) + "\n\n", 27],
  ["data: x\n\n".repeat(20), 10],
  ["data: " + "é".repeat(20) + "\n\n", 40],
]) {
  const bytes = enc.encode(text);
  for (const parts of [1, 4, bytes.length]) {
    const chunks = split(bytes, parts);
    sseCases.push({ chunks: chunks.map(hex), max_frame_bytes: limit, expect: await runSSE(chunks, limit) });
  }
}

// A UTF-8 byte order mark opens the stream: the reference's TextDecoder drops it (only at the very
// start), so the first frame must still be found. A later U+FEFF is ordinary text.
for (const [text, limit] of [
  ["\ufeffdata: after bom\n\n", undefined],
  ["\ufeffevent: e\r\ndata: d\r\n\r\n", undefined],
  ["\ufeff\ufeffdata: second bom is text\n\ndata: ok\n\n", undefined],
  ["data: a\n\n\ufeffdata: mid-stream bom is text\n\ndata: b\n\n", undefined],
  ["\ufeff", undefined],
  ["\ufeffdata: x\n\n", 8],
  ["\ufeffdata: x\n\n", 9],
]) {
  const bytes = enc.encode(text);
  // Every cut position, so the BOM's three bytes are split at each possible place.
  for (const parts of [1, 2, 3, bytes.length]) {
    const chunks = split(bytes, parts);
    sseCases.push({
      chunks: chunks.map(hex),
      ...(limit === undefined ? {} : { max_frame_bytes: limit }),
      expect: await runSSE(chunks, limit),
    });
  }
}

const out = {
  version: 1,
  note: "Generated by scripts/export-conformance.mjs from the TypeScript reference in packages/protocol. Manifest and card validators return their issue lists or result objects as is; sse chunks are hex-encoded bytes.",
  plugin_manifest: manifestCases,
  editor_card: editorCases,
  chart_card: chartCases,
  terminal_event: terminalCases,
  sse: sseCases,
};
const lines = (key) => out[key].map((c) => "  " + JSON.stringify(c)).join(",\n");
const body =
  `{\n "version": 1,\n "note": ${JSON.stringify(out.note)},\n` +
  ["plugin_manifest", "editor_card", "chart_card", "terminal_event", "sse"]
    .map((k) => ` "${k}": [\n${lines(k)}\n ]`)
    .join(",\n") +
  "\n}\n";
writeFileSync(new URL("../conformance/protocol.v1.json", import.meta.url), body);
const ok = (cases) => cases.filter((c) => (Array.isArray(c.expect) ? c.expect.length === 0 : c.expect?.ok === true)).length;
console.log(
  `manifest ${manifestCases.length} (${ok(manifestCases)} valid), editor ${editorCases.length} (${ok(editorCases)} valid), chart ${chartCases.length} (${ok(chartCases)} valid), terminal ${terminalCases.length}, sse ${sseCases.length} (${sseCases.filter((c) => c.expect.error).length} errors)`,
);
