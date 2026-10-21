import { describe, expect, it } from "vitest";
import { createMemoryDocumentStore } from "../documents/store.js";
import {
  QUOTES_METADATA_KEY,
  checkQuoteDrift,
  formatQuotes,
  quoteDrift,
  quotesOf,
  withQuotes,
  type DocumentQuoteRef,
} from "./quotes.js";

const quote = (over: Partial<DocumentQuoteRef> = {}): DocumentQuoteRef => ({
  docId: "doc_1",
  title: "Q3 plan",
  revision: 2,
  blocks: [1, 1],
  start: 10,
  end: 30,
  text: "The **liability** cap is 12 months.",
  ...over,
});

describe("document quotes", () => {
  it("carries the SOURCE markdown, not what the screen rendered", () => {
    // Quoting rendered text would hand the model "liability" where the
    // document says "**liability**" — and the same span has to work as an edit
    // anchor later, where that difference decides whether a find matches.
    const out = formatQuotes([quote()]);
    expect(out).toContain("**liability**");
  });

  it("names the document, revision and block range", () => {
    const out = formatQuotes([quote({ blocks: [2, 4] })]);
    expect(out).toContain('"Q3 plan"');
    expect(out).toContain("doc_1 v2");
    expect(out).toContain("blocks 2–4");
  });

  it("says 'block' rather than a range when the quote is one block", () => {
    expect(formatQuotes([quote({ blocks: [3, 3] })])).toContain("block 3");
  });

  // A quote is arbitrary document text, so it can contain a fence of its own.
  // Truncating or escaping it would corrupt the very thing being quoted.
  it("grows the wrapper past any fence inside the quoted text", () => {
    const out = formatQuotes([quote({ text: "before\n```js\ncode\n```\nafter" })]);
    expect(out).toContain("````markdown");
    expect(out).toContain("```js");
    expect(out.trimEnd().endsWith("````")).toBe(true);
  });

  it("puts the quote before the user's own words", () => {
    const out = withQuotes("tighten this", [quote()]);
    expect(out.indexOf("Quoted from")).toBeLessThan(out.indexOf("tighten this"));
  });

  it("is a no-op with no quotes", () => {
    expect(formatQuotes([])).toBe("");
    expect(withQuotes("hello", [])).toBe("hello");
  });

  it("stands alone when the user quotes without typing anything", () => {
    const out = withQuotes("   ", [quote()]);
    expect(out).toContain("Quoted from");
    expect(out.trimEnd().endsWith("```")).toBe(true);
  });

  it("reads back off message metadata, and tolerates a message with none", () => {
    const q = quote();
    expect(quotesOf({ [QUOTES_METADATA_KEY]: [q] })).toEqual([q]);
    expect(quotesOf(undefined)).toEqual([]);
    expect(quotesOf({})).toEqual([]);
    // A corrupted entry degrades to "no quotes", never a crash — same rule the
    // stores follow.
    expect(quotesOf({ [QUOTES_METADATA_KEY]: "nonsense" })).toEqual([]);
  });
});

// The revision on a quote existed so drift could be detected; until this,
// nothing compared it. A quote taken from an old card reached the model
// looking exactly like a current one.
describe("quote drift", () => {
  const BODY = "# Q3\n\nThe **liability** cap is 12 months.";

  it("is silent while the document is still at the quoted revision", () => {
    expect(quoteDrift(quote(), { revision: 2, markdown: BODY })).toBeUndefined();
  });

  it("says the document moved, and whether the quoted text survived", () => {
    expect(quoteDrift(quote(), { revision: 4, markdown: `${BODY}\n\nAppendix.` })).toEqual({
      status: "moved",
      revision: 4,
      intact: true,
    });
    expect(quoteDrift(quote(), { revision: 4, markdown: "# Q3\n\nThe cap is 24 months." })).toEqual({
      status: "moved",
      revision: 4,
      intact: false,
    });
  });

  it("says the document is gone rather than saying nothing", () => {
    expect(quoteDrift(quote(), undefined)).toEqual({ status: "removed" });
  });

  it("stamps a stale quote from the store and leaves a current one bare", async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ id: "doc_1", title: "Q3 plan", markdown: BODY });
    const current = quote({ revision: doc.revision });
    const otherDoc = await store.create({ id: "doc_2", title: "Notes", markdown: "x" });
    await store.update(otherDoc.id, "y", 1);
    const stale = quote({ docId: "doc_2", revision: 1, text: "x" });

    const [a, b, c] = await checkQuoteDrift([current, stale, quote({ docId: "doc_gone" })], store);
    expect(a).toEqual(current);
    expect(b?.drift).toEqual({ status: "moved", revision: 2, intact: false });
    expect(c?.drift).toEqual({ status: "removed" });
  });

  // The annotation must never cost the user their message.
  it("leaves a quote unstamped when the lookup throws", async () => {
    const failing = { get: () => Promise.reject(new Error("offline")) };
    const [q] = await checkQuoteDrift([quote()], failing);
    expect(q?.drift).toBeUndefined();
  });

  it("tells the model, between the label and the text", () => {
    const moved = formatQuotes([quote({ drift: { status: "moved", revision: 5, intact: false } })]);
    expect(moved).toContain("doc_1 v2");
    expect(moved).toContain("now at v5");
    expect(moved).toContain("no longer in it");
    expect(moved.indexOf("now at v5")).toBeLessThan(moved.indexOf("**liability**"));

    expect(formatQuotes([quote({ drift: { status: "moved", revision: 5, intact: true } })])).toContain(
      "still in it",
    );
    expect(formatQuotes([quote({ drift: { status: "removed" } })])).toContain("no longer exists");
    expect(formatQuotes([quote()])).not.toContain("Note:");
  });
});
