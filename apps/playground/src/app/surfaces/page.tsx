"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AgentProvider, useSurface, useThread } from "@supersolutions/super-chat-react";
import {
  AgentSurface,
  BUILTIN_RENDERERS,
  CardRendererProvider,
  Composer,
  SurfaceHostProvider,
  Thread,
} from "@supersolutions/super-chat-ui";
import { SURFACE_DEMO_THREAD, SURFACE_ID, createSurfaceDemo, type SurfaceDemo } from "@/agent/surface-demo";
import styles from "./surfaces.module.css";

const FIRST_PROMPT = "Build me a spend explorer for Q3.";
const SECOND_PROMPT = "Add a breakdown by category.";

function Starters() {
  const { send, isRunning, messages } = useThread();
  const { spec } = useSurface(SURFACE_ID);
  const live = spec && !spec.deleted && !spec.expired;
  const prompt = live ? SECOND_PROMPT : FIRST_PROMPT;
  if (live && messages.some((m) => m.parts.some((p) => p.type === "text" && p.text === SECOND_PROMPT))) return null;
  return (
    <button type="button" className="sc-btn sc-btn--sm" disabled={isRunning} onClick={() => void send(prompt)}>
      {prompt}
    </button>
  );
}

function Inspector({ demo, panel }: { demo: SurfaceDemo; panel: boolean }) {
  const stats = useSyncExternalStore(demo.subscribe, demo.stats, demo.stats);
  const { spec } = useSurface(SURFACE_ID);
  const live = spec && !spec.deleted && !spec.expired ? spec : undefined;
  const { lines: _lines, ...state } = (live?.data ?? {}) as Record<string, unknown>;

  return (
    <aside className={styles.side} aria-label="What the framework is doing">
      {panel && live ? (
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Placed by the host</h2>
          <AgentSurface surfaceId={SURFACE_ID} />
        </section>
      ) : null}
      <section className={styles.block}>
        <h2 className={styles.blockTitle}>This session</h2>
        <dl className={styles.stats}>
          <div>
            <dt>Model calls</dt>
            <dd data-testid="model-calls">{stats.modelCalls}</dd>
          </div>
          <div>
            <dt>Metered actions</dt>
            <dd data-testid="metered-actions">{stats.meteredActions}</dd>
          </div>
        </dl>
        <p className={styles.note}>Move a filter and the model calls stay where they are. The interface answers locally.</p>
      </section>
      <section className={styles.block}>
        <h2 className={styles.blockTitle}>Surface state{live ? `, revision ${live.revision}` : ""}</h2>
        <pre className={styles.state} data-testid="surface-state">{live ? JSON.stringify(state, null, 2) : "Nothing built yet."}</pre>
      </section>
    </aside>
  );
}

function Panel({ demo }: { demo: SurfaceDemo }) {
  const { clear, isRunning, messages } = useThread();
  const [panel, setPanel] = useState(false);
  const placement = useMemo(() => (panel ? () => "elsewhere" as const : () => "inline" as const), [panel]);

  return (
    <SurfaceHostProvider catalogue={demo.catalogue} placement={placement}>
      <div className={styles.page}>
        <div className={styles.main}>
          <div className={styles.bar}>
            <h1 className={styles.barTitle}>Agent-built interfaces</h1>
            <div className={styles.placement} role="group" aria-label="Where the interface appears">
              <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" aria-pressed={!panel} onClick={() => setPanel(false)}>In the thread</button>
              <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" aria-pressed={panel} onClick={() => setPanel(true)}>Side panel</button>
            </div>
            <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" disabled={isRunning || !messages.length} onClick={clear}>Start over</button>
          </div>
          <div className={styles.thread}>
            <Thread
              empty={
                <div className={styles.empty}>
                  <p className={styles.emptyTitle}>One request, a working interface</p>
                  <p className={styles.emptyBody}>The agent assembles filters, totals, a chart and a table, then keeps them up to date as you work.</p>
                </div>
              }
            />
            <div className={styles.starters}><Starters /></div>
            <Composer placeholder="Ask for an interface…" />
          </div>
        </div>
        <Inspector demo={demo} panel={panel} />
      </div>
    </SurfaceHostProvider>
  );
}

export default function SurfacesPanel() {
  const [demo] = useState(createSurfaceDemo);

  // Reload restores the thread, the surface and whatever the filters were set to.
  useEffect(() => {
    void demo.client.openThread(SURFACE_DEMO_THREAD);
  }, [demo]);

  return (
    <AgentProvider client={demo.client}>
      <CardRendererProvider renderers={BUILTIN_RENDERERS} registry={demo.cards}>
        <Panel demo={demo} />
      </CardRendererProvider>
    </AgentProvider>
  );
}
