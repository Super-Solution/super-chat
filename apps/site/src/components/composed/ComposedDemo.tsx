"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AgentProvider, useCardAction, usePartialTools, useSurface, useThread } from "@supersolutions/super-chat-react";
import {
  AgentSurface,
  BUILTIN_RENDERERS,
  CardRenderer,
  CardRendererProvider,
  SurfaceHostProvider,
  SurfaceView,
} from "@supersolutions/super-chat-ui";
import type { SurfaceSpec } from "@supersolutions/super-chat-core";
import { createComposedDemo, type ComposedDemo as Demo } from "./demo";
import { SCENARIOS } from "./scenarios";
import styles from "./composed.module.css";

type Baseline = { surfaceId: string; calls: number; revision: number };

function Stage({ demo }: { demo: Demo }) {
  const { isRunning, send, clear } = useThread();
  const { pending, respond } = useCardAction();
  const partials = usePartialTools();
  const [active, setActive] = useState(0);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const scenario = SCENARIOS[active]!;
  const { spec, activity } = useSurface(scenario.surfaceId);
  const calls = useSyncExternalStore(demo.subscribe, demo.modelCalls, demo.modelCalls);

  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const askRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const wasPending = useRef(false);

  // The first request runs when the section arrives, so the page shows the work without a click.
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || started.current) return;
        started.current = true;
        observer.disconnect();
        void send(SCENARIOS[0]!.request);
      },
      { rootMargin: "120px" },
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [send]);

  // The counters start once the interface exists: everything after that is the person's.
  useEffect(() => {
    if (!isRunning && spec && baseline?.surfaceId !== spec.surfaceId) {
      setBaseline({ surfaceId: spec.surfaceId, calls, revision: spec.revision });
    }
  }, [isRunning, spec, calls, baseline]);

  // The pressed button is disabled while the run waits, so focus moves to the question and back.
  useEffect(() => {
    if (pending) askRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    else if (wasPending.current) statusRef.current?.focus({ preventScroll: true });
    wasPending.current = Boolean(pending);
  }, [pending]);

  const choose = (index: number) => {
    if (index === active && spec) return;
    started.current = true;
    setActive(index);
    setBaseline(null);
    clear();
    void send(SCENARIOS[index]!.request);
  };

  const streaming = Object.values(partials).find((call) => call.name === "createSurface")?.partialCard as SurfaceSpec | undefined;
  const live = spec && !spec.deleted ? spec : undefined;
  const parts = (live ?? streaming)?.components?.length ?? 0;
  const approval = live?.data["approval"] as { approved?: boolean; reference?: string } | undefined;
  const counted = baseline?.surfaceId === live?.surfaceId ? baseline : null;

  const state: { tone: string; text: string } =
    pending ? { tone: "waiting", text: "Your turn. Nothing happens until you answer." }
    : isRunning ? { tone: "working", text: parts ? `Composing the interface: ${parts} parts` : "Reading the request" }
    : approval?.approved ? { tone: "done", text: "Approved. Your answer went back to the run." }
    : activity?.state === "cancelled" ? { tone: "idle", text: "Declined. Nothing was sent." }
    : live ? { tone: "idle", text: `Composed from ${live.components.length} parts` }
    : { tone: "idle", text: "Ready" };

  return (
    <div ref={root} className={styles.stage} data-state={state.tone}>
      <div className={styles.side}>
        <div className={styles.requests} role="group" aria-label="Ask the agent">
          {SCENARIOS.map((item, index) => (
            <button key={item.id} type="button" className={styles.request} aria-pressed={index === active} onClick={() => choose(index)}>
              {item.request}
            </button>
          ))}
        </div>
        <p ref={statusRef} className={styles.status} data-tone={state.tone} role="status" tabIndex={-1}>
          <i aria-hidden="true" />
          {state.text}
        </p>
        <p className={styles.reply}>{!isRunning && live ? scenario.reply : "\u00a0"}</p>
        <dl className={styles.counters}>
          <div>
            <dt>Model calls since it appeared</dt>
            <dd>{counted ? calls - counted.calls : 0}</dd>
          </div>
          <div>
            <dt>Updates in your browser</dt>
            <dd>{counted && live ? live.revision - counted.revision : 0}</dd>
          </div>
        </dl>
        <p className={styles.note}>
          Scripted agent, sample figures. <Link href="/playground/surfaces">Open the full demo</Link>
        </p>
      </div>
      <div className={styles.canvas}>
        {live ? (
          <AgentSurface surfaceId={live.surfaceId} />
        ) : streaming?.components?.length ? (
          <SurfaceView spec={streaming} partial />
        ) : (
          <div className={styles.blank} aria-hidden="true"><span /><span /><span /></div>
        )}
        {pending ? (
          <div ref={askRef} className={styles.ask}>
            <CardRenderer card={pending} respond={respond} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ComposedDemo() {
  const [demo] = useState(createComposedDemo);
  return (
    <AgentProvider client={demo.client}>
      <CardRendererProvider renderers={BUILTIN_RENDERERS} registry={demo.cards}>
        <SurfaceHostProvider catalogue={demo.catalogue}>
          <Stage demo={demo} />
        </SurfaceHostProvider>
      </CardRendererProvider>
    </AgentProvider>
  );
}
