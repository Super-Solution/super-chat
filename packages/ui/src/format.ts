// Value formatting shared by every card renderer.
//
// Centralised because a table cell and a stat tile showing the same number in
// different formats is the fastest way to make an interface look untrustworthy.

import type { CardValueFormat } from "@super-solution/super-chat-core";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const pctWide = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, useGrouping: false });
const pctNarrow = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, useGrouping: false });
const percent = (n: number): string => (Math.abs(n) < 1 ? pctNarrow : pctWide).format(n);

export function formatValue(value: unknown, format: CardValueFormat = "text"): string {
  if (value == null) return "—";

  switch (format) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      // Compact only above 5 digits: "12.3K" is helpful, "1.2K" hides precision
      // people expect to see on small counts.
      return Math.abs(n) >= 100_000 ? compact.format(n) : plain.format(n);
    }
    case "currency": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      const abs = Math.abs(n);
      // Sub-cent values are common in crypto; fixed 2dp would render them as $0.00.
      const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
      // A whole amount in the thousands reads as "$48,200". Forcing ".00" onto
      // it is the machine-printed look; amounts with cents keep them.
      const min = abs >= 1000 && Number.isInteger(n) ? 0 : 2;
      return `$${n.toLocaleString(undefined, { minimumFractionDigits: min, maximumFractionDigits: Math.max(min, digits) })}`;
    }
    case "percent": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      // One decimal at most ("8.2%", "12%"), two only below 1% where the
      // second digit is the signal ("0.04%"). A fixed "8.20%" is false precision.
      return `${percent(n)}%`;
    }
    case "bytes": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      const units = ["B", "KB", "MB", "GB", "TB"];
      let i = 0;
      let v = n;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }
    case "duration": {
      const ms = Number(value);
      if (!Number.isFinite(ms)) return String(value);
      if (ms < 1000) return `${Math.round(ms)}ms`;
      if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
      if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
      return `${(ms / 3_600_000).toFixed(1)}h`;
    }
    case "datetime": {
      const d = typeof value === "number" ? new Date(value) : new Date(String(value));
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
    }
    case "code":
    case "text":
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

export function formatDelta(delta: number, format: CardValueFormat = "number"): string {
  // A true minus sign: the hyphen-minus is narrower and misaligns a column of
  // signed deltas against the plus signs above it.
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${formatValue(Math.abs(delta), format)}`;
}

export const toneClass = (tone?: string): string => (tone && tone !== "neutral" ? ` sc-tone--${tone}` : "");

/** Positive is not always good — but for a delta with no stated tone it is the useful default. */
export const deltaTone = (delta: number): "positive" | "negative" | "neutral" =>
  delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
