"use client";

import { useState } from "react";
import { BUILTIN_CARDS, type CardAction, type CardSpec } from "@super-solution/super-chat-core";
import { BUILTIN_RENDERERS, CardRenderer, CardRendererProvider } from "@super-solution/super-chat-ui";
import { PanelHeader, SpecSplit } from "@/components/Shell";
import { CARD_SAMPLES } from "@/agent/card-samples";

export default function CardsPanel() {
  const [log, setLog] = useState<string[]>([]);
  const respond = (action: Omit<CardAction, "at">) =>
    setLog((l) => [`${action.kind}.${action.type} → ${JSON.stringify(action.value ?? null)}`, ...l].slice(0, 5));

  const passive = BUILTIN_CARDS.filter((c) => !c.interactive);
  const interactive = BUILTIN_CARDS.filter((c) => c.interactive);

  return (
    <CardRendererProvider renderers={BUILTIN_RENDERERS}>
      <div className="dev__page">
        <PanelHeader title="Agent cards">
          A card is a structured tool output the host renders as UI. Two ways one appears: a domain tool attaches it to
          its result, or the agent calls <code className="sc-mono">visualize</code> and picks a presentation itself —
          which is what makes it visually flexible rather than limited to what someone pre-built. Each kind below is
          shown with the exact spec that produced it.
        </PanelHeader>

        <div className="dev__kindnav">
          {BUILTIN_CARDS.map((c) => (
            <a key={c.kind} href={`#${c.kind}`}>
              {c.kind}
            </a>
          ))}
        </div>

        <section className="dev__section" style={{ marginTop: 0 }}>
          <h2 className="dev__section-title">How the agent chooses</h2>
          <p className="dev__section-note">
            The model never sees this page. It sees the one-line summary under each name below, embedded in the{" "}
            <code className="sc-mono">visualize</code> tool description — so those summaries, not the schemas, are what
            actually steer the choice. Kinds are registered with their validator and renderer together; a test asserts
            the two sets match exactly, so a card can never validate with nowhere to render.
          </p>
        </section>

        {passive.map((def) => (
          <section key={def.kind} id={def.kind} className="dev__section dev__kind">
            <div className="dev__kind-head">
              <span className="dev__kind-name">{def.kind}</span>
            </div>
            <p className="dev__kind-summary">{def.summary}</p>
            <SpecSplit spec={CARD_SAMPLES[def.kind] ?? { kind: def.kind }} label={`visualize({ kind: "${def.kind}", spec })`}>
              <CardRenderer card={{ id: `s_${def.kind}`, spec: (CARD_SAMPLES[def.kind] ?? { kind: def.kind }) as CardSpec }} />
            </SpecSplit>
          </section>
        ))}

        <section className="dev__section">
          <h2 className="dev__section-title">Interactive kinds</h2>
          <p className="dev__section-note">
            These pause the run. The tool call suspends, the card renders, and the user's answer becomes the tool result
            the model reads on its next step — that is the human-in-the-loop seam. They render at top level and are
            never collapsed, because a hidden question is an unanswerable one.
          </p>
          {log.length ? (
            <div className="sc-card">
              <div className="sc-card__title">Actions received</div>
              <ul className="sc-list">
                {log.map((line, i) => (
                  <li key={i} className="sc-mono">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {interactive.map((def) => (
          <section key={def.kind} id={def.kind} className="dev__section dev__kind">
            <div className="dev__kind-head">
              <span className="dev__kind-name">{def.kind}</span>
              <span className="sc-pill sc-pill--info">interactive</span>
            </div>
            <p className="dev__kind-summary">{def.summary}</p>
            <SpecSplit spec={CARD_SAMPLES[def.kind] ?? { kind: def.kind }} label={`visualize({ kind: "${def.kind}", spec })`}>
              <CardRenderer
                card={{ id: `s_${def.kind}`, spec: (CARD_SAMPLES[def.kind] ?? { kind: def.kind }) as CardSpec, callId: `s_${def.kind}` }}
                respond={respond}
              />
            </SpecSplit>
          </section>
        ))}

        <section className="dev__section">
          <h2 className="dev__section-title">Failure modes are visible, not silent</h2>
          <p className="dev__section-note">
            An unknown kind renders a labelled fallback with its payload, and a card whose data was trimmed out of
            persisted history says so. Both beat the alternative, which is a card that quietly disappears.
          </p>
          <CardRenderer card={{ id: "unknown", spec: { kind: "sankey", nodes: [] } as CardSpec }} />
          <CardRenderer card={{ id: "expired", spec: { kind: "table" } as CardSpec, expired: true }} />
        </section>
      </div>
    </CardRendererProvider>
  );
}
