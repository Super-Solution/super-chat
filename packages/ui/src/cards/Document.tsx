"use client";

// The document previewer.
//
// Its boundary is the whole design, so it is stated first: this RENDERS,
// SELECTS and (later) shows a diff. It is not an editor. No toolbar, no
// caret, no contentEditable. Changes go through the conversation and land via
// an approved diff, which is what keeps this a framework component rather than
// the "visual builder" HANDOFF rules out. The moment someone wants to type in
// here, that is the host's product decision, and what the framework hands them
// is Markdown plus anchors — not a half-built editor.
//
// Two shapes, one component. Inline in the transcript by default, expanded to a
// full surface on request; on a compact container the expanded state is a
// sheet, because a side panel does not exist at that width (UI-SPEC 6.7). That
// had to be decided here rather than retrofitted — the expanded state is a
// different DOM, not a different width.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentCard } from "@super-solution/super-chat-core";
import type { MarkdownBlock } from "@super-solution/super-chat-core";
import { renderMarkdownWithAnchors } from "../markdown.js";
import type { CardRendererProps } from "../renderer-registry.js";
import { useDocumentQuotes } from "../quotes.js";
import { CardActions } from "./CardActions.js";

/**
 * A span of a document the user pointed at, resolved back to source offsets.
 *
 * `text` is the SOURCE markdown, not the rendered text: quoting what the screen
 * showed would hand the model `bold` where the document says `**bold**`, and
 * the same span has to work as an edit anchor later.
 */
export type DocumentQuote = {
  docId: string;
  title: string;
  revision: number;
  /** Inclusive block index range, for a coarse anchor that survives edits. */
  blocks: [number, number];
  start: number;
  end: number;
  text: string;
};

export type DocumentCardViewProps = CardRendererProps<DocumentCard> & {
  /**
   * Raised when the user quotes a selection. Usually unset: the card finds the
   * composer's quote bus itself, so a document rendered through the ordinary
   * card pipeline is quotable with no host wiring. Pass this to intercept.
   */
  onQuote?: (quote: DocumentQuote) => void;
};

