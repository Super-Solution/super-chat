# Context assembly

Most chat apps *accumulate* an array of messages and hope it fits. superchat
**derives** the context every turn from named sources under an explicit token
budget, and records why each layer was included, truncated or dropped.

The failure this prevents is specific and common: history grows, silently starves
the system prompt, and the model "forgets" its rules. It reads like a prompt
problem. It isn't.

> **Live panel:** `/skills` shows the context a query assembles, layer by layer.

## Build one

```ts
import { ContextBuilder } from "@super-solution/super-chat-core";

const contextBuilder = new ContextBuilder({
  identity: "You are a support agent for Acme. Today is 20 August 2026.",
  skills,                    // a SkillRegistry
  contextWindow: 128_000,
  maxOutputTokens: 4_000,
  keepRecent: 8,             // verbatim turns kept at the tail when summarizing
  sources: [/* … */],
});
```

`identity` is **always pinned**. That is deliberate: identity is not negotiable
under budget pressure, so it is never the layer that gets dropped to make room.

## Read the trace

```ts
const context = await contextBuilder.build({ messages });

context.system            // the assembled system prompt
context.messages          // history after compaction/trimming
context.toolNames         // tools allowed this turn, after skill unlocks
context.trace.entries     // [{ id, kind, status, tokens, detail, ms }, …]
context.trace.totals      // { system, history, tools, total }
context.trace.headroom    // tokens left for the reply — negative means over-packed
context.trace.warnings
```

Each entry carries a `status` of `included`, `truncated`, `dropped`, `compacted`
or `failed`, plus `originalTokens` when something was cut down. "Why did the agent
know that" becomes a thing you read rather than a thing you guess.

In React you don't have to build this yourself — the runtime emits it:

```tsx
import { ContextInspector } from "@super-solution/super-chat-ui";
<ContextInspector />        // renders the trace from the current run
```

Or headlessly, from the event stream:

```ts
for await (const event of runAgent(messages, config)) {
  if (event.type === "context-built") {
    console.table(event.trace.entries);
    if (event.trace.headroom < 0) console.warn("over-packed", event.trace.warnings);
  }
}
```

## Sources

A source is a named contributor. Sources run **in parallel**, so one slow
retrieval doesn't serialize behind another.

```ts
export type ContextSource = {
  id: string;
  run(input: ContextSourceInput): Promise<ContextSourceResult> | ContextSourceResult;
};
```

`input` carries `messages`, `query` (the latest user text — what memory and
retrieval match against), `vars`, and a `signal`. The result contributes `layers`,
and may also unlock `tools` — which is how a matched skill enables its own tools.

Three come built in:

```ts
import {
  createMemorySource, createLocalMemoryStore,
  createRetrievalSource, createKeywordRetriever,
} from "@super-solution/super-chat-core";

const memoryStore = createLocalMemoryStore("myapp:memory");

sources: [
  // Cross-thread memory, read half. The `remember` tool is the write half.
  createMemorySource(memoryStore),
  // Retrieval: cited evidence. createKeywordRetriever is a lexical reference
  // impl — swap in your own vector store behind the same Retriever interface.
  createRetrievalSource(createKeywordRetriever(DOCS), { limit: 3 }),
  // App state: lets the agent read the host UI it is embedded in.
  createAppStateSource(myAppState),
]
```

Writing your own is the whole extension point:

```ts
import { estimateTokens, type ContextSource } from "@super-solution/super-chat-core";

const ticketSource: ContextSource = {
  id: "open-tickets",
  async run({ vars }) {
    const tickets = await db.openTicketsFor(vars.userId as string);
    if (!tickets.length) return {};      // contribute nothing, cost nothing

    const text = tickets.map((t) => `- ${t.id}: ${t.subject}`).join("
");
    return {
      layers: [{
        id: "open-tickets",
        kind: "environment",           // identity | skills | skill-index | memory | environment | custom
        text,
        tokens: estimateTokens(text),  // you declare the cost; the budget spends it
        priority: 400,                 // higher survives budget pressure longer
      }],
    };
  },
};
```

Returning `{}` is the right move when there's nothing to say. A source that always
contributes is a source that always costs tokens.

## Compaction

When history exceeds its share of the budget, older turns are summarized with a
cheap model and recent ones (`keepRecent`) are kept verbatim.

```ts
new ContextBuilder({
  summarizer: async (messages) => callCheapModel(buildSummaryPrompt(messages)),
  keepRecent: 8,
});
```

**If the summarizer fails, compaction falls back to trimming.** A summarizer
outage costs context quality; it never costs the user their turn. That fallback
is not configurable on purpose.

Without a `summarizer`, history is trimmed at safe cut points — `safeCutIndex`
never splits a tool call from its result, because a dangling `function_call` with
no output 400s the entire thread permanently.

## Card placement

When any card-capable tool is present, the builder appends a placement note to
the instructions. Without it, models narrate "as you can see in the table below"
above a card that renders *above* the text. Override it with `cardPlacementNote`
if your surface puts cards somewhere else.

## Next

- What feeds the `skills` option → **Skills**
- What `toolNames` resolves against → **Tools**
