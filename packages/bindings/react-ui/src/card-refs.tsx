"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { parseCardRef, type CardRef, type CardRefHost, type CardRefResult } from "@supersolutions/super-chat-core";

// Card references in prose: `[the support level](ref:btc?key=support)`.
//
// The markdown renderer turns that into `<span class="sc-ref" data-ref="…">`, and that is all
// it does: a ref is not a link, and with nobody to answer it, it is plain text. This file is
// the other half. A host that wraps the transcript in <CardRefProvider host={…}> makes those
// spans interactive: pointing at or focusing one asks the card it names to show what it means
// (`enter`), leaving takes that back (`leave`), and choosing it (click, Enter, Space, tap) asks
// the card to bring it into view (`activate`).
//
// Nothing here knows what a card shows or what the params mean. Any card kind that implements
// `ref()` in super-protocol works, which is why the host is an interface, not a chart.

type RefContext = { host: CardRefHost; announce: (text: string) => void };

const Context = createContext<RefContext | undefined>(undefined);

/** The host in force, if any. Without one, refs render as plain text. */
export function useCardRefHost(): CardRefHost | undefined {
  return useContext(Context)?.host;
}

/**
 * Makes the references in the prose below it live. A label a card gives back on focus or
 * activation is announced to a screen reader through a polite live region rendered here.
 */
export function CardRefProvider({ host, children }: { host: CardRefHost; children: ReactNode }) {
  const [status, setStatus] = useState("");
  const value = useMemo<RefContext>(() => ({ host, announce: setStatus }), [host]);
  return (
    <Context.Provider value={value}>
      {children}
      <div className="sc-sr-only" role="status" aria-live="polite">
        {status}
      </div>
    </Context.Provider>
  );
}

const SELECTOR = ".sc-ref[data-ref-live]";

type Tracked = { hover?: HTMLElement; focus?: HTMLElement; shown?: HTMLElement; dismissed?: HTMLElement };

function readRef(el: HTMLElement): CardRef | undefined {
  const parsed = parseCardRef(el.getAttribute("data-ref"));
  return parsed.ok ? parsed.ref : undefined;
}

/** A reference nobody can answer reads as the text it is, with the reason on hover. */
function degrade(el: HTMLElement, reason: string) {
  el.setAttribute("data-ref-state", "unavailable");
  el.setAttribute("title", reason);
  el.removeAttribute("tabindex");
  el.removeAttribute("role");
  el.removeAttribute("data-ref-live");
}

/**
 * Rendered Markdown, with its card references live when a <CardRefProvider> is above it.
 * The one place prose HTML is injected, so a surface that shows assistant text gets
 * references by using this instead of `dangerouslySetInnerHTML`.
 */
export function ProseHtml({ html, className }: { html: string; className?: string }) {
  const context = useContext(Context);
  const box = useRef<HTMLDivElement>(null);
  const inner = useMemo(() => ({ __html: html }), [html]);
  const tracked = useRef<Tracked>({});
  const host = context?.host;
  const announce = context?.announce;

  // Decorate after every change of the HTML: React replaces the markup wholesale, so what a
  // previous pass added is gone. A ref that does not parse is dead from the start.
  useLayoutEffect(() => {
    const root = box.current;
    if (!root || !host) return;
    for (const el of root.querySelectorAll<HTMLElement>(".sc-ref")) {
      const parsed = parseCardRef(el.getAttribute("data-ref"));
      if (!parsed.ok) {
        degrade(el, parsed.error);
        continue;
      }
      el.setAttribute("data-ref-live", "");
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
    }
    const state = tracked.current;
    return () => {
      // The elements this pass decorated are about to go; so is whatever they were showing.
      if (state.shown) host.ref(null, "leave");
      tracked.current = {};
    };
  }, [html, host]);

  if (!host || !announce) return <div ref={box} className={className} dangerouslySetInnerHTML={inner} />;

  // Narrowed bindings: the function declarations below are hoisted, so they cannot see the
  // narrowing the early return gave `host` and `announce`.
  const live: CardRefHost = host;
  const tell: (text: string) => void = announce;

  const refOfTarget = (target: EventTarget | null): HTMLElement | undefined => {
    const el = target instanceof Element ? target.closest<HTMLElement>(SELECTOR) : null;
    return el && box.current?.contains(el) ? el : undefined;
  };

  // Hoisted by `function` so settle and sync can call each other.
  function settle(el: HTMLElement, result: CardRefResult, say: boolean) {
    if (result.ok) {
      if (say && result.label) tell(result.label);
      return;
    }
    // It is text now: it can no longer be what is pointed at, and what else is (a focused ref
    // behind a hovered one) comes back.
    degrade(el, result.reason);
    const state = tracked.current;
    if (state.shown === el) state.shown = undefined;
    if (state.hover === el) state.hover = undefined;
    if (state.focus === el) state.focus = undefined;
    sync(false);
  }

  // What is shown is whatever the pointer is over, else whatever has focus.
  function sync(say: boolean) {
    const state = tracked.current;
    const next = state.hover ?? state.focus;
    if (next === state.shown) return;
    if (state.shown) {
      const previous = readRef(state.shown);
      state.shown = undefined;
      if (previous) live.ref(previous, "leave");
    }
    if (!next) return;
    const ref = readRef(next);
    if (!ref) return;
    state.shown = next;
    settle(next, live.ref(ref, "enter"), say);
  }

  const over = (event: MouseEvent) => {
    const el = refOfTarget(event.target);
    const state = tracked.current;
    if (!el || state.dismissed === el) return;
    state.hover = el;
    sync(false);
  };
  const out = (event: MouseEvent) => {
    const state = tracked.current;
    const el = refOfTarget(event.target);
    if (!el || el !== state.hover) return;
    if (event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) return;
    state.hover = undefined;
    if (state.dismissed === el) state.dismissed = undefined;
    sync(false);
  };
  const focusIn = (event: FocusEvent) => {
    const el = refOfTarget(event.target);
    if (!el) return;
    tracked.current.focus = el;
    sync(true);
  };
  const focusOut = (event: FocusEvent) => {
    const el = refOfTarget(event.target);
    if (!el || el !== tracked.current.focus) return;
    tracked.current.focus = undefined;
    sync(false);
  };
  const activate = (el: HTMLElement) => {
    const ref = readRef(el);
    if (ref) settle(el, live.ref(ref, "activate"), true);
  };
  const click = (event: MouseEvent) => {
    const el = refOfTarget(event.target);
    if (!el) return;
    event.preventDefault();
    activate(el);
  };
  const key = (event: KeyboardEvent) => {
    const state = tracked.current;
    if (event.key === "Escape" && state.shown) {
      // Dismissible without moving the pointer or the focus (WCAG 1.4.13).
      state.dismissed = state.hover;
      state.hover = undefined;
      state.focus = undefined;
      sync(false);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const el = refOfTarget(event.target);
    if (!el) return;
    event.preventDefault();
    activate(el);
  };

  return (
    <div
      ref={box}
      className={className}
      dangerouslySetInnerHTML={inner}
      onMouseOver={over}
      onMouseOut={out}
      onFocus={focusIn}
      onBlur={focusOut}
      onClick={click}
      onKeyDown={key}
    />
  );
}
