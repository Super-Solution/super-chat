"use client";

// Cards of this kit that a sentence can point into.
//
// A reference in prose names a card by the `id` in its spec (`ref:authority?cite=2`), and the
// host decides how to find that card. `pluginCardRefHost` finds a mounted plugin card. This file
// is the same idea for the cards the kit draws itself: a card that wants to answer references
// registers a handler under its id while it is on screen, and `builtinCardRefHost` hands the
// reference to the newest card with that id. A card that answers nothing is not registered, so
// the reference reads as text with the reason.
//
// The host is the whole public surface. What the params mean stays with the card kind (the
// citations card reads `cite=`), and nothing here reads them.

import { useEffect, useRef } from "react";
import type { CardRef, CardRefEvent, CardRefHost, CardRefResult } from "@supersolutions/super-chat-core";

export type CardRefHandler = (ref: CardRef | null, event: CardRefEvent) => CardRefResult;

const mounted = new Map<string, CardRefHandler[]>();

/**
 * Answers references to the card `id` while the calling card is mounted. A card without an id
 * (the common case) registers nothing. The latest handler is read on every call, so it may close
 * over state.
 */
export function useCardRefTarget(id: string | undefined, handler: CardRefHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!id) return;
    const entry: CardRefHandler = (ref, event) => latest.current(ref, event);
    mounted.set(id, [...(mounted.get(id) ?? []), entry]);
    return () => {
      const rest = (mounted.get(id) ?? []).filter((h) => h !== entry);
      if (rest.length) mounted.set(id, rest);
      else mounted.delete(id);
    };
  }, [id]);
}

/**
 * The host for `<CardRefProvider>`: sends a reference to the mounted card it names. Two cards
 * with one id (an old turn and a new one) resolve to the newest, the one the sentence beside it
 * was written about. `null` clears what every card is showing.
 */
export const builtinCardRefHost: CardRefHost = {
  ref(ref, event) {
    if (ref === null) {
      for (const list of mounted.values()) for (const handler of list) handler(null, event);
      return { ok: true };
    }
    const list = mounted.get(ref.target);
    const handler = list?.[list.length - 1];
    if (!handler) return { ok: false, code: "ref_no_card", reason: `no card "${ref.target}" is on screen.` };
    return handler(ref, event);
  },
};

/**
 * One host out of several: a reference goes to the first that has the card it names. Use it to
 * answer for the kit's own cards and a plugin's together:
 * `chainCardRefHosts(builtinCardRefHost, pluginCardRefHost)`.
 */
export function chainCardRefHosts(...hosts: readonly CardRefHost[]): CardRefHost {
  return {
    ref(ref, event) {
      if (ref === null) {
        for (const host of hosts) host.ref(null, event);
        return { ok: true };
      }
      let last: CardRefResult = { ok: false, code: "ref_no_card", reason: `no card "${ref.target}" is on screen.` };
      for (const host of hosts) {
        const result = host.ref(ref, event);
        if (result.ok || result.code !== "ref_no_card") return result;
        last = result;
      }
      return last;
    },
  };
}
