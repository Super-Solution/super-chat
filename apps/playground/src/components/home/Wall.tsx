"use client";

import type { ReactNode } from "react";
import type { CardSpec } from "@zzyzxlabs/super-chat-core";
import { CardRenderer, ThinkingState } from "@zzyzxlabs/super-chat-ui";
import styles from "./home.module.css";
import * as S from "./specs";

type Tile = { id: string; spec: CardSpec; focal?: boolean } | { id: string; node: ReactNode };

// Library tiles carry no label: the code says what layer it is.
function Lib({ children }: { children: ReactNode }) {
  return <div className={styles.lib}>{children}</div>;
}

const COLUMNS: { className: string; label: string; tiles: Tile[] }[] = [
  {
    className: "",
    label: "Cards for data",
    tiles: [
      { id: "stats", spec: S.SIGNUP_STATS },
      { id: "chart", spec: S.SIGNUP_CHART },
      { id: "table", spec: S.vendorTable(4) },
      { id: "gauge", spec: S.BUDGET_GAUGE },
      { id: "kv", spec: S.CONTRACT_KV },
    ],
  },
  {
    className: styles.reverse,
    label: "Cards that ask and change things",
    tiles: [
      { id: "confirm", spec: S.PURCHASE_CONFIRM, focal: true },
      { id: "choice", spec: S.PLAN_CHOICE },
      { id: "funnel", spec: S.SIGNUP_FUNNEL },
      { id: "diff", spec: S.CAP_DIFF },
      { id: "form", spec: S.REQUEST_FORM },
    ],
  },
  {
    className: styles.slow,
    label: "Materials, runtime and backend",
    tiles: [
      {
        id: "proxy",
        node: (
          <Lib>
            <pre>{`export const POST =\n  createProxyHandler({\n    providers, authorize,\n    onRequest: audit,\n  });`}</pre>
          </Lib>
        ),
      },
      { id: "progress", spec: S.RESEARCH_PROGRESS },
      {
        id: "trace",
        node: (
          <Lib>
            <pre>{`system            included\nskill:procurement included\nretrieval         truncated\napp-state         dropped\nheadroom  5,778 tok`}</pre>
          </Lib>
        ),
      },
      { id: "citations", spec: S.LIABILITY_CITATIONS },
      {
        id: "thinking",
        node: (
          <div className={styles.paperTile}>
            <ThinkingState label="Reading the vendor contracts" />
          </div>
        ),
      },
      {
        id: "meter",
        node: (
          <Lib>
            <pre>{`{ model: "gpt-5.2",\n  tokens: 2188, ms: 4100,\n  outcome: "ok" }`}</pre>
          </Lib>
        ),
      },
      { id: "timeline", spec: S.RENEWAL_TIMELINE },
    ],
  },
];

function TileView({ tile, copy }: { tile: Tile; copy: string }) {
  if ("node" in tile) return <div>{tile.node}</div>;
  return (
    <div className={`${styles.tile}${tile.focal ? ` ${styles.focal}` : ""}`}>
      <CardRenderer card={{ id: `wall_${copy}_${tile.id}`, spec: tile.spec }} />
    </div>
  );
}

// Each column holds its tiles twice and slides up by exactly one copy, so the
// loop has no seam. The second copy is inert: it is decoration, and its
// controls must not be reachable twice.
export function Wall() {
  return (
    <div className={styles.wall}>
      {COLUMNS.map((col) => (
        <div key={col.label} className={styles.col} aria-label={col.label} role="group">
          <div className={`${styles.track}${col.className ? ` ${col.className}` : ""}`}>
            <div className={styles.half}>
              {col.tiles.map((t) => <TileView key={t.id} tile={t} copy="a" />)}
            </div>
            <div className={styles.half} aria-hidden="true" inert>
              {col.tiles.map((t) => <TileView key={t.id} tile={t} copy="b" />)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
