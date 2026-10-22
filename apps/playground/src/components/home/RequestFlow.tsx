"use client";

import { useRef } from "react";
import styles from "./home.module.css";
import { useInView } from "./useInView";

// One request, end to end: a dot leaves the browser, the server runs its four
// checks in order, the call goes on to the provider, and the answer comes back.
// Pure CSS on one 5s cycle; it runs only while the flow is on screen.
const CHECKS = ["allowlist", "authorize", "forward", "record"];

export function RequestFlow() {
  const root = useRef<HTMLDivElement>(null);
  const running = useInView(root, 0.4);

  return (
    <div ref={root} className={`${styles.flow}${running ? ` ${styles.flowRunning}` : ""}`}>
      <div className={styles.lane} aria-hidden="true">
        <span className={styles.packetOut} />
        <span className={styles.packetBack} />
      </div>
      <div className={styles.flowStep}><strong>The browser</strong><small>createProxyTransport(&#123; url: &quot;/api/agent&quot; &#125;)</small></div>
      <div className={styles.flowArrow} aria-hidden="true">→</div>
      <div className={`${styles.flowStep} ${styles.flowServer}`}>
        <strong>Your server</strong>
        <small className={styles.checks}>
          {CHECKS.map((c, i) => (
            <span key={c} className={styles.check} style={{ animationDelay: `${0.9 + i * 0.32}s` }}>{c}</span>
          ))}
        </small>
      </div>
      <div className={styles.flowArrow} aria-hidden="true">→</div>
      <div className={styles.flowStep}><strong>The provider</strong><small>OpenAI · Anthropic · compatible</small></div>
    </div>
  );
}
