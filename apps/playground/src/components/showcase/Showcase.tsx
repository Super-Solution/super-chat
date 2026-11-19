"use client";

// The hero animation. Not the kit: a drawing of what the kit does. A question
// arrives, the agent assembles an interface for it, then stops to ask the person
// something (a choice, a form, an approval or a redline) and carries on with the
// answer. It plays by itself; the scene buttons jump to one, and it can be paused.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./showcase.module.css";

type Phase = "type" | "build" | "ask" | "answer" | "done";
const ORDER: Phase[] = ["type", "build", "ask", "answer", "done"];

// How long each phase holds before the next one starts.
const HOLD: Record<Phase, number> = { type: 0, build: 1900, ask: 1100, answer: 1500, done: 2600 };
const TYPE_MS = 34;

type Scene = { id: string; label: string; question: string; summary: string };

const SCENES: Scene[] = [
  {
    id: "approval",
    label: "Approval",
    question: "Why did September spend jump?",
    summary: "Asked why spend jumped, the agent builds a spend review with totals, a chart and the largest lines, then asks for approval before sending it.",
  },
  {
    id: "choice",
    label: "Choice",
    question: "Which vendor should we shortlist?",
    summary: "Asked to compare vendors, the agent lays out three side by side, then asks which one to shortlist and highlights the pick.",
  },
  {
    id: "form",
    label: "Form",
    question: "Draft the renewal notice for Relay Desk.",
    summary: "Asked to draft a notice, the agent shows the contract, then asks for the recipient and date in a short form and drafts it.",
  },
  {
    id: "redline",
    label: "Redline",
    question: "Tighten the liability cap.",
    summary: "Asked to change a clause, the agent opens the contract and proposes a redline that the person accepts.",
  },
];

const at = (phase: Phase, from: Phase) => ORDER.indexOf(phase) >= ORDER.indexOf(from);
const part = (i: number): CSSProperties => ({ "--i": i } as CSSProperties);

