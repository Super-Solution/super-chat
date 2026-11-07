"use client";

// The agent's to-do list: what it plans to do, what it is doing now, what it
// has finished.
//
// The header carries the whole state at a glance — a dotted progress pie while
// work is running, a filled check when everything is done — so the list itself
// can be collapsed without losing the thread.

import { useState } from "react";
import { RollingCount } from "./RollingCount.js";

export type TodoStatus = "todo" | "active" | "done" | "blocked";

export interface TodoItem {
  label: string;
  status?: TodoStatus;
}

/* ── icons ────────────────────────────────────────────────────────────────── */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const CheckIcon = ({ on }: { on?: boolean }) => (
  <svg className={"sc-todo__icon" + (on ? " sc-todo__icon--on" : "")} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" {...stroke} />
  </svg>
);

const ArrowIcon = ({ on }: { on?: boolean }) => (
  <svg
    className={"sc-todo__icon sc-todo__icon--strong" + (on ? " sc-todo__icon--on" : "")}
    viewBox="0 0 24 24"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <path d="m12.75 15 3-3m0 0-3-3m3 3h-7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" {...stroke} />
  </svg>
);

const DashedIcon = ({ on }: { on?: boolean }) => (
  <svg className={"sc-todo__icon" + (on ? " sc-todo__icon--on" : "")} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="1.8 3.6" strokeLinecap="round" />
  </svg>
);

const BlockedIcon = ({ on }: { on?: boolean }) => (
  <svg
    className={"sc-todo__icon sc-todo__icon--blocked" + (on ? " sc-todo__icon--on" : "")}
    viewBox="0 0 24 24"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <path d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" {...stroke} />
  </svg>
);

const FilledCheckIcon = () => (
  <svg className="sc-todo__headcheck" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
      fill="currentColor"
    />
  </svg>
);

const ListIcon = () => (
  <svg className="sc-todo__headlist" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      {...stroke}
    />
  </svg>
);

/* ── component ────────────────────────────────────────────────────────────── */

export interface TodoListProps {
  items: TodoItem[];
  title?: string;
  defaultCollapsed?: boolean;
}

export function TodoList({ items, title = "To-dos", defaultCollapsed = false }: TodoListProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const total = items.length;
  const doneCount = items.filter((t) => t.status === "done").length;
  const running = items.some((t) => t.status === "active");
  const blocked = items.some((t) => t.status === "blocked");
  const allDone = total > 0 && doneCount === total;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="sc-todo">
      <button
        type="button"
        className="sc-todo__head"
        aria-expanded={!collapsed}
        aria-label={`Toggle ${title}`}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="sc-todo__headicon">
          {allDone ? (
            <FilledCheckIcon />
          ) : running || (doneCount > 0 && !blocked) ? (
            <span className="sc-todo__pie" style={{ ["--sc-todo-pie" as string]: pct + "%" }} aria-hidden="true">
              <svg className="sc-todo__piering" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeDasharray="2.2 4.4" strokeLinecap="round" />
              </svg>
            </span>
          ) : (
            <ListIcon />
          )}
          <svg className="sc-todo__chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m19.5 8.25-7.5 7.5-7.5-7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="sc-todo__title">{title}</span>
        <span className="sc-todo__count">
          <RollingCount value={doneCount + "/" + total} />
        </span>
      </button>

      <div className={"sc-todo__collapsible" + (collapsed ? " sc-todo__collapsible--closed" : "")}>
        <div className="sc-todo__inner">
          <ul className="sc-todo__list">
            {items.map((item, i) => {
              const status = item.status ?? "todo";
              return (
                <li key={i} className={"sc-todo__item sc-todo__item--" + status} style={{ ["--sc-i" as string]: i }}>
                  <span className="sc-todo__iconwrap">
                    <DashedIcon on={status === "todo"} />
                    <ArrowIcon on={status === "active"} />
                    <CheckIcon on={status === "done"} />
                    <BlockedIcon on={status === "blocked"} />
                  </span>
                  {/* the shimmer overlay reads the label off the attribute so the
                      gradient text can crossfade over the plain one */}
                  <span className="sc-todo__label" data-label={item.label}>
                    {item.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
