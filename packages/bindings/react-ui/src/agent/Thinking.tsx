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
import { useLabels } from "../labels.js";

/** Bare shimmering label. Use when there is nothing to show but the wait. */
export function ThinkingState({ label }: { label?: string }) {
  const labels = useLabels();
  label ??= labels.thinking.replace(/…$/, "");
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

/** A CJK character is as wide as two Latin ones, so a line of it is "long" at half the count. */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/g;
const width = (s: string) => s.length + (s.match(WIDE)?.length ?? 0);

let segmenter: Intl.Segmenter | null | undefined;
/**
 * Sentences of one paragraph. `Intl.Segmenter` knows where a sentence ends in every language
 * (the full stop of Chinese and Japanese, abbreviations in English) where a regex over `.!?`
 * knows one; browsers without it get a regex that also knows the CJK terminators.
 */
function sentences(para: string): string[] {
  if (segmenter === undefined) {
    try {
      segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "sentence" }) : null;
    } catch {
      segmenter = null;
    }
  }
  if (segmenter) return [...segmenter.segment(para)].map((s) => s.segment);
  return para.match(/[^.!?。！？]+(?:[.!?]+|[。！？]+)(?:\s|$)?|[^.!?。！？]+$/g) ?? [para];
}

/**
 * Split raw reasoning into display lines. Models emit reasoning as prose, so
 * paragraph breaks come first and sentences are the fallback — one long
 * paragraph should still scroll as several lines rather than one clamped blob.
 */
export function thinkingLines(text: string): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const para of paras) {
    if (width(para) <= 160) {
      out.push(para);
      continue;
    }
    for (const s of sentences(para)) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** "Thought for 3s" with its first word set apart; any other wording is shown whole. */
function ThoughtFor({ text, verb }: { text: string; verb: string }) {
  if (!text.startsWith(verb)) return <>{text}</>;
  return (
    <>
      <span className="sc-think__verb">{verb}</span>
      {text.slice(verb.length)}
    </>
  );
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
  const labels = useLabels();
  const lines = useMemo(() => thinkingLines(text), [text]);

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
        aria-label={labels.toggleThought}
        onClick={done ? toggle : undefined}
      >
        {done ? (
          <span className="sc-think__label">
            {seconds !== null ? (
              <ThoughtFor text={labels.thoughtFor(String(seconds))} verb={labels.thought} />
            ) : (
              <span className="sc-think__verb">{labels.thought}</span>
            )}
          </span>
        ) : (
          <span className="sc-think__label sc-shimmer">{labels.thinking}</span>
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
