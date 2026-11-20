import { approvalCard, type CardRegistry, type ToolDefinition, type ToolExecutionContext, type ToolRegistry, type ToolResult, type ToolSide } from "@supersolutions/super-chat-core";
import { PLUGIN_TOOL_PRESETS, pluginToolAuthority as declaredAuthority, validateChatPlugin, type ChatPlugin, type PluginTool, type PluginToolAuthority } from "@supersolutions/super-protocol";

/**
 * A tool as a plugin declared it. `authority` and `confirm` are untrusted until they are
 * checked here. `approval` is the plugin's own wording for its approval card; the core
 * keeps only its plain-text fields, so a malformed one falls back to the generic card.
 */
type DeclaredPluginTool = Omit<PluginTool, "authority" | "confirm"> & { authority?: unknown; confirm?: unknown; approval?: unknown };
const pluginToolAuthority = (tool: DeclaredPluginTool) => declaredAuthority(tool as Pick<PluginTool, "authority">);

export class PluginInstallError extends Error {
  constructor(
    public plugin: string,
    public issues: { path: string; message: string }[],
  ) {
    super(`Cannot install plugin ${plugin}: ${issues.map((i) => `${i.path || "plugin"}: ${i.message}`).join("; ")}`);
    this.name = "PluginInstallError";
  }
}

export type InstallChatPluginOptions = {
  /** Where the plugin's tools go. Without it only the cards are installed and every tool is reported as refused. */
  tools?: ToolRegistry;
};

export type RefusedPluginTool = {
  name: string;
  reason: "no-tool-registry" | "undeclared-authority" | "invalid-confirm" | "not-in-manifest" | "invalid-name" | "invalid-schema";
};

export type PluginInstallReport = {
  cardKinds: string[];
  /** Tools now registered, each in the presets its authority allows. */
  tools: string[];
  /** Tools the agent cannot see, and why. */
  refusedTools: RefusedPluginTool[];
  /** Declared capabilities this host does not render: `panel` and `canvas`. */
  unsupportedSurfaces: { id: string; surface: string }[];
};

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function refusalOf(tool: DeclaredPluginTool, declared: ReadonlySet<string>): RefusedPluginTool["reason"] | null {
  if (typeof tool.name !== "string" || !TOOL_NAME.test(tool.name)) return "invalid-name";
  if (pluginToolAuthority(tool) === null) return "undeclared-authority";
  if (tool.confirm !== undefined && typeof tool.confirm !== "boolean") return "invalid-confirm";
  if (!declared.has(tool.name)) return "not-in-manifest";
  const schema: unknown = tool.inputSchema;
  if (typeof schema !== "object" || schema === null || (schema as { type?: unknown }).type !== "object") return "invalid-schema";
  return null;
}

function toToolDefinition(tool: DeclaredPluginTool, authority: PluginToolAuthority): ToolDefinition {
  const confirm = tool.confirm === true;
  const side: ToolSide = confirm ? "confirm" : authority === "read" ? "read" : "write";
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    side,
    // The approval below passes `confirmed` on to the plugin. Its wording is for the
    // person approving: the plugin and tool names stay in the run trace.
    ...(confirm ? { confirmation: "tool" as const } : {}),
    execute: async (input: unknown, ctx: ToolExecutionContext): Promise<ToolResult> => {
      if (confirm) {
        if (!ctx.requestCard) return { output: { error: `"${tool.name}" needs the user's approval and this host cannot ask for it.` }, failure: "denied" };
        const wording = typeof tool.approval === "function" ? (tool.approval as ToolDefinition["approval"]) : undefined;
        const card = approvalCard({ description: tool.description, ...(wording ? { approval: wording } : {}) }, input, { danger: authority === "act" });
        const answer = (await ctx.requestCard(card)) as { confirmed?: unknown } | undefined;
        if (answer?.confirmed !== true) return { output: { error: "The user declined." }, failure: "denied" };
      }
      const output = await tool.run(input, { ...(ctx.signal ? { signal: ctx.signal } : {}), ...(confirm ? { confirmed: true } : {}) });
      return { output };
    },
  };
}

/**
 * Registers a plugin's card kinds and tools. A plugin can add kinds and tools
 * but never replace one that is already registered (built-ins included): a
 * collision is an error, and nothing is installed.
 *
 * Authority is never assumed. A tool enters only the presets its declared
 * authority allows; a tool with a missing or unknown authority enters none and
 * is listed in `refusedTools`.
 */
export function installChatPlugin(registry: CardRegistry, plugin: ChatPlugin, options: InstallChatPluginOptions = {}): PluginInstallReport {
  // A malformed tool is refused on its own below, with a reason in the report, so it
  // does not stop the plugin's cards and other tools from installing.
  const issues = validateChatPlugin(plugin).filter((issue) => !/^tools\[\d+\]\.(authority|confirm)$/.test(issue.path));
  const name = plugin?.manifest?.name ?? "(unknown)";
  if (issues.length) throw new PluginInstallError(name, issues);

  const seen = new Set<string>();
  for (const def of plugin.cardKinds ?? []) {
    if (registry.has(def.kind) || seen.has(def.kind)) {
      issues.push({ path: "cardKinds", message: `card kind "${def.kind}" is already registered` });
    }
    seen.add(def.kind);
  }

  const declared = new Set(plugin.manifest.capabilities.flatMap((c) => (c.surface === "tool" && c.toolName ? [c.toolName] : [])));
  const accepted: { tool: DeclaredPluginTool; authority: PluginToolAuthority }[] = [];
  const refusedTools: RefusedPluginTool[] = [];
  const names = new Set<string>();
  for (const tool of (plugin.tools ?? []) as DeclaredPluginTool[]) {
    if (!options.tools) {
      refusedTools.push({ name: tool.name, reason: "no-tool-registry" });
      continue;
    }
    const reason = refusalOf(tool, declared);
    if (reason) {
      refusedTools.push({ name: String(tool.name), reason });
      continue;
    }
    if (options.tools.has(tool.name) || names.has(tool.name)) issues.push({ path: "tools", message: `tool "${tool.name}" is already registered` });
    names.add(tool.name);
    accepted.push({ tool, authority: pluginToolAuthority(tool)! });
  }
  if (issues.length) throw new PluginInstallError(name, issues);

  for (const def of plugin.cardKinds ?? []) registry.register(def);
  for (const { tool, authority } of accepted) options.tools!.register(toToolDefinition(tool, authority), PLUGIN_TOOL_PRESETS[authority]);

  return {
    cardKinds: (plugin.cardKinds ?? []).map((def) => def.kind),
    tools: accepted.map(({ tool }) => tool.name),
    refusedTools,
    unsupportedSurfaces: plugin.manifest.capabilities.filter((c) => c.surface === "panel" || c.surface === "canvas").map((c) => ({ id: c.id, surface: c.surface })),
  };
}
