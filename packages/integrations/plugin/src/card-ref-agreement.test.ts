// Core keeps its own copy of the card reference parser (core has no dependencies). This
// package depends on both, so it holds the copy to the published protocol: same limits,
// same results, same messages.

import { describe, expect, it } from "vitest";
import * as core from "@supersolutions/super-chat-core";
import * as protocol from "@supersolutions/super-protocol";

const repeat = (c: string, n: number) => c.repeat(n);
const HREFS: unknown[] = [
  "ref:btc", "ref:btc?key=support", "ref:btc?key=a&key=b", "ref:btc?key=a%2Cb", "ref:sales?x=2026-03..2026-05&y=10..20&series=eu&series=us",
  "ref:a.b_c:d-e?k=1", "ref:A1", "ref:1a", "ref:btc?from=1&to=2&low=1.5&high=2.5", "ref:btc?key=%E6%94%AF%E6%92%90", "ref:btc?key=%F0%9F%98%80",
  "ref:btc?key=%20", "ref:btc?key=100%25", "ref:btc?constructor=1", "ref:btc?toString=1",
  `ref:btc?key=${repeat("a", 256)}`, `ref:btc?key=${repeat("a", 257)}`, `ref:${repeat("t", 128)}`, `ref:${repeat("t", 129)}`, `ref:${repeat("t", 510)}`,
  `ref:t?${Array.from({ length: 33 }, () => "k=v").join("&")}`, `ref:t?${Array.from({ length: 17 }, (_, i) => `p${i}=1`).join("&")}`, `ref:t?${repeat("k", 33)}=1`,
  "ref:", "ref:?k=v", "ref:btc?", "ref:btc?k", "ref:btc?k=", "ref:btc?=v", "ref:btc?k=v&", "ref:btc?K=v", "ref:btc?k=a b", "ref:btc?k=a+b", "ref:btc?k=%",
  "ref:btc?k=%GG", "ref:btc?k=%C0%AF", "ref:btc?k=%ED%A0%80", "ref:btc?k=%00", "ref:btc#frag", "ref:bt c", "ref:-btc", "REF:btc", "javascript:alert(1)",
  " ref:btc", "", "ref", "ref:é", null, undefined, 5, {}, [], true,
];

describe("core's card reference parser", () => {
  it("has the published protocol's limits and scheme", () => {
    expect(core.CARD_REF_LIMITS).toEqual(protocol.CARD_REF_LIMITS);
    expect(core.CARD_REF_SCHEME).toBe(protocol.CARD_REF_SCHEME);
  });
  it.each(HREFS.map((href) => [String(href).slice(0, 60), href]))("reads %j as the protocol does", (_label, href) => {
    expect(core.parseCardRef(href as string)).toEqual(protocol.parseCardRef(href as string));
  });
});
