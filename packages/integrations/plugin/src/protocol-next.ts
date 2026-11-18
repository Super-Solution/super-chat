import type { CardMountContext, PluginTool } from "@supersolutions/super-protocol";

/**
 * The parts of `@supersolutions/super-protocol` 0.2.0 this package uses while it
 * still pins 0.1.0 from npm. The shapes match 0.2.0 exactly. Once 0.2.0 is
 * published, import them from the protocol and delete this file.
 */
export type PluginToolAuthority = "read" | "draft" | "act";

export const PLUGIN_TOOL_PRESETS: Readonly<Record<PluginToolAuthority, readonly string[]>> = {
  read: ["observer", "draft", "executor"],
  draft: ["draft", "executor"],
  act: ["executor"],
};

export type DeclaredPluginTool = Omit<PluginTool, "run"> & {
  authority?: unknown;
  confirm?: unknown;
  run(input: unknown, context: { signal?: AbortSignal; confirmed?: boolean }): Promise<unknown>;
};

/** The declared authority, or null when it is missing or unknown. Own keys only: `toString` is not an authority. */
export function pluginToolAuthority(tool: { authority?: unknown }): PluginToolAuthority | null {
  const value = tool.authority;
  return typeof value === "string" && Object.hasOwn(PLUGIN_TOOL_PRESETS, value) ? (value as PluginToolAuthority) : null;
}

export type ThemeToken =
  | "background" | "surface" | "surface-raised" | "border" | "text" | "text-muted" | "accent" | "accent-contrast"
  | "positive" | "negative" | "warning" | "info" | "font-sans" | "font-mono" | "radius";

export type HostTheme = { mode: "light" | "dark"; tokens: Partial<Record<ThemeToken, string>> };

export type HostCardContext = CardMountContext & { hostTheme?: HostTheme };
