"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { playgroundPath } from "@/agent/deployment";
import styles from "./experience.module.css";

export type ExperienceId = "legal" | "companion" | "defi";

export type ExperienceTrace = {
  skill: string;
  tools: string[];
  content: string[];
  card: string;
  provider: string;
  model: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  duration: string;
};

type MockStreamTextProps = {
  text: string;
  active: boolean;
  streamKey: string | number;
  className?: string;
  speedMs?: number;
};

/**
 * Reveals mock API copy in short word batches. The complete sentence remains
 * available to assistive technology while the visual layer streams quietly.
 */
export function MockStreamText({
  text: source,
  active,
  streamKey,
  className,
  speedMs = 34,
}: MockStreamTextProps) {
  const tokens = useMemo(() => source.match(/\S+\s*/g) ?? [], [source]);
  const [visibleCount, setVisibleCount] = useState(active ? 0 : tokens.length);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!active || reducedMotion) {
      setVisibleCount(active ? tokens.length : 0);
      return;
    }

    setVisibleCount(0);
    let cursor = 0;
    let timer = 0;
    const reveal = () => {
      const batch = cursor % 7 === 0 ? 2 : 1;
      cursor = Math.min(tokens.length, cursor + batch);
      setVisibleCount(cursor);
      if (cursor < tokens.length) timer = window.setTimeout(reveal, speedMs);
    };
    timer = window.setTimeout(reveal, 90);
    return () => window.clearTimeout(timer);
  }, [active, reducedMotion, speedMs, streamKey, tokens]);

  if (!active) return null;

  const complete = visibleCount >= tokens.length;
  return (
    <span className={`${styles.mockStream}${className ? ` ${className}` : ""}`}>
      <span className={styles.srOnly}>{source}</span>
      <span aria-hidden="true">
        {tokens.slice(0, visibleCount).join("")}
        {!complete ? <i className={styles.streamCaret} /> : null}
      </span>
    </span>
  );
}

const EXPERIENCES: { id: ExperienceId; label: string; href: string }[] = [
  { id: "legal", label: "Legal", href: "/experiences/legal" },
  { id: "companion", label: "Companion", href: "/experiences/companion" },
  { id: "defi", label: "SupWallet", href: "/experiences/defi" },
];

export function ExperienceBar({ current }: { current: ExperienceId }) {
  return (
    <header className={styles.bar}>
      <Link className={styles.brand} href="/" aria-label="Super Chat home">
        {/* The Super Chat mark: one speech bubble cut into three layers on a 28 degree shear. */}
        <svg className={styles.logo} viewBox="2 -58 104 174" height={26} aria-hidden="true">
          <g transform="skewY(-28)">
            <path fill="currentColor" d="M21 0H87Q100 0 100 13V23Q100 26 97 26H11Q8 26 8 23V13Q8 0 21 0Z" />
            <path fill="#8469ff" d="M11 33H97Q100 33 100 36V56Q100 59 97 59H11Q8 59 8 56V36Q8 33 11 33Z" />
            <path fill="currentColor" d="M11 66H97Q100 66 100 69V79Q100 92 87 92H44L8 116V69Q8 66 11 66Z" />
          </g>
        </svg>
        <span>Super Chat</span>
      </Link>
      <nav className={styles.switcher} aria-label="Experience demos">
        {EXPERIENCES.map((experience) => (
          <Link
            key={experience.id}
            href={experience.href}
            className={experience.id === current ? styles.active : undefined}
            aria-current={experience.id === current ? "page" : undefined}
          >
            {experience.label}
          </Link>
        ))}
      </nav>
      <div className={styles.context}>
        <Link className={styles.byok} href={playgroundPath("/run")}>Open playground</Link>
      </div>
    </header>
  );
}

export function FrameworkXray({ trace, children }: { trace: ExperienceTrace; children?: ReactNode }) {
  const totalTokens = trace.inputTokens + trace.outputTokens;

  return (
    <details className={styles.xray}>
      <summary>
        <span className={styles.inspectTitle}>Inspect run</span>
        <span className={styles.inspectMeter}>{trace.steps} steps · {totalTokens.toLocaleString()} tokens</span>
        <i className={styles.disclosure} aria-hidden="true" />
      </summary>

      <div className={styles.xrayBody} aria-label="SuperChat run inspector">
        <p className={styles.inspectRoute}>{trace.provider} / {trace.model}</p>
        <dl className={styles.trace}>
          <div><dt>Skill</dt><dd>{trace.skill}</dd></div>
          <div><dt>Tools</dt><dd>{trace.tools.join(" · ")}</dd></div>
          <div><dt>Content</dt><dd>{trace.content.join(" · ")}</dd></div>
          <div><dt>Card</dt><dd><code>{trace.card}</code></dd></div>
        </dl>

        <section className={styles.receipt} aria-label="Metering receipt">
          <div className={styles.receiptTitle}><h3>Metering</h3><span>{trace.duration}</span></div>
          <div className={styles.meterGrid}>
            <span><b>{trace.inputTokens.toLocaleString()}</b> input</span>
            <span><b>{trace.outputTokens.toLocaleString()}</b> output</span>
          </div>
        </section>

        <details className={styles.paymentPreview}>
          <summary><strong>x402 preview</strong><span>simulated</span></summary>
          <ol>
            <li><i />402 request</li>
            <li><i />authorize cap</li>
            <li><i />settle usage</li>
          </ol>
          <p>No wallet or settlement in this demo.</p>
        </details>

        {children ? <div className={styles.extension}>{children}</div> : null}
      </div>
    </details>
  );
}
