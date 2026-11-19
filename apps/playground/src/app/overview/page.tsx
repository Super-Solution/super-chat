"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { Orb } from "@supersolutions/super-chat-ui";
import { playgroundPath } from "@/agent/deployment";
import { PANEL_GROUPS, type Panel } from "@/components/Shell";
import { Showcase } from "@/components/showcase/Showcase";
import styles from "./overview.module.css";

/** A small drawing of what each panel is about. It moves when the tile is hovered or focused. */
function Art({ panel }: { panel: Panel }) {
  switch (panel.icon) {
    case "cards":
      return <div className={styles.cards}><i /><i /><i /></div>;
    case "surface":
      return <div className={styles.surface}><i /><i /><i /><i /></div>;
    case "orb":
      return <div className={styles.orb}><Orb variant="S1" size={40} label="Thinking" /></div>;
    case "motion":
      return (
        <svg className={styles.wave} viewBox="0 0 120 40" aria-hidden="true">
          <path d="M4 30 C 24 30, 24 10, 44 10 S 64 30, 84 30 S 104 10, 116 10" />
        </svg>
      );
    case "doc":
      return <div className={styles.doc}><i /><i /><i /><b /></div>;
    case "skill":
      return <div className={styles.bars}><i style={{ "--w": "82%" } as CSSProperties} /><i style={{ "--w": "54%" } as CSSProperties} /><i style={{ "--w": "31%" } as CSSProperties} /></div>;
    case "tool":
      return <div className={styles.toggles}><i /><i /><i /></div>;
    case "wire":
      return <div className={styles.wire}><i /><b /><i /></div>;
    case "state":
      return <div className={styles.state}><i /><b /><i /></div>;
    case "run":
      return <div className={styles.run}><i /><i /><i /><i /></div>;
    default:
      return null;
  }
}

export default function OverviewPage() {
  let index = 0;
  return (
    <div className="dev__page">
      <header className="dev__head">
        <h1 className="dev__title">Playground</h1>
        <p className="dev__lede">Each panel shows one capability of the kit, running in your browser.</p>
      </header>

      <section className={styles.stage} aria-label="What the agent does">
        <Showcase />
      </section>

      {PANEL_GROUPS.map((group) => (
        <section key={group.label} className={styles.group}>
          <h2 className={styles.groupTitle}>{group.label}</h2>
          <div className={styles.tiles}>
            {group.panels.map((panel) => (
              <Link key={panel.href} href={playgroundPath(panel.href)} className={styles.tile} style={{ "--n": index++ } as CSSProperties}>
                <div className={styles.art} aria-hidden="true"><Art panel={panel} /></div>
                <strong>{panel.label}</strong>
                <span>{panel.hint}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
