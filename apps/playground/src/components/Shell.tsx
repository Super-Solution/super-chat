"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { playgroundPath } from "@/agent/deployment";
import { SiteNav } from "./SiteNav";

// Panels, not pages of an app. Each one isolates a single capability so a
// developer evaluating the framework can see what is available without reading
// the source — which is what they actually want from a demo. The homepage is
// the overview, so it is not listed here.
const PANELS = [
  { href: "/cards", label: "Agent cards", hint: "23 kinds + their specs" },
  { href: "/agent-ui", label: "Agent surfaces", hint: "Thinking, orbs, composer" },
  { href: "/dev-ani", label: "Animations", hint: "Every motion, catalogued & replayable" },
  { href: "/skills", label: "Skills", hint: "Modes, matching, live scoring" },
  { href: "/tools", label: "Tools & presets", hint: "Schemas, capability gating" },
  { href: "/requests", label: "Wire requests", hint: "Responses vs Chat Completions" },
  { href: "/app-state", label: "App state", hint: "Agent reads & drives your UI" },
  { href: "/documents", label: "Documents", hint: "Previewer, quotes, edit refusals" },
  { href: "/run", label: "Run & events", hint: "Live chat + event stream" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const panels = PANELS.map((panel) => ({ ...panel, href: playgroundPath(panel.href) }));

  // Experiences are full-screen products with their own chrome; a site bar on
  // top would push their 100dvh layouts past the viewport.
  if (pathname.startsWith("/experiences")) {
    return (
      <div className="dev dev--experience">
        <main className="dev__main">{children}</main>
      </div>
    );
  }

  // The homepage, the guide and the install page scroll as whole pages under
  // the site bar; only the playground panels get the sidebar.
  const section = pathname === "/" ? "home" : pathname.startsWith("/docs") ? "docs" : pathname.startsWith("/install") ? "install" : null;
  if (section) {
    return (
      <div className="site">
        <SiteNav active={section === "home" ? undefined : section} />
        <main className="site__main">{children}</main>
      </div>
    );
  }

  return (
    <div className="site">
      <SiteNav active="playground" />
      <div className="dev">
        <aside className="dev__nav">
          <div className="dev__brand">
            Playground
            <span>one capability per panel</span>
          </div>
          <nav>
            {panels.map((p) => (
              <Link key={p.href} href={p.href} className={`dev__link${pathname.startsWith(p.href) ? " dev__link--on" : ""}`}>
                <span className="dev__link-label">{p.label}</span>
                <span className="dev__link-hint">{p.hint}</span>
              </Link>
            ))}
          </nav>
          <div className="dev__foot">
            <code className="sc-mono">@zzyzxlabs/super-chat-core</code>
            <code className="sc-mono">@zzyzxlabs/super-chat-react</code>
            <code className="sc-mono">@zzyzxlabs/super-chat-ui</code>
          </div>
        </aside>
        <main className="dev__main">{children}</main>
      </div>
    </div>
  );
}

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="dev__head">
      <h1 className="dev__title">{title}</h1>
      {children ? <p className="dev__lede">{children}</p> : null}
    </header>
  );
}

/** Spec on the left, rendered result on the right — the pairing devs want. */
export function SpecSplit({ spec, children, label }: { spec: unknown; children: ReactNode; label?: string }) {
  return (
    <div className="dev__split">
      <div className="dev__spec">
        {label ? <div className="dev__spec-label">{label}</div> : null}
        <pre className="sc-pre dev__code">{JSON.stringify(spec, null, 2)}</pre>
      </div>
      <div className="dev__preview">{children}</div>
    </div>
  );
}
