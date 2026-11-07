/**
 * How a financial chart travels through chat: the market-data contracts, the
 * annotation spec, the card kind and its validator. The chart package (any
 * license) implements the renderer and the feed adapters; hosts and agents only
 * need this file to produce and route the card.
 *
 * The data contracts are the neutral subset every chart backend needs. They are
 * structurally identical to the types of `@supersolutions/super-chart-core`, so
 * a datafeed written against either is accepted by the other.
 */
import type { CardKindDefinition, CardValidationResult } from "./chat.js";

export const CHART_CARD_KIND = "super-chart.chart";

/** One OHLCV bar. `timestamp` is the bar open time in milliseconds. */
export interface MarketBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  turnover?: number;
  [key: string]: unknown;
}

export type Timespan = "second" | "minute" | "hour" | "day" | "week" | "month" | "year" | (string & {});

export interface SymbolInfo {
  ticker: string;
  name?: string;
  shortName?: string;
  exchange?: string;
  market?: string;
  /** Decimals on the price axis; "auto" derives it from the loaded prices. */
  pricePrecision?: number | "auto";
  volumePrecision?: number;
  priceCurrency?: string;
  type?: string;
  logo?: string;
  /** IANA zone in which this symbol's daily and longer bars open. Default UTC. */
  timezone?: string;
}

export interface Period {
  multiplier: number;
  timespan: Timespan;
  /** Label shown to the user, for example "1h" or "1D". */
  text: string;
}

export interface HistoryRequest {
  /** Aborted when the answer is no longer wanted. */
  signal: AbortSignal;
  /** True for the first request of a series, false for scroll-back and catch-up. */
  firstDataRequest: boolean;
  /** How many bars the chart wants (a size hint). */
  countBack: number;
  /** Scroll-back only: answer with bars strictly older than this timestamp. */
  before?: number;
}

export interface HistoryResult {
  bars: MarketBar[];
  /** True: nothing exists before these bars. */
  noData?: boolean;
}

export interface SearchRequest {
  signal: AbortSignal;
}

export type DatafeedSubscribeCallback = (data: MarketBar | MarketBar[]) => void;

