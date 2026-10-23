// Demo domain tools.
//
// Data is synthesised from a seeded PRNG rather than fetched, so the playground
// runs with nothing but an OpenAI key and produces the same series on every
// reload — a chart that reshuffles each render makes it impossible to tell a
// rendering bug from new data.

import { withCard, type ToolDefinition } from "@super-solution/super-chat-core";

const INSTRUMENTS = [
  { symbol: "SUI", name: "Sui", venue: "crypto", base: 3.42 },
  { symbol: "SOL", name: "Solana", venue: "crypto", base: 178.2 },
  { symbol: "BTC", name: "Bitcoin", venue: "crypto", base: 94_300 },
  { symbol: "ETH", name: "Ethereum", venue: "crypto", base: 3_180 },
  { symbol: "NVDA", name: "NVIDIA", venue: "equity", base: 138.6 },
  { symbol: "AAPL", name: "Apple", venue: "equity", base: 241.5 },
];

/** Deterministic PRNG so a given symbol always yields the same series. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100_000) / 100_000;
  };
}

function series(symbol: string, days: number) {
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol.toUpperCase());
  const base = inst?.base ?? 100;
  const rand = seeded(symbol.toUpperCase());
  const out: { t: number; o: number; h: number; l: number; c: number; v: number }[] = [];
  let price = base * (0.82 + rand() * 0.1);
  const start = Date.UTC(2026, 5, 1);

  for (let i = 0; i < days; i += 1) {
    const drift = (rand() - 0.46) * 0.045;
    const o = price;
    const c = Math.max(0.0001, o * (1 + drift));
    const h = Math.max(o, c) * (1 + rand() * 0.018);
    const l = Math.min(o, c) * (1 - rand() * 0.018);
    out.push({ t: start + i * 86_400_000, o, h, l, c, v: Math.round(rand() * 900_000 + 100_000) });
    price = c;
  }
  return out;
}

export const listInstruments: ToolDefinition = {
  name: "listInstruments",
  side: "read",
  description:
    "Search available instruments by name or symbol. Call this when the user's term could mean more than one thing, then present the matches as a `choice` card.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string", description: "Partial name, symbol, or an empty string for everything." } },
    additionalProperties: false,
  },
  execute(input) {
    const { query = "" } = (input ?? {}) as { query?: string };
    const q = query.trim().toLowerCase();
    const matches = q
      ? INSTRUMENTS.filter((i) => i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q))
      : INSTRUMENTS;
    return { output: { count: matches.length, instruments: matches.map(({ symbol, name, venue }) => ({ symbol, name, venue })) } };
  },
};

export const getQuote: ToolDefinition = {
  name: "getQuote",
  side: "read",
  description: "Current price and 24h change for one instrument. Renders a stats card.",
  inputSchema: {
    type: "object",
    required: ["symbol"],
    properties: { symbol: { type: "string" } },
    additionalProperties: false,
  },
  execute(input) {
    const { symbol } = (input ?? {}) as { symbol?: string };
    const inst = INSTRUMENTS.find((i) => i.symbol === String(symbol).toUpperCase());
    if (!inst) {
      // Naming the alternatives is what lets the model self-correct instead of
      // retrying the same bad symbol.
      return {
        output: { error: `Unknown symbol "${symbol}".`, known: INSTRUMENTS.map((i) => i.symbol) },
        failure: "not-found" as const,
      };
    }
    const bars = series(inst.symbol, 30);
    const last = bars.at(-1)!;
    const prev = bars.at(-2)!;
    const change = ((last.c - prev.c) / prev.c) * 100;
    const high = Math.max(...bars.map((b) => b.h));
    const low = Math.min(...bars.map((b) => b.l));

    const data = {
      symbol: inst.symbol,
      name: inst.name,
      price: Number(last.c.toFixed(4)),
      change24h: Number(change.toFixed(2)),
      high30d: Number(high.toFixed(4)),
      low30d: Number(low.toFixed(4)),
    };

    // The card rides along with the data; the ContextBuilder strips it before
    // the next provider call so it is never billed twice.
    return {
      output: withCard(data, {
        kind: "stats",
        title: `${inst.name} (${inst.symbol})`,
        items: [
          { label: "Price", value: data.price, format: "currency" },
          { label: "24h", value: data.change24h, format: "percent", delta: data.change24h, deltaFormat: "percent" },
          { label: "30d high", value: data.high30d, format: "currency" },
          { label: "30d low", value: data.low30d, format: "currency" },
        ],
      }),
    };
  },
};

export const getHistory: ToolDefinition = {
  name: "getHistory",
  side: "read",
  description:
    "Daily OHLC history for one instrument. Render as a `chart` — variant `candlestick` for price action, `series` for a simple trend line.",
  inputSchema: {
    type: "object",
    required: ["symbol"],
    properties: {
      symbol: { type: "string" },
      days: { type: "number", description: "How many days back. Default 30, max 180." },
    },
    additionalProperties: false,
  },
  execute(input) {
    const { symbol, days = 30 } = (input ?? {}) as { symbol?: string; days?: number };
    const inst = INSTRUMENTS.find((i) => i.symbol === String(symbol).toUpperCase());
    if (!inst) {
      return { output: { error: `Unknown symbol "${symbol}".`, known: INSTRUMENTS.map((i) => i.symbol) }, failure: "not-found" as const };
    }
    const n = Math.max(5, Math.min(180, Math.round(days)));
    const bars = series(inst.symbol, n);

    // The model gets a SUMMARY, not 180 candles — the card carries the points.
    // Sending both would spend thousands of tokens on data it cannot use.
    const closes = bars.map((b) => b.c);
    return {
      output: withCard(
        {
          symbol: inst.symbol,
          points: bars.length,
          first: Number(closes[0]!.toFixed(4)),
          last: Number(closes.at(-1)!.toFixed(4)),
          changePct: Number((((closes.at(-1)! - closes[0]!) / closes[0]!) * 100).toFixed(2)),
          high: Number(Math.max(...bars.map((b) => b.h)).toFixed(4)),
          low: Number(Math.min(...bars.map((b) => b.l)).toFixed(4)),
        },
        {
          kind: "chart",
          title: `${inst.symbol} · last ${n} days`,
          variant: "candlestick",
          xType: "time",
          candles: bars.map((b) => ({
            t: b.t,
            o: Number(b.o.toFixed(4)),
            h: Number(b.h.toFixed(4)),
            l: Number(b.l.toFixed(4)),
            c: Number(b.c.toFixed(4)),
            v: b.v,
          })),
        },
      ),
    };
  },
};

export const compareInstruments: ToolDefinition = {
  name: "compareInstruments",
  side: "read",
  description: "Compare several instruments over the same window. Renders a table plus a normalised trend chart.",
  inputSchema: {
    type: "object",
    required: ["symbols"],
    properties: {
      symbols: { type: "array", items: { type: "string" }, description: "Two or more symbols." },
      days: { type: "number" },
    },
    additionalProperties: false,
  },
  execute(input, ctx) {
    const { symbols = [], days = 30 } = (input ?? {}) as { symbols?: string[]; days?: number };
    const n = Math.max(5, Math.min(180, Math.round(days)));
    const found = symbols
      .map((s) => INSTRUMENTS.find((i) => i.symbol === String(s).toUpperCase()))
      .filter((i): i is (typeof INSTRUMENTS)[number] => Boolean(i));

    if (found.length < 2) {
      return { output: { error: "Need at least two known symbols.", known: INSTRUMENTS.map((i) => i.symbol) }, failure: "invalid-input" as const };
    }

    const rows = found.map((inst) => {
      const bars = series(inst.symbol, n);
      const first = bars[0]!.c;
      const last = bars.at(-1)!.c;
      return {
        symbol: inst.symbol,
        name: inst.name,
        price: Number(last.toFixed(4)),
        change: Number((((last - first) / first) * 100).toFixed(2)),
        venue: inst.venue,
      };
    });

    // Emit the trend chart mid-execution, then return the table as the result —
    // one tool, two cards, which is what `emitCard` exists for.
    ctx.emitCard?.({
      kind: "chart",
      title: `Normalised performance · ${n} days`,
      variant: "series",
      xType: "time",
      yLabel: "% from start",
      series: found.map((inst) => {
        const bars = series(inst.symbol, n);
        const first = bars[0]!.c;
        return {
          name: inst.symbol,
          type: "line" as const,
          points: bars.map((b) => [b.t, Number((((b.c - first) / first) * 100).toFixed(3))] as [number, number]),
        };
      }),
      annotations: [{ type: "hline", value: 0, label: "flat", tone: "neutral" }],
    });

    return {
      output: withCard(
        { window: `${n}d`, rows },
        {
          kind: "table",
          title: `Comparison · last ${n} days`,
          columns: [
            { key: "symbol", label: "Symbol", pill: true },
            { key: "name", label: "Name" },
            { key: "price", label: "Price", format: "currency", align: "right" },
            { key: "change", label: `${n}d change`, format: "percent", align: "right" },
          ],
          rows,
          sortBy: "change",
          sortDir: "desc",
        },
      ),
    };
  },
};

/**
 * A `confirm`-side tool: it asks before it acts.
 *
 * This is the human-in-the-loop path end to end — the tool suspends the run,
 * the UI renders a confirm card, and the user's answer becomes the tool result
 * the model reads on the next step.
 */
