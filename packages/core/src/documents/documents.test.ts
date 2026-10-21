import { describe, expect, it } from "vitest";
import { applyEdits, hunksOf, outlineOf, searchBlocks, spanOf } from "./edit.js";
import { buildEml, buildMailto, emlFilename, MAILTO_SAFE_LENGTH } from "./email.js";
import { createMemoryDocumentStore } from "./store.js";
import { createDocumentTools } from "./tools.js";
import type { EmailCard } from "../cards/types.js";
import type { DocumentStore } from "./types.js";

const DOC = [
  "# Vendor review",
  "",
  "Two suppliers, scored against the March criteria.",
  "",
  "## Findings",
  "",
  "The cheaper option fails SSO. The cheaper option is not a saving.",
  "",
  "```",
  "renewal = 2027-03-01",
  "",
  "notice = 90d",
  "```",
].join("\n");

describe("outline", () => {
  it("gives a navigable map without the body", () => {
    const outline = outlineOf(DOC);
    expect(outline.map((o) => o.preview)).toEqual([
      "# Vendor review",
      "Two suppliers, scored against the March criteria.",
      "## Findings",
      "The cheaper option fails SSO. The cheaper option is not a saving.",
      "```",
    ]);
    expect(outline[0]!.level).toBe(1);
    expect(outline[2]!.level).toBe(2);
    // Prose is not a heading, and the fence is not prose.
    expect(outline[1]!.level).toBeUndefined();
    expect(outline[4]!.kind).toBe("fence");
  });

  it("reports size so the model can budget before asking for text", () => {
    for (const entry of outlineOf(DOC)) expect(entry.chars).toBeGreaterThan(0);
  });
});

describe("reading spans", () => {
  it("returns exactly the requested blocks", () => {
    expect(spanOf(DOC, 2)).toBe("## Findings");
    expect(spanOf(DOC, 0, 1)).toBe("# Vendor review\n\nTwo suppliers, scored against the March criteria.");
  });

  it("clamps rather than throwing on a range past the end", () => {
    expect(spanOf(DOC, 0, 99)).toBe(DOC);
    expect(spanOf("", 0)).toBe("");
  });

  it("finds blocks containing a phrase, case-insensitively", () => {
    expect(searchBlocks(DOC, "SSO").map((m) => m.block)).toEqual([3]);
    expect(searchBlocks(DOC, "findings").map((m) => m.block)).toEqual([2]);
    expect(searchBlocks(DOC, "")).toEqual([]);
  });
});

