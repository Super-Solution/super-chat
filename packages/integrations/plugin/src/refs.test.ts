import { describe, expect, it, vi } from "vitest";
import type { CardRef, CardRefResult } from "@supersolutions/super-chat-core";
import type { CardMountHandle } from "@supersolutions/super-protocol";
import { MountController, pluginCardRefHost } from "./index.js";
import { registerCardRefTarget } from "./refs.js";

const ctx = { theme: "light" as const };
const container = {} as HTMLElement;
const ref = (target: string, params: Record<string, string[]> = {}): CardRef => ({ target, params });

type RefFn = (ref: CardRef | null, event: "enter" | "leave" | "activate") => CardRefResult;
const mounted = (onRef?: RefFn): { controller: MountController; ref: ReturnType<typeof vi.fn> } => {
  const fn = vi.fn<RefFn>(onRef ?? (() => ({ ok: true })));
  const handle: CardMountHandle & { ref?: RefFn } = { update: vi.fn(), destroy: vi.fn(), ...(onRef === null ? {} : { ref: fn }) };
  const controller = new MountController(() => handle);
  controller.attach(container, {}, ctx);
  return { controller, ref: fn };
};

describe("MountController.ref", () => {
  it("forwards a reference to the mounted card and returns its answer", () => {
    const { controller, ref: card } = mounted(() => ({ ok: true, label: "Support at 100" }));
    expect(controller.ref(ref("btc", { key: ["support"] }), "activate")).toEqual({ ok: true, label: "Support at 100" });
    expect(card).toHaveBeenCalledWith(ref("btc", { key: ["support"] }), "activate");
  });

  it("answers ref_unsupported for a card without ref(), and ref_no_card before it is mounted", () => {
    const bare = new MountController(() => ({ update: vi.fn(), destroy: vi.fn() }));
    expect(bare.ref(ref("a"), "enter")).toMatchObject({ ok: false, code: "ref_no_card" });
    bare.attach(container, {}, ctx);
    expect(bare.ref(ref("a"), "enter")).toMatchObject({ ok: false, code: "ref_unsupported" });
  });

  it("contains a card that throws and reports it", () => {
    const onError = vi.fn();
    const boom = new MountController(
      () => ({ update: vi.fn(), destroy: vi.fn(), ref: () => { throw new Error("boom"); } }) as CardMountHandle,
      onError,
    );
    boom.attach(container, {}, ctx);
    expect(boom.ref(ref("a"), "enter")).toMatchObject({ ok: false, code: "ref_failed" });
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("pluginCardRefHost", () => {
  it("finds the card a reference names, and says so when there is none", () => {
    const a = mounted();
    const undo = registerCardRefTarget(["btc"], a.controller);
    expect(pluginCardRefHost.ref(ref("btc"), "enter")).toEqual({ ok: true });
    expect(a.ref).toHaveBeenCalledOnce();
    expect(pluginCardRefHost.ref(ref("eth"), "enter")).toMatchObject({ ok: false, code: "ref_no_card" });
    undo();
    expect(pluginCardRefHost.ref(ref("btc"), "enter")).toMatchObject({ ok: false, code: "ref_no_card" });
  });

  it("answers from the newest card when two share an id, and falls back when it goes", () => {
    const older = mounted();
    const newer = mounted();
    const undoOlder = registerCardRefTarget(["btc", "card-1"], older.controller);
    const undoNewer = registerCardRefTarget(["btc", "card-2"], newer.controller);
    pluginCardRefHost.ref(ref("btc"), "enter");
    expect(newer.ref).toHaveBeenCalledOnce();
    expect(older.ref).not.toHaveBeenCalled();
    expect(pluginCardRefHost.ref(ref("card-1"), "enter")).toEqual({ ok: true });
    undoNewer();
    pluginCardRefHost.ref(ref("btc"), "leave");
    expect(older.ref).toHaveBeenLastCalledWith(ref("btc"), "leave");
    undoOlder();
  });

  it("clears every card for null", () => {
    const a = mounted();
    const b = mounted();
    const undo = [registerCardRefTarget(["a"], a.controller), registerCardRefTarget(["b"], b.controller)];
    expect(pluginCardRefHost.ref(null, "leave")).toEqual({ ok: true });
    expect(a.ref).toHaveBeenCalledWith(null, "leave");
    expect(b.ref).toHaveBeenCalledWith(null, "leave");
    undo.forEach((u) => u());
  });
});
