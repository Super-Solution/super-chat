"use client";

// A count that rolls the old glyph up and the new one in, per character slot.
//
// Extracted from TodoList when PlanProgress needed the same thing: both show a
// done/total that changes mid-run, and a number that swaps instantly reads as a
// re-render rather than as progress. The `.sc-roll` styles were already generic.

import { useEffect, useRef, useState } from "react";

/** One character slot. Rolls only when its own glyph changes. */
function RollDigit({ char }: { char: string }) {
  const prev = useRef(char);
  const [roll, setRoll] = useState<{ from: string; to: string } | null>(null);
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (char === prev.current) return;
    const from = prev.current;
    prev.current = char;
    setRoll({ from, to: char });
    setUp(false);
    // Two frames: one to paint the "from" glyph, one to start the transition.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setUp(true)));
    const done = setTimeout(() => setRoll(null), 380);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [char]);

  if (!roll) return <span className="sc-roll__digit">{char}</span>;
  return (
    <span className="sc-roll__digit">
      <span className={"sc-roll__inner" + (up ? " sc-roll__inner--up" : "")}>
        <span>{roll.from}</span>
        <span>{roll.to}</span>
      </span>
    </span>
  );
}

/**
 * The whole value carries the label, not the individual slots — a screen
 * reader should hear "3/5", not three separate characters mid-roll.
 */
export function RollingCount({ value }: { value: string }) {
  return (
    <span className="sc-roll" aria-label={value}>
      {value.split("").map((c, i) => (
        <RollDigit key={i} char={c} />
      ))}
    </span>
  );
}
