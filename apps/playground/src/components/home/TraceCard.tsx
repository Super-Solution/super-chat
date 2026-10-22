"use client";

import { useEffect, useRef, useState } from "react";
import { RollingCount } from "@zzyzxlabs/super-chat-ui";
import styles from "./home.module.css";
import { prefersReducedMotion, useSeen } from "./useInView";

// The context for one turn, assembled the first time it scrolls into view:
// each layer lands in order, takes its share of the budget bar, and the
// headroom left for the reply counts down to what is really left.

const BUDGET = 8_000;
const TRACE = [
  { id: "system", status: "included", tokens: 412, shown: "412", tone: "#161616", opacity: 1 },
  { id: "skill:procurement", status: "included", tokens: 214, shown: "214", tone: "#0f766e", opacity: 1 },
  { id: "memory", status: "included", tokens: 96, shown: "96", tone: "#0f766e", opacity: 0.7 },
  { id: "retrieval:contracts", status: "truncated", tokens: 380, shown: "380 / 900", tone: "#0f766e", opacity: 0.5 },
  { id: "history", status: "compacted", tokens: 1_120, shown: "1,120", tone: "#c2410c", opacity: 0.6 },
  { id: "app-state:board", status: "dropped", tokens: 0, shown: "0", tone: "transparent", opacity: 1 },
] as const;

const STEP = 260;

export function TraceCard() {
  const root = useRef<HTMLDivElement>(null);
  const seen = useSeen(root);
  // Server render and no-JS show the finished trace; motion only replays it.
  const [count, setCount] = useState<number>(TRACE.length);
  // Replay only when the card starts below the fold, emptied before it is
  // seen; a card already on screen at load stays finished rather than flash.
  const armed = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion() || el.getBoundingClientRect().top < window.innerHeight) return;
    armed.current = true;
    setCount(0);
  }, []);

  useEffect(() => {
    if (!seen || !armed.current) return;
    const timers = TRACE.map((_, i) => window.setTimeout(() => setCount(i + 1), 200 + i * STEP));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [seen]);

  const used = TRACE.slice(0, count).reduce((sum, t) => sum + t.tokens, 0);
  const headroom = (BUDGET - used).toLocaleString("en-US");

  return (
    <div ref={root} className={styles.trace}>
      <div className={styles.traceHead}><strong>Context, turn 4</strong><span>8,000 tok budget</span></div>
      <div className={styles.traceBar} aria-hidden="true">
        {TRACE.filter((t) => t.tokens > 0).map((t) => {
          const i = TRACE.indexOf(t);
          return (
            <span
              key={t.id}
              className={styles.traceSeg}
              data-on={i < count}
              style={{ width: `${(t.tokens / BUDGET) * 100}%`, background: t.tone, opacity: t.opacity }}
            />
          );
        })}
      </div>
      <table>
        <tbody>
          {TRACE.map((t, i) => (
            <tr key={t.id} className={styles.traceRow} data-on={i < count}>
              <td>{t.id}</td>
              <td className={t.status === "included" ? styles.included : t.status === "dropped" ? styles.dropped : styles.trimmed}>{t.status}</td>
              <td>{t.shown}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.prov}><span><RollingCount value={headroom} /> tok left for the reply</span></div>
    </div>
  );
}
