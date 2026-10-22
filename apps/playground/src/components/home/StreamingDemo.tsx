"use client";

import { useEffect, useRef, useState } from "react";
import { CardRenderer } from "@zzyzxlabs/super-chat-ui";
import styles from "./home.module.css";
import { useInView } from "./useInView";
import { VENDOR_ROWS, vendorTable } from "./specs";

const TOTAL = VENDOR_ROWS.length;
const FULL = vendorTable(TOTAL);

// Replays what the runtime does with a streamed `visualize` call: each tick is
// one more row of parsed arguments, and the real table renderer draws it in
// partial mode until the spec is whole. The finished card is rendered hidden
// underneath, so the live one fills a box that is already its final size and
// the section never grows while it streams.
export function StreamingDemo() {
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root);
  const [flavor, setFlavor] = useState<"b" | "c">("b");
  const [rows, setRows] = useState(TOTAL);
  // The loop pauses offscreen and picks up where it left off, so the card
  // never snaps back to its first row as you scroll in.
  const tick = useRef(TOTAL);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top >= window.innerHeight) {
      tick.current = 1;
      setRows(1);
    }
  }, []);

  useEffect(() => {
    if (!inView || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      // A few idle ticks after the last row, so the finished card is readable.
      tick.current = tick.current >= TOTAL + 5 ? 1 : tick.current + 1;
      setRows(Math.min(tick.current, TOTAL));
    }, 520);
    return () => window.clearInterval(id);
  }, [inView]);

  const partial = rows < TOTAL;
  const lines = VENDOR_ROWS.slice(0, rows).map((r) => `  { "vendor": "${r.vendor}", "region": "${r.region}", "cost": ${r.cost} },`);
  const flavorClass = flavor === "b" ? styles.flavorB : styles.flavorC;

  return (
    <div ref={root} className={styles.streaming}>
      <div className={styles.stack}>
        <h2 className={styles.h2}>A card draws while the model is still writing it.</h2>
        <div className={styles.toggle} role="group" aria-label="Flavor">
          <button type="button" aria-pressed={flavor === "b"} onClick={() => setFlavor("b")}>Instrument</button>
          <button type="button" aria-pressed={flavor === "c"} onClick={() => setFlavor("c")}>Tactile</button>
        </div>
      </div>
      <div className={styles.stack}>
        <pre className={styles.specPane} aria-label="Tool arguments so far">
          {`"rows": [\n${lines.join("\n")}`}
          {partial ? <>{"\n  "}<span className={styles.caret} aria-hidden="true" /></> : "\n]"}
        </pre>
        <div className={`${styles.liveCard} ${flavorClass}`}>
          <div className={styles.ghost} aria-hidden="true" inert>
            <CardRenderer card={{ id: "stream_full", spec: FULL }} />
          </div>
          <div className={styles.live}>
            <CardRenderer card={{ id: "stream_demo", spec: vendorTable(rows) }} partial={partial} />
          </div>
        </div>
      </div>
    </div>
  );
}
