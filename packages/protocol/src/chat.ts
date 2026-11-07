/**
 * The chat-plugin contract. A host (super-chat, or any other chat UI) loads a
 * `ChatPlugin` without knowing which framework, license or vendor is behind it.
 * Rendering is framework-neutral: a plugin mounts into a DOM element, and each
 * host adapts that to React, Vue, Svelte, and so on.
 */
import { validatePluginManifest, type ManifestIssue, type PluginManifest } from "./plugin.js";

export type CardValidationResult = { ok: true } | { ok: false; error: string; expected?: string };

/** Structurally identical to super-chat's `CardKindDefinition`, so a host can register it as is. */
export interface CardKindDefinition {
  kind: string;
  /** One line shown to the model when it chooses a card kind. */
  summary: string;
  /** JSON Schema of the spec the model may send. */
  schema: Record<string, unknown>;
  validate(spec: unknown): CardValidationResult;
  /** Interactive cards ask the user something and must render at top level. */
  interactive?: boolean;
}

/** What the user did with an interactive card; the host turns it into the tool result. */
export interface CardResponse {
  type: "submit" | "select" | "confirm" | "cancel" | "dismiss";
  /** Selected option ids, form values, or nothing for confirm/cancel. */
  value?: unknown;
}

export interface CardMountContext {
  theme: "light" | "dark";
  locale?: string;
  /** The spec is still streaming in: valid, but more is coming. */
  partial?: boolean;
  /** Present for interactive cards: report what the user did. */
  respond?: (action: CardResponse) => void;
}

export interface CardMountHandle {
  update(spec: unknown, context: CardMountContext): void;
  destroy(): void;
}

/** Mounts one card into `container`. Must not touch anything outside it. */
export type CardMount = (container: HTMLElement, spec: unknown, context: CardMountContext) => CardMountHandle;

export interface PluginTool {
  name: string;
  description: string;
  /** JSON Schema of the tool input. */
  inputSchema: Record<string, unknown>;
  run(input: unknown, context: { signal?: AbortSignal }): Promise<unknown>;
}

export interface ChatPlugin {
  manifest: PluginManifest;
  cardKinds?: CardKindDefinition[];
  /** Mount functions keyed by card kind. */
  mounts?: Record<string, CardMount>;
  tools?: PluginTool[];
}

/** Checks the manifest and that every declared capability is actually implemented. */
export function validateChatPlugin(plugin: ChatPlugin): ManifestIssue[] {
  const issues = validatePluginManifest(plugin?.manifest);
  if (issues.length) return issues;
  const add = (path: string, message: string) => issues.push({ path, message });
  const kinds = new Set((plugin.cardKinds ?? []).map((k) => k.kind));
  const tools = new Set((plugin.tools ?? []).map((t) => t.name));
  plugin.manifest.capabilities.forEach((cap, i) => {
    const p = `capabilities[${i}]`;
    if (cap.surface === "card") {
      if (!kinds.has(cap.cardKind!)) add(`${p}.cardKind`, `plugin does not define card kind "${cap.cardKind}"`);
      if (typeof plugin.mounts?.[cap.cardKind!] !== "function") add(`${p}.cardKind`, `plugin has no mount for card kind "${cap.cardKind}"`);
    }
    if (cap.surface === "tool" && !tools.has(cap.toolName!)) add(`${p}.toolName`, `plugin does not define tool "${cap.toolName}"`);
  });
  return issues;
}
