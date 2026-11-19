"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IS_STATIC_DEMO, playgroundPath } from "@/agent/deployment";
import { SiteNav, type SiteSection } from "./SiteNav";

// Panels, not pages of an app. Each one isolates a single capability so a
// developer evaluating the framework can see what is available without reading
// the source. The overview opens the set.

type IconName = "home" | "cards" | "surface" | "orb" | "motion" | "doc" | "skill" | "tool" | "wire" | "state" | "run";

export type Panel = { href: string; label: string; hint: string; icon: IconName };

const OVERVIEW: Panel = { href: "/overview", label: "Overview", hint: "What the kit does, at a glance", icon: "home" };

export const PANEL_GROUPS: { label: string; panels: Panel[] }[] = [
  {
    label: "Interface",
    panels: [
      { href: "/cards", label: "Agent cards", hint: "Every kind and its spec", icon: "cards" },
      { href: "/surfaces", label: "Surfaces", hint: "Interfaces the agent assembles", icon: "surface" },
      { href: "/agent-ui", label: "Agent parts", hint: "Thinking, orbs, composer", icon: "orb" },
      { href: "/dev-ani", label: "Animations", hint: "Every motion, replayable", icon: "motion" },
      { href: "/documents", label: "Documents", hint: "Previewer, quotes, edit refusals", icon: "doc" },
    ],
  },
  {
    label: "Agent",
    panels: [
      { href: "/skills", label: "Skills", hint: "Modes, matching, live scoring", icon: "skill" },
      { href: "/tools", label: "Tools & presets", hint: "Schemas, capability gating", icon: "tool" },
      { href: "/requests", label: "Wire requests", hint: "Responses vs Chat Completions", icon: "wire" },
      { href: "/app-state", label: "App state", hint: "The agent reads and drives your UI", icon: "state" },
      { href: "/run", label: "Run & events", hint: "Live chat and its event stream", icon: "run" },
    ],
  },
];

const EXPERIENCES = [
  { href: "/experiences/legal", label: "Legal workspace" },
  { href: "/experiences/companion", label: "Companion" },
  { href: "/experiences/defi", label: "DeFi assistant" },
];

/** The overview is the playground's front door: /playground on the site, /overview here. */
export const overviewHref = () => (IS_STATIC_DEMO ? "/playground" : "/overview");

const ICONS: Record<IconName, ReactNode> = {
  home: <path d="M3 8.5 10 3l7 5.5V17H3z M8 17v-5h4v5" />,
  cards: <path d="M4 5h9v11H4z M7 3h9v11" />,
  surface: <path d="M3 4h14v12H3z M3 8h14 M8 8v8" />,
  orb: <path d="M10 3a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M10 7a3 3 0 1 0 0 6a3 3 0 0 0 0-6z" />,
  motion: <path d="M3 13c3 0 3-6 6-6s3 6 6 6 M3 16h14" />,
  doc: <path d="M5 3h7l3 3v11H5z M8 9h5 M8 12h5" />,
  skill: <path d="M10 3l2 4.5 5 .5-3.8 3.3 1.2 4.9L10 13.6 5.6 16.2l1.2-4.9L3 8l5-.5z" />,
  tool: <path d="M12.5 3.5a4 4 0 0 0-4.7 5.2L3 13.5 6.5 17l4.8-4.8a4 4 0 0 0 5.2-4.7l-2.4 2.4-2.6-.6-.6-2.6z" />,
  wire: <path d="M3 7h10l-3-3 M17 13H7l3 3" />,
  state: <path d="M4 4h5v5H4z M11 11h5v5h-5z M9 6.5h4.5V11 M11 13.5H6.5V9" />,
  run: <path d="M6 4l10 6-10 6z" />,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="dev__icon" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const COLLAPSE_KEY = "superchat:playground-rail";

/** ⌘K: jump to any panel or experience without leaving the keyboard. */
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const all = [
      { href: overviewHref(), label: OVERVIEW.label, hint: OVERVIEW.hint, group: "Playground" },
      ...PANEL_GROUPS.flatMap((group) => group.panels.map((p) => ({ href: playgroundPath(p.href), label: p.label, hint: p.hint, group: group.label }))),
      ...EXPERIENCES.map((e) => ({ href: e.href, label: e.label, hint: "A product built on Super Chat", group: "Experiences" })),
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((item) => `${item.label} ${item.hint} ${item.group}`.toLowerCase().includes(q)) : all;
  }, [query]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery("");
      setActive(0);
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <dialog
      ref={dialog}
      className="dev__palette"
      aria-label="Go to a panel"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dev__palette-box">
        <input
          ref={input}
          className="dev__palette-input"
          placeholder="Go to a panel…"
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="dev-palette-list"
          aria-activedescendant={items[active] ? `dev-palette-${active}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (event.key === "Enter" && items[active]) {
              event.preventDefault();
              go(items[active].href);
            }
          }}
        />
        <ul id="dev-palette-list" className="dev__palette-list" role="listbox">
          {items.map((item, index) => (
            <li
              key={item.href}
              id={`dev-palette-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(item.href)}
            >
              <span>{item.label}</span>
              <small>{item.group}</small>
            </li>
          ))}
          {items.length ? null : <li className="dev__palette-empty">No panel matches “{query}”.</li>}
        </ul>
      </div>
    </dialog>
  );
}

export function Shell({
  children,
  renderNav = (active) => <SiteNav active={active} />,
}: {
  children: ReactNode;
  /** Lets the public site supply its own top bar. */
  renderNav?: (active?: SiteSection) => ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Storage can be blocked; the rail simply starts open.
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleRail = () => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {
        // Not remembered, still toggled.
      }
      return !value;
    });
  };

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
        {renderNav(section === "home" ? undefined : section)}
        <main className="site__main">{children}</main>
      </div>
    );
  }

  const here = pathname.replace(/\/$/, "") || "/";
  const isOn = (href: string) => (href === overviewHref() ? here === href : here.startsWith(href));
  const link = (panel: Panel, href: string) => (
    <Link key={href} href={href} className="dev__link" aria-current={isOn(href) ? "page" : undefined} title={collapsed ? panel.label : panel.hint}>
      <Icon name={panel.icon} />
      <span className="dev__link-label">{panel.label}</span>
    </Link>
  );

  return (
    <div className="site">
      {renderNav("playground")}
      <div className="dev" data-collapsed={collapsed || undefined}>
        <aside className="dev__nav" aria-label="Playground">
          <div className="dev__navtop">
            <button type="button" className="dev__search" onClick={() => setPalette(true)} aria-label="Go to a panel">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="M13.2 13.2 17 17" /></svg>
              <span className="dev__search-label">Go to a panel</span>
              <kbd>⌘K</kbd>
            </button>
          </div>
          <nav className="dev__groups">
            {link(OVERVIEW, overviewHref())}
            {PANEL_GROUPS.map((group) => (
              <div key={group.label} className="dev__group">
                <div className="dev__group-label">{group.label}</div>
                {group.panels.map((panel) => link(panel, playgroundPath(panel.href)))}
              </div>
            ))}
          </nav>
          <button type="button" className="dev__collapse" onClick={toggleRail} aria-expanded={!collapsed} aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h14v12H3z M8 4v12" /></svg>
          </button>
        </aside>
        <main className="dev__main" key={here}>
          {children}
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
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
