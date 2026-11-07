"use client";

// Thinking indicators.
//
// `ThinkingState` is the bare shimmering label for "working on it". `Thinking`
// is the full reasoning block: a stream of clamped lines that scroll themselves
// while the model thinks, then fold into a "Thought for Ns" summary the user
// can open again.
//
// Unlike the reference design these are driven by real content — reasoning text
// arrives token by token, so the reveal follows the stream instead of a timer.

import { useEffect, useMemo, useRef, useState } from "react";

/** Bare shimmering label. Use when there is nothing to show but the wait. */
export function ThinkingState({ label = "Thinking" }: { label?: string }) {
  return (
    <span className="sc-shimmer" role="status">
      {label}
    </span>
  );
}

// Geometry — keep in sync with the CSS.
const LINE_H = 40; // 2 lines × 20px
const GAP = 4;
const MAX_H = 180; // the viewport grows with content to here, then scrolls
const FADE = 16; // top/bottom fade once the viewport is capped

/**
 * Split raw reasoning into display lines. Models emit reasoning as prose, so
 * paragraph breaks come first and sentences are the fallback — one long
 * paragraph should still scroll as several lines rather than one clamped blob.
 */
function toLines(text: string): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const para of paras) {
    if (para.length <= 160) {
      out.push(para);
      continue;
    }
    const sentences = para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
    if (!sentences) {
      out.push(para);
      continue;
    }
    for (const s of sentences) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export interface ThinkingProps {
  /** Reasoning text so far. Grows while the model is streaming. */
  text: string;
  /** True while more reasoning may still arrive. */
  streaming?: boolean;
  /** How long the thinking took, in ms. Shown in the collapsed summary. */
  elapsedMs?: number;
  /** Start expanded once done. Defaults to collapsed, as in a finished turn. */
  defaultOpen?: boolean;
}

export function Thinking({ text, streaming = false, elapsedMs, defaultOpen = false }: ThinkingProps) {
  const lines = useMemo(() => toLines(text), [text]);

  // While streaming the reasoning is always open; once done it folds into the
  // summary and the user can toggle it back.
  const [open, setOpen] = useState(defaultOpen);
  // Which soft fades to show while scrolling the unfolded reasoning.
  const [fade, setFade] = useState({ top: false, bottom: true });
  const viewportRef = useRef<HTMLDivElement>(null);

  // Measure the thinking ourselves when the caller does not — the elapsed time
  // is the whole point of the collapsed summary.
  const startedAt = useRef<number | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (streaming) {
      startedAt.current ??= Date.now();
      return;
    }
    if (startedAt.current !== null && measured === null) setMeasured(Date.now() - startedAt.current);
  }, [streaming, measured]);

  const done = !streaming;
  const expanded = done ? open : true;
  const elapsed = elapsedMs ?? measured;
  const seconds = elapsed !== null && elapsed !== undefined ? Math.max(1, Math.round(elapsed / 1000)) : null;

  const count = lines.length;
  const contentH = count > 0 ? count * LINE_H + (count - 1) * GAP : 0;
  const capped = contentH > MAX_H;
  const viewH = capped ? MAX_H : contentH;
  const scrollable = done && open;
  // While streaming the stream is pushed up so the newest line sits at the
  // bottom edge; once the user opens it, native scrolling takes over.
  const translate = scrollable ? 0 : capped ? MAX_H - FADE - contentH : 0;

  const showTop = scrollable ? fade.top : capped;
  const showBottom = scrollable ? fade.bottom : capped;
  const mask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${showTop ? FADE : 0}px, #000 calc(100% - ${
        showBottom ? FADE : 0
      }px), transparent 100%)`
    : "none";

  const onScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  };

  const toggle = () => {
    const next = !open;
    if (next) {
      setFade({ top: false, bottom: true });
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
    }
    setOpen(next);
  };

  if (!count) return streaming ? <ThinkingState /> : null;

  return (
    <div className="sc-think">
      <button
        type="button"
        className={"sc-think__head" + (done ? " sc-think__head--clickable" : "")}
        aria-expanded={expanded}
        aria-label="Toggle thought"
        onClick={done ? toggle : undefined}
      >
        {done ? (
          <span className="sc-think__label">
            <span className="sc-think__verb">Thought</span>
            {seconds !== null ? ` for ${seconds}s` : ""}
          </span>
        ) : (
          <span className="sc-think__label sc-shimmer">Thinking…</span>
        )}
        {done ? (
          <svg className="sc-think__chevron" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path
              d="m4.5 15.75 7.5-7.5 7.5 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      <div className={"sc-think__collapsible" + (expanded ? "" : " sc-think__collapsible--closed")}>
        <div className="sc-think__inner">
          <div
            ref={viewportRef}
            className={"sc-think__viewport" + (scrollable ? " sc-think__viewport--scroll" : "")}
            style={{ height: `${viewH}px`, WebkitMaskImage: mask, maskImage: mask }}
            onScroll={scrollable ? onScroll : undefined}
          >
            <div className="sc-think__stream" style={{ transform: `translateY(${translate}px)` }}>
              {lines.map((line, i) => (
                <p key={i} className="sc-think__line">
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
