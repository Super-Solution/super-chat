import type { CardRef, CardRefEvent, CardRefHost, CardRefResult } from "@supersolutions/super-chat-core";
import type { MountController } from "./controller.js";

// The cards on screen, by the id a reference names.
//
// A reference in a message says `ref:<id>`, where the id is the card spec's own `id` (a
// plugin's cards carry one: a chart, a plot, a document). This is the table from that id to the
// card that is mounted now. It is deliberately dumb: it does not know what any card shows, it
// only finds the right one and passes the reference on, so a new card kind needs nothing here.

const mounted = new Map<string, MountController[]>();

/** Records a mounted card under the ids it answers to. Returns the undo, which PluginCard runs on unmount. */
export function registerCardRefTarget(ids: readonly string[], controller: MountController): () => void {
  const keys = [...new Set(ids.filter((id) => id !== ""))];
  for (const key of keys) mounted.set(key, [...(mounted.get(key) ?? []), controller]);
  return () => {
    for (const key of keys) {
      const rest = (mounted.get(key) ?? []).filter((c) => c !== controller);
      if (rest.length) mounted.set(key, rest);
      else mounted.delete(key);
    }
  };
}

/**
 * The host for `<CardRefProvider>`: sends a reference to the mounted plugin card it names.
 * Two cards with the same id (an old turn and a new one both showing "btc") resolve to the
 * newest, because that is the one the sentence beside it was written about. `null` clears
 * every card, which is what a host does when the reader moves away.
 */
export const pluginCardRefHost: CardRefHost = {
  ref(ref: CardRef | null, event: CardRefEvent): CardRefResult {
    if (ref === null) {
      for (const list of mounted.values()) for (const controller of list) controller.ref(null, event);
      return { ok: true };
    }
    const list = mounted.get(ref.target);
    const controller = list?.[list.length - 1];
    if (!controller) return { ok: false, code: "ref_no_card", reason: `no card "${ref.target}" is on screen.` };
    return controller.ref(ref, event);
  },
};
