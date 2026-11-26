import { describe, expect, it } from "vitest";
import type { CardRef, CardRefHost } from "@supersolutions/super-chat-core";
import { builtinCardRefHost, chainCardRefHosts } from "./card-ref-targets.js";
import { citedIndex } from "./cards/General.js";

const ref = (target: string): CardRef => ({ target, params: {} });

describe("citedIndex", () => {
  const items = [{ id: "photo" }, { id: "2" }, {}];
  it("finds a source by its id, else by its 1-based number", () => {
    expect(citedIndex(items, "photo")).toBe(0);
    expect(citedIndex(items, "3")).toBe(2);
  });
  it("lets an id win over a position, so a source called 2 is found before the second one", () => {
    expect(citedIndex(items, "2")).toBe(1);
  });
  it("finds nothing for what is not there, rather than the nearest thing", () => {
    expect(citedIndex(items, "4")).toBe(-1);
    expect(citedIndex(items, "0")).toBe(-1);
    expect(citedIndex(items, "01")).toBe(-1);
    expect(citedIndex(items, "nope")).toBe(-1);
  });
});

describe("card ref hosts", () => {
  it("says there is no card, with the code a host chains on, when nothing is mounted", () => {
    expect(builtinCardRefHost.ref(ref("nobody"), "enter")).toMatchObject({ ok: false, code: "ref_no_card" });
    expect(builtinCardRefHost.ref(null, "leave")).toEqual({ ok: true });
  });

  it("asks the next host only when the first has no such card", () => {
    const seen: string[] = [];
    const host = (name: string, has: string[]): CardRefHost => ({
      ref(r) {
        seen.push(name);
        if (r && has.includes(r.target)) return { ok: true, label: name };
        return { ok: false, code: "ref_no_card", reason: "none" };
      },
    });
    const chained = chainCardRefHosts(host("a", ["x"]), host("b", ["y"]));
    expect(chained.ref(ref("x"), "enter")).toEqual({ ok: true, label: "a" });
    expect(chained.ref(ref("y"), "enter")).toEqual({ ok: true, label: "b" });
    expect(seen).toEqual(["a", "a", "b"]);
    expect(chained.ref(ref("z"), "enter")).toMatchObject({ ok: false, code: "ref_no_card" });
  });

  it("does not ask on when the card answered with a refusal of its own", () => {
    const refusing: CardRefHost = { ref: () => ({ ok: false, code: "ref_no_source", reason: "no such source" }) };
    const never: CardRefHost = { ref: () => { throw new Error("asked"); } };
    expect(chainCardRefHosts(refusing, never).ref(ref("x"), "enter")).toMatchObject({ code: "ref_no_source" });
  });
});
