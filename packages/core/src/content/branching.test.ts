import { describe, expect, it } from "vitest";
import type { Message } from "./types.js";
import { childrenOf, latestLeaf, linkLinear, pathTo, siblingsOf } from "./branching.js";

const m = (id: string, parentId: string | null, role: Message["role"] = "user"): Message => ({
  id,
  role,
  parts: [{ type: "text", text: id }],
  parentId,
});

// A tree with a fork at u1:
//   u1 ── a1 ── u2 ── a2      (branch 1)
//    └─── a1b ── u2b          (branch 2, from regenerating a1)
const TREE = [m("u1", null), m("a1", "u1", "assistant"), m("u2", "a1"), m("a2", "u2", "assistant"), m("a1b", "u1", "assistant"), m("u2b", "a1b")];

describe("pathTo", () => {
  it("walks root-first from the head", () => {
    expect(pathTo(TREE, "a2").map((x) => x.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(pathTo(TREE, "u2b").map((x) => x.id)).toEqual(["u1", "a1b", "u2b"]);
  });

  it("handles unknown heads and cycles without hanging", () => {
    expect(pathTo(TREE, "nope")).toEqual([]);
    expect(pathTo(TREE, null)).toEqual([]);
    const cyclic = [m("a", "b"), m("b", "a")];
    expect(pathTo(cyclic, "a").length).toBeLessThanOrEqual(2);
  });
});

describe("siblings and leaves", () => {
  it("finds siblings sharing a parent, in insertion order", () => {
    expect(siblingsOf(TREE, "a1").map((x) => x.id)).toEqual(["a1", "a1b"]);
    expect(siblingsOf(TREE, "u1").map((x) => x.id)).toEqual(["u1"]);
  });

  it("latestLeaf follows the newest child chain", () => {
    expect(latestLeaf(TREE, "a1")).toBe("a2");
    expect(latestLeaf(TREE, "a1b")).toBe("u2b");
    expect(latestLeaf(TREE, "a2")).toBe("a2");
  });

  it("childrenOf(null) lists roots", () => {
    expect(childrenOf(TREE, null).map((x) => x.id)).toEqual(["u1"]);
  });
});

describe("linkLinear", () => {
  it("chains a plain list and leaves an existing tree untouched", () => {
    const plain: Message[] = [
      { id: "x", role: "user", parts: [] },
      { id: "y", role: "assistant", parts: [] },
    ];
    const linked = linkLinear(plain);
    expect(linked.map((x) => x.parentId)).toEqual([null, "x"]);
    expect(linkLinear(TREE)).toEqual(TREE);
  });
});