/** A market-data source. Bars are `from <= timestamp < to`, oldest first. */
export interface Datafeed {
  searchSymbols(search?: string, request?: SearchRequest): Promise<SymbolInfo[]>;
  getHistoryKLineData(symbol: SymbolInfo, period: Period, from: number, to: number, request?: HistoryRequest): Promise<MarketBar[] | HistoryResult>;
  subscribe(symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void;
  unsubscribe(symbol: SymbolInfo, period: Period): void;
  resolvePeriod?(period: Pick<Period, "multiplier" | "timespan">): Period | null;
}

export type ChartAnnotationKind = "level" | "zone" | "marker";
export type ChartAnnotationTone = "bull" | "bear" | "neutral" | "accent";

/**
 * A mark an agent or a person places on the chart. `level` is a horizontal
 * price line (one anchor, price required); `zone` is a price band over a time
 * range (two anchors, prices required); `marker` is a point label (one anchor).
 * Time is milliseconds since the epoch, like bars.
 */
export interface ChartAnnotation {
  key: string;
  kind: ChartAnnotationKind;
  anchors: Array<{ time: number; price?: number }>;
  text?: string;
  tone?: ChartAnnotationTone;
  /** CSS color; overrides the tone. */
  color?: string;
}

export interface ChartIndicator {
  /** A registered indicator name, for example "MA", "RSI", "MACD". */
  name: string;
  params?: number[];
}

export const CHART_TYPES = ["candles", "hollow-candles", "ohlc", "line", "area", "baseline", "heikin-ashi"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartCardSpec {
  kind: typeof CHART_CARD_KIND;
  /** Stable id so a later tool call can address this chart. */
  id?: string;
  title?: string;
  symbol: SymbolInfo;
  period: Period;
  /** Height in CSS pixels. Default 420. */
  height?: number;
  chartType?: ChartType;
  /** Inline snapshot of bars (oldest first). Exactly one of `bars` or `feed`. */
  bars?: MarketBar[];
  /** A datafeed the host registered under this id. */
  feed?: { id: string };
  indicators?: ChartIndicator[];
  annotations?: ChartAnnotation[];
}

export const CHART_LIMITS = Object.freeze({ bars: 20000, annotations: 256, indicators: 12, anchors: 2, textLength: 2048, keyLength: 128, height: [160, 1200] as const });

const fail = (error: string, expected?: string): CardValidationResult => (expected ? { ok: false, error, expected } : { ok: false, error });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validatePeriod(v: unknown): string | null {
  if (!isObject(v)) return "period must be an object.";
  if (!Number.isSafeInteger(v.multiplier) || (v.multiplier as number) <= 0) return "period.multiplier must be a positive integer.";
  if (typeof v.timespan !== "string" || v.timespan.trim() === "") return "period.timespan must be a non-empty string.";
  if (typeof v.text !== "string" || v.text.trim() === "") return "period.text must be a non-empty string.";
  return null;
}

export function validateSymbol(v: unknown): string | null {
  if (!isObject(v)) return "symbol must be an object.";
  if (typeof v.ticker !== "string" || v.ticker.trim() === "") return "symbol.ticker must be a non-empty string.";
  for (const k of ["name", "shortName", "exchange", "market", "priceCurrency", "type", "logo", "timezone"] as const) {
    if (v[k] !== undefined && typeof v[k] !== "string") return `symbol.${k} must be a string.`;
  }
  if (v.pricePrecision !== undefined && v.pricePrecision !== "auto" && !(Number.isInteger(v.pricePrecision) && (v.pricePrecision as number) >= 0 && (v.pricePrecision as number) <= 12)) return 'symbol.pricePrecision must be an integer from 0 to 12 or "auto".';
  return null;
}

export function validateMarketBar(v: unknown): string | null {
  if (!isObject(v)) return "a bar must be an object.";
  for (const k of ["timestamp", "open", "high", "low", "close"] as const) if (!finite(v[k])) return `bar.${k} must be a finite number.`;
  if (v.volume !== undefined && !finite(v.volume)) return "bar.volume must be a finite number.";
  if ((v.high as number) < Math.max(v.open as number, v.close as number, v.low as number) || (v.low as number) > Math.min(v.open as number, v.close as number)) return "bar high/low must contain open and close.";
  return null;
}

export function validateChartAnnotation(v: unknown): string | null {
  if (!isObject(v)) return "an annotation must be an object.";
  if (typeof v.key !== "string" || v.key.trim() === "" || v.key.length > CHART_LIMITS.keyLength) return `annotation.key must be a non-empty string of at most ${CHART_LIMITS.keyLength} characters.`;
  if (v.kind !== "level" && v.kind !== "zone" && v.kind !== "marker") return 'annotation.kind must be "level", "zone" or "marker".';
  if (!Array.isArray(v.anchors) || v.anchors.length === 0 || v.anchors.length > CHART_LIMITS.anchors) return "annotation.anchors must hold one or two anchors.";
  for (const a of v.anchors) {
    if (!isObject(a) || !finite(a.time)) return "annotation anchors need a finite time.";
    if (a.price !== undefined && !finite(a.price)) return "annotation anchor price must be a finite number.";
  }
  const anchors = v.anchors as Array<{ price?: number }>;
  if (v.kind === "level" && (anchors.length !== 1 || anchors[0]?.price === undefined)) return "a level needs exactly one anchor with a price.";
  if (v.kind === "zone" && (anchors.length !== 2 || anchors.some((a) => a.price === undefined))) return "a zone needs two anchors, both with a price.";
  if (v.kind === "marker" && anchors.length !== 1) return "a marker needs exactly one anchor.";
  if (v.text !== undefined && (typeof v.text !== "string" || v.text.length > CHART_LIMITS.textLength)) return `annotation.text must be a string of at most ${CHART_LIMITS.textLength} characters.`;
  if (v.tone !== undefined && !["bull", "bear", "neutral", "accent"].includes(v.tone as string)) return "annotation.tone must be bull, bear, neutral or accent.";
  if (v.color !== undefined && (typeof v.color !== "string" || v.color.length > 128)) return "annotation.color must be a short CSS color string.";
  return null;
}

export function validateChartAnnotations(v: unknown): string | null {
  if (!Array.isArray(v)) return "annotations must be an array.";
  if (v.length > CHART_LIMITS.annotations) return `at most ${CHART_LIMITS.annotations} annotations per chart.`;
  const keys = new Set<string>();
  for (const item of v) {
    const problem = validateChartAnnotation(item);
    if (problem) return problem;
    const key = (item as ChartAnnotation).key;
    if (keys.has(key)) return `duplicate annotation key "${key}".`;
    keys.add(key);
  }
  return null;
}

export function validateChartCardSpec(spec: unknown): CardValidationResult {
  if (!isObject(spec)) return fail("Chart card spec must be an object.");
  if (spec.kind !== CHART_CARD_KIND) return fail(`kind must be "${CHART_CARD_KIND}".`);
  if (spec.id !== undefined && (typeof spec.id !== "string" || spec.id.trim() === "" || spec.id.length > 128)) return fail("id must be a non-empty string.");
  if (spec.title !== undefined && typeof spec.title !== "string") return fail("title must be a string.");
  const problem = validateSymbol(spec.symbol) ?? validatePeriod(spec.period);
  if (problem) return fail(problem);
  if (spec.height !== undefined && !(finite(spec.height) && spec.height >= CHART_LIMITS.height[0] && spec.height <= CHART_LIMITS.height[1])) return fail(`height must be ${CHART_LIMITS.height[0]}..${CHART_LIMITS.height[1]} pixels.`);
  if (spec.chartType !== undefined && !CHART_TYPES.includes(spec.chartType as ChartType)) return fail(`chartType must be one of ${CHART_TYPES.join(", ")}.`);
  const hasBars = spec.bars !== undefined;
  const hasFeed = spec.feed !== undefined;
  if (hasBars === hasFeed) return fail("Provide exactly one of `bars` or `feed`.", "bars: [{timestamp, open, high, low, close, volume?}] | feed: { id }");
  if (hasBars) {
    if (!Array.isArray(spec.bars) || spec.bars.length === 0) return fail("bars must be a non-empty array.");
    if (spec.bars.length > CHART_LIMITS.bars) return fail(`at most ${CHART_LIMITS.bars} inline bars; reference a feed for more.`);
    let previous = -Infinity;
    for (const bar of spec.bars) {
      const bad = validateMarketBar(bar);
      if (bad) return fail(bad);
      const t = (bar as MarketBar).timestamp;
      if (t <= previous) return fail("bars must be sorted oldest first with unique timestamps.");
      previous = t;
    }
  } else if (!isObject(spec.feed) || typeof spec.feed.id !== "string" || spec.feed.id.trim() === "") {
    return fail("feed needs a non-empty id.");
  }
  if (spec.indicators !== undefined) {
    if (!Array.isArray(spec.indicators) || spec.indicators.length > CHART_LIMITS.indicators) return fail(`indicators must be an array of at most ${CHART_LIMITS.indicators}.`);
    for (const i of spec.indicators) {
      if (!isObject(i) || typeof i.name !== "string" || i.name.trim() === "") return fail("each indicator needs a name.");
      if (i.params !== undefined && (!Array.isArray(i.params) || !i.params.every(finite))) return fail("indicator params must be an array of finite numbers.");
    }
  }
  if (spec.annotations !== undefined) {
    const bad = validateChartAnnotations(spec.annotations);
    if (bad) return fail(bad);
  }
  return { ok: true };
}

export const chartCardKind: CardKindDefinition = {
  kind: CHART_CARD_KIND,
  summary: "A financial chart the user can pan, zoom, draw on and replay: candles or lines, indicators, and your annotations (levels, zones, markers).",
  schema: {
    type: "object",
    required: ["kind", "symbol", "period"],
    properties: {
      kind: { const: CHART_CARD_KIND },
      id: { type: "string", description: "Stable id so later tool calls can address this chart." },
      title: { type: "string" },
      symbol: { type: "object", required: ["ticker"], properties: { ticker: { type: "string" }, name: { type: "string" }, exchange: { type: "string" }, pricePrecision: { type: ["integer", "string"] }, timezone: { type: "string" } } },
      period: { type: "object", required: ["multiplier", "timespan", "text"], properties: { multiplier: { type: "integer", minimum: 1 }, timespan: { type: "string" }, text: { type: "string" } } },
      height: { type: "number", minimum: CHART_LIMITS.height[0], maximum: CHART_LIMITS.height[1] },
      chartType: { enum: [...CHART_TYPES] },
      bars: { type: "array", description: "Inline OHLCV bars, oldest first. Use this or `feed`.", maxItems: CHART_LIMITS.bars },
      feed: { type: "object", required: ["id"], properties: { id: { type: "string" } }, description: "A datafeed the host registered." },
      indicators: { type: "array", maxItems: CHART_LIMITS.indicators, items: { type: "object", required: ["name"], properties: { name: { type: "string" }, params: { type: "array", items: { type: "number" } } } } },
      annotations: { type: "array", maxItems: CHART_LIMITS.annotations, items: { type: "object", required: ["key", "kind", "anchors"], properties: { key: { type: "string" }, kind: { enum: ["level", "zone", "marker"] }, anchors: { type: "array", maxItems: 2 }, text: { type: "string" }, tone: { enum: ["bull", "bear", "neutral", "accent"] }, color: { type: "string" } } } },
    },
  },
  validate: validateChartCardSpec,
};
