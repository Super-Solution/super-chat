"use client";

import Link from "next/link";
import { playgroundPath } from "@/agent/deployment";

export const REPO_URL = "https://github.com/Super-Solution/super-chat";

// One top bar for the homepage and every playground panel. Section links are
// anchors on the homepage, so they work from any page.
const LINKS = [
  { label: "Cards", href: "/#cards" },
  { label: "Materials", href: "/#materials" },
  { label: "Backend", href: "/#backend" },
  { label: "Flavors", href: "/#flavors" },
];

export type SiteSection = "playground" | "docs" | "install";

export function SiteNav({ active }: { active?: SiteSection }) {
  return (
    <header className="sitenav">
      <div className="sitenav__inner">
        <Link href="/" className="sitenav__brand">
          <span className="sitenav__mark" aria-hidden="true"><i /><i /><i /></span>
          superchat
        </Link>
        <nav className="sitenav__links" aria-label="Primary">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
          <Link href="/docs" aria-current={active === "docs" ? "page" : undefined}>Docs</Link>
          <Link href={playgroundPath("/cards")} aria-current={active === "playground" ? "page" : undefined}>Playground</Link>
        </nav>
        <div className="sitenav__actions">
          <a className="sitenav__btn" href={REPO_URL}>GitHub</a>
          <Link className="sitenav__btn sitenav__btn--primary" href="/install" aria-current={active === "install" ? "page" : undefined}>Install</Link>
        </div>
      </div>
    </header>
  );
}
