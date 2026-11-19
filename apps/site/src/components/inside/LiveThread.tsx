"use client";

import { useEffect, useRef, useState } from "react";
import { AgentProvider, useCardAction, useRun, useThread } from "@supersolutions/super-chat-react";
import { BUILTIN_RENDERERS, CardRendererProvider, Composer, LiveTurn, MessageView, SurfaceHostProvider } from "@supersolutions/super-chat-ui";
import { createComposedDemo } from "../composed/demo";
import { SCENARIOS } from "../composed/scenarios";
import styles from "./inside.module.css";

const FIRST = SCENARIOS[1]!;

/**
 * The kit's message parts in a scroller of our own. `<Thread>` follows new content with
 * scrollIntoView, which would also scroll this page while a visitor is reading it.
 */
function Messages() {
  const { messages } = useThread();
  const { respond } = useCardAction();
  const steps = useRun((run) => run.parts.length);
  const waiting = useRun((run) => run.pendingCard?.id);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && (pinned.current || waiting)) el.scrollTop = el.scrollHeight;
  }, [messages.length, steps, waiting]);

  return (
    <div
      ref={scroller}
      className={`sc-thread ${styles.threadBody}`}
      tabIndex={0}
      role="group"
      aria-label="Conversation"
      onScroll={(event) => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {messages.map((message) => <MessageView key={message.id} message={message} respond={respond} />)}
      <LiveTurn />
    </div>
  );
}

function Frame() {
  const { send, messages, isRunning } = useThread();
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || started.current) return;
      started.current = true;
      observer.disconnect();
      void send(FIRST.request);
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [send]);

  const asked = new Set(messages.flatMap((message) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))));
  const next = SCENARIOS.filter((scenario) => !asked.has(scenario.request));

  return (
    <div ref={root} className={styles.thread}>
      <Messages />
      {next.length ? (
        <div className={styles.starters} role="group" aria-label="Sample requests">
          {next.map((scenario) => (
            <button key={scenario.id} type="button" className="sc-btn sc-btn--sm" disabled={isRunning} onClick={() => void send(scenario.request)}>
              {scenario.request}
            </button>
          ))}
        </div>
      ) : null}
      <Composer placeholder="Ask the agent" />
    </div>
  );
}

/** The real message parts and composer, answering from a script with sample figures. */
export function LiveThread() {
  const [demo] = useState(createComposedDemo);
  return (
    <AgentProvider client={demo.client}>
      <CardRendererProvider renderers={BUILTIN_RENDERERS} registry={demo.cards}>
        <SurfaceHostProvider catalogue={demo.catalogue}>
          <Frame />
        </SurfaceHostProvider>
      </CardRendererProvider>
    </AgentProvider>
  );
}
