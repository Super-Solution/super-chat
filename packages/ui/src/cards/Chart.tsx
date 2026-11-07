"use client";

// A dependency-free SVG chart.
//
// Charting libraries are 100–300KB and every one of them wants to own layout.
// A card only needs line/area/bar/scatter plus candlesticks, all of which are a
// path and a scale — so this is hand-drawn, renders on the server, and inherits
// theme colours instead of fighting them.

import { useId, useMemo } from "react";
import type { ChartCard } from "@super-solution/super-chat-core";
import type { CardRendererProps } from "../renderer-registry.js";
import { formatValue } from "../format.js";

const PALETTE = ["var(--sc-series-1)", "var(--sc-series-2)", "var(--sc-series-3)", "var(--sc-series-4)", "var(--sc-series-5)"];

const W = 720;
const H = 280;
const PAD = { top: 16, right: 52, bottom: 30, left: 56 };

type Scale = (v: number) => number;

const DAY = 86_400_000;
// Whole-day steps only, so every tick lands on a UTC midnight and reads as a
// date instead of an arbitrary instant like 2026-07-15T09:46.
const TIME_STEPS = [DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY, 182 * DAY, 365 * DAY];

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  // Snap to 1/2/5×10^n so labels read as round numbers rather than 0.3714.
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function timeTicks(min: number, max: number, count = 5): number[] {
  const raw = (max - min) / count;
  // Sub-day spans have no calendar structure worth snapping to.
  if (!Number.isFinite(raw) || raw < DAY) return niceTicks(min, max, count);
  const step = TIME_STEPS.find((s) => s >= raw) ?? Math.ceil(raw / (365 * DAY)) * 365 * DAY;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

// Axis labels render on the server too, so they must not depend on the runtime
// locale or timezone — toLocaleDateString() there disagrees with the browser's
// and fails hydration.
function formatTimeTick(t: number, span: number): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t);
  const iso = d.toISOString();
  return span < DAY ? iso.slice(11, 16) : iso.slice(0, 10);
}

/** Keep an axis to ~8 labels; past that they overlap into an unreadable smear. */
function thin<T>(items: T[], max = 8): T[] {
  const step = Math.ceil(items.length / max) || 1;
  return items.filter((_, i) => i % step === 0);
}

// Beyond this many points, bar/scatter series are thinned the same way axis
// ticks are — one <rect>/<circle> per data point stops being free once a
// series has thousands of them, and they'd overdraw into a solid smear anyway.
const MAX_MARKS = 500;

/** `Math.min(...values)` throws past ~100k call-stack args; a plain loop doesn't. */
function arrMin(values: number[], seed = Infinity): number {
  let m = seed;
  for (const v of values) if (v < m) m = v;
  return m;
}

