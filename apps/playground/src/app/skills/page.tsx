"use client";

import { useMemo, useState } from "react";
import { ContextBuilder, scoreSkill, userMessage, type BuiltContext } from "@super-solution/super-chat-core";
import { PanelHeader } from "@/components/Shell";
import { buildContextBuilder, skills } from "@/agent/setup";

const EXAMPLES = [
  "Review the Vertex MSA for liability exposure",
  "Where are we losing people in the signup funnel?",
  "What's SUI trading at?",
  "Hello",
  "幫我看一下這份合約的條款",
];

export default function SkillsPanel() {
  const [query, setQuery] = useState(EXAMPLES[0]!);
  const [built, setBuilt] = useState<BuiltContext | null>(null);
  const [builder] = useState<ContextBuilder>(() => buildContextBuilder());

  const scored = useMemo(
    () =>
      skills
        .list()
        .map((s) => ({ skill: s, ...scoreSkill(s, query) }))
        .sort((a, b) => b.score - a.score),
    [query],
  );

  const maxScore = Math.max(...scored.map((s) => s.score), 1);

  const assemble = async () => {
    setBuilt(await builder.build({ messages: [userMessage(query)] }));
  };

  return (
    <div className="dev__page">
      <PanelHeader title="Skills">
        A skill is a unit of operating knowledge with a trigger and a cost — not a blob of prompt. Three delivery modes
        decide when each one is paid for. Type a query below to see the matcher score every skill, then assemble the
        context it would produce.
      </PanelHeader>

      <section className="dev__section" style={{ marginTop: 0 }}>
        <h2 className="dev__section-title">The three modes</h2>
        <dl className="sc-kv" style={{ marginBottom: 18 }}>
          <div className="sc-kv__row">
            <dt>
              <code className="sc-mono">always</code>
            </dt>
            <dd style={{ textAlign: "left", maxWidth: "62ch" }}>
              Injected every turn and pinned against budget pressure. For rules that must never be missed — safety
              boundaries, identity, output format. Keep them short; you pay on every request.
            </dd>
          </div>
          <div className="sc-kv__row">
            <dt>
              <code className="sc-mono">matched</code>
            </dt>
            <dd style={{ textAlign: "left", maxWidth: "62ch" }}>
              Injected only when the message scores against its aliases. A contract playbook costs nothing on a
              marketing question.
            </dd>
          </div>
          <div className="sc-kv__row">
            <dt>
              <code className="sc-mono">manual</code>
            </dt>
            <dd style={{ textAlign: "left", maxWidth: "62ch" }}>
              Never injected. The model sees a one-line index and pulls the body with{" "}
              <code className="sc-mono">loadSkill</code> when it decides it needs it.
            </dd>
          </div>
        </dl>
      </section>

      <section className="dev__section">
        <h2 className="dev__section-title">Live matching</h2>
        <p className="dev__section-note">
          Matching is lexical and CJK-aware — no embedding round-trip before the real request. Swap in your own matcher
          via <code className="sc-mono">SkillRegistryOptions.matcher</code> if you want semantic retrieval.
        </p>

        <div className="dev__row">
          <input className="dev__input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a user message…" />
          <button type="button" className="sc-btn sc-btn--primary" onClick={assemble}>
            Assemble context
          </button>
        </div>
        <div className="dev__row">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" className="sc-btn sc-btn--ghost sc-btn--sm" onClick={() => setQuery(e)}>
              {e.length > 34 ? `${e.slice(0, 34)}…` : e}
            </button>
          ))}
        </div>

        <table className="sc-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Mode</th>
              <th>Score</th>
              <th>Why</th>
              <th>Unlocks</th>
            </tr>
          </thead>
          <tbody>
            {scored.map(({ skill, score, reason, sections }) => {
              const enters = skill.mode === "always" || (skill.mode === "matched" && score >= 1.5);
              return (
                <tr key={skill.id} style={{ opacity: enters ? 1 : 0.5 }}>
                  <td>
                    <code className="sc-mono">{skill.id}</code>
                    {sections.length ? <div className="sc-muted" style={{ fontSize: 11 }}>+ {sections.map((s) => s.id).join(", ")}</div> : null}
                  </td>
                  <td>
                    <span className={`sc-pill${skill.mode === "always" ? " sc-pill--positive" : skill.mode === "manual" ? " sc-pill--info" : ""}`}>
                      {skill.mode}
                    </span>
                  </td>
                  <td>
                    <div className="dev__score">
                      <div className="dev__scorebar">
                        <div className="dev__scorefill" style={{ width: `${(score / maxScore) * 100}%` }} />
                      </div>
                      <span className="sc-mono">{score.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="sc-muted" style={{ fontSize: 11 }}>
                    {reason}
                  </td>
                  <td className="sc-muted" style={{ fontSize: 11 }}>
                    {skill.tools?.length ? skill.tools.join(", ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {built ? (
        <section className="dev__section">
          <h2 className="dev__section-title">Assembled context</h2>
          <p className="dev__section-note">
            What the provider would actually receive as <code className="sc-mono">instructions</code>, plus the trace
            explaining every layer's fate. This is rebuilt from scratch on every turn — never accumulated.
          </p>
          <div className="dev__split">
            <div className="dev__spec">
              <div className="dev__spec-label">trace.entries</div>
              <table className="sc-table sc-table--compact">
                <thead>
                  <tr>
                    <th>Layer</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {built.trace.entries.map((e, i) => (
                    <tr key={i} title={e.detail}>
                      <td>
                        <code className="sc-mono">{e.id}</code>
                      </td>
                      <td>
                        <span className={`sc-pill sc-pill--${e.status === "included" ? "positive" : e.status === "failed" ? "negative" : "warning"}`}>
                          {e.status}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }} className="sc-mono">
                        {e.tokens}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="sc-panel__row" style={{ marginTop: 10 }}>
                <span className="sc-muted">Tools unlocked</span>
                <span className="sc-mono">{built.toolNames.length}</span>
              </div>
              <div className="sc-panel__row">
                <span className="sc-muted">Headroom</span>
                <span className="sc-mono">{built.trace.headroom.toLocaleString()} tok</span>
              </div>
            </div>
            <div className="dev__preview">
              <div className="dev__spec-label">system</div>
              <pre className="sc-pre dev__code" style={{ maxHeight: 460 }}>
                {built.system}
              </pre>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
