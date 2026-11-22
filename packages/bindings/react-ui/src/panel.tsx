"use client";

// The side panel: a card shown beside the conversation instead of inside it.
//
// A card asks for it with `placement: "panel"` (the agent through `visualize`, or a tool on its
// result). The panel is state plus one component; where it sits is the host's layout:
//
//   <ChatPanelProvider>
//     <Thread />                 a panel card leaves a short line here that reopens it
//     <ChatPanel />              put it in a column, a drawer or a sheet
//   </ChatPanelProvider>
//
// The same renderer draws the card in the panel as in the chat, told `placement: "panel"`, so a
// plugin card (a chart, a document) can show its full tool there. Without a provider a panel card
// is drawn inline as before: a host with no panel loses nothing.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Card } from "@supersolutions/super-chat-core";
import { useOptionalAgentClient } from "@supersolutions/super-chat-react";
// Used only while rendering, so the two modules may import each other.
import { CardRenderer } from "./renderer-registry.js";

export type ChatPanelLabels = {
  /** The line left in the chat for a card shown in the panel. */
  opened: string;
  /** Its button when the card is not the one in the panel. */
  open: string;
  /** Its state when the card is the one in the panel. */
  showing: string;
  /** The panel's close button. */
  close: string;
  /** The panel's heading for a card without a title. */
  untitled: string;
};

const DEFAULT_LABELS: ChatPanelLabels = {
  opened: "Opened beside the chat",
  open: "Open",
  showing: "Showing",
  close: "Close panel",
  untitled: "Panel",
};

export type ChatPanelState = {
  /** The card in the panel, or `null` when it is closed. */
  card: Card | null;
  open(card: Card): void;
  close(): void;
  labels: ChatPanelLabels;
};

const ChatPanelContext = createContext<ChatPanelState | null>(null);

/** The panel, inside a `ChatPanelProvider`. Throws outside one. */
export function useChatPanel(): ChatPanelState {
  const panel = useContext(ChatPanelContext);
  if (!panel) throw new Error("useChatPanel must be used inside <ChatPanelProvider>.");
  return panel;
}

/** The panel, or `null` when the host has none. */
export function useOptionalChatPanel(): ChatPanelState | null {
  return useContext(ChatPanelContext);
}

export type ChatPanelProviderProps = {
  children: ReactNode;
  /** The card the panel starts with, for a host that restores its layout (default none). */
  initialCard?: Card | null;
  /**
   * Open a panel card as soon as it arrives in a running turn (default true). Needs an
   * `AgentProvider`; a host that runs turns elsewhere calls `open(card)` itself. Cards already in
   * a thread when it is shown never open by themselves.
   */
  autoOpen?: boolean;
  /** Called whenever the panel opens a card or closes, for a host that lays itself out around it. */
  onChange?: (card: Card | null) => void;
  /** Any subset of the panel's words; the rest stay English. */
  labels?: Partial<ChatPanelLabels>;
};

const isPanelCard = (card: Card) => card.placement === "panel" && !card.expired;

export function ChatPanelProvider({ children, initialCard = null, autoOpen = true, onChange, labels }: ChatPanelProviderProps) {
  const [card, setCard] = useState<Card | null>(initialCard);
  const changed = useRef(onChange);
  changed.current = onChange;
  const open = useCallback((next: Card) => {
    setCard(next);
    changed.current?.(next);
  }, []);
  const close = useCallback(() => {
    setCard(null);
    changed.current?.(null);
  }, []);

  // A card revised in place (same id) stays in the panel with its new content.
  const client = useOptionalAgentClient();
  useEffect(() => {
    if (!client) return;
    const seen = new Set(client.store.get().cards.map((c) => c.id));
    return client.store.subscribe(() => {
      const cards = client.store.get().cards;
      let fresh: Card | undefined;
      for (const c of cards) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          if (autoOpen && isPanelCard(c)) fresh = c;
        }
      }
      if (fresh) {
        open(fresh);
        return;
      }
      setCard((current) => {
        if (!current) return current;
        const latest = cards.find((c) => c.id === current.id);
        return latest && latest !== current ? latest : current;
      });
    });
  }, [client, autoOpen, open]);

  const words = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);
  const value = useMemo(() => ({ card, open, close, labels: words }), [card, open, close, words]);
  return <ChatPanelContext.Provider value={value}>{children}</ChatPanelContext.Provider>;
}

const titleOf = (card: Card): string | undefined => {
  const title = (card.spec as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title.trim() : undefined;
};

/**
 * What a panel card leaves in the chat: its title and a button that brings it back to the panel.
 * `CardRenderer` draws it for a `placement: "panel"` card inside a `ChatPanelProvider`.
 */
export function PanelCardLine({ card }: { card: Card }) {
  const panel = useChatPanel();
  const showing = panel.card?.id === card.id;
  const title = titleOf(card);
  return (
    <div className={`sc-card sc-panel-line${showing ? " sc-panel-line--showing" : ""}`}>
      <span className="sc-panel-line__icon" aria-hidden>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
          <path d="M9.5 2.75v10.5" />
        </svg>
      </span>
      <span className="sc-panel-line__text">
        {title ? <span className="sc-panel-line__title">{title}</span> : null}
        <span className="sc-muted sc-panel-line__note">{panel.labels.opened}</span>
      </span>
      <button
        type="button"
        className="sc-btn sc-btn--sm sc-panel-line__open"
        aria-pressed={showing}
        disabled={showing}
        onClick={() => panel.open(card)}
      >
        {showing ? panel.labels.showing : panel.labels.open}
      </button>
    </div>
  );
}

export type ChatPanelProps = {
  className?: string;
  /** Shown while no card is open. Default: nothing is rendered. */
  empty?: ReactNode;
  /** Draw the heading row with the card's title and a close button. Default true. */
  header?: boolean;
  /** Replaces the default card drawing, for a host that wraps the card in its own chrome. */
  children?: (card: Card) => ReactNode;
};

/**
 * The open panel card, drawn by the same renderer as in the chat with `placement: "panel"`. It fills
 * its container: give it the height of the column, drawer or sheet it sits in.
 */
export function ChatPanel({ className, empty = null, header = true, children }: ChatPanelProps) {
  const panel = useChatPanel();
  const { card } = panel;
  if (!card) return empty ? <>{empty}</> : null;
  const title = titleOf(card) ?? panel.labels.untitled;
  return (
    <section className={`sc-panel${className ? ` ${className}` : ""}`} aria-label={title}>
      {header ? (
        <header className="sc-panel__header">
          <h2 className="sc-panel__title">{title}</h2>
          <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm sc-panel__close" aria-label={panel.labels.close} onClick={panel.close}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
      ) : null}
      <div className="sc-panel__body">{children ? children(card) : <CardRenderer card={card} placement="panel" />}</div>
    </section>
  );
}
