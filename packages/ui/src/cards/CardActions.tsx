"use client";

// Shared action row for read-only cards (table / markdown / code).
//
// Before this existed, CodeCardView hand-rolled its own copy button and every
// other read-only card had nothing — "add copy to the table card" would have
// meant a fourth near-identical implementation. Centralising means every
// read-only card gets copy + download for free, and they stay behaviourally
// identical (same "Copied" debounce, same download mechanics) instead of
// drifting apart one bug fix at a time.
//
// Deliberately NOT used by the interactive cards (choice/form/confirm): an
// action row planted next to a decision control is a misclick hazard — see
// the file header in Interactive.tsx for the underlying invariant.

import { useState } from "react";

export type CardActionsProps = {
  /** Lazy so a card with expensive formatting (e.g. building TSV) only pays
   * for it when the button is actually pressed. */
  getText: () => string;
  /** Download filename, extension included (e.g. "table.tsv"). */
  filename: string;
  mimeType?: string;
};

export function CardActions({ getText, filename, mimeType = "text/plain" }: CardActionsProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    // A silent catch would leave the button looking inert when the clipboard is
    // blocked (permissions, an unfocused document, an older browser). Say it
    // failed — an unlabelled non-event is indistinguishable from a broken UI.
    try {
      await navigator.clipboard.writeText(getText());
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  };

  const download = () => {
    const blob = new Blob([getText()], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Deferred rather than immediate: revoking the URL in the same tick can
    // cut a download off before some browsers finish reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="sc-card__actions sc-card__actions--aux">
      <button
        type="button"
        className={`sc-btn sc-btn--ghost sc-btn--sm${state === "failed" ? " sc-tone--negative" : ""}`}
        onClick={copy}
      >
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
      <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" onClick={download}>
        Download
      </button>
    </div>
  );
}