/** Nearest ancestor (or self) carrying a block anchor. */
function anchorOf(node: Node | null): number | null {
  let el: HTMLElement | null =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el) {
    const raw = el.dataset?.scBlock;
    if (raw !== undefined) {
      const i = Number(raw);
      if (Number.isInteger(i)) return i;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Resolve a DOM selection to a source span.
 *
 * Block-level, deliberately. Mapping a selection to exact inline offsets would
 * need a renderer that tracks positions through every inline transform; block
 * granularity needs only the anchors already emitted, and it is the same
 * granularity the edit protocol addresses. The cost is that quoting half a
 * paragraph quotes the paragraph — which for "ask about this bit" is the right
 * rounding, since a fragment torn out of its sentence is worse context.
 */
function resolveSelection(root: HTMLElement, blocks: MarkdownBlock[], src: string): Omit<DocumentQuote, "docId" | "title" | "revision"> | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  if (!sel.toString().trim()) return null;

  const from = anchorOf(range.startContainer);
  const to = anchorOf(range.endContainer);
  if (from === null || to === null) return null;

  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const first = blocks[lo];
  const last = blocks[hi];
  if (!first || !last) return null;

  return {
    blocks: [lo, hi],
    start: first.start,
    end: last.end,
    text: src.slice(first.start, last.end),
  };
}

export function DocumentCardView({ spec, onQuote: onQuoteProp }: DocumentCardViewProps) {
  const bus = useDocumentQuotes();
  // An explicit handler wins; otherwise the bus, if a provider is mounted;
  // otherwise quoting is off — which is the right state for a host that renders
  // documents and wants nothing to do with the composer.
  const onQuote = onQuoteProp ?? (bus ? (q: DocumentQuote) => bus.add(q) : undefined);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<Omit<DocumentQuote, "docId" | "title" | "revision"> | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const { html, blocks } = useMemo(() => renderMarkdownWithAnchors(spec.markdown), [spec.markdown]);
  // Memoised for IDENTITY, not for the cost of building an object literal.
  // React re-applies dangerouslySetInnerHTML when the prop object is new, even
  // if the string inside it is unchanged — and re-applying innerHTML destroys
  // and rebuilds every child node, which collapses any selection inside them.
  // Passing a fresh literal here made the previewer un-quotable in a way that
  // looked like the selection code failing: the range resolved correctly, then
  // the re-render that displayed the result wiped the selection that produced
  // it. tests/document.spec.ts pins this.
  const inner = useMemo(() => ({ __html: html }), [html]);

  const readSelection = useCallback(() => {
    const root = bodyRef.current;
    if (!root || !onQuote) return;
    const resolved = resolveSelection(root, blocks, spec.markdown);
    // Only ever REPLACED by a new selection, never cleared by an empty one.
    // Reaching for the button collapses the selection on the way — a touch tap
    // does it before the click lands — so a bar that withdrew whenever the
    // selection emptied would vanish exactly as the user went to press it.
    // Withdrawing it is the dismiss button's job, which is explicit.
    if (resolved) setPending(resolved);
  }, [blocks, onQuote, spec.markdown]);

  // selectionchange on the document, not mouseup on the element: a selection
  // can be made with the keyboard, extended outside the element, or — on iOS —
  // adjusted through the system's own drag handles, none of which produce a
  // mouseup here.
  useEffect(() => {
    if (!onQuote) return;
    const handler = () => readSelection();
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [onQuote, readSelection]);

  // Escape closes the expanded surface. Sheets that trap the user are the
  // single most common complaint about this pattern on a phone.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  const quote = () => {
    if (!pending || !onQuote) return;
    onQuote({ docId: spec.docId, title: spec.title, revision: spec.revision, ...pending });
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const body = (
    <>
      <div className="sc-doc__head">
        <span className="sc-doc__title">{spec.title}</span>
        <span className="sc-doc__rev sc-mono" title="Document revision">
          v{spec.revision}
        </span>
        <button
          type="button"
          className="sc-doc__expand"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? "Close" : "Open"}
        </button>
      </div>

      <div
        ref={bodyRef}
        className="sc-doc__body sc-prose"
        dangerouslySetInnerHTML={inner}
      />

      {/* The quote bar sits under the document rather than floating at the
          selection. A floating button is the nicer desktop interaction and an
          unusable one on iOS, where the system's magnifier and callout bar own
          that space and will cover it. One affordance in one place beats two
          that disagree. */}
      {onQuote && pending ? (
        <div className="sc-doc__quotebar">
          <span className="sc-doc__quotetext">{pending.text.trim().slice(0, 90)}</span>
          <button type="button" className="sc-btn sc-btn--sm sc-btn--primary" onClick={quote}>
            Ask about this
          </button>
          <button
            type="button"
            className="sc-doc__quotedismiss"
            aria-label="Dismiss quote"
            onClick={() => setPending(null)}
          >
            ✕
          </button>
        </div>
      ) : null}

      <CardActions getText={() => spec.markdown} filename={`${spec.title || "document"}.md`} mimeType="text/markdown" />
    </>
  );

  if (!expanded) return <div className="sc-card sc-doc">{body}</div>;

  return (
    <>
      <div className="sc-card sc-doc sc-doc--placeholder" aria-hidden>
        <div className="sc-doc__head">
          <span className="sc-doc__title">{spec.title}</span>
          <span className="sc-muted">opened</span>
        </div>
      </div>
      <div className="sc-doc__scrim" onClick={() => setExpanded(false)} />
      <div className="sc-doc__surface" role="dialog" aria-label={spec.title}>
        <div className="sc-card sc-doc sc-doc--open">{body}</div>
      </div>
    </>
  );
}
