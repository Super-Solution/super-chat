"use client";

// Starting points for a conversation.
//
// Two pieces. `Suggestions` is the list itself: a few prompts a person can send with one press,
// usable wherever a host wants them (under the composer, after an answer). `EmptyThread` is what
// `Thread` shows before the first message when the host passes neither `empty` nor anything else:
// a title, one line, and the suggestions if there are any. Nothing here invents a prompt; the
// host supplies every one.

import type { ReactNode } from "react";
import { useThread } from "@supersolutions/super-chat-react";
import { useLabels } from "./labels.js";

/** A prompt to offer. A bare string is both its label and what is sent. */
export type Suggestion = string | { label: string; prompt?: string };

const labelOf = (s: Suggestion) => (typeof s === "string" ? s : s.label);
const promptOf = (s: Suggestion) => (typeof s === "string" ? s : (s.prompt ?? s.label));

export type SuggestionsProps = {
  items: readonly Suggestion[];
  /** What pressing one does. Default: send its prompt as the next message. */
  onPick?: (prompt: string, item: Suggestion) => void;
};

export function Suggestions({ items, onPick }: SuggestionsProps) {
  const labels = useLabels();
  const { send, isRunning } = useThread();
  if (!items.length) return null;
  return (
    <ul className="sc-suggestions" aria-label={labels.suggestions}>
      {items.map((item) => (
        <li key={labelOf(item)}>
          <button
            type="button"
            className="sc-suggestion"
            disabled={isRunning}
            onClick={() => (onPick ? onPick(promptOf(item), item) : void send(promptOf(item)))}
          >
            {labelOf(item)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The thread before anything is said: what this is for, and a way in. */
export function EmptyThread({ suggestions, children }: { suggestions?: readonly Suggestion[]; children?: ReactNode }) {
  const labels = useLabels();
  return (
    <div className="sc-emptystate">
      <h2 className="sc-emptystate__title">{labels.emptyTitle}</h2>
      <p className="sc-emptystate__text">{labels.emptyDescription}</p>
      {suggestions?.length ? <Suggestions items={suggestions} /> : null}
      {children}
    </div>
  );
}
