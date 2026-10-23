"use client";

// The quote bus: previewer → composer.
//
// Without it a host has to wire DocumentCardView's onQuote into its own state
// and hand that back to Composer as a prop — for a gesture the user thinks of
// as one action. That wiring is exactly the friction this feature exists to
// remove, so the kit does it.
//
// It lives in packages/ui rather than packages/react because both ends are UI
// components, and routing it through the client layer would make the kit's
// component tree depend on a store it does not otherwise need. The provider is
// optional: DocumentCardView without one simply does not offer quoting, which
// is the correct degradation for a host that renders documents but wants no
// composer integration.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { DocumentQuoteRef } from "@super-solution/super-chat-core";

export type QuoteBus = {
  quotes: DocumentQuoteRef[];
  add(quote: DocumentQuoteRef): void;
  remove(index: number): void;
  clear(): void;
};

const QuoteContext = createContext<QuoteBus | null>(null);

export function DocumentQuoteProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<DocumentQuoteRef[]>([]);

  const add = useCallback((quote: DocumentQuoteRef) => {
    setQuotes((prev) =>
      // Quoting the same span twice is a slip, not an intent to send it twice.
      prev.some(
        (q) => q.docId === quote.docId && q.start === quote.start && q.end === quote.end,
      )
        ? prev
        : [...prev, quote],
    );
  }, []);

  const remove = useCallback((index: number) => {
    setQuotes((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => setQuotes([]), []);

  const value = useMemo<QuoteBus>(() => ({ quotes, add, remove, clear }), [quotes, add, remove, clear]);
  return <QuoteContext.Provider value={value}>{children}</QuoteContext.Provider>;
}

/**
 * Null when no provider is mounted — callers branch on it rather than getting a
 * silently inert bus, so "quoting does nothing" is impossible to ship by
 * accident.
 */
export function useDocumentQuotes(): QuoteBus | null {
  return useContext(QuoteContext);
}
