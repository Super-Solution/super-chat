"use client";

// The context inspector.
//
// This is the component that justifies the whole trace subsystem: it answers
// "what did you actually send, and what did you leave out" without anyone
// reading a log. Every framework can build a request; being able to SEE the
// request is what makes one debuggable.

import { useContextTrace, useSkills, useTools } from "@super-solution/super-chat-react";
import type { TraceEntry } from "@super-solution/super-chat-core";

const STATUS_TONE: Record<TraceEntry["status"], string> = {
  included: "positive",
  truncated: "warning",
  compacted: "info",
  dropped: "warning",
  failed: "negative",
};

function Bar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="sc-bar">
      <div className="sc-bar__head">
        <span>{label}</span>
        <span className="sc-mono">{value.toLocaleString()} tok</span>
      </div>
      <div className="sc-bar__track">
        <div className="sc-bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ContextInspector() {
  const trace = useContextTrace();
  const { skills, matched } = useSkills();
  const { active, presets, fromRun } = useTools();

  if (!trace) {
    return (
      <div className="sc-panel">
        <div className="sc-panel__title">Context</div>
        <p className="sc-muted">Send a message to see exactly what gets assembled and sent.</p>
        <div className="sc-panel__section">
          <div className="sc-panel__label">Registered skills</div>
          <ul className="sc-list">
            {skills.map((s) => (
              <li key={s.id}>
                <code className="sc-mono">{s.id}</code> <span className="sc-pill">{s.mode}</span>
              </li>
            ))}
            {skills.length === 0 ? <li className="sc-muted">None registered.</li> : null}
          </ul>
        </div>
      </div>
    );
  }

  const window = trace.budget.contextWindow;

  return (
    <div className="sc-panel">
      <div className="sc-panel__title">Context</div>

      <div className="sc-panel__section">
        <Bar label="System (identity + skills)" value={trace.totals.system} total={window} />
        <Bar label="History" value={trace.totals.history} total={window} />
        <div className="sc-panel__row">
          <span className="sc-muted">Reserved for reply</span>
          <span className="sc-mono">{trace.budget.shares.output.toLocaleString()} tok</span>
        </div>
        <div className="sc-panel__row">
          <span className="sc-muted">Headroom</span>
          <span className={`sc-mono ${trace.headroom < 0 ? "sc-tone--negative" : ""}`}>
            {trace.headroom.toLocaleString()} tok
          </span>
        </div>
      </div>

      {trace.warnings.length ? (
        <div className="sc-panel__section">
          {trace.warnings.map((w, i) => (
            <div key={i} className="sc-note sc-note--warning">
              {w}
            </div>
          ))}
        </div>
      ) : null}

      <div className="sc-panel__section">
        <div className="sc-panel__label">What went in</div>
        <table className="sc-table sc-table--compact">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {trace.entries.map((e, i) => (
              <tr key={`${e.id}-${i}`} title={e.detail}>
                <td>
                  <code className="sc-mono">{e.id}</code>
                </td>
                <td>
                  <span className={`sc-pill sc-pill--${STATUS_TONE[e.status]}`}>{e.status}</span>
                </td>
                <td style={{ textAlign: "right" }} className="sc-mono">
                  {e.originalTokens && e.originalTokens !== e.tokens ? (
                    <>
                      <s className="sc-muted">{e.originalTokens}</s> {e.tokens}
                    </>
                  ) : (
                    e.tokens
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sc-panel__section">
        <div className="sc-panel__label">Skills loaded this turn</div>
        {matched.length ? (
          <div className="sc-chips">
            {matched.map((id) => (
              <span key={id} className="sc-pill sc-pill--positive">
                {id}
              </span>
            ))}
          </div>
        ) : (
          <p className="sc-muted">None matched — only always-on skills applied.</p>
        )}
      </div>

      <div className="sc-panel__section">
        <div className="sc-panel__label">
          Tools exposed <span className="sc-muted">({presets.join(", ") || "no presets"}{fromRun ? " + skill unlocks" : ""})</span>
        </div>
        <div className="sc-chips">
          {active.map((name) => (
            <span key={name} className="sc-pill">
              {name}
            </span>
          ))}
          {active.length === 0 ? <span className="sc-muted">None.</span> : null}
        </div>
      </div>
    </div>
  );
}
