"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardAction } from "@supersolutions/super-chat-core";
import { Orb } from "@supersolutions/super-chat-ui";
import { SCENES } from "./content";
import { LiveCard } from "./parts";
import styles from "./home.module.css";

type Phase = "typing" | "thinking" | "answer" | "waiting" | "done";

const TYPE_MS = 30;
const THINK_AFTER_MS = 240;
const ANSWER_AFTER_MS = 1500;
const ASK_AFTER_MS = 3700;
const NEXT_SCENE_MS = 2400;
const WAITING_STATUS = "Your turn. The run is paused until you answer.";

/** Plays one agent turn at a time and stops at each question until the visitor answers. */
export function useHeroScene() {
  const [state, setState] = useState({ scene: 0, round: 0, phase: "typing" as Phase, chars: 0, reply: "" });
  const timers = useRef<number[]>([]);

  const clear = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const later = useCallback((run: () => void, ms: number) => {
    timers.current.push(window.setTimeout(run, ms));
  }, []);

  const play = useCallback(
    (scene: number) => {
      clear();
      const question = SCENES[scene].question;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setState((s) => ({ scene, round: s.round + 1, phase: "waiting", chars: question.length, reply: "" }));
        return;
      }
      setState((s) => ({ scene, round: s.round + 1, phase: "typing", chars: 0, reply: "" }));
      const type = (chars: number) => {
        setState((s) => ({ ...s, chars }));
        if (chars < question.length) return later(() => type(chars + 1), TYPE_MS);
        later(() => setState((s) => ({ ...s, phase: "thinking" })), THINK_AFTER_MS);
        later(() => setState((s) => ({ ...s, phase: "answer" })), ANSWER_AFTER_MS);
        later(() => setState((s) => ({ ...s, phase: "waiting" })), ASK_AFTER_MS);
      };
      later(() => type(1), 420);
    },
    [clear, later],
  );

  useEffect(() => {
    play(0);
    return clear;
  }, [play, clear]);

  const answer = (action: Omit<CardAction, "at">) => {
    const scene = SCENES[state.scene];
    clear();
    setState((s) => ({ ...s, phase: "done", reply: action.type === "confirm" ? scene.yes : scene.no }));
    later(() => play((state.scene + 1) % SCENES.length), NEXT_SCENE_MS);
  };

  return { ...state, answer };
}

export function HeroScene({ scene }: { scene: ReturnType<typeof useHeroScene> }) {
  const current = SCENES[scene.scene];
  const { phase } = scene;
  const showAnswer = phase === "answer" || phase === "waiting" || phase === "done";
  const showAsk = phase === "waiting" || phase === "done";
  const statusRef = useRef<HTMLDivElement>(null);

  // "done" only follows a person's answer, so autoplay never moves focus.
  useEffect(() => {
    if (phase === "done") statusRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const status =
    phase === "thinking" ? current.working
    : phase === "answer" ? `The agent chose a ${current.kind} card`
    : phase === "waiting" ? WAITING_STATUS
    : phase === "done" ? scene.reply
    : "";

  return (
    <div className={styles.scene}>
      <div className={styles.reserve}>
        {SCENES.map((item) => (
          <p key={item.question} className={`${styles.bubble} ${styles.ghost}`} aria-hidden="true">{item.question}</p>
        ))}
        <p className={styles.bubble}>
          {current.question.slice(0, scene.chars)}
          {phase === "typing" ? <span className={styles.caret} aria-hidden="true" /> : null}
        </p>
      </div>
      <div className={styles.reserve}>
        <div className={`${styles.status} ${styles.ghost}`} aria-hidden="true"><span>{WAITING_STATUS}</span></div>
        <div ref={statusRef} className={styles.status} data-idle={status === ""} role="status" tabIndex={-1}>
          {phase === "thinking" ? <Orb variant="S1" size={22} /> : null}
          <span>{status}</span>
        </div>
      </div>
      <div className={styles.deck}>
        <div className={styles.deckSizer} aria-hidden="true" inert>
          {SCENES.map((item) => (
            <div key={item.question}>
              <div className={styles.slot}><LiveCard kind={item.kind} instance="sizer" /></div>
              <div className={styles.slot}><LiveCard kind="confirm" spec={item.ask} instance={`sizer_${item.kind}`} /></div>
            </div>
          ))}
        </div>
        <div className={styles.deckLive}>
          {showAnswer ? (
            <div className={`${styles.deckAnswer} ${styles.slot}`}>
              <LiveCard kind={current.kind} instance={`answer_${scene.round}`} />
            </div>
          ) : null}
          {showAsk ? (
            <div className={`${styles.deckAsk} ${styles.slot}`}>
              <LiveCard kind="confirm" spec={current.ask} instance={`ask_${scene.round}`} onRespond={scene.answer} />
            </div>
          ) : null}
        </div>
      </div>
      <p className={styles.sceneNote}>Sample data, rendered by the real card components.</p>
    </div>
  );
}
