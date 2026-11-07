import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../context/builder.js";
import { userMessage } from "../content/parts.js";
import { createKeywordRetriever, createRetrievalSource } from "./retrieval.js";

const DOCS = [
  {
    id: "billing",
    title: "Billing policy",
    source: "handbook",
    text: "Invoices are issued on the first business day of the month.\n\nRefunds are processed within five business days of approval.",
  },
  {
    id: "onboarding",
    title: "Onboarding guide",
    source: "handbook",
    text: "New accounts start with a fourteen day trial period.\n\nTrial accounts can invite up to three collaborators.",
  },
];

describe("createKeywordRetriever", () => {
  it("scores paragraph chunks by lexical overlap and orders by score", async () => {
    const retriever = createKeywordRetriever(DOCS);
    const hits = await retriever.retrieve("when are refunds processed after approval");
    expect(hits[0]).toMatchObject({ id: "billing#1", title: "Billing policy" });
    expect(hits[0]!.text).toContain("Refunds are processed");
  });

  it("returns nothing for a query with no overlap", async () => {
    const retriever = createKeywordRetriever(DOCS);
    expect(await retriever.retrieve("quantum entanglement")).toEqual([]);
  });
});

describe("createRetrievalSource", () => {
  it("injects numbered evidence with a citation instruction, recorded in the trace", async () => {
    const builder = new ContextBuilder({
      identity: "Test agent.",
      contextWindow: 32_000,
      sources: [createRetrievalSource(createKeywordRetriever(DOCS), { limit: 2 })],
    });
    const context = await builder.build({
      messages: [userMessage("when are refunds processed after approval?")],
      vars: {},
    });

    expect(context.system).toContain("[1] Billing policy (handbook)");
    expect(context.system).toContain("Refunds are processed");
    expect(context.system).toContain("citations");
    expect(context.trace.entries.some((e) => e.id === "retrieval" && e.status === "included")).toBe(true);
  });

  it("skips short queries entirely — a greeting is not a search", async () => {
    let called = 0;
    const source = createRetrievalSource({
      retrieve: async () => {
        called += 1;
        return [];
      },
    });
    const builder = new ContextBuilder({ identity: "T.", contextWindow: 32_000, sources: [source] });
    await builder.build({ messages: [userMessage("hi")], vars: {} });
    expect(called).toBe(0);
  });
});
