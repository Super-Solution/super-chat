# Full-stack reference integration

One app that runs Super Chat, Super Router, Super Chart and Super Editor together. The agent is served through a real
Super Router (in-memory ledger, in this process), calls Chart and Editor tools, and shows their cards.

The model is scripted, so no API key is needed, and all market data is generated. Everything else is the real code
path: router, billing, streaming tool calls, the agent loop, presets, confirmation and plugin cards.

## Licence

This example is **GPL-3.0-or-later** because it imports the GPL Chart and Editor plugins. It is private, is not
published, and is outside the Apache-2.0 workspace of this repository. No Super Chat package depends on it.
An app that ships these plugins takes on the GPL, or needs a commercial licence from SUPER SOLUTION LABS INC.

## Run

The example needs contract changes that are not on npm yet, so it installs tarballs of local checkouts. Clone
`super-protocol`, `super-router`, `super-chart` and `super-editor` next to `super-chat`, and build each one.

```bash
cd examples/full-stack
node scripts/pack-siblings.mjs
npx pnpm@9.12.0 install
npx pnpm@9.12.0 dev        # http://127.0.0.1:3220
```

`scripts/pack-siblings.mjs` lists variables for checkouts in other places.

## What to try

- **Executor** runs every step. Renaming the document stops at a confirm card; declining leaves the title unchanged.
- **Draft** offers no tool that overwrites content, so the rename step never happens.
- **Observer** offers read tools only, so nothing on a chart or document is changed.
- **Dark theme** switches the page, and the chart and document cards follow it.

## How the pieces connect

`src/agent.ts` is the whole integration: install the plugins, point the provider at the router, create the client.
`server/router.ts` shows the server side, where the router key stays.