function Pointer() {
  return (
    <svg className={styles.pointer} viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M5 3l14 8.2-6.1 1.4L10 19z" fill="#111113" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function Metric({ label, value, i }: { label: string; value: string; i: number }) {
  return (
    <div className={`${styles.part} ${styles.metric}`} style={part(i)}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Bars({ values, labels, mark, i }: { values: number[]; labels: string[]; mark?: number; i: number }) {
  const top = Math.max(...values);
  return (
    <div className={`${styles.part} ${styles.well} ${styles.chart}`} style={part(i)}>
      <div className={styles.bars}>
        {values.map((value, index) => (
          <span key={labels[index]} data-mark={index === mark || undefined}>
            <i style={{ height: `${(value / top) * 100}%`, "--b": index } as CSSProperties} />
            <small>{labels[index]}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function Rows({ rows, i }: { rows: [string, string, string][]; i: number }) {
  return (
    <div className={`${styles.part} ${styles.well} ${styles.rows}`} style={part(i)}>
      {rows.map((row, index) => (
        <div key={row[0]} style={{ "--r": index } as CSSProperties}>
          <span>{row[0]}</span>
          <span>{row[1]}</span>
          <span>{row[2]}</span>
        </div>
      ))}
    </div>
  );
}

function Ask({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.ask}>
      <div className={styles.askTitle}>{title}</div>
      {children}
    </div>
  );
}

function ApprovalScene({ phase }: { phase: Phase }) {
  const approved = at(phase, "done");
  return (
    <>
      <div className={styles.surface}>
        <div className={styles.grid3}>
          <Metric label="Total" value="$382,200" i={0} />
          <Metric label="Lines" value="12" i={1} />
          <Metric label="Average line" value="$31,850" i={2} />
        </div>
        <Bars values={[104, 112, 165]} labels={["Jul", "Aug", "Sep"]} mark={2} i={3} />
        <Rows i={4} rows={[["Northlight Cloud", "Sep", "$61,900"], ["Fernway Media", "Sep", "$51,750"], ["Alder Studio", "Sep", "$34,500"]]} />
      </div>
      <Ask title={approved ? "Sent for approval" : "Send this view for approval?"}>
        <dl className={styles.facts}>
          <div><dt>Team</dt><dd>All</dd></div>
          <div><dt>Total in view</dt><dd>$382,200</dd></div>
        </dl>
        <div className={styles.actions}>
          <span className={styles.primary} data-done={approved || undefined}>
            {approved ? "Approved" : "Approve"}
            {at(phase, "answer") && !approved ? <Pointer /> : null}
          </span>
          {approved ? null : <span className={styles.secondary}>Not yet</span>}
        </div>
      </Ask>
    </>
  );
}

const VENDORS = [
  { name: "Tessera Logs", cost: "$28,400", score: 82 },
  { name: "Quillon Labs", cost: "$31,900", score: 64 },
  { name: "Plumb Analytics", cost: "$26,100", score: 71 },
];

function ChoiceScene({ phase }: { phase: Phase }) {
  const picked = at(phase, "done") ? 0 : -1;
  return (
    <>
      <div className={styles.surface}>
        <div className={styles.grid3}>
          {VENDORS.map((vendor, index) => (
            <div key={vendor.name} className={`${styles.part} ${styles.vendor}`} style={part(index)} data-picked={picked === index || undefined}>
              <strong>{vendor.name}</strong>
              <span>Annual cost</span>
              <b>{vendor.cost}</b>
              <span>Fit</span>
              <div className={styles.meter}><i style={{ width: `${vendor.score}%` }} /></div>
            </div>
          ))}
        </div>
        <Rows i={3} rows={[["Tessera Logs", "SSO, audit log", "12 days"], ["Quillon Labs", "SSO", "21 days"], ["Plumb Analytics", "Audit log", "48 days"]]} />
      </div>
      <Ask title="Which one should I shortlist?">
        <div className={styles.options}>
          {VENDORS.map((vendor, index) => (
            <span key={vendor.name} className={styles.option} data-picked={picked === index || undefined}>
              <i />
              {vendor.name}
              {index === 0 && at(phase, "answer") && picked < 0 ? <Pointer /> : null}
            </span>
          ))}
        </div>
      </Ask>
    </>
  );
}

function Typed({ text, start }: { text: string; start: boolean }) {
  const [shown, setShown] = useState(start ? 0 : text.length);
  useEffect(() => {
    if (!start) return;
    setShown(0);
    const timer = window.setInterval(() => setShown((n) => (n >= text.length ? n : n + 1)), 45);
    return () => window.clearInterval(timer);
  }, [start, text]);
  return <>{text.slice(0, shown) || " "}</>;
}

function FormScene({ phase, motion }: { phase: Phase; motion: boolean }) {
  const filling = at(phase, "answer");
  const drafted = at(phase, "done");
  return (
    <>
      <div className={styles.surface}>
        <div className={styles.grid3}>
          <Metric label="Annual value" value="$46,200" i={0} />
          <Metric label="Seats" value="65" i={1} />
          <Metric label="Renews in" value="34 days" i={2} />
        </div>
        <div className={`${styles.part} ${styles.well} ${styles.timeline}`} style={part(3)}>
          <span>Term</span>
          <div className={styles.meter}><i style={{ width: "72%" }} /></div>
          <small>Started 1 Dec 2025, renews 1 Dec 2026</small>
        </div>
        {drafted ? (
          <div className={`${styles.part} ${styles.doc}`} style={part(0)}>
            <strong>Notice of non-renewal</strong>
            <span /><span /><span style={{ width: "62%" }} />
          </div>
        ) : null}
      </div>
      <Ask title={drafted ? "Notice drafted" : "Who should the notice go to?"}>
        <div className={styles.fields}>
          <label><span>Recipient</span><em>{filling ? <Typed text="legal@relaydesk.com" start={motion && !drafted} /> : " "}</em></label>
          <label><span>Effective</span><em>{filling ? <Typed text="1 Dec 2026" start={motion && !drafted} /> : " "}</em></label>
        </div>
        <div className={styles.actions}>
          <span className={styles.primary} data-done={drafted || undefined}>
            {drafted ? "Drafted" : "Draft notice"}
            {filling && !drafted ? <Pointer /> : null}
          </span>
        </div>
      </Ask>
    </>
  );
}

function RedlineScene({ phase }: { phase: Phase }) {
  const accepted = at(phase, "done");
  return (
    <>
      <div className={styles.surface}>
        <div className={`${styles.part} ${styles.page}`} style={part(0)}>
          <strong>10.1 Aggregate liability</strong>
          <p>
            Vertex&apos;s aggregate liability will not exceed fees paid in the preceding{" "}
            {accepted ? <ins>twelve</ins> : <mark>three</mark>} months.
          </p>
          <span /><span /><span style={{ width: "54%" }} />
        </div>
        <div className={`${styles.part} ${styles.page}`} style={part(1)}>
          <strong>10.2 Excluded damages</strong>
          <span /><span style={{ width: "70%" }} />
        </div>
      </div>
      <Ask title={accepted ? "Redline accepted" : "Accept this change?"}>
        <p className={styles.diff}>
          …fees paid in the preceding <del>three</del> <ins>twelve</ins> months.
        </p>
        <div className={styles.actions}>
          <span className={styles.primary} data-done={accepted || undefined}>
            {accepted ? "Accepted" : "Accept"}
            {at(phase, "answer") && !accepted ? <Pointer /> : null}
          </span>
          {accepted ? null : <span className={styles.secondary}>Reject</span>}
        </div>
      </Ask>
    </>
  );
}

export function Showcase() {
  const [scene, setScene] = useState(0);
  const [phase, setPhase] = useState<Phase>("type");
  const [chars, setChars] = useState(0);
  const [round, setRound] = useState(0);
  const [paused, setPaused] = useState(false);
  const [motion, setMotion] = useState(true);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  const current = SCENES[scene]!;

  // Reduced motion: no autoplay, every scene shown finished.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotion(!query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Nothing runs while the hero is off screen or the tab is hidden.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.15 });
    observer.observe(element);
    const onVisibility = () => setVisible(document.visibilityState === "visible" && element.getBoundingClientRect().bottom > 0);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const running = motion && !paused && visible;
  const settled = !motion;
  const shownPhase: Phase = settled ? "done" : phase;
  const shownChars = settled ? current.question.length : chars;

  const go = useCallback((index: number) => {
    setScene(index);
    setPhase("type");
    setChars(0);
    setRound((r) => r + 1);
  }, []);

  useEffect(() => {
    if (!running) return;
    let timer: number;
    if (phase === "type") {
      if (chars < current.question.length) timer = window.setTimeout(() => setChars((n) => n + 1), TYPE_MS);
      else timer = window.setTimeout(() => setPhase("build"), 260);
    } else if (phase === "done") {
      timer = window.setTimeout(() => go((scene + 1) % SCENES.length), HOLD.done);
    } else {
      const next = ORDER[ORDER.indexOf(phase) + 1]!;
      timer = window.setTimeout(() => setPhase(next), HOLD[phase]);
    }
    return () => window.clearTimeout(timer);
  }, [running, phase, chars, current.question.length, scene, go]);

  return (
    <div ref={root} className={styles.showcase}>
      <div className={styles.controls}>
        <div className={styles.scenes} role="group" aria-label="What the agent asks">
          {SCENES.map((item, index) => (
            <button key={item.id} type="button" aria-pressed={index === scene} onClick={() => go(index)}>
              {item.label}
            </button>
          ))}
        </div>
        {motion ? (
          <button type="button" className={styles.pause} onClick={() => setPaused((p) => !p)}>
            {paused ? "Play" : "Pause"}
          </button>
        ) : null}
      </div>
      <p className={styles.srOnly} aria-live="polite">{current.summary}</p>
      <div className={styles.window} data-phase={shownPhase} data-motion={motion || undefined} aria-hidden="true">
        <div className={styles.bubble}>
          {current.question.slice(0, shownChars) || " "}
          {shownPhase === "type" && !settled ? <span className={styles.caret} /> : null}
        </div>
        <div className={styles.stage} key={`${current.id}:${round}`}>
          {current.id === "approval" ? <ApprovalScene phase={shownPhase} /> : null}
          {current.id === "choice" ? <ChoiceScene phase={shownPhase} /> : null}
          {current.id === "form" ? <FormScene phase={shownPhase} motion={motion} /> : null}
          {current.id === "redline" ? <RedlineScene phase={shownPhase} /> : null}
        </div>
      </div>
    </div>
  );
}
