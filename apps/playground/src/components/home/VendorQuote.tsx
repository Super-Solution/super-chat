import type { CardSpec } from "@super-solution/super-chat-core";
import type { CardRendererProps } from "@super-solution/super-chat-ui";

// A host-defined card kind, rendered through the same registry as the 23
// built-ins. It uses the kit's card classes, so it follows the flavor tokens.
export type VendorQuoteSpec = {
  kind: "vendorQuote";
  vendor: string;
  term: string;
  price: number;
  notes: string[];
};

export const VENDOR_QUOTE = {
  kind: "vendorQuote",
  vendor: "Brightline",
  term: "3-year term",
  price: 52_900,
  notes: ["per year", "SSO included", "data in EU"],
} satisfies VendorQuoteSpec as unknown as CardSpec;

export function VendorQuoteView({ spec }: CardRendererProps) {
  const quote = spec as unknown as VendorQuoteSpec;
  return (
    <div className="sc-card">
      <div className="sc-card__title">{quote.vendor} · {quote.term}</div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 16 }}>
        <span className="sc-mono" style={{ fontSize: 32, fontWeight: 500, lineHeight: 1.2 }}>
          ${quote.price.toLocaleString("en-US")}
        </span>
        <span className="sc-muted" style={{ fontSize: 14 }}>{quote.notes.join(" · ")}</span>
      </div>
    </div>
  );
}
