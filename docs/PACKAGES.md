# Packages and layers

Packages depend only downward. Install the layers you need.

| layer | package | depends on |
| --- | --- | --- |
| contract | `@supersolutions/super-protocol` | nothing |
| engine | `@supersolutions/super-chat-core` | nothing |
| client / server / headless UI | `-client`, `-server`, `-ui-core` | `core` |
| gateway binding | `-router` | `core`, `super-protocol` |
| React | `-react` → `-ui` | `client`, `core`, `ui-core` |
| plugin host | `-plugin` | `core`, `ui`, `super-protocol` |

Licence boundary: every package here is Apache-2.0 and none may depend on a GPL/AGPL Super package
(super-editor, super-chart). Those plug in through `super-protocol`; `license-boundary.test.ts`
enforces it.

## Where the folders are

Folders group packages by what they are, so a new framework or language is one more folder, not a
new top-level concept. npm names do not change.

```
packages/
  protocol/            super-protocol, the shared contract
  core/ client/ ui-core/   framework-free layers
  bindings/            one folder per UI framework
    react/             -react   (hooks)
    react-ui/          -ui      (card renderers and chat primitives)
  integrations/        plug into something else
    plugin/            -plugin  (chat plugin host)
    router/            -router  (Super Router / InferenceGateway binding)
backends/
  typescript/
    server/            -server  (createProxyHandler)
```

A Vue, Svelte or Solid binding goes in `packages/bindings/<framework>/`. A Go or Rust backend goes
in `backends/<language>/`; it implements the same contract in `super-protocol` instead of importing
the TypeScript one. Rust backends are closed source and live in a private repository, not here.

## Routing through Super Router (or any gateway)

```ts
import { createSuperRouterGateway, createSuperRouterProvider } from "@supersolutions/super-chat-router";

const provider = createSuperRouterProvider({
  gateway: createSuperRouterGateway({ baseUrl: "https://router.example.com", apiKey: process.env.SR_KEY! }),
  customerId: "cust_123",
});
// NormalizedRequest.model is the Super Router *service* id.
```

Any object implementing `InferenceGateway` from `super-protocol/router` works in place of the HTTP
gateway. The provider is text-only: tools and media are reported as warnings, not silently sent.
Use a fixed `idempotencyKey` to make a retry safe; a repeated key returns the stored request
status without output (the router never stores completions), which the provider reports as an error.

## Installing a plugin

```ts
import { CardRegistry, BUILTIN_CARDS } from "@supersolutions/super-chat-core";
import { installChatPlugin, pluginRenderers } from "@supersolutions/super-chat-plugin";
import { CardRendererProvider } from "@supersolutions/super-chat-ui";

const registry = new CardRegistry(BUILTIN_CARDS);
installChatPlugin(registry, editorPlugin); // throws on an invalid plugin or a card-kind collision
// <CardRendererProvider renderers={pluginRenderers([editorPlugin])}> … </CardRendererProvider>
```

A plugin is a `ChatPlugin` (`super-protocol/chat`): a manifest, card kinds and framework-neutral
`CardMount` functions. The host never imports the plugin's package, only its object.
