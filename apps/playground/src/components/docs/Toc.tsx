"use client";

import { useEffect, useState } from "react";
import type { GuideHeading } from "./guide";
import styles from "./docs.module.css";

// The page's sections, with the one you are reading marked as you scroll.
export function Toc({ headings }: { headings: GuideHeading[] }) {
  const [active, setActive] = useState(headings[0]?.id);

  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => Boolean(e));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    // A heading counts once it crosses the top fifth of the viewport.
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "0px 0px -80% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [headings]);

  return (
    <nav className={styles.toc} aria-label="On this page">
      <ul>
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} aria-current={h.id === active ? "location" : undefined}>{h.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
