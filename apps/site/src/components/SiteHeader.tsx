"use client";

import Link from "next/link";
import { REPO_URL, type SiteSection } from "@/components/SiteNav";
import { Mark } from "./Mark";

const LINKS = [
  { label: "Cards", href: "/#cards" },
  { label: "Questions", href: "/#questions" },
  { label: "Providers", href: "/#providers" },
];

const isCurrent = (match: boolean) => (match ? ("page" as const) : undefined);

/** The top bar for the guide, install page and playground panels. */
export function SiteHeader({ active }: { active?: SiteSection }) {
  return (
    <header className="sitenav schat-scope schat-header">
      <div className="sitenav__inner">
        <Link href="/" className="sitenav__brand">
          <Mark size={28} />
          Super Chat
        </Link>
        <nav className="sitenav__links" aria-label="Primary">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href}>{link.label}</Link>
          ))}
          <Link href="/install" aria-current={isCurrent(active === "install")}>Install</Link>
          <Link href="/docs" aria-current={isCurrent(active === "docs")}>Docs</Link>
        </nav>
        <div className="sitenav__actions">
          <a className="sitenav__btn" href={REPO_URL}>GitHub</a>
          <Link className="sitenav__btn sitenav__btn--primary" href="/playground" aria-current={isCurrent(active === "playground")}>Playground</Link>
        </div>
      </div>
    </header>
  );
}