export const createAlert: ToolDefinition = {
  name: "createAlert",
  side: "confirm",
  description:
    "Set a price alert. This is a real action, so it asks the user to confirm the exact terms first. Never call it without a specific symbol and price.",
  inputSchema: {
    type: "object",
    required: ["symbol", "price", "direction"],
    properties: {
      symbol: { type: "string" },
      price: { type: "number" },
      direction: { type: "string", enum: ["above", "below"] },
    },
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const { symbol, price, direction } = (input ?? {}) as { symbol?: string; price?: number; direction?: string };
    const inst = INSTRUMENTS.find((i) => i.symbol === String(symbol).toUpperCase());
    if (!inst) {
      return { output: { error: `Unknown symbol "${symbol}".`, known: INSTRUMENTS.map((i) => i.symbol) }, failure: "not-found" as const };
    }

    const answer = (await ctx.requestCard?.({
      kind: "confirm",
      title: "Create price alert",
      description: "You will be notified once when this condition is met.",
      summary: [
        { label: "Instrument", value: `${inst.name} (${inst.symbol})` },
        { label: "Trigger", value: `Price goes ${direction} $${price}` },
        { label: "Expires", value: "30 days" },
      ],
      confirmLabel: "Create alert",
    })) as { cancelled?: boolean } | undefined;

    if (!answer || answer.cancelled) {
      return { output: { created: false, reason: "The user declined." }, failure: "denied" as const };
    }

    return {
      output: withCard(
        { created: true, id: `alert_${inst.symbol}_${price}` },
        {
          kind: "keyvalue",
          title: "Alert created",
          items: [
            { label: "Instrument", value: `${inst.name} (${inst.symbol})` },
            { label: "Condition", value: `${direction} $${price}`, tone: "positive" },
            { label: "Alert id", value: `alert_${inst.symbol}_${price}`, mono: true },
          ],
        },
      ),
    };
  },
};

export const DOMAIN_TOOLS = [listInstruments, getQuote, getHistory, compareInstruments, createAlert];
