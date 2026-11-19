"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { REPO_URL } from "@/components/SiteNav";
import { MARK_LAYERS, MARK_VIEWBOX } from "../Mark";
import styles from "./home.module.css";

export function InstallCommand({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = () => {
    if (!navigator.clipboard) return setState("failed");
    navigator.clipboard.writeText(command).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };

  return (
    <div className="schat-install">
      <code>{command}</code>
      <button type="button" data-state={state} onClick={copy}>
        <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
      </button>
    </div>
  );
}

/**
 * The mark at poster scale. Each layer takes its colour from the surrounding field.
 * The layers land in turn order once: on load, or when `onView` art first scrolls in.
 */
export function BubbleArt({ className, top, middle, bottom, onView = false }: { className: string; top: string; middle: string; bottom: string; onView?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [play, setPlay] = useState(!onView);

  useEffect(() => {
    if (!onView || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setPlay(true);
      observer.disconnect();
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [onView]);

  return (
    <svg ref={ref} className={`${className}${play ? " schat-turn-play" : ""}`} viewBox={MARK_VIEWBOX} aria-hidden="true">
      <g transform="skewY(-28)">
        <path className="schat-turn-top" style={{ fill: top }} d={MARK_LAYERS.top} />
        <path className="schat-turn-middle" style={{ fill: middle }} d={MARK_LAYERS.middle} />
        <path className="schat-turn-bottom" style={{ fill: bottom }} d={MARK_LAYERS.bottom} />
      </g>
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className={`${styles.wrap} ${styles.footer}`}>
      <span>Super Chat is part of <a href="https://github.com/Super-Solution">Super Solution Lab</a>. Sample data on this page is synthetic.</span>
      <nav className={styles.footerLinks} aria-label="Footer">
        <Link href="/docs">Docs</Link>
        <a href={REPO_URL}>GitHub</a>
        <a href="https://www.npmjs.com/package/@supersolutions/super-chat-core">npm</a>
        <a href={`${REPO_URL}/blob/main/LICENSE`}>License</a>
      </nav>
    </footer>
  );
}
