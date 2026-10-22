"use client";

// The email draft.
//
// Editable, because a model does not know how the user talks to this
// particular person, and a draft you cannot touch is one you retype elsewhere.
//
// Three exits, ordered by what actually works:
//
//   Download .eml  a real RFC 5322 message. Every client opens it, it carries
//                  headers and recipients, it survives being saved, and it does
//                  not care how long the body is. This is the reliable one.
//   Copy           for anyone already in a webmail tab.
//   Open in mail   mailto:, the convenience shortcut — and the one with hard
//                  limits, so when a body is long enough to be truncated the
//                  card says so instead of letting a letter arrive cut in half.
//
// None of them sends. Sending needs a credential, and the framework holding one
// would break the rule Transport keeps. A host that wants a send button passes
// `onSend`; without it there is no button, which is the honest default.

import { useState } from "react";
import { buildEml, buildMailto, emlFilename, type EmailCard } from "@zzyzxlabs/super-chat-core";
import type { CardRendererProps } from "../renderer-registry.js";

export type EmailCardViewProps = CardRendererProps<EmailCard> & {
  /** Host-supplied delivery. Absent means no send button at all. */
  onSend?: (email: EmailCard) => Promise<void> | void;
};

const list = (v: string) =>
  v.split(",").map((s) => s.trim()).filter(Boolean);

export function EmailCardView({ spec, onSend }: EmailCardViewProps) {
  const [to, setTo] = useState(spec.to.join(", "));
  const [cc, setCc] = useState((spec.cc ?? []).join(", "));
  const [subject, setSubject] = useState(spec.subject);
  const [body, setBody] = useState(spec.body);
  const [state, setState] = useState<"idle" | "copied" | "sending" | "sent" | "failed">("idle");

  const edited: EmailCard = {
    kind: "email",
    to: list(to),
    ...(list(cc).length ? { cc: list(cc) } : {}),
    subject,
    body,
  };
  const mailto = buildMailto(edited);

  const download = () => {
    const blob = new Blob([buildEml(edited)], { type: "message/rfc822" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = emlFilename(edited);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  };

  const send = async () => {
    if (!onSend) return;
    setState("sending");
    try {
      await onSend(edited);
      setState("sent");
    } catch {
      setState("failed");
    }
  };

  return (
    // No "Draft email" heading: the To / Subject / body fields already say what
    // this is, and the subject is the title the user will recognise.
    <div className="sc-card sc-email">
      <div className="sc-email__fields">
        <label className="sc-email__row">
          <span className="sc-email__label">To</span>
          <input className="sc-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="sc-email__row">
          <span className="sc-email__label">Cc</span>
          <input className="sc-input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="—" />
        </label>
        <label className="sc-email__row">
          <span className="sc-email__label">Subject</span>
          <input className="sc-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
      </div>

      <textarea className="sc-email__body sc-input" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />

      {mailto.mayTruncate ? (
        // Named before the user clicks, because the failure is otherwise
        // silent: the client simply drops the tail and the letter goes out
        // missing its end.
        <div className="sc-callout sc-callout--warning sc-email__warn">
          <div className="sc-callout__body">
            This is too long for a mailto link ({mailto.length} characters) — some mail clients will cut it short.
            Download the <code className="sc-mono">.eml</code> instead.
          </div>
        </div>
      ) : null}

      <div className="sc-card__actions">
        <button type="button" className="sc-btn sc-btn--primary" onClick={download}>
          Download .eml
        </button>
        <a
          className={`sc-btn${mailto.mayTruncate ? " sc-btn--ghost" : ""}`}
          href={mailto.href}
          // Nothing happens on a machine with no mail client registered, and
          // nothing is reported either — so this is the shortcut, never the
          // only way out.
          title="Opens your mail client"
        >
          Open in mail client
        </a>
        <button type="button" className="sc-btn sc-btn--ghost" onClick={copy}>
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </button>
        {onSend ? (
          <button type="button" className="sc-btn sc-btn--primary" disabled={state === "sending" || state === "sent"} onClick={send}>
            {state === "sending" ? "Sending…" : state === "sent" ? "Sent" : "Send"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
