import { describe, expect, it } from "vitest";
import { ContextBuilder } from "./builder.js";
import { compactHistory, safeCutIndex, trimHistory } from "./compaction.js";
import { SkillRegistry } from "../skills/registry.js";
import { createBudget } from "../tokens/budget.js";
import { withCard } from "../cards/types.js";
import type { Message } from "../content/types.js";
import type { Skill } from "../skills/types.js";

const user = (text: string, id = `u${Math.random()}`): Message => ({ id, role: "user", parts: [{ type: "text", text }] });
const asst = (text: string, id = `a${Math.random()}`): Message => ({ id, role: "assistant", parts: [{ type: "text", text }] });

const skills: Skill[] = [
  { id: "safety", name: "Safety rules", description: "Always on", mode: "always", body: "Never move funds without approval." },
  {
    id: "trading",
    name: "Trading playbook",
    description: "Trading",
    mode: "matched",
    aliases: ["swap", "trade", "perp"],
    body: "Check the route before swapping.",
    tools: ["checkRoute", "swap"],
  },
  { id: "deep", name: "Deep research", description: "Long research runs", mode: "manual", body: "Plan, then gather." },
];

describe("ContextBuilder", () => {
  it("always includes always-mode skills and omits unmatched matched ones", async () => {
    const builder = new ContextBuilder({ identity: "You are a wallet agent.", skills: new SkillRegistry(skills) });
    const built = await builder.build({ messages: [user("hello there")] });

    expect(built.system).toContain("Never move funds without approval.");
    expect(built.system).not.toContain("Check the route before swapping.");
  });

  it("injects a matched skill and unlocks its tools", async () => {
    const builder = new ContextBuilder({ skills: new SkillRegistry(skills) });
    const built = await builder.build({ messages: [user("can you swap 10 SUI for USDC")] });

    expect(built.system).toContain("Check the route before swapping.");
    expect(built.toolNames).toEqual(expect.arrayContaining(["checkRoute", "swap"]));
  });

  it("lists manual skills as an index rather than injecting their bodies", async () => {
    const builder = new ContextBuilder({ skills: new SkillRegistry(skills) });
    const built = await builder.build({ messages: [user("hi")] });

    expect(built.system).toContain("deep: Long research runs");
    expect(built.system).not.toContain("Plan, then gather.");
  });

  it("records every decision in the trace", async () => {
    const builder = new ContextBuilder({ identity: "id", skills: new SkillRegistry(skills) });
    const built = await builder.build({ messages: [user("swap something")] });

    const ids = built.trace.entries.map((e) => e.id);
    expect(ids).toContain("skills");
    expect(ids).toContain("history");
    expect(built.trace.totals.total).toBeGreaterThan(0);
  });

  it("drops a matched skill that does not fit, and revokes the tools it unlocked", async () => {
    // A skill whose instructions were dropped must not leave its tools exposed —
    // the model would see tools it has no guidance for.
    const fat: Skill = {
      id: "fat",
      name: "Fat skill",
      description: "huge",
      mode: "matched",
      aliases: ["swap"],
      body: "x".repeat(200_000),
      tools: ["dangerous"],
    };
    const builder = new ContextBuilder({
      skills: new SkillRegistry([fat]),
      budget: createBudget(8_000),
    });
    const built = await builder.build({ messages: [user("swap now")] });

    expect(built.toolNames).not.toContain("dangerous");
    expect(built.trace.entries.some((e) => e.id === "skill:fat" && e.status === "dropped")).toBe(true);
  });

  it("strips card payloads from history so they are not re-billed", async () => {
    const heavy = withCard({ summary: "3 pools" }, { kind: "table", columns: [{ key: "a", label: "A" }], rows: [] });
    const messages: Message[] = [
      user("find pools"),
      { id: "t1", role: "tool", parts: [{ type: "tool-result", callId: "c1", name: "findPools", output: heavy }] },
    ];
    const builder = new ContextBuilder({});
    const built = await builder.build({ messages });

    const out = built.messages.at(-1)!.parts[0] as { output: Record<string, unknown> };
    expect(out.output["summary"]).toBe("3 pools");
    expect(out.output["$card"]).toBeUndefined();
    expect(out.output["rendered"]).toBe("[table card shown to the user]");
  });

  it("keeps working when a context source throws", async () => {
    const builder = new ContextBuilder({
      sources: [{ id: "memory", run: () => { throw new Error("retrieval timed out"); } }],
    });
    const built = await builder.build({ messages: [user("hi")] });

    expect(built.trace.entries.find((e) => e.id === "memory")?.status).toBe("failed");
    expect(built.trace.warnings.some((w) => w.includes("memory"))).toBe(true);
  });

  it("adds the card placement contract only when visualize is available", async () => {
    const builder = new ContextBuilder({});
    const without = await builder.build({ messages: [user("hi")] });
    expect(without.system).not.toContain("CARD PLACEMENT");

    const withViz = await builder.build({ messages: [user("hi")], baseTools: ["visualize"] });
    expect(withViz.system).toContain("CARD PLACEMENT");
  });
});

