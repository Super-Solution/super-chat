"use client";

// The documents panel: the sixth seam, driven by hand.
//
// Everything below runs with no model and no network. That is not a limitation
// of the demo, it is the point of the module: the hard parts of in-chat editing
// are ADDRESSING (which text does this edit mean?) and REFUSAL (what happens
// when the answer is "more than one" or "none"?), and both are decided by pure
// functions over a string. So they can be exercised directly, and a developer
// evaluating the framework can make them fail on purpose — which is the only
// way to see the half of `applyEdits` that matters.
//
// The other panels answer "what can the agent show you". This one answers "what
// stops the agent from quietly changing the wrong paragraph".

import { useMemo, useState } from "react";
import {
  applyEdits,
  buildEml,
  hunksOf,
  outlineOf,
  type Card,
  type DocumentCard,
  type DocumentEdit,
  type EditReviewCard,
  type EmailCard,
} from "@super-solution/super-chat-core";
import {
  DocumentCardView,
  DocumentQuoteProvider,
  EditReviewCardView,
  EmailCardView,
  useDocumentQuotes,
} from "@super-solution/super-chat-ui";
import { PanelHeader } from "@/components/Shell";

// Deliberately made of the constructs a real report is made of — a table, a
// quote, an ordered list, a fenced block — because those are what the previewer
// had to grow to render, and a sample that avoids them proves nothing.
const SOURCE = `# Vendor review

Two suppliers, scored against the March criteria.

## Findings

The cheaper option fails SSO. On a three-year horizon that is not a saving.

| Supplier | Annual | SSO | Notice |
|:---------|-------:|:---:|:-------|
| Northwind | 42,000 | yes | 60 days |
| Contoso   | 31,500 | no  | 90 days |

> Contoso's contract has no cap on the renewal uplift.

## Recommendation

1. Award to Northwind.
2. Ask Contoso for a capped renewal and re-score in September.

\`\`\`
renewal = 2027-03-01
notice  = 90d
\`\`\`
`;

type Attempt = { label: string; edits: DocumentEdit[]; note: string };

// Three that work and three that are refused. The refusals are the interesting
// half: each maps to a DIFFERENT retry, which is what makes them useful to a
// model rather than just safe.
const ATTEMPTS: Attempt[] = [
  {
    label: "Rename a heading",
    note: "Anchored on text that occurs once. Applies.",
    edits: [{ find: "## Recommendation", replace: "## What we recommend" }],
  },
  {
    label: "Two edits at once",
    note: "Resolved against the original and applied back-to-front, so the first cannot shift the second.",
    edits: [
      { find: "42,000", replace: "42,000 (fixed for 3y)" },
      { find: "Award to Northwind.", replace: "Award to Northwind, subject to legal sign-off." },
    ],
  },
  {
    label: "Delete a line",
    note: "An empty replacement is a deletion, and the hunk shows removed lines with nothing added.",
    edits: [{ find: "\n2. Ask Contoso for a capped renewal and re-score in September.", replace: "" }],
  },
  {
    label: "Anchor that matches nothing",
    note: "reason: not-found → the model is quoting text that is not there. Re-read.",
    edits: [{ find: "## Conclusions", replace: "## Findings" }],
  },
  {
    label: "Anchor that matches twice",
    note: "reason: ambiguous → \"Contoso\" appears in the table and in the quote. Widen it, or name a block.",
    edits: [{ find: "Contoso", replace: "Contoso Ltd" }],
  },
  {
    label: "Block that does not exist",
    note: "reason: no-such-block → the count is reported, so the model can re-read the outline.",
    edits: [{ block: 99, find: "SSO", replace: "single sign-on" }],
  },
];

const asCard = (spec: DocumentCard | EditReviewCard | EmailCard, id: string): Card => ({ id, spec });

/** The quote bar writes here; this is the composer's half of the bus. */
function QuoteReadout() {
  const bus = useDocumentQuotes();
  if (!bus) return null;

  if (!bus.quotes.length) {
    return (
      <p className="dev__section-note">
        Select any text in the document above and press <strong>Ask about this</strong>. The quote resolves to a
        block range and the SOURCE markdown — not the rendered text, because the same span has to work as an edit
        anchor later.
      </p>
    );
  }

  return (
    <>
      <div className="dev__row" style={{ marginBottom: 12 }}>
        <button type="button" className="sc-btn sc-btn--sm" onClick={bus.clear}>
          Clear {bus.quotes.length}
        </button>
      </div>
      <pre className="sc-pre dev__code">{JSON.stringify(bus.quotes, null, 2)}</pre>
    </>
  );
}

