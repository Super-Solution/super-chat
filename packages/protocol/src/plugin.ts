/**
 * Plugin manifest v0 — what a super-chat plugin (editor, chart, ...) declares
 * so a host can load it without depending on the plugin's package or license.
 * Apache-2.0 on purpose: a host licensed under Apache-2.0 may import this
 * package, while the plugin itself may be GPL/AGPL or commercial.
 */

export const PLUGIN_MANIFEST_VERSION = 0 as const;

export type PluginSurface = "card" | "panel" | "tool" | "canvas";

export interface PluginCapability {
  /** Stable id, namespaced by plugin, e.g. "editor.document". */
  id: string;
  surface: PluginSurface;
  /** For `card` capabilities: the card `kind` the host routes to this plugin. */
  cardKind?: string;
  /** For `tool` capabilities: the tool name offered to the model. */
  toolName?: string;
  /** JSON Schema for the data the host passes to the plugin. Opaque to the protocol. */
  inputSchema?: Record<string, unknown>;
}

export interface PluginManifest {
  manifestVersion: typeof PLUGIN_MANIFEST_VERSION;
  /** npm-style name, e.g. "@supersolutions/super-editor-chat-plugin". */
  name: string;
  version: string;
  /** SPDX expression of the plugin itself, e.g. "GPL-3.0-or-later". */
  license: string;
  capabilities: PluginCapability[];
  /** Where the plugin's own backend lives; absent for purely client-side plugins. */
  service?: { baseUrl: string };
}

export interface ManifestIssue {
  path: string;
  message: string;
}

const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const CAPABILITY_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SURFACES: readonly string[] = ["card", "panel", "tool", "canvas"];

/** Returns every problem found; an empty array means the manifest is valid. */
export function validatePluginManifest(value: unknown): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [{ path: "", message: "manifest must be an object" }];
  }
  const m = value as Record<string, unknown>;
  if (m.manifestVersion !== PLUGIN_MANIFEST_VERSION) add("manifestVersion", `must be ${PLUGIN_MANIFEST_VERSION}`);
  if (typeof m.name !== "string" || !NAME.test(m.name)) add("name", "must be a valid npm package name");
  if (typeof m.version !== "string" || !SEMVER.test(m.version)) add("version", "must be a semver string");
  if (typeof m.license !== "string" || m.license.trim() === "") add("license", "must be a non-empty SPDX expression");
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    add("capabilities", "must be a non-empty array");
  } else {
    const seen = new Set<string>();
    m.capabilities.forEach((c: unknown, i) => {
      const p = `capabilities[${i}]`;
      if (typeof c !== "object" || c === null) return add(p, "must be an object");
      const cap = c as Record<string, unknown>;
      if (typeof cap.id !== "string" || !CAPABILITY_ID.test(cap.id)) add(`${p}.id`, "must be a dotted lowercase id such as editor.document");
      else if (seen.has(cap.id)) add(`${p}.id`, "duplicate capability id");
      else seen.add(cap.id);
      if (typeof cap.surface !== "string" || !SURFACES.includes(cap.surface)) add(`${p}.surface`, `must be one of ${SURFACES.join(", ")}`);
      if (cap.surface === "card" && (typeof cap.cardKind !== "string" || cap.cardKind === "")) add(`${p}.cardKind`, "is required for card capabilities");
      if (cap.surface === "tool" && (typeof cap.toolName !== "string" || cap.toolName === "")) add(`${p}.toolName`, "is required for tool capabilities");
      if (cap.inputSchema !== undefined && (typeof cap.inputSchema !== "object" || cap.inputSchema === null || Array.isArray(cap.inputSchema))) add(`${p}.inputSchema`, "must be an object");
    });
  }
  if (m.service !== undefined) {
    const s = m.service as Record<string, unknown> | null;
    let ok = false;
    if (s && typeof s === "object" && typeof s.baseUrl === "string") {
      try { const u = new URL(s.baseUrl); ok = u.protocol === "https:" || u.protocol === "http:"; } catch { /* invalid */ }
    }
    if (!ok) add("service.baseUrl", "must be an http(s) URL");
  }
  return issues;
}