describe("compaction", () => {
  it("never cuts between a tool call and its result", () => {
    const messages: Message[] = [
      user("a"),
      { id: "m2", role: "assistant", parts: [{ type: "tool-call", callId: "c1", name: "t", input: {}, status: "done" }] },
      { id: "m3", role: "tool", parts: [{ type: "tool-result", callId: "c1", name: "t", output: {} }] },
      user("b"),
    ];
    // Asking to cut at index 2 would orphan the tool result; it must slide past it.
    expect(safeCutIndex(messages, 2)).toBe(3);
  });

  it("trims oldest turns when over budget", () => {
    const messages = Array.from({ length: 40 }, (_, i) => (i % 2 ? asst(`reply ${i}`) : user(`ask ${i}`)));
    const result = trimHistory(messages, 200);

    expect(result.strategy).toBe("trim");
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.tokensAfter).toBeLessThanOrEqual(200);
  });

  it("summarizes older turns and keeps recent ones verbatim", async () => {
    const filler = "word ".repeat(60); // ~75 tokens per message, so 30 turns overflow 300
    const messages = Array.from({ length: 30 }, (_, i) =>
      i % 2 ? asst(`reply ${i} ${filler}`) : user(`ask ${i} ${filler}`),
    );
    const result = await compactHistory(messages, {
      limitTokens: 300,
      keepRecent: 4,
      summarizer: async () => "User asked about many things.",
    });

    expect(result.strategy).toBe("summarize");
    expect(result.messages[0]?.metadata?.["superchat"]).toBe("compaction-summary");
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
  });

  it("keeps the summary when the recent tail alone still overflows", async () => {
    // A plain trim walks newest-first and would drop the summary we just paid
    // a model call to produce. The summary is pinned; the tail gives way.
    const filler = "word ".repeat(120);
    const messages = Array.from({ length: 20 }, (_, i) => user(`ask ${i} ${filler}`));
    const result = await compactHistory(messages, {
      limitTokens: 250,
      keepRecent: 6,
      summarizer: async () => "Earlier: the user asked twenty questions.",
    });

    expect(result.strategy).toBe("summarize");
    expect(result.messages[0]?.metadata?.["superchat"]).toBe("compaction-summary");
    expect(result.tokensAfter).toBeLessThanOrEqual(300);
  });

  it("falls back to trimming when the summarizer fails", async () => {
    const filler = "word ".repeat(60);
    const messages = Array.from({ length: 30 }, (_, i) => user(`ask ${i} ${filler}`));
    const result = await compactHistory(messages, {
      limitTokens: 200,
      summarizer: async () => { throw new Error("model down"); },
    });

    // A summarizer outage must cost context quality, not the user's turn.
    expect(result.strategy).toBe("trim");
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("does nothing when history already fits", async () => {
    const messages = [user("short")];
    const result = await compactHistory(messages, { limitTokens: 10_000 });
    expect(result.strategy).toBe("none");
    expect(result.messages).toEqual(messages);
  });
});
