"use client";

// Trigger-menu for the composer: `/` for skills, `@` for tools.
//
// One component for both, because they differ only in trigger character and
// data source — and a second near-identical menu is a second place for the
// keyboard handling to drift.
//
// The rule that shapes the matching: a trigger only counts at a word boundary.
// Without that, an email address opens the tool menu and a file path opens the
// skill menu, which is how these features become annoying rather than useful.

import { useEffect, useMemo, useState } from "react";

export type SuggestItem = { id: string; label: string; hint?: string };

/** What the composer needs to know: is a menu open, and on what. */
export type TriggerState = { trigger: string; query: string; start: number } | null;

/**
 * Find an active trigger immediately before the caret.
 *
 * Returns null unless the trigger is at the start of the input or preceded by
 * whitespace, and the query since then contains no whitespace — once the user
 * types a space they have moved on and the menu should close.
 */
export function findTrigger(text: string, caret: number, triggers: string[]): TriggerState {
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) return null;
    if (triggers.includes(ch)) {
      const before = i === 0 ? "" : text[i - 1]!;
      if (i !== 0 && !/\s/.test(before)) return null;
      return { trigger: ch, query: text.slice(i + 1, caret), start: i };
    }
  }
  return null;
}

/** Case-insensitive substring match, prefix matches ranked first. */
export function rankItems(items: SuggestItem[], query: string): SuggestItem[] {
  if (!query) return items.slice(0, 8);
  const q = query.toLowerCase();
  return items
    .filter((i) => i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.label.toLowerCase().startsWith(q) || a.id.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.label.toLowerCase().startsWith(q) || b.id.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp;
    })
    .slice(0, 8);
}

export function SuggestMenu({
  items,
  active,
  onPick,
}: {
  items: SuggestItem[];
  active: number;
  onPick: (item: SuggestItem) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="sc-suggest" role="listbox">
      {items.map((it, i) => (
        <li key={it.id}>
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            className={`sc-suggest__item${i === active ? " sc-suggest__item--active" : ""}`}
            // mousedown, not click: click fires after blur, and blur closes the
            // menu — the button would be gone before the click landed.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(it);
            }}
          >
            <span className="sc-suggest__label">{it.label}</span>
            {it.hint ? <span className="sc-suggest__hint sc-muted">{it.hint}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Keeps the highlighted row in range as the list changes under it. */
export function useActiveIndex(length: number): [number, (n: number) => void] {
  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive((a) => (a >= length ? 0 : a));
  }, [length]);
  return [Math.min(active, Math.max(0, length - 1)), setActive];
}

/** Replace the trigger span with the chosen id, leaving a trailing space. */
export function applyPick(text: string, state: NonNullable<TriggerState>, caret: number, id: string): { text: string; caret: number } {
  const head = text.slice(0, state.start);
  const tail = text.slice(caret);
  const inserted = `${state.trigger}${id} `;
  return { text: head + inserted + tail, caret: head.length + inserted.length };
}

export const useSuggestItems = (skills: { id: string; name?: string; description?: string }[], tools: { name: string; description?: string }[]) =>
  useMemo(
    () => ({
      "/": skills.map((s) => ({ id: s.id, label: s.name ?? s.id, hint: s.description })),
      "@": tools.map((t) => ({ id: t.name, label: t.name, hint: t.description })),
    }),
    [skills, tools],
  );
