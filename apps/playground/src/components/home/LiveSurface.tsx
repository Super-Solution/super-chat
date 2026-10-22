"use client";

import { useEffect, useRef, useState } from "react";
import { PlanProgress, ThinkingState, type PlanStepStatus } from "@zzyzxlabs/super-chat-ui";
import styles from "./home.module.css";
import { prefersReducedMotion, useInView } from "./useInView";

// The parts around an answer, playing one short run: the thinking label moves
// on, the plan advances, tool calls resolve, and a quote lands in the composer.
// It loops only while on screen. With reduced motion it holds one frame.

type Tool = { name: string; state: "running" | "done" | "failed"; detail: string };

type Frame = {
  thinking: string;
  plan: [PlanStepStatus, PlanStepStatus, PlanStepStatus];
  tools: Tool[];
  quote: boolean;
};

const FRAMES: Frame[] = [
  {
    thinking: "Reading the vendor contracts",
    plan: ["active", "pending", "pending"],
    tools: [{ name: "getQuotes", state: "running", detail: "running" }],
    quote: false,
  },
  {
    thinking: "Comparing SSO and data terms",
    plan: ["done", "active", "pending"],
    tools: [
      { name: "getQuotes", state: "done", detail: "0.9s" },
      { name: "checkSSO", state: "running", detail: "running" },
    ],
    quote: false,
  },
  {
    thinking: "Comparing SSO and data terms",
    plan: ["done", "active", "pending"],
    tools: [
      { name: "getQuotes", state: "done", detail: "0.9s" },
      { name: "checkSSO", state: "done", detail: "1.4s" },
      { name: "fetchDPA", state: "running", detail: "running" },
    ],
    quote: false,
  },
  {
    thinking: "Drafting the recommendation",
    plan: ["done", "done", "active"],
    tools: [
      { name: "getQuotes", state: "done", detail: "0.9s" },
      { name: "checkSSO", state: "done", detail: "1.4s" },
      { name: "fetchDPA", state: "failed", detail: "timeout" },
    ],
    quote: true,
  },
];

const HOLD = 1700;

export function LiveSurface() {
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root);
  const [at, setAt] = useState(2);

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return;
    setAt(0);
    const id = window.setInterval(() => setAt((i) => (i + 1) % (FRAMES.length + 1)), HOLD);
    return () => window.clearInterval(id);
  }, [inView]);

  // One extra beat on the last frame before the loop restarts.
  const frame = FRAMES[Math.min(at, FRAMES.length - 1)]!;
  const labels = ["Gather the three quotes", "Compare SSO and data terms", "Draft the recommendation"];

  return (
    <div ref={root} className={styles.surface}>
      <div className={styles.thinking}>
        <i aria-hidden="true" />
        <span key={frame.thinking} className={styles.swap}><ThinkingState label={frame.thinking} /></span>
      </div>
      <PlanProgress static title="Plan" steps={labels.map((label, i) => ({ label, status: frame.plan[i] }))} />
      <div className={styles.tools} aria-live="off">
        {frame.tools.map((t) => (
          <div key={t.name} className={styles.toolRow}>
            <span>{t.name}</span>
            <span key={t.state} className={`${styles.swap} ${t.state === "done" ? styles.ok : t.state === "failed" ? styles.bad : styles.run}`}>
              {t.detail}
            </span>
          </div>
        ))}
      </div>
      <form className={styles.quoteRow} onSubmit={(e) => e.preventDefault()}>
        {frame.quote ? (
          <div className={`${styles.quote} ${styles.arrive}`}><span>“The cheaper option fails the SSO requirement…”</span></div>
        ) : null}
        <div className={styles.sendRow}>
          <input type="text" aria-label="Message" placeholder="Ask about this clause" />
          <button type="submit">Send</button>
        </div>
      </form>
    </div>
  );
}