describe("applying edits", () => {
  it("replaces an anchored span and leaves the rest alone", () => {
    const out = applyEdits(DOC, [{ block: 2, find: "## Findings", replace: "## What we found" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("## What we found");
    expect(out.markdown).toContain("# Vendor review");
    expect(out.markdown).toContain("renewal = 2027-03-01");
  });

  // Refusing is the more important half. A first-match-wins fallback puts a
  // change somewhere nobody asked for and then presents it for approval as
  // though it were intended — the user says yes to a diff that reads fine.
  it("refuses an anchor that matches nothing, and says to re-read", () => {
    const out = applyEdits(DOC, [{ find: "## Conclusions", replace: "## Wrap-up" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("not-found");
    expect(out.message).toMatch(/re-read/i);
  });

  it("refuses an anchor that matches twice rather than picking one", () => {
    const out = applyEdits(DOC, [{ find: "The cheaper option", replace: "Supplier A" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("ambiguous");
    expect(out.message).toMatch(/appears 2 times/);
  });

  it("accepts the same anchor once a block narrows it to one occurrence", () => {
    // Same text, disambiguated by naming where it lives — which is what the
    // block index on a quote is for.
    const doc = "The cap is 12 months.\n\nElsewhere: The cap is 12 months.";
    const out = applyEdits(doc, [{ block: 1, find: "The cap is 12 months.", replace: "The cap is 24 months." }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toBe("The cap is 12 months.\n\nElsewhere: The cap is 24 months.");
  });

  it("names a block that does not exist instead of silently searching everywhere", () => {
    const out = applyEdits(DOC, [{ block: 99, find: "SSO", replace: "single sign-on" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("no-such-block");
  });

  // Offsets are resolved against the ORIGINAL text, so an earlier edit that
  // changes length must not move a later one.
  it("applies several edits without letting them shift each other", () => {
    const out = applyEdits(DOC, [
      { block: 0, find: "# Vendor review", replace: "# Supplier review — final, with a much longer title" },
      { block: 2, find: "## Findings", replace: "## Findings and risks" },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("# Supplier review — final, with a much longer title");
    expect(out.markdown).toContain("## Findings and risks");
  });

  it("refuses two edits that target overlapping text", () => {
    const doc = "alpha beta gamma";
    const out = applyEdits(doc, [
      { find: "alpha beta", replace: "A" },
      { find: "beta gamma", replace: "B" },
    ]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/overlapping/);
  });

  it("treats an empty replacement as a deletion", () => {
    const out = applyEdits(DOC, [{ block: 3, find: " The cheaper option is not a saving.", replace: "" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toContain("The cheaper option fails SSO.");
    expect(out.markdown).not.toContain("is not a saving");
  });

  // A block span stops at the blank line that ends it, so an anchor written to
  // straddle that boundary finds nothing. Worth pinning: the alternative — a
  // block-scoped search that quietly widens to the whole document — would make
  // the block argument decorative exactly when it is being used to disambiguate.
  it("does not let a block-scoped anchor reach past the end of its block", () => {
    const out = applyEdits(DOC, [{ block: 2, find: "## Findings\n\nThe cheaper", replace: "x" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("not-found");
  });

  it("rejects an edit with no anchor at all", () => {
    const out = applyEdits(DOC, [{ find: "", replace: "x" }]);
    expect(out.ok).toBe(false);
  });

  it("is a no-op for an empty edit list", () => {
    const out = applyEdits(DOC, []);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.markdown).toBe(DOC);
  });
});

describe("hunks", () => {
  it("gives one independently applicable hunk per edit", () => {
    const out = applyEdits(DOC, [
      { block: 0, find: "# Vendor review", replace: "# Supplier review" },
      { block: 2, find: "## Findings", replace: "## Findings and risks" },
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const hunks = hunksOf(out.applied);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ index: 0, block: 0, removed: ["# Vendor review"], added: ["# Supplier review"] });
    expect(hunks[1]!.block).toBe(2);
  });

  it("shows a deletion as removed lines with nothing added", () => {
    const out = applyEdits("keep\n\ndrop me", [{ block: 1, find: "drop me", replace: "" }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(hunksOf(out.applied)[0]!.added).toEqual([]);
  });
});

describe("DocumentStore", () => {
  it("mints revision 1 and bumps it on every write", async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: "one" });
    expect(doc.revision).toBe(1);
    const next = await store.update(doc.id, "two", 1);
    expect(next.revision).toBe(2);
    expect(next.markdown).toBe("two");
  });

  // The whole reason revisions exist: the user can change the document between
  // the model reading it and proposing an edit.
  it("refuses a write against a stale revision", async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: "one" });
    await store.update(doc.id, "two", 1);
    await expect(store.update(doc.id, "three", 1)).rejects.toThrow(/revision 2, not 1/);
  });

  it("keeps prior bodies so undo is a checkout, not a computed inverse", async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: "one" });
    await store.update(doc.id, "two", 1);
    await store.update(doc.id, "three", 2);
    expect((await store.history(doc.id)).map((h) => h.markdown)).toEqual(["two", "one"]);
  });

  it("reports a missing document rather than creating one", async () => {
    const store = createMemoryDocumentStore();
    await expect(store.update("nope", "x", 1)).rejects.toThrow(/No document nope/);
  });

  // Carried over by the spread, an undo's marker would make the next ordinary
  // edit look like part of the undo — and the undo after that would skip it.
  it("records an undo's origin on that write only", async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: "one" });
    await store.update(doc.id, "two", 1);
    const undone = await store.update(doc.id, "one", 2, { restoredFrom: 1 });
    expect(undone.restoredFrom).toBe(1);
    const edited = await store.update(doc.id, "three", 3);
    expect(edited.restoredFrom).toBeUndefined();
    expect((await store.history(doc.id))[0]!.restoredFrom).toBe(1);
  });
});

// Shared by the undo and edit suites: run a tool for its whole result, with a
// review handler standing in for the user.
const toolOf = (store: DocumentStore, name: string) => {
  const tool = createDocumentTools({ store }).find((t) => t.name === name);
  if (!tool?.execute) throw new Error(`no ${name}`);
  return tool;
};
type Outcome = { output: Record<string, unknown>; failure?: string; card?: { revision?: number } };
const call = async (
  store: DocumentStore,
  name: string,
  input: Record<string, unknown>,
  review?: (spec: unknown) => Promise<unknown>,
): Promise<Outcome> => {
  const ctx = { vars: {}, callId: "call_1", ...(review ? { requestCard: review } : {}) };
  return (await toolOf(store, name).execute!(input, ctx)) as Outcome;
};
const bodyOf = async (store: DocumentStore, id: string) => (await store.get(id))!.markdown;

// Each undo is a checkout that mints a new revision, which used to mean the
// second undo restored the body the first one had just replaced: history[0] is
// always "what was here before the last write", and after an undo that is the
// undone text. Two undos left the document where it started.
describe("undoDocument", () => {
  const threeVersions = async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: "one" });
    await store.update(doc.id, "two", 1);
    await store.update(doc.id, "three", 2);
    return { store, id: doc.id };
  };

  it("walks back one version per call instead of ping-ponging", async () => {
    const { store, id } = await threeVersions();

    const first = await call(store, "undoDocument", { docId: id });
    expect(await bodyOf(store, id)).toBe("two");
    expect(first.output).toMatchObject({ revision: 4, restoredFrom: 2, canUndoFurther: true });

    const second = await call(store, "undoDocument", { docId: id });
    expect(await bodyOf(store, id)).toBe("one");
    expect(second.output).toMatchObject({ revision: 5, restoredFrom: 1, canUndoFurther: false });

    // Past the start is a refusal, not a wrap-around.
    const third = await call(store, "undoDocument", { docId: id });
    expect(third.failure).toBe("not-found");
    expect(await bodyOf(store, id)).toBe("one");
  });

  // Ordinary linear undo: editing after an undo abandons what was undone, so
  // walking back from the new edit never resurfaces it.
  it("does not resurface an undone version after a fresh edit", async () => {
    const { store, id } = await threeVersions();
    await call(store, "undoDocument", { docId: id }); // v4 = "two"
    await store.update(id, "four", 4); // v5

    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const out = await call(store, "undoDocument", { docId: id });
      if (out.failure) break;
      seen.push(await bodyOf(store, id));
    }
    expect(seen).toEqual(["two", "one"]);
  });

  it("jumps to an explicit revision, and steps back from there", async () => {
    const { store, id } = await threeVersions();

    const jump = await call(store, "undoDocument", { docId: id, toRevision: 1 });
    expect(await bodyOf(store, id)).toBe("one");
    expect(jump.output).toMatchObject({ revision: 4, restoredFrom: 1, canUndoFurther: false });
    expect((await call(store, "undoDocument", { docId: id })).failure).toBe("not-found");
  });

  it("refuses a revision it does not keep, and says which it does", async () => {
    const { store, id } = await threeVersions();
    const out = await call(store, "undoDocument", { docId: id, toRevision: 9 });
    expect(out.failure).toBe("not-found");
    expect(out.output["available"]).toEqual([2, 1]);
    expect(await bodyOf(store, id)).toBe("three");
  });
});

// The review is an await on a human, and the document can move while it is
// open. The edit used to be applied to the body read BEFORE that await, with
// the store's revision check as the only guard — which threw, so the model saw
// a failed tool instead of a refusal it could retry.
describe("editDocument across the approval await", () => {
  const BODY = "Alpha one.\n\nBeta two.";
  const seed = async () => {
    const store = createMemoryDocumentStore();
    const doc = await store.create({ title: "Plan", markdown: BODY });
    return { store, id: doc.id };
  };
  const propose = { revision: 1, edits: [{ find: "Alpha", replace: "ALPHA" }, { find: "Beta", replace: "BETA" }] };

  it("writes only the accepted hunks", async () => {
    const { store, id } = await seed();
    const out = await call(store, "editDocument", { docId: id, ...propose }, async () => ({ accepted: [1] }));
    expect(out.failure).toBeUndefined();
    expect(out.output).toMatchObject({ revision: 2, applied: 1, rejected: 1 });
    expect(await bodyOf(store, id)).toBe("Alpha one.\n\nBETA two.");
  });

  it("refuses, without throwing, when the document moves during review", async () => {
    const { store, id } = await seed();
    const out = await call(store, "editDocument", { docId: id, ...propose }, async () => {
      // The user accepts a different change in another tab before this one.
      await store.update(id, `${BODY}\n\nGamma three.`, 1);
      return { accepted: [0, 1] };
    });

    expect(out.failure).toBe("invalid-input");
    expect(out.output).toMatchObject({ reason: "stale-revision", revision: 2 });
    expect(String(out.output["error"])).toMatch(/Re-read/);
    // The approved diff was against revision 1; it does not transfer.
    expect(await bodyOf(store, id)).toBe(`${BODY}\n\nGamma three.`);
  });

  // The narrower race: the document moves between the re-read and the write.
  // The store's check catches it; the tool turns that into the same refusal.
  it("turns the store's own revision check into the same refusal", async () => {
    const { store: inner, id } = await seed();
    const racing: DocumentStore = {
      ...inner,
      async update(docId, markdown, expected, opts) {
        await inner.update(docId, "Someone else's body.", expected);
        return inner.update(docId, markdown, expected, opts);
      },
    };

    const out = await call(racing, "editDocument", { docId: id, ...propose }, async () => ({ accepted: [0] }));
    expect(out.failure).toBe("invalid-input");
    expect(out.output).toMatchObject({ reason: "stale-revision", revision: 2 });
    expect(await bodyOf(inner, id)).toBe("Someone else's body.");
  });

  it("still throws a store failure that is not a conflict", async () => {
    const { store: inner, id } = await seed();
    const broken: DocumentStore = {
      ...inner,
      async update() {
        throw new Error("disk full");
      },
    };
    await expect(
      call(broken, "editDocument", { docId: id, ...propose }, async () => ({ accepted: [0] })),
    ).rejects.toThrow(/disk full/);
  });

  it("names the stale-revision reason when the proposal itself is behind", async () => {
    const { store, id } = await seed();
    await store.update(id, BODY.replace("one", "uno"), 1);
    const out = await call(store, "editDocument", { docId: id, ...propose }, async () => ({ accepted: [0] }));
    expect(out.output).toMatchObject({ reason: "stale-revision", revision: 2 });
  });
});

// A docId only ever reaches the model inside a tool result, which lives in the
// transcript — and the transcript is trimmed by compaction and absent from a
// new thread. Without an index the store keeps the document and the agent
// cannot name it, which is the "outlives its thread" claim failing in the one
// place it was made for.
describe("listDocuments", () => {
  const toolNamed = (name: string, opts: Parameters<typeof createDocumentTools>[0]) => {
    const tool = createDocumentTools(opts).find((t) => t.name === name);
    if (!tool) throw new Error(`no ${name}`);
    return tool;
  };
  const run = async (tool: ReturnType<typeof toolNamed>, input: Record<string, unknown>) => {
    // `execute` is optional on ToolDefinition — an absent one means the host
    // runs the tool. These have theirs, and asserting it is part of the test.
    if (!tool.execute) throw new Error(`${tool.name} has no execute`);
    const result = (await tool.execute(input, {} as never)) as { output: Record<string, unknown> };
    return result.output;
  };

  it("names every document, newest first, without any of their bodies", async () => {
    const store = createMemoryDocumentStore();
    await store.create({ title: "Older", markdown: "# A\n\nbody of the older one" });
    await store.create({ title: "Newer", markdown: "# B\n\nbody" });

    const out = await run(toolNamed("listDocuments", { store }), {});
    const docs = out["documents"] as { title: string; blocks: number }[];
    expect(docs.map((d) => d.title)).toEqual(["Newer", "Older"]);
    expect(docs[0]!.blocks).toBe(2);
    expect(JSON.stringify(out)).not.toContain("body of the older one");
  });

  it("filters on the title, case-insensitively", async () => {
    const store = createMemoryDocumentStore();
    await store.create({ title: "Vendor review", markdown: "x" });
    await store.create({ title: "Launch note", markdown: "y" });

    const out = await run(toolNamed("listDocuments", { store }), { query: "VENDOR" });
    expect((out["documents"] as unknown[]).length).toBe(1);
  });

  // Reported, not silent — for the same reason a truncated span is. A model
  // that believes it has seen every document tells the user theirs is gone.
  it("says so when it has more documents than it listed", async () => {
    const store = createMemoryDocumentStore();
    for (let i = 0; i < 5; i += 1) await store.create({ title: `Doc ${i}`, markdown: "x" });

    const out = await run(toolNamed("listDocuments", { store, maxListed: 2 }), {});
    expect((out["documents"] as unknown[]).length).toBe(2);
    expect(out["total"]).toBe(5);
    expect(out["truncated"]).toBe(true);
  });

  // The playground grants tiers by name for this reason; the order here is not
  // a contract, but the SET is, and a tool quietly disappearing from it would
  // otherwise only show up as an agent that cannot find anything.
  it("ships the whole document loop", () => {
    const names = createDocumentTools({ store: createMemoryDocumentStore() }).map((t) => t.name).sort();
    expect(names).toEqual(["createDocument", "editDocument", "listDocuments", "readDocument", "undoDocument"]);
  });
});

describe("email exits", () => {
  const email: EmailCard = {
    kind: "email",
    to: ["counsel@example.com"],
    cc: ["ops@example.com"],
    subject: "Vendor review — redline",
    body: "Hi,\n\nThe redline is attached.\n\nThanks",
  };

  it("builds a mailto with recipients, subject and body", () => {
    const { href } = buildMailto(email);
    expect(href.startsWith("mailto:counsel%40example.com")).toBe(true);
    expect(href).toContain("cc=ops%40example.com");
    expect(href).toContain("subject=Vendor%20review");
  });

  // Clients disagree about a bare %0A and all of them accept %0D%0A.
  it("encodes newlines as CRLF", () => {
    expect(buildMailto(email).href).toContain("%0D%0A");
  });

  // The failure this flags is silent in every mail client: the body is simply
  // cut off, and the user sends a letter missing its end without being told.
  it("flags a body long enough that a client may truncate it", () => {
    const long = buildMailto({ ...email, body: "x".repeat(MAILTO_SAFE_LENGTH + 100) });
    expect(long.mayTruncate).toBe(true);
    expect(buildMailto(email).mayTruncate).toBe(false);
  });

  it("builds an .eml with CRLF line endings and the headers a client needs", () => {
    const eml = buildEml(email);
    expect(eml).toContain("To: counsel@example.com");
    expect(eml).toContain("Cc: ops@example.com");
    expect(eml).toContain("MIME-Version: 1.0");
    expect(eml).toContain("The redline is attached.");
    expect(eml.split("\n").every((l) => l.endsWith("\r") || !l.includes("\r"))).toBe(true);
    expect(eml).not.toMatch(/(?<!\r)\n/);
  });

  // A draft has not been sent, so stamping it with a send time would be a
  // small lie that some clients then display as fact.
  it("leaves Date and Message-ID to the client that actually sends it", () => {
    const eml = buildEml(email);
    expect(eml).not.toContain("Date:");
    expect(eml).not.toContain("Message-ID:");
  });

  it("encodes a non-ASCII subject as an RFC 2047 word", () => {
    const eml = buildEml({ ...email, subject: "報價單" });
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  // 998 octets is a MUST, not a style note: past it a strict parser is entitled
  // to refuse the message. One long unwrapped paragraph reaches it easily, and
  // one long unwrapped paragraph is what a model writes by default.
  it("carries a paragraph past the 998-octet line limit instead of emitting an illegal line", () => {
    const eml = buildEml({ ...email, body: `Dear counsel, ${"the clause is unenforceable. ".repeat(80)}` });
    expect(eml).toContain("Content-Transfer-Encoding: quoted-printable");
    for (const line of eml.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
  });

  it("leaves a short body as plain 8bit rather than encoding what does not need it", () => {
    const eml = buildEml(email);
    expect(eml).toContain("Content-Transfer-Encoding: 8bit");
    expect(eml).toContain("The redline is attached.");
  });

  // Soft breaks are what make quoted-printable lossless: the receiver rejoins
  // them, so the letter that arrives is the letter that was written.
  it("uses soft breaks that decode back to the original text", () => {
    const body = `Dear counsel, ${"the clause is unenforceable. ".repeat(80)}`;
    const eml = buildEml({ ...email, body });
    const encoded = eml.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    const decoded = encoded
      .replace(/=\r\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    expect(decoded).toBe(body);
  });

  it("splits a long non-ASCII subject into encoded-words that each fit in 75 chars", () => {
    const eml = buildEml({ ...email, subject: "報價單與合約條款的完整檢視，含續約通知期與資安要求".repeat(3) });
    const words = eml.match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? [];
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    // Every word decodes on its own — a split through a UTF-8 sequence would
    // put a replacement character in the middle of the subject.
    const joined = words.map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8")).join("");
    expect(joined).not.toContain("�");
  });

  it("folds a long recipient list at the commas, with continuation lines indented", () => {
    const many = Array.from({ length: 8 }, (_, i) => `person${i}@a-fairly-long-domain.example.com`);
    const eml = buildEml({ ...email, to: many });
    const header = eml.split("\r\n").slice(0, eml.split("\r\n").findIndex((l) => l.startsWith("Cc:")));
    expect(header.length).toBeGreaterThan(1);
    for (const line of header.slice(1)) expect(line.startsWith(" ")).toBe(true);
    // Unfolding restores the list exactly.
    expect(header.join("").replace(/\s+/g, " ")).toBe(`To: ${many.join(", ")}`);
  });

  it("makes a filesystem-safe filename from the subject", () => {
    // The em dash is not filename-safe, so it goes; the spaces around it
    // collapse with it rather than leaving a double hyphen behind.
    expect(emlFilename(email)).toBe("Vendor-review-redline.eml");
    expect(emlFilename({ ...email, subject: "" })).toBe("draft.eml");
    expect(emlFilename({ ...email, subject: "../../etc/passwd" })).not.toContain("/");
  });
});