function arrMax(values: number[], seed = -Infinity): number {
  let m = seed;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function ChartCardView({ spec }: CardRendererProps<ChartCard>) {
  const gradientId = useId();
  const isCandles = spec.variant === "candlestick" && spec.candles?.length;

  const model = useMemo(() => {
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    if (isCandles) {
      const candles = spec.candles!;
      const lo = arrMin(candles.map((c) => c.l));
      const hi = arrMax(candles.map((c) => c.h));
      const pad = (hi - lo) * 0.05 || 1;
      const yMin = lo - pad;
      const yMax = hi + pad;
      const x: Scale = (i) => PAD.left + (candles.length <= 1 ? innerW / 2 : (i / (candles.length - 1)) * innerW);
      const y: Scale = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
      const xTicks = thin(
        candles.map((c, i) => ({ at: x(i), label: typeof c.t === "number" ? formatTimeTick(c.t, Infinity) : String(c.t).slice(0, 10) })),
      );
      return {
        kind: "candles" as const,
        candles,
        x,
        y,
        yTicks: niceTicks(yMin, yMax),
        xTicks,
        width: Math.max(2, (innerW / candles.length) * 0.6),
      };
    }

    const series = spec.series ?? [];
    // Category axes index by position; numeric/time axes use the value itself.
    const categorical = spec.xType === "category" || series.some((s) => s.points.some((p) => typeof p[0] === "string"));
    const xs = series.flatMap((s) => s.points.map((p, i) => (categorical ? i : Number(p[0])))).filter(Number.isFinite);
    const ys = series.flatMap((s) => s.points.map((p) => p[1]));
    // The x domain is the data's own extent. Seeding it with 0 the way the y
    // domain is would put the epoch on a time axis and squash every point into
    // the last pixel of the plot.
    const xMin = xs.length ? arrMin(xs) : 0;
    const xMax = xs.length ? arrMax(xs) : 1;
    const yMinRaw = arrMin(ys, 0);
    const yMaxRaw = arrMax(ys, 1);
    const yPad = (yMaxRaw - yMinRaw) * 0.08 || 1;
    const yMin = yMinRaw < 0 ? yMinRaw - yPad : Math.max(0, yMinRaw - yPad);
    const yMax = yMaxRaw + yPad;

    const x: Scale = (v) => PAD.left + (xMax === xMin ? innerW / 2 : ((v - xMin) / (xMax - xMin)) * innerW);
    const y: Scale = (v) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

    const xTicks = categorical
      ? thin((series[0]?.points ?? []).map((p, i) => ({ at: x(i), label: String(p[0]) })))
      : (spec.xType === "time" ? timeTicks(xMin, xMax) : niceTicks(xMin, xMax, 5)).map((t) => ({
          at: x(t),
          label: spec.xType === "time" ? formatTimeTick(t, xMax - xMin) : formatValue(t, "number"),
        }));

    return { kind: "series" as const, series, categorical, x, y, yTicks: niceTicks(yMin, yMax), xTicks };
  }, [spec, isCandles]);

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title ?? "chart"} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--sc-series-1)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--sc-series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {model.yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.left} x2={W - PAD.right} y1={model.y(t)} y2={model.y(t)} className="sc-chart__grid" />
              <text x={PAD.left - 8} y={model.y(t)} className="sc-chart__label" textAnchor="end" dominantBaseline="middle">
                {formatValue(t, "number")}
              </text>
            </g>
          ))}

          {model.kind === "candles"
            ? model.candles.map((c, i) => {
                const up = c.c >= c.o;
                const cx = model.x(i);
                const top = model.y(Math.max(c.o, c.c));
                const bottom = model.y(Math.min(c.o, c.c));
                return (
                  <g key={i} className={up ? "sc-candle sc-candle--up" : "sc-candle sc-candle--down"}>
                    <line x1={cx} x2={cx} y1={model.y(c.h)} y2={model.y(c.l)} />
                    <rect
                      x={cx - model.width / 2}
                      y={top}
                      width={model.width}
                      // A doji has zero body height and would vanish; floor at 1px.
                      height={Math.max(1, bottom - top)}
                    />
                  </g>
                );
              })
            : model.series.map((s, si) => {
                const color = s.color ?? PALETTE[si % PALETTE.length];
                const pts = s.points.map((p, i) => [model.x(model.categorical ? i : Number(p[0])), model.y(p[1])] as const);
                if (!pts.length) return null;

                if (s.type === "bar") {
                  const bw = Math.max(2, ((W - PAD.left - PAD.right) / Math.max(1, pts.length)) * 0.6);
                  const marks = pts.length > MAX_MARKS ? thin(pts, MAX_MARKS) : pts;
                  return marks.map(([px, py], i) => (
                    <rect key={`${si}-${i}`} x={px - bw / 2} y={py} width={bw} height={Math.max(0, model.y(0) - py)} fill={color} rx={2} />
                  ));
                }
                if (s.type === "scatter") {
                  const marks = pts.length > MAX_MARKS ? thin(pts, MAX_MARKS) : pts;
                  return marks.map(([px, py], i) => <circle key={`${si}-${i}`} cx={px} cy={py} r={3} fill={color} />);
                }

                const d = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
                const area = `${d} L${pts[pts.length - 1]![0].toFixed(2)},${model.y(0).toFixed(2)} L${pts[0]![0].toFixed(2)},${model.y(0).toFixed(2)} Z`;
                return (
                  <g key={si}>
                    {s.type === "area" ? <path d={area} fill={`url(#${gradientId})`} /> : null}
                    <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })}

          {(spec.annotations ?? []).map((a, i) => {
            if (a.type !== "hline") return null;
            const yy = model.y(Number(a.value));
            return (
              <g key={`a${i}`}>
                <line x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} className={`sc-chart__annotation sc-tone--${a.tone ?? "info"}`} />
                {a.label ? (
                  <text x={W - PAD.right + 4} y={yy} className="sc-chart__label" dominantBaseline="middle">
                    {a.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="sc-chart__axis" />

          {model.xTicks.map((t, i) => (
            <text key={`x${i}`} x={t.at} y={H - PAD.bottom + 14} className="sc-chart__label" textAnchor="middle">
              {t.label}
            </text>
          ))}
        </svg>
      </div>

      {model.kind === "series" && model.series.length > 1 ? (
        <div className="sc-legend">
          {model.series.map((s, i) => (
            <span key={s.name} className="sc-legend__item">
              <span className="sc-legend__swatch" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}