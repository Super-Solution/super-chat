"use client";

// Cross-domain card renderers.
//
// These exist because the first pass of this kit skewed toward one domain, and a
// framework's card catalogue quietly dictates what its agents can express. A
// legal agent needs citations and checklists the way an analytics agent needs
// charts; if the kit only ships charts, every agent built on it looks like an
// analytics agent.

import { useMemo } from "react";
import type {
  CalloutCard,
  ChecklistCard,
  CitationsCard,
  ComparisonCard,
  FunnelCard,
  GaugeCard,
  TreeCard,
  TreeNode,
} from "@zzyzxlabs/super-chat-core";
import type { CardRendererProps } from "../renderer-registry.js";
import { formatValue, toneClass } from "../format.js";

export function ComparisonCardView({ spec }: CardRendererProps<ComparisonCard>) {
  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-table-wrap">
        <table className="sc-table sc-compare">
          <thead>
            <tr>
              <th />
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
                      {v === true ? (
                        <span className="sc-tone--positive" aria-label="yes">
                          ✓
                        </span>
                      ) : v === false ? (
                        <span className="sc-tone--negative" aria-label="no">
                          ✕
                        </span>
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

const CHECK_ICON: Record<string, string> = { done: "✓", todo: "○", blocked: "✕", na: "–" };

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
                <span className="sc-check__icon" aria-hidden>
                  {CHECK_ICON[item.status] ?? "○"}
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

const CALLOUT_ICON: Record<string, string> = { info: "i", warning: "!", danger: "!", success: "✓", note: "·" };

export function CalloutCardView({ spec }: CardRendererProps<CalloutCard>) {
  return (
    <div className={`sc-card sc-callout sc-callout--${spec.tone}`} role={spec.tone === "danger" ? "alert" : undefined}>
      <span className="sc-callout__icon" aria-hidden>
        {CALLOUT_ICON[spec.tone] ?? "·"}
      </span>
      <div>
        {spec.title ? <div className="sc-callout__title">{spec.title}</div> : null}
        <div className="sc-callout__body">{spec.body}</div>
      </div>
    </div>
  );
}

export function CitationsCardView({ spec }: CardRendererProps<CitationsCard>) {
  return (
    <div className="sc-card">
      <div className="sc-card__title">{spec.title ?? "Sources"}</div>
      <ol className="sc-cites">
        {spec.items.map((item, i) => (
          <li key={i} className="sc-cite">
            <span className="sc-cite__n" aria-hidden>
              {i + 1}
            </span>
            <div className="sc-cite__body">
              <div className="sc-cite__head">
                {item.url ? (
                  // Model-supplied URLs: never trust the referrer, never let the
                  // opened page reach back via window.opener.
                  <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                    {item.title}
                  </a>
                ) : (
                  <span className="sc-cite__title">{item.title}</span>
                )}
                {item.relevance ? (
                  <span className={`sc-pill sc-pill--${item.relevance === "high" ? "positive" : item.relevance === "low" ? "warning" : "info"}`}>
                    {item.relevance}
                  </span>
                ) : null}
              </div>
              <div className="sc-muted sc-cite__meta">
                {[item.source, item.locator, item.date ? formatValue(item.date, "datetime") : null]
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
              <span className="sc-funnel__value">{formatValue(stage.value, spec.format ?? "number")}</span>
              <div className="sc-funnel__rate">
                {stepRate == null ? (
                  <span className="sc-muted">—</span>
                ) : (
                  <span className={stepRate < 50 ? "sc-tone--warning" : "sc-muted"}>{stepRate.toFixed(1)}%</span>
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
  const min = spec.min ?? 0;
  const max = spec.max ?? 100;
  const clamped = Math.min(max, Math.max(min, spec.value));
  const pct = ((clamped - min) / (max - min)) * 100;
  const band = spec.bands?.find((b) => clamped >= b.from && clamped <= b.to);

  return (
    <div className="sc-card">
      {spec.title ? <div className="sc-card__title">{spec.title}</div> : null}
      <div className="sc-gauge">
        <div className={`sc-gauge__value${toneClass(band?.tone)}`}>{formatValue(spec.value, spec.format ?? "number")}</div>
        {band || spec.label ? (
          <div className={`sc-gauge__label${toneClass(band?.tone)}`}>{spec.label ?? band?.label}</div>
        ) : null}
      </div>
      <div className="sc-gauge__track" role="meter" aria-valuenow={clamped} aria-valuemin={min} aria-valuemax={max}>
        {(spec.bands ?? []).map((b, i) => (
          <div
            key={i}
            className={`sc-gauge__band sc-tone--${b.tone ?? "neutral"}`}
            style={{ left: `${((b.from - min) / (max - min)) * 100}%`, width: `${((b.to - b.from) / (max - min)) * 100}%` }}
            title={b.label}
          />
        ))}
        <div className="sc-gauge__needle" style={{ left: `${pct}%` }} />
      </div>
      <div className="sc-gauge__scale">
        <span className="sc-muted sc-mono">{formatValue(min, spec.format ?? "number")}</span>
        {spec.bands?.length ? (
          <span className="sc-gauge__bandlabels">
            {spec.bands.map((b, i) => (
              <span key={i} className={`sc-muted${band === b ? " sc-gauge__bandlabel--on" : ""}`}>
                {b.label}
              </span>
            ))}
          </span>
        ) : null}
        <span className="sc-muted sc-mono">{formatValue(max, spec.format ?? "number")}</span>
      </div>
    </div>
  );
}

function TreeBranch({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <li className={`sc-treenode${toneClass(node.tone)}`}>
      <div className="sc-treenode__row">
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
