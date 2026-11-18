// The order a turn actually happened in.
//
// A turn is text, then a tool's output, then more text. Rendering all cards above
// all text loses that: the model writes "here is the breakdown" and "so the second
// row matters" around a chart, and both land below it. Live and finished turns share
// this one function so a turn does not rearrange itself the moment it commits.

import type { Card } from "../cards/types.js";
import type { ContentPart } from "./types.js";

export type TurnSegment =
  | { type: "text"; key: string; text: string }
  /** The output slot of one tool call. Stable from first preview to final card. */
  | { type: "output"; key: string; callId: string; cards: Card[] }
  /** A card no call in this turn accounts for. */
  | { type: "card"; key: string; card: Card };

export type TurnLayoutOptions = {
  /** Keep a slot for a call with no card yet. A live turn needs it for previews and skeletons. */
  keepEmptyOutputs?: boolean;
};

/**
 * True when a stored turn recorded where its cards belong. Turns saved before this
 * existed carry no `callId` on their artifacts and keep the layout they had.
 */
export function hasTurnOrder(parts: readonly ContentPart[]): boolean {
  return parts.some((p) => p.type === "artifact" && p.kind.startsWith("card:") && typeof p.callId === "string");
}

export function layoutTurn(parts: readonly ContentPart[], cards: readonly Card[], options: TurnLayoutOptions = {}): TurnSegment[] {
  const byCall = new Map<string, Card[]>();
  for (const card of cards) {
    if (!card.callId) continue;
    const list = byCall.get(card.callId);
    if (list) list.push(card);
    else byCall.set(card.callId, [card]);
  }

  const segments: TurnSegment[] = [];
  const placed = new Set<string>();
  let textCount = 0;
  // A call that drew nothing should not split a paragraph into two blocks, but
  // the words either side of it were still written apart.
  let crossedCall = false;

  for (const part of parts) {
    if (part.type === "text") {
      if (!part.text) continue;
      const last = segments[segments.length - 1];
      if (last?.type === "text") {
        last.text += (crossedCall ? "\n\n" : "") + part.text;
      } else {
        segments.push({ type: "text", key: `text:${textCount}`, text: part.text });
        textCount += 1;
      }
      crossedCall = false;
    } else if (part.type === "tool-call") {
      const owned = byCall.get(part.callId) ?? [];
      for (const card of owned) placed.add(card.id);
      if (owned.length || options.keepEmptyOutputs) {
        segments.push({ type: "output", key: `call:${part.callId}`, callId: part.callId, cards: owned });
        crossedCall = false;
      } else {
        crossedCall = true;
      }
    }
  }

  for (const card of cards) {
    if (!placed.has(card.id)) segments.push({ type: "card", key: `card:${card.id}`, card });
  }
  return segments;
}
