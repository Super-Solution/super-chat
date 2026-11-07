# @supersolutions/super-chat-plugin

Plugin host for super-chat. `installChatPlugin(registry, plugin)` registers a
[`ChatPlugin`](../protocol/README.md)'s card kinds (refusing invalid plugins and kind collisions), and
`pluginRenderers(plugins)` gives `CardRendererProvider` a React renderer per card kind that mounts the
plugin's framework-neutral `CardMount`. A mount that throws is contained to its own card.

See [docs/PACKAGES.md](../../docs/PACKAGES.md).
