import type { CardRegistry } from "@supersolutions/super-chat-core";
import { validateChatPlugin, type ChatPlugin } from "@supersolutions/super-protocol";

export class PluginInstallError extends Error {
  constructor(
    public plugin: string,
    public issues: { path: string; message: string }[],
  ) {
    super(`Cannot install plugin ${plugin}: ${issues.map((i) => `${i.path || "plugin"}: ${i.message}`).join("; ")}`);
    this.name = "PluginInstallError";
  }
}

/**
 * Registers a plugin's card kinds. A plugin can add kinds but never replace one
 * that is already registered (built-ins included): a collision is an error, so
 * installing a plugin cannot silently change what an existing card means.
 */
export function installChatPlugin(registry: CardRegistry, plugin: ChatPlugin): void {
  const issues = validateChatPlugin(plugin);
  const name = plugin?.manifest?.name ?? "(unknown)";
  if (issues.length) throw new PluginInstallError(name, issues);
  const seen = new Set<string>();
  for (const def of plugin.cardKinds ?? []) {
    if (registry.has(def.kind) || seen.has(def.kind)) {
      issues.push({ path: "cardKinds", message: `card kind "${def.kind}" is already registered` });
    }
    seen.add(def.kind);
  }
  if (issues.length) throw new PluginInstallError(name, issues);
  for (const def of plugin.cardKinds ?? []) registry.register(def);
}
