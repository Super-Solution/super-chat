"use client";

// Cross-domain card renderers.
//
// These exist because the first pass of this kit skewed toward one domain, and a
// framework's card catalogue quietly dictates what its agents can express. A
// legal agent needs citations and checklists the way an analytics agent needs
// charts; if the kit only ships charts, every agent built on it looks like an
// analytics agent.

import { useMemo, useRef, useState } from "react";
import type {
  CalloutCard,
  ChecklistCard,
  CitationsCard,
  ComparisonCard,
  FunnelCard,
  GaugeCard,
  TreeCard,
  TreeNode,
} from "@supersolutions/super-chat-core";
import type { CardRendererProps } from "../renderer-registry.js";
import { formatValue, safeHref, type FormatOptions } from "@supersolutions/super-chat-ui-core";
import { FormattedValue, useFormatOptions } from "./FormattedValue.js";
import { StatusMark, ToneIcon, type StatusMarkKind } from "./icons.js";
import { useLabels } from "../labels.js";
import { useCardRefTarget } from "../card-ref-targets.js";

export function ComparisonCardView({ spec }: CardRendererProps<ComparisonCard>) {
  const labels = useLabels();
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-table-wrap">
        <table className="sc-table sc-compare">
          <thead>
            <tr>
              {/* The corner cell heads the row labels: named for a screen reader, empty to the eye. */}
              <th scope="col"><span className="sc-sr-only">{labels.criterion}</span></th>
              {spec.options.map((o) => (
                <th key={o.id} className={o.highlight ? "sc-compare__best" : undefined}>
                  <div>{o.label}</div>
                  {o.note ? <div className="sc-muted sc-compare__note">{o.note}</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.criteria.map((c, i) => (
              <tr key={i} className={c.weight === "high" ? "sc-compare__key" : undefined}>
                <th scope="row">
                  {c.label}
                  {c.detail ? <div className="sc-muted sc-compare__note">{c.detail}</div> : null}
                </th>
                {spec.options.map((o) => {
                  const v = c.values[o.id];
                  return (
                    <td key={o.id} className={o.highlight ? "sc-compare__best" : undefined}>
                      {/* Yes and no differ in shape and weight, not in a
                          red-green pair across every row of the table. */}
                      {v === true ? (
                        <span className="sc-compare__yes"><StatusMark kind="done" label="yes" /></span>
                      ) : v === false ? (
                        <span className="sc-compare__no"><StatusMark kind="failed" label="no" /></span>
                      ) : v == null ? (
                        <span className="sc-muted">—</span>
                      ) : (
                        formatValue(v)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHECK_MARK: Record<string, StatusMarkKind> = { done: "done", todo: "pending", blocked: "failed", na: "skipped" };

export function ChecklistCardView({ spec, partial }: CardRendererProps<ChecklistCard>) {
  // Group consecutive items sharing a `group`, preserving the model's ordering
  // rather than re-sorting — the order usually carries meaning.
  const groups = useMemo(() => {
    const out: { name?: string; items: ChecklistCard["items"] }[] = [];
    for (const item of spec.items) {
      const last = out[out.length - 1];
      if (last && last.name === item.group) last.items.push(item);
      else out.push({ name: item.group, items: [item] });
    }
    return out;
  }, [spec.items]);

  const done = spec.items.filter((i) => i.status === "done").length;
  const relevant = spec.items.filter((i) => i.status !== "na").length;

  return (
    <div className="sc-card">
      <div className="sc-card__head">
        {spec.title ? <span className="sc-card__title">{spec.title}</span> : <span />}
        {/* "2/3 done" on a list that will have nine items is a false count;
            the tally waits for the whole list. */}
        {partial ? null : (
          <span className="sc-pill">
            {done}/{relevant} done
          </span>
        )}
      </div>
      {groups.map((g, gi) => (
        <div key={gi} className="sc-checkgroup">
          {g.name ? <div className="sc-panel__label">{g.name}</div> : null}
          <ul className="sc-checklist">
            {g.items.map((item, i) => (
              <li key={i} className={`sc-check sc-check--${item.status}`}>
                <span className="sc-check__icon">
                  <StatusMark kind={CHECK_MARK[item.status] ?? "pending"} />
                </span>
                <span className="sc-check__body">
                  <span className="sc-check__label">{item.label}</span>
                  {item.detail ? <span className="sc-muted sc-check__detail">{item.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function CalloutCardView({ spec }: CardRendererProps<CalloutCard>) {
  // A note is plain prose and carries no mark; the other tones get a drawn
  // icon so the tone never rests on color alone.
  return (
    <div className={`sc-card sc-callout sc-callout--${spec.tone}`} role={spec.tone === "danger" ? "alert" : undefined}>
      {spec.tone === "note" ? null : (
        <span className="sc-callout__icon">
          <ToneIcon kind={spec.tone} />
        </span>
      )}
      <div>
        {spec.title ? <div className="sc-callout__title">{spec.title}</div> : null}
        <div className="sc-callout__body">{spec.body}</div>
      </div>
    </div>
  );
}

/**
 * Which source `cite=` names: an item's own `id`, else its 1-based position. An id wins, so a
 * source called "2" is found before the second source is.
 */
export function citedIndex(items: readonly { id?: string }[], cite: string): number {
  const byId = items.findIndex((item) => item.id === cite);
  if (byId >= 0) return byId;
  return /^[1-9]\d{0,5}$/.test(cite) && Number(cite) <= items.length ? Number(cite) - 1 : -1;
}

/**
 * A date such as `1980-01-01` is a day, not a moment: shown as a datetime it reads "12:00:00 AM",
 * and in a zone west of UTC it would read the day before. A day is formatted as a day, in UTC,
 * and a bare year (`1980`, how a case is cited) stays a year.
 */
export function citedDate(date: string | number, options: FormatOptions | undefined): string {
  if (typeof date === "string" && /^\d{4}$/.test(date)) return date;
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const d = new Date(`${date}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString(options?.locale, { timeZone: "UTC" });
  }
  return formatValue(date, "datetime", options);
}

export function CitationsCardView({ spec }: CardRendererProps<CitationsCard>) {
  const labels = useLabels();
  const formatOptions = useFormatOptions();
  const list = useRef<HTMLOListElement>(null);
  // Which source a sentence is pointing at right now. State, so it shows; cleared on leave.
  const [pointed, setPointed] = useState<number | null>(null);
  useCardRefTarget(spec.id, (ref, event) => {
    if (ref === null) {
      setPointed(null);
      return { ok: true };
    }
    const cite = ref.params["cite"]?.[0];
    if (cite === undefined) return { ok: false, code: "ref_no_cite", reason: "a citation link names its source with cite=." };
    const index = citedIndex(spec.items, cite);
    if (index < 0) return { ok: false, code: "ref_no_source", reason: `this card has no source "${cite}".` };
    const item = spec.items[index]!;
    const label = [item.title, item.locator].filter(Boolean).join(", ");
    if (event === "leave") setPointed(null);
    else setPointed(index);
    if (event === "activate") {
      // Bring it into view, and give a keyboard user somewhere to be: the source itself.
      const row = list.current?.children[index] as HTMLElement | undefined;
      row?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      row?.focus({ preventScroll: true });
    }
    return { ok: true, label };
  });
  return (
    <div className="sc-card" data-card-id={spec.id}>
      <div className="sc-card__title">{spec.title ?? labels.sources}</div>
      <ol className="sc-cites" ref={list}>
        {spec.items.map((item, i) => (
          <li key={i} className="sc-cite" tabIndex={-1} data-cite={item.id ?? String(i + 1)} data-pointed={pointed === i ? "" : undefined}>
            <span className="sc-cite__n" aria-hidden>
              {i + 1}
            </span>
            <div className="sc-cite__body">
              <div className="sc-cite__head">
                {safeHref(item.url) ? (
                  // Model-supplied URLs: http(s) only (React 18 would follow a
                  // javascript: href), never trust the referrer, never let the
                  // opened page reach back via window.opener.
                  <a href={safeHref(item.url)} target="_blank" rel="noopener noreferrer nofollow">
                    {item.title}
                  </a>
                ) : (
                  <span className="sc-cite__title">{item.title}</span>
                )}
                {/* Relevance is a ranking, not a status: one neutral pill,
                    not a traffic light per source. */}
                {item.relevance ? <span className="sc-pill">{item.relevance}</span> : null}
              </div>
              <div className="sc-muted sc-cite__meta">
                {[item.source, item.locator, item.date ? citedDate(item.date, formatOptions) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {item.snippet ? <blockquote className="sc-cite__snippet">{item.snippet}</blockquote> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function FunnelCardView({ spec }: CardRendererProps<FunnelCard>) {
  const top = Math.max(...spec.stages.map((s) => s.value), 1);
  // Only the steepest drop is marked. Coloring every step under 50% painted
  // most real funnels orange and so marked nothing.
  let dropAt = -1;
  let dropRate = Infinity;
  spec.stages.forEach((stage, i) => {
    const prev = i > 0 ? spec.stages[i - 1]! : null;
    if (!prev || prev.value <= 0) return;
    const rate = stage.value / prev.value;
    if (rate < dropRate) {
      dropRate = rate;
      dropAt = i;
    }
  });

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-funnel">
        {spec.stages.map((stage, i) => {
          const prev = i > 0 ? spec.stages[i - 1]! : null;
          // Two rates, because they answer different questions: conversion from
          // the previous stage (where am I losing people) and share of the top
          // (how much survives end to end).
          const stepRate = prev && prev.value > 0 ? (stage.value / prev.value) * 100 : null;
          return (
            <div key={i} className="sc-funnel__row">
              <div className="sc-funnel__label">
                {stage.label}
                {stage.note ? <span className="sc-muted sc-funnel__note">{stage.note}</span> : null}
              </div>
              <div className="sc-funnel__track">
                {/* The bar carries no text: a number wider than its own bar
                    used to spill onto the track and vanish into it. */}
                <div className="sc-funnel__bar" style={{ width: `${Math.max(2, (stage.value / top) * 100)}%` }} />
              </div>
              <span className="sc-funnel__value"><FormattedValue value={stage.value} format={spec.format ?? "number"} /></span>
              <div className="sc-funnel__rate">
                {stepRate == null ? (
                  <span className="sc-muted">—</span>
                ) : (
                  <span className={i === dropAt ? "sc-funnel__drop" : "sc-muted"}><FormattedValue value={stepRate} format="percent" /></span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GaugeCardView({ spec }: CardRendererProps<GaugeCard>) {
  const labels = useLabels();
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const clamped = Math.min(max, Math.max(min, spec.value));
  const pct = ((clamped - min) / (max - min)) * 100;
  const band = spec.bands?.find((b) => clamped >= b.from && clamped <= b.to);

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      {/* The reading stays in the text color: the band it falls in already
          says how good or bad it is, and a red headline number is an alarm the
          card can't take back. */}
      <div className="sc-gauge">
        <div className="sc-gauge__value"><FormattedValue value={spec.value} format={spec.format ?? "number"} /></div>
        {band || spec.label ? <div className="sc-gauge__label">{spec.label ?? band?.label}</div> : null}
      </div>
      <div className="sc-gauge__track" role="meter" aria-label={spec.title ?? spec.label ?? labels.gauge} aria-valuenow={clamped} aria-valuemin={min} aria-valuemax={max}>
        {(spec.bands ?? []).map((b, i) => (
          <div
            key={i}
            className={`sc-gauge__band sc-tone--${b.tone ?? "neutral"}${band === b ? " sc-gauge__band--on" : ""}`}
            style={{ left: `${((b.from - min) / (max - min)) * 100}%`, width: `${((b.to - b.from) / (max - min)) * 100}%` }}
            title={b.label}
          />
        ))}
        <div className="sc-gauge__needle" style={{ left: `${pct}%` }} />
      </div>
      <div className="sc-gauge__scale">
        <span className="sc-muted sc-mono"><FormattedValue value={min} format={spec.format ?? "number"} /></span>
        {spec.bands?.length ? (
          <span className="sc-gauge__bandlabels">
            {spec.bands.map((b, i) => (
              <span key={i} className={`sc-muted${band === b ? " sc-gauge__bandlabel--on" : ""}`}>
                {b.label}
              </span>
            ))}
          </span>
        ) : null}
        <span className="sc-muted sc-mono"><FormattedValue value={max} format={spec.format ?? "number"} /></span>
      </div>
    </div>
  );
}

function TreeBranch({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    // Tone marks the node with a dot. It used to color the whole <li>, which
    // every descendant inherited, so one flagged section turned its subtree red.
    <li className="sc-treenode">
      <div className="sc-treenode__row">
        {node.tone && node.tone !== "neutral" ? <span className={`sc-treenode__mark sc-tone--${node.tone}`} aria-hidden /> : null}
        <span className="sc-treenode__label">{node.label}</span>
        {node.detail ? <span className="sc-muted sc-treenode__detail">{node.detail}</span> : null}
      </div>
      {node.children?.length ? (
        <ul className="sc-tree__children">
          {node.children.map((child, i) => (
            <TreeBranch key={i} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TreeCardView({ spec }: CardRendererProps<TreeCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <ul className="sc-tree">
        {spec.nodes.map((n, i) => (
          <TreeBranch key={i} node={n} depth={0} />
        ))}
      </ul>
    </div>
  );
}
