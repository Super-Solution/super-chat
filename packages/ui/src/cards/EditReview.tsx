"use client";

// The approval surface for a document edit.
//
// In in-chat editing the diff IS the approval — there is no other moment where
// the user sees what is about to happen. So this card is interactive, and it
// accepts hunks INDIVIDUALLY. All-or-nothing would be simpler and would make
// the exchange read as take-it-or-leave-it; partial acceptance is what makes it
// read as working with someone. It is also free here, because an edit already
// carries its own anchor and is therefore independently applicable.

import { useState } from "react";
import type { EditReviewCard } from "@super-solution/super-chat-core";
import type { CardRendererProps } from "../renderer-registry.js";

export function EditReviewCardView({ spec, card, respond, answered }: CardRendererProps<EditReviewCard>) {
  // Everything starts accepted. The model proposed these because it was asked
  // to; opting out of one is the exception, and making the user tick every box
  // to get what they requested is friction that reads as distrust.
  const [accepted, setAccepted] = useState<Set<number>>(() => new Set(spec.hunks.map((h) => h.index)));

  // The recorded action wins over local state. This card re-mounts from history
  // when the turn commits, and local state does not survive that — the same
  // trap ConfirmCardView documents, where guessing made a confirmed action read
  // back as declined.
  const recorded = (card.action?.value as { accepted?: number[] } | undefined)?.accepted;
  const done = answered || card.action !== undefined;
  const shown = recorded ? new Set(recorded) : accepted;

  const toggle = (index: number) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const answer = (indices: number[]) => {
    if (done) return;
    respond?.({ cardId: card.id, callId: card.callId, kind: "editreview", type: "submit", value: { accepted: indices } });
  };

  const apply = () => answer([...accepted].sort((a, b) => a - b));
  // An explicit empty answer rather than a cancel: the tool distinguishes "the
  // user said no" from "nothing came back", and only the first is a decision
  // worth reporting to the model as one.
  const reject = () => answer([]);

  return (
    <div className="sc-card sc-card--interactive sc-editreview">
      <div className="sc-card__head">
        <div className="sc-card__title">
          {spec.title}
          <span className="sc-editreview__rev sc-mono"> v{spec.revision}</span>
        </div>
        <span className="sc-pill">
          {shown.size}/{spec.hunks.length} {done ? "applied" : "selected"}
        </span>
      </div>

      {spec.summary ? <p className="sc-card__prompt">{spec.summary}</p> : null}

      <ul className="sc-hunks">
        {spec.hunks.map((hunk) => {
          const on = shown.has(hunk.index);
          return (
            <li key={hunk.index} className={`sc-hunk${on ? "" : " sc-hunk--off"}`}>
              <label className="sc-hunk__head">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={done}
                  onChange={() => toggle(hunk.index)}
                />
                <span className="sc-hunk__where sc-mono">block {hunk.block}</span>
              </label>
              <div className="sc-hunk__body sc-mono">
                {hunk.removed.map((line, i) => (
                  <div key={`r${i}`} className="sc-hunk__line sc-hunk__line--del">
                    {/* The sign is a second, non-colour signal — the rule every
                        tone in this kit follows, and the one that matters most
                        here because red/green is the classic failure case. */}
                    <span className="sc-hunk__sign" aria-hidden>
                      −
                    </span>
                    <span className="sc-hunk__text">{line || " "}</span>
                  </div>
                ))}
                {hunk.added.map((line, i) => (
                  <div key={`a${i}`} className="sc-hunk__line sc-hunk__line--add">
                    <span className="sc-hunk__sign" aria-hidden>
                      +
                    </span>
                    <span className="sc-hunk__text">{line || " "}</span>
                  </div>
                ))}
                {hunk.added.length === 0 ? <div className="sc-hunk__note">removed</div> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sc-card__actions">
        <button type="button" className="sc-btn sc-btn--primary" disabled={done || accepted.size === 0} onClick={apply}>
          {accepted.size === spec.hunks.length
            ? `Apply ${spec.hunks.length === 1 ? "change" : "all changes"}`
            : `Apply ${accepted.size} of ${spec.hunks.length}`}
        </button>
        <button type="button" className="sc-btn" disabled={done} onClick={reject}>
          Reject all
        </button>
      </div>
    </div>
  );
}
