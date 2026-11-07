"use client";

// Streamed assistant text with a caret.
//
// The reference component fakes the stream with a timer. Here the text is
// already arriving token by token, so this only owns the caret: solid while
// tokens are landing, blinking once the stream goes quiet but the turn has not
// closed. A caret that blinks *during* the stream reads as a stall.

import { useEffect, useRef, useState } from "react";

export interface StreamingTextProps {
  text: string;
  /** True while more tokens may still arrive. */
  streaming?: boolean;
  className?: string;
  /** Delay before a still-open but quiet stream starts blinking. */
  quietMs?: number;
}

export function StreamingText({ text, streaming = false, className, quietMs = 420 }: StreamingTextProps) {
  const [receiving, setReceiving] = useState(true);
  const previous = useRef(text);

  useEffect(() => {
    if (!streaming) {
      previous.current = text;
      setReceiving(true);
      return;
    }
    if (text === previous.current) return;
    previous.current = text;
    setReceiving(true);
    const timer = setTimeout(() => setReceiving(false), quietMs);
    return () => clearTimeout(timer);
  }, [text, streaming, quietMs]);

  return (
    <div className={"sc-prose sc-msg__text" + (className ? " " + className : "")}>
      {text}
      {streaming ? <span className={`sc-caret${receiving ? " sc-caret--steady" : ""}`} aria-hidden /> : null}
    </div>
  );
}

/** Bare blinking caret, for a turn that has started but produced no text yet. */
export function Caret({ steady = false }: { steady?: boolean }) {
  return <span className={"sc-caret" + (steady ? " sc-caret--steady" : "")} aria-hidden />;
}
