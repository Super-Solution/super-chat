"use client";

// PlanProgress — the run's plan, with live status.
//
// Deliberately NOT a card and NOT TodoList, though all three show steps:
//
//   card (`progress`, `checklist`)  the model emitted it, once, into the
//                                  transcript. It is a message. It never
//                                  changes after it lands.
//   TodoList                        a turn's working list, inline in the
//                                  thread, scrolls away with the turn.
//   PlanProgress                    run-scoped ambient state. It outlives any
//                                  one message, so it belongs OUTSIDE the
//                                  transcript — a rail, a header, a drawer.
//                                  The host picks; this renders to fill
//                                  whatever box it is given.
//
// That last point is why there is no `position` or width in its styles: a
// framework that hardcodes "right sidebar" has decided the host's layout for
// it. What the component does own is DENSITY — collapsed it becomes a single
// bar with a segmented meter, so the same instance works in a 280px rail and
// in a 44px sticky strip.
//
// The motion is a downward thread: the spine draws between completed steps, a
// pulse trickles down the active step's spine, the check draws itself, and the
// strike wipes across the label. All of it is transform/opacity/clip-path, so
// none of it touches layout.

import { useState } from "react";
import { RollingCount } from "./RollingCount.js";

export type PlanStepStatus = "pending" | "active" | "done" | "failed" | "skipped";

export interface PlanStep {
  label: string;
  /** Second line — what the step is actually doing right now. */
  detail?: string;
  status?: PlanStepStatus;
}

export interface PlanProgressProps {
  steps: PlanStep[];
  title?: string;
  defaultCollapsed?: boolean;
  /**
   * Hides the collapse control and pins the open state. For a host that has
   * already given the rail its own header.
   */
  static?: boolean;
  className?: string;
}

/** Counts toward the meter as "settled" — a skipped step is not still pending. */
const SETTLED: PlanStepStatus[] = ["done", "skipped", "failed"];

/**
 * The check draws itself by retracting its dash offset. `pathLength="1"`
 * normalises the geometry so the dasharray is 1 regardless of the viewBox —
 * without it the offset would have to be re-measured whenever the path
 * changed.
 */
const CheckMark = () => (
  <svg className="sc-plan__glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path
      className="sc-plan__draw"
      d="m6.5 12.4 3.8 3.8 7.2-8.4"
      pathLength="1"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CrossMark = () => (
  <svg className="sc-plan__glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path
      className="sc-plan__draw"
      d="M8 8l8 8M16 8l-8 8"
      pathLength="1"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  </svg>
);

const SkipMark = () => (
  <svg className="sc-plan__glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path
      className="sc-plan__draw"
      d="M7.5 12h9"
      pathLength="1"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  </svg>
);

const Chevron = () => (
  <svg className="sc-plan__chevron" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
    <path d="m4.5 15.75 7.5-7.5 7.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function PlanProgress({
  steps,
  title = "Progress",
  defaultCollapsed = false,
  static: isStatic = false,
  className,
}: PlanProgressProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const total = steps.length;
  const settled = steps.filter((s) => SETTLED.includes(s.status ?? "pending")).length;
  const active = steps.find((s) => s.status === "active");
  const failed = steps.some((s) => s.status === "failed");
  const allDone = total > 0 && settled === total;
  const open = isStatic || !collapsed;

  // The head summarises whichever state the list is in, so collapsing it loses
  // position but never loses meaning.
  const summary = failed ? "Blocked" : allDone ? "Complete" : (active?.label ?? title);

  return (
    <section
      className={"sc-plan" + (className ? " " + className : "")}
      data-state={failed ? "failed" : allDone ? "done" : "running"}
      aria-label={title}
    >
      <button
        type="button"
        className="sc-plan__head"
        aria-expanded={open}
        // Collapsed, the head IS the component, so it announces the state it
        // is standing in for rather than just "toggle".
        aria-label={`${title} — ${settled} of ${total} — ${summary}`}
        disabled={isStatic}
        onClick={isStatic ? undefined : () => setCollapsed((c) => !c)}
      >
        <span className="sc-plan__title">{open ? title : summary}</span>
        <span className="sc-plan__count" aria-hidden="true">
          <RollingCount value={`${settled}/${total}`} />
        </span>
        {isStatic ? null : <Chevron />}
      </button>

      {/* The meter is outside the collapsible on purpose: collapsed, it is the
          only thing left carrying progress, so it must not fold away with the
          list. Expanded it reads as a rule under the header. */}
      <span className="sc-plan__meter" aria-hidden="true">
        {steps.map((step, i) => (
          <span
            key={i}
            className="sc-plan__seg"
            data-status={step.status ?? "pending"}
            style={{ ["--sc-i" as string]: i }}
          />
        ))}
      </span>

      <div className={"sc-plan__collapsible" + (open ? "" : " sc-plan__collapsible--closed")}>
        <div className="sc-plan__inner">
          <ol className="sc-plan__list">
            {steps.map((step, i) => {
              const status = step.status ?? "pending";
              return (
                <li
                  key={i}
                  className="sc-plan__step"
                  data-status={status}
                  data-last={i === total - 1 ? "" : undefined}
                  style={{ ["--sc-i" as string]: i }}
                >
                  <span className="sc-plan__rail" aria-hidden="true">
                    <span className="sc-plan__node">
                      {status === "failed" ? <CrossMark /> : status === "skipped" ? <SkipMark /> : <CheckMark />}
                      <span className="sc-plan__halo" />
                    </span>
                    {/* Connector down to the next node. The last step has none
                        — a thread that continues past the end implies work
                        that is not there. */}
                    {i === total - 1 ? null : <span className="sc-plan__spine" />}
                  </span>

                  <span className="sc-plan__body">
                    {/* The strike is an overlay copy, clipped left to right, so
                        it wipes across every line of a wrapped label. Doing it
                        with text-decoration on the label itself can only fade,
                        not sweep; doing it with one absolute bar only strikes
                        the first line. The real label underneath is never
                        transparent, so a browser that drops the overlay loses
                        the strike and nothing else. */}
                    <span className="sc-plan__label" data-label={step.label}>
                      {step.label}
                    </span>
                    {step.detail ? <span className="sc-plan__detail">{step.detail}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