export default function DocumentsPanel() {
  // The panel holds the body itself rather than a DocumentStore: a store adds
  // async and an id and demonstrates nothing the store's own tests do not
  // already pin. What is worth showing is the text changing under an approval.
  const [markdown, setMarkdown] = useState(SOURCE);
  const [revision, setRevision] = useState(1);
  const [attempt, setAttempt] = useState<Attempt>(ATTEMPTS[0]!);
  const [answered, setAnswered] = useState<Card | null>(null);

  const outline = useMemo(() => outlineOf(markdown), [markdown]);
  const result = useMemo(() => applyEdits(markdown, attempt.edits), [markdown, attempt]);

  const documentCard: DocumentCard = { kind: "document", docId: "doc_demo", title: "Vendor review", markdown, revision };

  const review: EditReviewCard | null = result.ok
    ? {
        kind: "editreview",
        docId: "doc_demo",
        title: "Vendor review",
        revision,
        summary: attempt.label,
        hunks: hunksOf(result.applied),
      }
    : null;

  // Accepting is where the two halves meet: the accepted subset is re-resolved
  // against the CURRENT body, never replayed from the offsets computed when the
  // diff was drawn.
  const accept = (indices: number[]) => {
    if (!result.ok) return;
    const chosen = result.applied.filter((_, i) => indices.includes(i)).map((a) => a.edit);
    const partial = applyEdits(markdown, chosen);
    if (partial.ok) {
      setMarkdown(partial.markdown);
      setRevision((r) => r + 1);
    }
  };

  const email: EmailCard = {
    kind: "email",
    to: ["counsel@example.com"],
    subject: "Vendor review — recommendation",
    body: `Hi,\n\nSummary of the vendor review:\n\n${outline
      .filter((o) => o.level)
      .map((o) => `- ${o.preview.replace(/^#+\s*/, "")}`)
      .join("\n")}\n\nFull document attached.\n\nThanks`,
  };

  return (
    <div className="dev__page">
      <PanelHeader title="Documents">
        A document is the sixth thing this framework persists, and none of the other five fits: it changes (so not a
        file ref), it outlives its thread (so not the transcript), and for a document the diff <em>is</em> the product,
        because it is what the user approves. Storage stays the host&apos;s — the framework owns the model, the edit
        protocol and the approval surface.
      </PanelHeader>

      <DocumentQuoteProvider>
        <section className="dev__section">
          <h2 className="dev__section-title">The previewer</h2>
          <p className="dev__section-note">
            It renders, it selects, and it shows diffs. No toolbar, no caret, no <code className="sc-mono">
              contentEditable
            </code>{" "}
            — changes go through the conversation and land via an approved diff. That boundary is what keeps this a
            component rather than the visual builder the framework rules out.
          </p>
          <DocumentCardView spec={documentCard} card={asCard(documentCard, "card_doc")} />
        </section>

        <section className="dev__section">
          <h2 className="dev__section-title">Quoting</h2>
          <p className="dev__section-note">
            A quote is part of the user&apos;s <em>message</em>, not app-state. App-state is re-read every turn, goes
            stale the moment the selection changes, and is droppable under budget pressure — and dropping a paragraph
            the user deliberately highlighted loses part of what they said.
          </p>
          <QuoteReadout />
        </section>
      </DocumentQuoteProvider>

      <section className="dev__section">
        <h2 className="dev__section-title">The outline the model reads</h2>
        <p className="dev__section-note">
          Editing is directed — &quot;the third section&quot;, &quot;the bit about renewal&quot; — not a similarity
          search, so the model navigates rather than retrieves. One line per block, and never the body.
        </p>
        <pre className="sc-pre dev__code">{JSON.stringify(outline, null, 2)}</pre>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">The edit protocol, including its refusals</h2>
        <p className="dev__section-note">
          Half of <code className="sc-mono">applyEdits</code> is refusal, and that half is the reason the feature is
          safe. First-match-wins is the tempting fallback and the dangerous one: it puts a change somewhere nobody
          asked for and then presents it for approval as though it were intended. The diff reads fine, so the user
          says yes.
        </p>

        <div className="dev__row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {ATTEMPTS.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`sc-btn sc-btn--sm${a === attempt ? " sc-btn--primary" : ""}`}
              onClick={() => {
                setAttempt(a);
                setAnswered(null);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        <p className="dev__section-note">{attempt.note}</p>
        <pre className="sc-pre dev__code">{JSON.stringify(attempt.edits, null, 2)}</pre>

        {review ? (
          <EditReviewCardView
            key={`${attempt.label}:${revision}`}
            spec={review}
            card={answered ?? asCard(review, `card_review_${revision}`)}
            answered={answered !== null}
            respond={(action) => {
              const value = action.value as { accepted?: number[] } | undefined;
              const indices = Array.isArray(value?.accepted) ? value.accepted : [];
              setAnswered({ ...asCard(review, `card_review_${revision}`), action: { ...action, at: 0 } as Card["action"] });
              accept(indices);
            }}
          />
        ) : (
          <div className="sc-callout sc-callout--negative">
            <div className="sc-callout__title">
              Refused — <code className="sc-mono">{!result.ok ? result.reason : ""}</code>
            </div>
            <div className="sc-callout__body">{!result.ok ? result.message : ""}</div>
          </div>
        )}

        <p className="dev__section-note" style={{ marginTop: 12 }}>
          The document above is live: accept a hunk and it rewrites, and the revision goes up. A refusal writes
          nothing and hands the model a reason it can act on — <code className="sc-mono">not-found</code> means
          re-read, <code className="sc-mono">ambiguous</code> means widen the anchor.{" "}
          <button type="button" className="sc-btn sc-btn--sm" onClick={() => { setMarkdown(SOURCE); setRevision(1); setAnswered(null); }}>
            Reset to v1
          </button>
        </p>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">The way out</h2>
        <p className="dev__section-note">
          <code className="sc-mono">.eml</code> is the exit and <code className="sc-mono">mailto:</code> is the
          shortcut, and the card says so in that order — past roughly 2,000 characters a mail client truncates a
          mailto <em>silently</em>. Nothing here sends: that needs a credential, and the framework holding one would
          break the rule Transport keeps. A host that wants a send button passes{" "}
          <code className="sc-mono">onSend</code>.
        </p>
        <EmailCardView spec={email} card={asCard(email, "card_email")} />
        <details style={{ marginTop: 12 }}>
          <summary className="dev__section-note" style={{ cursor: "pointer" }}>
            The generated .eml
          </summary>
          <pre className="sc-pre dev__code">{buildEml(email)}</pre>
        </details>
      </section>
    </div>
  );
}
