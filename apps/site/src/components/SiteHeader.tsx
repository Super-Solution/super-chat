"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { REPO_URL, type SiteSection } from "@/components/SiteNav";
import { Mark } from "./Mark";
import { THEME_KEY } from "./site-theme";
import styles from "./site-header.module.css";

export type HeaderSection = SiteSection | "whats-inside";

const LINKS: { id: HeaderSection; label: string; href: string }[] = [
  { id: "whats-inside", label: "What's inside", href: "/whats-inside" },
  { id: "docs", label: "Docs", href: "/docs" },
  { id: "install", label: "Install", href: "/install" },
];

const WIDE = "(min-width: 900px)";

function readTheme(): "light" | "dark" | null {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function useThemeToggle(enabled: boolean) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    if (enabled) setTheme(readTheme());
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    // Docs and playground panels are light-only, so the choice stops at this page's edge.
    return () => document.documentElement.removeAttribute("data-theme");
  }, [enabled, theme]);

  return () => {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = (theme ? theme === "dark" : systemDark) ? "light" : "dark";
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private windows can refuse storage. The theme still applies to this page.
    }
  };
}

/**
 * The one site navigation. Below 900px the links live in a native popover, which
 * brings Escape, light dismiss and focus return with it. At 900px and up CSS lays
 * the same list out in the bar.
 */
export function SiteHeader({
  active,
  overlay = false,
  themeable = false,
  waiting = false,
  className = "",
}: {
  active?: HeaderSection;
  /** Sit on top of a colour field instead of drawing a solid bar. */
  overlay?: boolean;
  /** Offer the theme switch. Only pages drawn entirely in brand tokens can honour it. */
  themeable?: boolean;
  waiting?: boolean;
  className?: string;
}) {
  const toggleTheme = useThemeToggle(themeable);
  const menu = useRef<HTMLUListElement>(null);

  // A menu left open across the breakpoint would stay in the top layer over the bar.
  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const close = () => {
      if (wide.matches && menu.current?.matches(":popover-open")) menu.current.hidePopover();
    };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  const closeMenu = () => {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  };

  return (
    <header className={`schat-scope ${styles.bar} ${overlay ? styles.overlay : styles.solid} ${className}`} data-wait={waiting}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/">
          <Mark size={overlay ? 36 : 28} play={overlay} />
          Super Chat
        </Link>
        <nav className={styles.nav} aria-label="Primary">
          <button className={styles.menuButton} type="button" popoverTarget="site-menu" aria-controls="site-menu" aria-label="Menu">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <ul className={styles.menu} id="site-menu" popover="auto" ref={menu}>
            {LINKS.map((link) => (
              <li key={link.id}>
                <Link href={link.href} aria-current={active === link.id ? "page" : undefined} onClick={closeMenu}>{link.label}</Link>
              </li>
            ))}
            <li><a href={REPO_URL}>GitHub</a></li>
            {themeable ? (
              <li className={styles.themeItem}>
                <button className={styles.themeButton} type="button" onClick={toggleTheme}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
                  </svg>
                  <span className={styles.themeLabel}>Switch color theme</span>
                </button>
              </li>
            ) : null}
          </ul>
        </nav>
        <Link className={styles.primary} href="/playground" aria-current={active === "playground" ? "page" : undefined}>Playground</Link>
      </div>
    </header>
  );
}
