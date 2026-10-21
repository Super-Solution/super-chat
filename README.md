# superchat

A frontend framework for agent services. It assembles **contexts**, **skills** and
**I/O content** into requests that are correct on the wire for each provider, and
gives the agent a **flexible visual vocabulary** to answer with.

Not a chat app. The thing chat apps leave to you.

```bash
npm install @zzyzxlabs/super-chat-core @zzyzxlabs/super-chat-react @zzyzxlabs/super-chat-ui
```

```ts
import "@zzyzxlabs/super-chat-ui/styles.css";
```

`core` is isomorphic and depends on neither React nor an LLM SDK — a server,
CLI or worker installs it alone.

| package | what it is |
| --- | --- |
| [`@zzyzxlabs/super-chat-core`](packages/core/README.md) | provider-agnostic engine — no React, isomorphic |
| [`@zzyzxlabs/super-chat-react`](packages/react/README.md) | thread state, run control, card actions |
| [`@zzyzxlabs/super-chat-ui`](packages/ui/README.md) | card renderers, chat primitives, context inspector, portable Mobile Agent assets |
| [`apps/playground`](apps/playground/README.md) | Three product-shaped agent experiences plus inspectable dev panels, **no API key needed** |

**Try it without a key first.** The playground runs the real adapter, runtime,
tools and context builder against a scripted transport — so what you are looking
at is the framework, not a mock of it. See [Run it](#run-it).

The landing page proves the same runtime through three deliberately different
products: a legal document workspace, an expressive companion, and SupWallet's
simulated DeFi operations. Each demo can reveal the skill, tools, card, provider,
token use and timing behind its run.

## Playground experiences

### Counsel Workspace

Document review with clause-level findings, counsel analysis, and staged
redlines.

![Counsel Workspace reviewing a master services agreement](docs/assets/playground-counsel.png)

### Milo

A memory-aware companion with calm, product-specific interactions that do not
look or behave like a generic chat surface.

![Milo companion guiding a quiet breathing moment](docs/assets/playground-companion.png)

### SupWallet

A professional DeFi workspace where the agent can explain, simulate, confirm,
and execute portfolio operations through validated cards.

![SupWallet agent preparing a lending operation](docs/assets/playground-supwallet.png)

## Documentation

| | |
| --- | --- |
| [docs/guide](docs/guide/README.md) | How to build with it — install, proxy route, first turn, context assembly |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Changing superchat itself: load-bearing decisions, and what will bite you |
| [docs/UI-SPEC.md](docs/UI-SPEC.md) | Design tokens, breakpoints, theming — the spec `packages/ui` implements |
| [packages/ui/MOBILE-AGENT.md](packages/ui/MOBILE-AGENT.md) | Native port contract — RN layout, loading states, actions and Orb motion assets |

---

## Why this exists

Open WebUI, LibreChat, LobeChat and AnythingLLM are excellent *products*. When you
need an agent surface inside your own product, you end up rebuilding the same five
subsystems anyway — and each one has a failure mode that only shows up in
production:

| Subsystem | The failure you hit |
| --- | --- |
| **Request crafting** | Responses and Chat Completions disagree on tool shape, image parts, and token limits. A dangling `function_call` with no output 400s the *entire thread*, permanently. |
| **Context assembly** | History grows, silently starves the system prompt, and the model "forgets" its rules. Reads like a prompt problem; isn't. |
| **Capability scoping** | Tools accumulate. The day you add a destructive one, it is already live on every key you ever minted. |
| **Agent cards** | A hand-maintained parser/renderer dispatch chain drifts, and a card silently degrades to a "ran ✓" chip. |
| **Documents** | The agent rewrites the wrong paragraph, the diff looks plausible, and the user approves it. |

superchat takes a position on all five.

---

## The five subsystems

### 1. Request crafting — hand-rolled, both dialects, async first-class

No LLM SDK dependency. The adapter owns the wire format, because that is the part
you actually need to get right.

```ts
const provider = createOpenAIProvider({
  transport: createProxyTransport({ url: "/api/agent" }),
  dialect: "responses",              // or "chat" for OpenAI-compatible endpoints
});
```

Both dialects are implemented as **separate builders sharing no object literals**,
because conflating them is the single largest source of 400s:

|  | Responses | Chat Completions |
| --- | --- | --- |
| tool declaration | flat `{type, name, parameters}` | nested `{type, function:{…}}` |
| user text part | `input_text` | `text` |
| image part | `input_image` | `image_url` |
| tool output | `function_call_output` item | `role:"tool"` message |
| output cap | `max_output_tokens` | `max_completion_tokens` |
| async | `background:true` + polling | — |

**Async / background mode** is a first-class run mode, not an afterthought:

```ts
for await (const event of runAgent(messages, { ...config, mode: "background" })) {
  if (event.type === "job-started") persist(event.handle);   // survives a reload
  if (event.type === "job-status")  render(event.status);
}
```

Jobs are polled (not streamed) because polling is what survives a closed tab, a
dropped network, and a serverless timeout — the whole reason to use background
mode. `JobStore` persists handles; `resumeJobs()` re-polls them on next load.

Also handled, because each one bit someone: SSE frames split mid-UTF-8-codepoint,
streamed parallel tool calls correlated by `index`, `stream_options.include_usage`
(without it every streamed turn meters as zero), reasoning-item replay, and
orphaned tool calls dropped before they poison the thread.

### 2. Context assembly — derived, budgeted, inspectable

Most chat apps *accumulate* an array. superchat *derives* the context every turn
from named sources under an explicit token budget, and records why each layer was
included, truncated or dropped.

```ts
const context = await contextBuilder.build({ messages });
context.trace.entries;   // [{ id: "skill:markets", status: "included", tokens: 214 }, …]
context.trace.headroom;  // tokens left for the reply
```

`<ContextInspector/>` renders that trace. "Why did the agent know that" becomes a
thing you read, not a thing you guess.

Compaction summarizes older turns with a cheap model and keeps recent ones
verbatim, always falling back to trimming if the summarizer fails — a summarizer
outage costs context quality, never the user's turn.

### 3. Skills — three delivery modes, one registry

A skill is a *unit* with a trigger and a cost, not a blob of prompt.

```ts
{ id: "markets", mode: "matched", aliases: ["price", "chart", "trend", "行情"],
  tools: ["getQuote", "getHistory"], body: "…" }
```

| mode | behaviour | for |
| --- | --- | --- |
| `always` | injected every turn, pinned | safety rules, identity, output format |
| `matched` | injected when the message scores against its aliases | domain playbooks |
| `manual` | never injected; the model pulls it with `loadSkill` | long methods, rare paths |

A skill can **unlock tools**, so a legal question never puts twelve marketing
tool schemas in front of the model. Matching is lexical — no embedding
round-trip before the real request — and CJK-aware; swap in your own matcher if
you want semantic retrieval.

Unlocking grants **relevance, not authority**. A tool that belongs to no preset
is private until a skill surfaces it; a tool that carries a preset still needs
that preset enabled. Otherwise any skill could hand out the executor tier just
by naming a tool.

### 4. Agent cards — the agent's visual vocabulary

Two ways a card appears: a domain tool attaches one to its result, or the agent
calls `visualize` and **chooses** a presentation. The second is what makes it
visually flexible rather than limited to whatever someone pre-built.

23 built-in kinds, chosen to span what agents actually need to express rather
than one industry's habits:

| group | kinds |
| --- | --- |
| structured data | `table` `stats` `comparison` `keyvalue` `tree` |
| quantitative shape | `chart` `funnel` `gauge` |
| sequence and state | `timeline` `progress` `checklist` |
| prose and evidence | `markdown` `callout` `citations` `code` `diff` `media` |
| artifacts | `document` `email` |
| **interactive** | `choice` `form` `confirm` `editreview` |

`comparison` is the most portable of them — legal clause-vs-clause, vendor
selection, pricing tiers, candidate evaluation all reduce to options × criteria.
`citations` matters specifically for agents: it is the card that lets a reader
check the work instead of trusting the summary.

The kit is deliberately domain-neutral. Each kind's one-line `summary` is what
the model actually reads when choosing, so those summaries name no industry —
an early draft described `stats` as "portfolio totals" and `choice` meta as
"APR, price, size", and that alone was enough to make every agent built on it
behave like a finance agent.

```ts
return { output: { symbol: "SUI", price: 3.42 },
         card: { kind: "stats", items: [{ label: "Price", value: 3.42, format: "currency" }] } };
```

Interactive cards **suspend the run** until the user answers, and the answer
becomes the tool result the model reads next step. That is the human-in-the-loop
seam, end to end.

Three rules the design enforces:

1. **Validator and renderer register together.** A test asserts core's
   `BUILTIN_CARDS` and ui's `BUILTIN_RENDERERS` match exactly, so a card cannot
   validate with nowhere to render. Unknown kinds render a *visible* fallback.
2. **Interactive cards never collapse.** A hidden confirm dialog is an
   unanswerable question, and the run just looks hung.
3. **Cards carry an `expired` state.** Trimmed from persisted history, a card says
   so rather than rendering an empty shell.

Card payloads are stripped from history before the next request — the model
already read the tool's `output`; re-sending 2,000 chart points is double billing.

---

### 5. Documents — the diff is the product

A document is the sixth thing this framework persists, and none of the other
five fits: `FileStore` holds immutable provider refs and a document changes,
`ThreadStore` is trimmed by compaction and a document outlives its thread,
`MemoryStore` has no notion of position so there is nothing to address,
`Retriever` is read-only, and the app-state seam explicitly rules out diffing.

That last exclusion is right for UI state and wrong here, which is the whole
reason this is its own module: **for a document the diff is the product**,
because the diff is what the user approves.

The loop closes. The agent produces something the user keeps; they read it in a
previewer; they select part of it to ask about that part; changes land only
through a diff they accepted hunk by hunk; the result leaves as an `.eml`.

```ts
const tools = createDocumentTools({ store });   // list, create, read, edit, undo
```

Storage stays yours — `DocumentStore` mirrors `ThreadStore` and `FileStore`, and
memory and localStorage reference implementations ship. What the framework owns
is the protocol and the approval surface, the same line Transport draws when it
refuses to hold a credential.

**Half of `applyEdits` is refusal, and that half is the point.** An anchor that
matches nothing means the model is quoting text that is not there; one that
matches twice means it has not said which. Neither is guessed at:

```ts
applyEdits(doc, [{ find: "Contoso", replace: "Contoso Ltd" }])
// → { ok: false, reason: "ambiguous",
//     message: "That text appears 3 times. Include more surrounding text, or name the block." }
```

First-match-wins is the tempting fallback and the dangerous one. It puts a
change somewhere nobody asked for and then presents it for approval as though it
were intended — and the diff reads fine, so the user says yes. A rejection the
model can see is a retry; a wrong guess is a wrong document.

Three more decisions worth knowing:

- **Undo is a checkout of a stored body, never a computed inverse**, and it
  mints a *new* revision rather than rolling the number back — so an edit
  proposed against the undone text is refused, not silently applied to text that
  no longer exists. Each undo records the revision it restored, so calling it
  again keeps walking back; `toRevision` jumps.
- **A quote is part of the user's message, not app-state.** app-state is re-read
  every turn, goes stale on the next selection, and is droppable under budget
  pressure — and dropping a paragraph the user deliberately highlighted loses
  part of what they *said*. Give the client a `documentStore` and a quote taken
  from an older revision goes out saying so.
- **The previewer renders and selects. It is not an editor.** No toolbar, no
  caret, no `contentEditable`. If you want typing, what you get from the
  framework is Markdown plus anchors, and the product decision stays yours.

`/documents` in the playground drives all of it with no model — including the
refusals, which a scripted demo never triggers.

---

## Transport: where the key lives

The adapter never holds a credential. It describes the call; the transport decides
where it goes.

```ts
// Default — key stays on your server
createProxyTransport({ url: "/api/agent" })

// BYOK — key in the browser. Named to make you say it out loud.
createDirectTransport({ baseUrl: "…", apiKey, dangerouslyAllowBrowser: true })
```

The server half is ~10 lines and **allowlists paths**, because a proxy that
forwards any path is an open relay for your API key:

```ts
export const POST = createProxyHandler({
  providers: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: () => process.env.OPENAI_API_KEY!,
      allowPaths: ["/responses", "/responses/*", "/responses/*/cancel", "/chat/completions"],
    },
  },
  authorize: (req) => checkSession(req),   // your session / quota logic
});
```

Verified in tests: unlisted paths 403, `..` traversal 403, client-supplied
`Authorization` headers ignored.

### Provider profiles: official and compatible endpoints

A profile is public, serializable endpoint metadata — never a credential. The
same OpenAI adapter serves official Responses and OpenAI-compatible Chat
Completions endpoints; the profile selects the dialect and the transport owns
the key:

```ts
const profile = createOpenAICompatibleProfile({
  id: "oneapi",
  label: "Company oneAPI",
  baseUrl: "https://oneapi.example.com/v1",
  capabilities: { backgroundJobs: false, fileUpload: false },
});

const transport = createDirectTransportForProfile(profile, {
  apiKey,
  dangerouslyAllowBrowser: true,
});
const provider = createProviderFromProfile(profile, transport);
```

For a server proxy, register `oneapi` in `createProxyHandler.providers` with
that server's Base URL, secret and `POST /chat/completions` allowlist. Do not
accept an arbitrary client-supplied Base URL in a server proxy — that turns a
provider setting into SSRF access to the server's network.

### Media generation

Media generation is a parallel provider seam rather than extra methods on the
chat Provider. OpenAI-compatible `/images/generations` is implemented and can
be exposed to the agent as a normal tool:

```ts
const images = createOpenAIImageProvider({
  transport,
  id: profile.id,
  defaultModel: "gpt-image-1",
});

tools.register(createGenerateImageTool(images), ["executor"]);
```

The model receives compact asset metadata; image bytes and URLs render in a
`media` card instead of being copied into the next prompt. `MediaProvider`
also defines speech, transcription and async video job seams. Their provider
adapters are not implemented yet; the media renderer already handles image,
audio and video URLs. The image tool also declares its expected output count
and aspect ratio through `ToolDefinition.loading`, so the UI can reserve the
right geometry before the provider returns and keep it reserved until the
browser decodes the result.

### Metering: usage facts, not a billing system

Every attempted provider step and every completed run emits one canonical,
idempotent `metering` record. Records include requested and provider-reported
models, mode, outcome, token usage, timing and optional host metadata:

```ts
const meter = {
  record: async (record: MeteringRecord) => usageStore.put(record.id, record),
  onError: (error: unknown) => logger.warn(error),
};

for await (const event of runAgent(messages, {
  ...config,
  meter,
  meteringMetadata: { workspaceId },
})) {
  if (event.type === "metering") renderReceipt(event.record);
}
```

Meter delivery is awaited to preserve order but fail-open, so an observability
outage does not fail the agent run. Core records provider facts only: pricing,
credits, ledgers, persistence and settlement remain host responsibilities.

---

## Capability presets

Explicit **allowlists**, not blocklists. A newly registered tool is invisible until
someone puts it in a preset.

```ts
registry.register(getQuote,   ["observer"]);   // pure reads
registry.register(buildTx,    ["draft"]);      // produces something the user signs
registry.register(createAlert,["executor"]);   // acts — asks first via side:"confirm"

registry.resolve({ presets: ["observer"] });   // deny is applied last, always
```

---

## Run it

```bash
pnpm install && pnpm build
```

```bash
pnpm dev
```

The playground combines **product-shaped experiences** with focused dev panels.
It runs with **no API key**: scripted demo transports replace the network while
the real adapter, runtime, tools and context builder do the actual work.

| panel | what it shows |
| --- | --- |
| `/` | Product gallery — three domain agents on one runtime |
| `/experiences/legal` | Counsel Workspace — clause highlights, citations and an editable legal brief |
| `/experiences/companion` | Milo — a memory-aware companion with generated keepsakes and effects |
| `/experiences/defi` | SupWallet — simulated portfolio analysis and execution through agent cards |
| `/cards` | All 23 card kinds, each beside the spec that produced it |
| `/agent-ui` | The chrome around a turn: thinking, orbs, code, to-dos, composer |
| `/skills` | Live match scoring, and the context a query assembles |
| `/tools` | Schemas, preset gating, the exposed set changing as you toggle |
| `/requests` | One request rendered into both dialects, side by side |
| `/app-state` | The agent reading and driving the host's own UI |
| `/documents` | The previewer, quoting, and the edit refusals — driven by hand |
| `/run` | A live turn with the raw event stream and context trace beside it |

The experience flows use synthetic data and expose an **Inspect run** drawer for
their shared skills, tools, cards and metering. The x402 view is explicitly a
protocol preview: it opens no wallet and settles no payment. The lower-level
demo agent still covers **contract review, marketing analytics and market data**
through one registry; watch `/run` and note that a legal question exposes only
the legal tools.

For a live model, add `OPENAI_API_KEY` to `apps/playground/.env.local` and switch
the transport selector to **Server proxy**, or pick **BYOK direct** and paste a key.

```bash
pnpm test
```

387 tests. The runtime suite drives the real OpenAI and Anthropic adapters
against mocked transports, so the tool loop, card suspension, thinking replay,
background polling, provider profiles, metering, media generation and concurrent
proxy streaming are all exercised with no key and no network.

---

## Status

v0.2. Working and tested; API not frozen.

**Built:** OpenAI adapter (Responses + Chat Completions + background jobs) and
Anthropic adapter (`/v1/messages`, thinking-signature replay), transport layer
(multipart upload through the proxy, bearer or x-api-key auth), file upload to
`/v1/files` with a cross-thread `FileStore`, thread persistence with message
branching (`ThreadStore` v2 — parentId tree, fork-on-edit/regenerate, branch
switcher), MCP tool import (hand-rolled Streamable HTTP client, elicitation via
interactive form cards, `createMcpSkill` for the relevance half), memory seam
(`MemoryStore` + context source + `remember` tool), retrieval seam (`Retriever`
+ cited-evidence context source + lexical reference impl), skills, context
assembly, tools + presets, 23 card kinds, React bindings, UI kit, dev panels.

Also built: an **app-state seam** (the agent reads and operates host
application state through the same context-source and tool machinery), a REST
`ThreadStore` alongside the memory and localStorage ones, **provider-native
tool passthrough** (web search, code interpreter — declared per provider, their
activity surfaced in the transcript), **responsive support** (two
container-query tiers for width, media queries for device traits — a phone can
hold a conversation end to end), and the **document seam** (artifacts, a
quotable previewer, an anchored edit protocol with hunk-by-hunk approval, and
`.eml` as the way out), **provider profiles** for official and OpenAI-compatible
endpoints, **per-step and per-run metering**, an OpenAI-compatible image provider
with agent-tool bridge, stable geometry-aware loading states, and three complete
product-shaped playground experiences backed by the same runtime.

**Not built yet:** a Gemini adapter, speech/transcription provider adapters,
and video-generation provider adapters. Image generation is available through
the OpenAI-compatible media provider and agent-tool bridge.

**Known gaps**, kept here rather than in a tracker so they are read: nobody has
driven the document tools against a live model or looked at the document
surfaces on a real phone. `docs/HANDOFF.md` has the detail.

Prior art read closely: Open WebUI's tools/functions/knowledge split, and
LibreChat's multi-provider handling.
