# @superchat/playground

Next.js 15 dev panels for the [superchat](../../README.md) monorepo — each
route isolates one capability so you can see what's available without reading
the source. Runs with **no API key**: a scripted demo transport
(`src/agent/demo-transport.ts`) replaces the network while the real adapter,
runtime, tools and context builder do the actual work.

| route | panel |
| --- | --- |
| `/` | Product gallery — three domain agents on one runtime |
| `/experiences/legal` | Counsel Workspace — document review with clause highlights and a legal brief |
| `/experiences/companion` | Milo — memory-aware companion with generated keepsakes and effects |
| `/experiences/defi` | SupWallet — simulated portfolio execution through an agent card |
| `/cards` | All 23 card kinds, each beside the spec that produced it |
| `/agent-ui` | Agent surfaces — thinking, orbs, composer |
| `/skills` | Live match scoring, and the context a query assembles |
| `/tools` | Schemas, preset gating, the exposed set changing as you toggle |
| `/requests` | One request rendered into both wire dialects, side by side |
| `/app-state` | The agent reading and driving host application state |
| `/run` | A live turn with the raw event stream and context trace beside it |

Each experience has a presenter-controlled mock flow. Press its primary run
button to play the complete sequence, switch providers or models without a key,
and open **Inspect run** to see the shared skill, tool, card, metering, and x402
preview data. x402 is illustrative only: the playground never opens a wallet or
settles a payment.

`src/agent/` holds the demo agent's setup, tools, and skills — one registry
covering contract review, marketing analytics and market data, so `/run`
shows different skills/tools loading per message through identical machinery.

## Run it

```bash
pnpm install && pnpm build   # build the workspace packages first — this app imports their dist output
pnpm dev                     # from the repo root, or: pnpm --filter @superchat/playground dev
```

For a live model instead of the scripted demo transport, add `OPENAI_API_KEY`
to `.env.local` (see `.env.example`) and switch the transport selector to
**Server proxy**, or pick **BYOK direct** and paste a key in the browser.

The provider picker also includes **OpenAI-compatible / oneAPI**. Server mode
reads `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_API_KEY`; BYOK mode
accepts the Base URL and key in memory and sends Chat Completions requests.

See [../../docs/HANDOFF.md](../../docs/HANDOFF.md) for load-bearing design
decisions and [../../docs/UI-SPEC.md](../../docs/UI-SPEC.md) for the design spec.
