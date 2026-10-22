# Getting started

By the end of this page you have an agent that streams a reply, calls a tool, and
answers with a card — wired the way a real host wires it, not a toy loop.

## Install

```bash
pnpm add @super-solution/super-chat-core @super-solution/super-chat-react @super-solution/super-chat-ui
```

`core` is isomorphic and has no React and no LLM SDK dependency. `react` and `ui`
are additive — a server-side or CLI host installs `core` alone.

```ts
import "@super-solution/super-chat-ui/styles.css";   // if you use the UI kit
```

## 1. The proxy route

Your API key belongs on a server. The adapter runs in the browser, describes the
call it wants, and this route decides whether that call is allowed and attaches
the credential. That split is why the same adapter code works both proxied and
BYOK-direct.

```ts
// app/api/agent/route.ts  (Next.js App Router)
import { createProxyHandler } from "@super-solution/super-chat-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";   // streaming must not be buffered or cached

const handler = createProxyHandler({
  providers: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: () => {
        const key = process.env.OPENAI_API_KEY;
        if (!key) throw new Error("OPENAI_API_KEY is not set.");
        return key;
      },
      allowPaths: [
        "/responses",
        "/responses/*",
        "/responses/*/cancel",
        "/chat/completions",
        "POST /files",
      ],
    },
  },
});

export async function POST(request: Request) {
  return handler(request);
}
```

> **`allowPaths` is the security boundary, not a tidiness feature.** Without it
> this route is an open relay for your key: anything that can reach it could call
> `/fine_tuning`, list `/files`, or hit any other endpoint on your account. Note
> `POST /files` is method-scoped — a bare `/files` would also open `GET /files`
> (list every file on the account) and `DELETE`.

`authorize` is where a real deployment authenticates the session and meters usage:

```ts
authorize: (req, envelope) => {
  const session = getSession(req);
  if (!session) return new Response("Unauthorized", { status: 401 });
  return true;
},
```

## 2. Wire the subsystems

Four registries and a context builder. Declare them once as module singletons —
a fresh registry per render looks identical in a table and is dead everywhere else.

```ts
// agent/setup.ts
import {
  BUILTIN_CARDS, CardRegistry, ContextBuilder, SkillRegistry, ToolRegistry,
  createBuiltinTools, createOpenAIProvider, createProxyTransport,
} from "@super-solution/super-chat-core";

export const cards  = new CardRegistry(BUILTIN_CARDS);
export const skills = new SkillRegistry(MY_SKILLS, { maxMatched: 3 });

export const tools = new ToolRegistry();
// `visualize`, `updateCard` and `loadSkill` — always-available reads.
tools.registerAll(createBuiltinTools({ cards, skills }), ["observer"]);
tools.register(getWeather, ["observer"]);
tools.register(sendInvoice, ["executor"]);   // acts on the world: higher tier

export const contextBuilder = new ContextBuilder({
  skills,
  contextWindow: 128_000,
  maxOutputTokens: 4_000,
  keepRecent: 8,
  identity: "You are a support agent for Acme. Today is 20 August 2026.",
});

const transport = createProxyTransport({ url: "/api/agent" });
export const provider = createOpenAIProvider({ transport, dialect: "responses" });
```

The second argument to `register` is the **preset list**. A tool registered with
no preset is invisible until a skill unlocks it, and a tool in `["executor"]`
stays invisible until that preset is enabled for the run. Presets are allowlists,
never blocklists — see [`tools/types.ts`](../../packages/core/src/tools/types.ts).

## 3. Run a turn

`runAgent` is an async generator. No React, no DOM — this works in a test, a CLI,
or a queue worker.

```ts
import { runAgent, userMessage } from "@super-solution/super-chat-core";

const messages = [userMessage("What's the weather in Taipei?")];

for await (const event of runAgent(messages, {
  provider,
  model: "gpt-5.2",
  contextBuilder,
  tools,
  toolResolution: { presets: ["observer"] },
})) {
  switch (event.type) {
    case "context-built": console.log(event.trace.entries); break;
    case "text-delta":    process.stdout.write(event.delta); break;
    case "tool-call":     console.log("→", event.name, event.input); break;
    case "card":          console.log("card:", event.card.spec.kind); break;
    case "run-finish":    console.log("\n", event.usage); break;
  }
}
```

The full event union is in [`runtime/events.ts`](../../packages/core/src/runtime/events.ts);
`context-built` is the one worth wiring first, because it is the entire "why did
it send that" answer.

When a step calls several tools, they run in parallel and each `tool-result`
arrives as soon as its tool finishes, so results come in completion order, not
call order. Match a result to its call by `callId`, never by position. The
history written back for the next step keeps call order.

## 4. Or render it

In React, `AgentClient` owns the thread and drives `runAgent` for you; the hooks
are fine-grained selectors over it, so a component reading only `status` doesn't
re-render on every streamed token.

```tsx
"use client";
import { AgentClient, AgentProvider } from "@super-solution/super-chat-react";
import { BUILTIN_RENDERERS, CardRendererProvider, Composer, Thread } from "@super-solution/super-chat-ui";
import { contextBuilder, provider, tools } from "@/agent/setup";
import { useMemo } from "react";

export default function Chat() {
  const client = useMemo(() => new AgentClient({
    provider,
    model: "gpt-5.2",
    contextBuilder,
    tools,
    toolResolution: { presets: ["observer"] },
  }), []);

  return (
    <AgentProvider client={client}>
      <CardRendererProvider renderers={BUILTIN_RENDERERS}>
        <Thread />
        <Composer placeholder="Ask me anything…" />
      </CardRendererProvider>
    </AgentProvider>
  );
}
```

`CardRendererProvider` is not optional decoration: it is what guarantees every
card kind the model can emit has somewhere to render. Pass `BUILTIN_RENDERERS`
and override individual kinds by key — see [`cards/index.ts`](../../packages/ui/src/cards/index.ts).

## Where to go next

You now have the shape. Each subsystem has a live panel in the playground, and
the pages for them are still being written:

| subsystem | panel | reference for now |
| --- | --- | --- |
| Wire format, dialects, background jobs | `/requests` | [core README](../../packages/core/README.md) |
| Why the model knew that | `/skills` | [Context assembly](context.md) |
| Prompt units with triggers | `/skills` | [`skills/types.ts`](../../packages/core/src/skills/types.ts) |
| Capability boundaries | `/tools` | [`tools/types.ts`](../../packages/core/src/tools/types.ts) |
| Visual answers | `/cards` | [`cards/builtin.ts`](../../packages/core/src/cards/builtin.ts) |
| Hooks and the UI kit | `/run` | [react README](../../packages/react/README.md) · [ui README](../../packages/ui/README.md) |

Both type files above are written to be read — the comment at the top of each is
the design rationale, not an apology for the code below it.
