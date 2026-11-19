"use client";

import { useEffect, useRef, useState } from "react";
import { AgentProvider, useCardAction, usePartialTools, useSurface, useThread } from "@supersolutions/super-chat-react";
import {
  AgentSurface,
  BUILTIN_RENDERERS,
  CardRenderer,
  CardRendererProvider,
  SurfaceHostProvider,
} from "@supersolutions/super-chat-ui";
import type { SurfaceSpec } from "@supersolutions/super-chat-core";
import { createComposedDemo, type ComposedDemo as Demo } from "./demo";
import { SCENARIOS } from "./scenarios";
import styles from "./composed.module.css";

function Stage() {
  const { isRunning, send, clear } = useThread();
  const { pending, respond } = useCardAction();
  const partials = usePartialTools();
  const [active, setActive] = useState(0);
  const scenario = SCENARIOS[active]!;
  const { spec, activity } = useSurface(scenario.surfaceId);

  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const askRef = useRef<HTMLDivElement>(null);
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

  // The pressed button is disabled while the run waits, so focus moves to the question and back.
  useEffect(() => {
    if (pending) askRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    else if (wasPending.current) root.current?.querySelector<HTMLElement>("button[aria-pressed=\"true\"]")?.focus({ preventScroll: true });
    wasPending.current = Boolean(pending);
  }, [pending]);

  const choose = (index: number) => {
    if (index === active && spec) return;
    started.current = true;
    setActive(index);
    clear();
    void send(SCENARIOS[index]!.request);
  };

  const streaming = Object.values(partials).find((call) => call.name === "createSurface")?.partialCard as SurfaceSpec | undefined;
  const live = spec && !spec.deleted ? spec : undefined;
  const parts = (live ?? streaming)?.components?.length ?? 0;
  const approval = live?.data["approval"] as { approved?: boolean; reference?: string } | undefined;

  // Read out by screen readers only. The interface itself shows what changed.
  const announcement =
    pending ? "The agent is waiting for your answer."
    : isRunning ? (parts ? `Composing the interface: ${parts} parts` : "Reading the request")
    : approval?.approved ? "Approved. Your answer went back to the run."
    : activity?.state === "cancelled" ? "Declined. Nothing was sent."
    : "";

  return (
    <div ref={root} className={styles.stage}>
      <div className={styles.requests} role="group" aria-label="Ask the agent">
        {SCENARIOS.map((item, index) => (
          <button key={item.id} type="button" className={styles.request} aria-pressed={index === active} onClick={() => choose(index)}>
            {item.request}
          </button>
        ))}
      </div>
      <p className={styles.srOnly} role="status">{announcement}</p>
      <div className={styles.canvas}>
        {live || streaming?.components?.length ? (
          // One view from the first streamed part to the finished interface, so nothing is drawn twice.
          <AgentSurface key={scenario.surfaceId} surfaceId={scenario.surfaceId} streaming={streaming} />
        ) : (
          <div className="sc-surface" aria-hidden="true">
            <div className="sc-surface__body">
              <div className="sc-surface-pending sc-surface-pending--text"><span /><span /></div>
              <div className="sc-surface-pending sc-surface-pending--select"><span /><span /></div>
              <div className="sc-surface-pending sc-surface-pending--metric"><span /><span /></div>
              <div className="sc-surface-pending sc-surface-pending--card-chart"><span /><span /></div>
            </div>
          </div>
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
          <Stage />
        </SurfaceHostProvider>
      </CardRendererProvider>
    </AgentProvider>
  );
}
