// Quoted document spans — what the user pointed at, carried into one request.
//
// The load-bearing decision is where a quote LIVES, and the obvious answer is
// wrong. A selection looks like screen state, so app-state seems to be its
// home. It is not:
//
//   - app-state answers "what is the user looking at now" and is re-read every
//     turn. A quote is pinned to ONE request; the turn after, the user has not
//     selected anything and it must be gone.
//   - It would go stale in history. Select A, send, select B — and the first
//     message, re-read later, would show B, because app-state has no memory of
//     what it said three turns ago.
//   - It is droppable. app-state losing its slot to budget pressure costs some
//     environment detail. A span the user deliberately highlighted losing its
//     slot loses part of what the user SAID — a correctness bug wearing a
//     budget optimisation's clothes.
//
// So a quote is part of the user's message: flattened into a text part for the
// model, and kept structurally on `Message.metadata`, which is documented as
// never reaching a provider. Nothing in the adapters changes.
//
// Drift follows the same rule. Whether the document has moved past the quoted
// revision is checked once, when the message is sent, and recorded on the
// quote — not re-derived on every turn, which would make an old message
// describe the document's present rather than what was true when the user
// spoke.

import type { DocumentSnapshot, DocumentStore } from "../documents/types.js";

/** A span of a document artifact, resolved to source offsets. */
export type DocumentQuoteRef = {
  docId: string;
  title: string;
  /** Revision the span was taken from — compared at send time; see `drift`. */
  revision: number;
  /** Inclusive block index range. */
  blocks: [number, number];
  start: number;
  end: number;
  /** SOURCE markdown, not rendered text. */
  text: string;
  /**
   * How the document had moved past `revision` when the message was sent.
   * Absent when it had not, or when nothing checked — see `checkQuoteDrift`.
   */
  drift?: QuoteDrift;
};

/**
 * What a quote's document did between the quoted revision and the send.
 *
 * The quoted revision can be old the moment it is taken — a document card
 * further up the thread still shows the body it was created with — and the
 * model cannot tell from the text alone. Told, it re-reads; not told, it
 * proposes an edit against text that may no longer be there, or answers about
 * a paragraph the user has since rewritten.
 */
export type QuoteDrift =
  /** Past the quoted revision. `intact`: the quoted text still appears verbatim. */
  | { status: "moved"; revision: number; intact: boolean }
  /** The document no longer exists. */
  | { status: "removed" };

/**
 * Compare a quote against the document as it is now. `undefined` when the
 * quote is current.
 *
 * Any revision other than the quoted one counts — a lower one means the id now
 * names a different document, which is drift too.
 */
export function quoteDrift(
  quote: DocumentQuoteRef,
  current: Pick<DocumentSnapshot, "revision" | "markdown"> | undefined,
): QuoteDrift | undefined {
  if (!current) return { status: "removed" };
  if (current.revision === quote.revision) return undefined;
  return { status: "moved", revision: current.revision, intact: current.markdown.includes(quote.text) };
}

/**
 * Stamp each quote with its drift against the store, ready to send.
 *
 * A lookup that throws leaves that quote unstamped rather than failing the
 * send: the user's message matters more than the annotation, the quote still
 * names its revision, and an edit made from it is still checked against the
 * current one.
 */
export async function checkQuoteDrift(
  quotes: readonly DocumentQuoteRef[],
  documents: Pick<DocumentStore, "get">,
): Promise<DocumentQuoteRef[]> {
  const lookups = new Map<string, Promise<DocumentSnapshot | undefined | null>>();
  return Promise.all(
    quotes.map(async (quote) => {
      let lookup = lookups.get(quote.docId);
      if (!lookup) {
        lookup = documents.get(quote.docId).catch(() => null);
        lookups.set(quote.docId, lookup);
      }
      const current = await lookup;
      const { drift: _unchecked, ...rest } = quote;
      if (current === null) return rest;
      const drift = quoteDrift(quote, current);
      return drift ? { ...rest, drift } : rest;
    }),
  );
}

const driftNote = (drift: QuoteDrift | undefined): string => {
  if (!drift) return "";
  if (drift.status === "removed") return "Note: this document no longer exists.\n";
  return drift.intact
    ? `Note: the document is now at v${drift.revision}. This text is still in it, but its block numbers may have shifted — re-read before editing.\n`
    : `Note: the document is now at v${drift.revision}, and this text is no longer in it. Re-read before acting on the quote.\n`;
};

/** Key under `Message.metadata` where quotes are stored for re-rendering. */
export const QUOTES_METADATA_KEY = "documentQuotes";

const fence = (text: string) => {
  // A quote can itself contain a ``` fence, so the wrapper grows past the
  // longest run inside it rather than truncating or escaping the content.
  const longest = [...text.matchAll(/`{3,}/g)].reduce((n, m) => Math.max(n, m[0].length), 2);
  return "`".repeat(longest + 1);
};

/**
 * Render quotes as the prefix of the user's message.
 *
 * Fenced rather than indented, and labelled with the document and block range,
 * so the model can tell quoted material from the user's own words — and can
 * name what it is about to change when the edit tools arrive. A stamped drift
 * becomes a note between the label and the text.
 */
export function formatQuotes(quotes: readonly DocumentQuoteRef[]): string {
  if (!quotes.length) return "";
  return quotes
    .map((q) => {
      const [from, to] = q.blocks;
      const where = from === to ? `block ${from}` : `blocks ${from}–${to}`;
      const f = fence(q.text);
      return `Quoted from "${q.title}" (${q.docId} v${q.revision}, ${where}):\n${driftNote(q.drift)}${f}markdown\n${q.text}\n${f}`;
    })
    .join("\n\n");
}

/** Prefix `text` with the quotes, keeping a blank line between them. */
export function withQuotes(text: string, quotes: readonly DocumentQuoteRef[]): string {
  const prefix = formatQuotes(quotes);
  if (!prefix) return text;
  return text.trim() ? `${prefix}\n\n${text}` : prefix;
}

/** Read quotes back off a message, for re-rendering the chips in history. */
export function quotesOf(metadata: Record<string, unknown> | undefined): DocumentQuoteRef[] {
  const raw = metadata?.[QUOTES_METADATA_KEY];
  return Array.isArray(raw) ? (raw as DocumentQuoteRef[]) : [];
}
