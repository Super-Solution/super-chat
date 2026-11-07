import type { ToolSpec } from "../providers/types.js";
import { normalizeToolName } from "./repair.js";
import type { PresetName, ToolDefinition, ToolResolution } from "./types.js";

/**
 * The tool registry. Holds definitions, maps preset → allowlist, and renders the
 * provider-facing `ToolSpec[]`.
 *
 * `resolve()` is the only way to get a tool set, and it always applies deny
 * last — so a host-level kill switch cannot be re-granted by a preset or by a
 * skill unlocking a tool.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private presets = new Map<PresetName, Set<string>>();
  private listeners = new Set<() => void>();
  private version = 0;
  // Reverse of `presets`: tool name → presets that grant it. Lazily rebuilt —
  // `touch()` just nulls it out, so a burst of register()/addToPreset() calls
  // pays for one rebuild on the next presetsFor()/resolve(), not one per call.
  private reversePresetIndex: Map<string, PresetName[]> | null = null;

  constructor(tools: readonly ToolDefinition[] = []) {
    for (const t of tools) this.register(t);
  }

  register(tool: ToolDefinition, presets: readonly PresetName[] = []): this {
    this.tools.set(tool.name, tool);
    for (const p of presets) this.addToPreset(p, tool.name);
    this.touch();
    return this;
  }

  /** Register several tools into the same preset — the common bulk case. */
  registerAll(tools: readonly ToolDefinition[], presets: readonly PresetName[] = []): this {
    for (const t of tools) this.register(t, presets);
    return this;
  }

  addToPreset(preset: PresetName, ...names: string[]): this {
    const set = this.presets.get(preset) ?? new Set<string>();
    for (const n of names) set.add(n);
    this.presets.set(preset, set);
    this.touch();
    return this;
  }

  /**
   * Change notification, so a UI (or an inspector hook) re-reads after a LATE
   * registration — tools imported from an MCP server arrive long after mount,
   * and a registry nobody can observe leaves them invisible until reload.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Monotonic change counter — a stable snapshot value for useSyncExternalStore. */
  getVersion(): number {
    return this.version;
  }

  private touch(): void {
    this.version += 1;
    this.reversePresetIndex = null;
    for (const l of this.listeners) l();
  }

  get(name: string): ToolDefinition | undefined {
    // Tolerate router-namespaced names ("functions.getPrice") so a call from a
    // provider that rewrites names still dispatches.
    return this.tools.get(name) ?? this.tools.get(normalizeToolName(name));
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  presetNames(): PresetName[] {
    return [...this.presets.keys()];
  }

  /** Tool names in a preset that are actually registered. */
  namesInPreset(preset: PresetName): string[] {
    return [...(this.presets.get(preset) ?? [])].filter((n) => this.tools.has(n)).sort();
  }

  /** Which presets grant `name`. Used by the UI to explain why a tool is available. */
  presetsFor(name: string): PresetName[] {
    return this.reverseIndex().get(name) ?? [];
  }

  /** Tool name → presets that grant it, rebuilt on demand after the last mutation. */
  private reverseIndex(): Map<string, PresetName[]> {
    if (this.reversePresetIndex) return this.reversePresetIndex;
    const index = new Map<string, PresetName[]>();
    for (const [preset, names] of this.presets) {
      for (const name of names) {
        const grants = index.get(name);
        if (grants) grants.push(preset);
        else index.set(name, [preset]);
      }
    }
    this.reversePresetIndex = index;
    return index;
  }

  /**
   * Resolve the tool set for a run.
   *
   * Two distinct grants, and keeping them separate is a security property:
   *
   *   PRESETS grant AUTHORITY. Whether the caller may act at all.
   *   `allow` grants RELEVANCE. Usually a matched skill saying "these are the
   *   tools my instructions describe".
   *
   * A skill must therefore never be able to escalate past the capability tier.
   * So `allow` can surface a tool that belongs to NO preset (private by
   * default, unlocked by the skill that documents it), but a tool that IS in a
   * preset still requires that preset to be enabled. Otherwise any skill could
   * hand out the executor tier just by naming a tool.
   *
   * A name listed in a preset but never registered is skipped rather than
   * throwing — presets are configuration and often outlive the tools they name.
   */
  resolve(resolution: ToolResolution): ToolDefinition[] {
    const allowed = new Set<string>();
    for (const preset of resolution.presets) {
      for (const name of this.presets.get(preset) ?? []) allowed.add(name);
    }
    for (const name of resolution.allow ?? []) {
      const grants = this.presetsFor(name);
      const skillGated = grants.length === 0;
      const withinTier = grants.some((g) => resolution.presets.includes(g));
      if (skillGated || withinTier) allowed.add(name);
    }
    for (const name of resolution.deny ?? []) allowed.delete(name);

    return [...allowed]
      .map((n) => this.tools.get(n))
      .filter((t): t is ToolDefinition => t !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Provider-facing specs. The adapter turns these into its own wire shape. */
  toSpecs(tools: readonly ToolDefinition[]): ToolSpec[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      ...(t.strict ? { strict: true } : {}),
    }));
  }

  /** Tools whose execution happens on the host, not here. */
  hostExecuted(tools: readonly ToolDefinition[]): string[] {
    return tools.filter((t) => typeof t.execute !== "function").map((t) => t.name);
  }
}
