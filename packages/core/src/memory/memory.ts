// Persistent cross-thread memory.
//
// The seam, not a database: `MemoryStore` is four async methods a host backs
// with anything (localStorage here, a row per user in production), and the two
// halves that plug it into the machinery that already exists —
//
//   READ  → `createMemorySource()`  a ContextSource injecting remembered facts
//           as a "memory" layer, under the same token budget and trace as
//           every other layer ("why does the model know that" stays answerable);
//   WRITE → `createRememberTool()`  a tool the model calls to save, update or
//           forget a fact — memory the USER can see forming, not a hidden
//           profile.
//
// Deliberately NOT persisted: conversation history (that is the ThreadStore's
// job) or derived context. Memory is small, structured, and cross-thread:
// preferences, standing facts, corrections.

import { estimateTokens } from "../tokens/estimate.js";
import type { ContextSource } from "../context/types.js";
import type { ToolDefinition } from "../tools/types.js";

export type MemoryEntry = {
  /** Stable slug ("preferred-language"), so a fact updates instead of duplicating. */
  key: string;
  value: string;
  updatedAt: number;
};

export type MemoryStore = {
  /** `vars` carries host scoping (user id, workspace) — the store decides what it means. */
  list(vars?: Record<string, unknown>): Promise<MemoryEntry[]>;
  set(key: string, value: string, vars?: Record<string, unknown>): Promise<void>;
  remove(key: string, vars?: Record<string, unknown>): Promise<void>;
};

/**
 * Total facts a store keeps before it starts evicting. Distinct from
 * `MemorySourceOptions.maxEntries` (below), which caps how many of the
 * stored facts are injected into a single turn's context — this cap bounds
 * the store itself so it doesn't grow forever.
 */
const DEFAULT_STORE_CAP = 500;

/** Most-recently-updated first, so a cap-and-slice keeps the freshest facts. */
function byRecency(a: MemoryEntry, b: MemoryEntry): number {
  return b.updatedAt - a.updatedAt;
}

export function createMemoryMemoryStore(opts: { maxEntries?: number } = {}): MemoryStore {
  const cap = opts.maxEntries ?? DEFAULT_STORE_CAP;
  const entries = new Map<string, MemoryEntry>();
  return {
    async list() {
      return [...entries.values()].sort(byRecency);
    },
    async set(key, value) {
      entries.set(key, { key, value, updatedAt: Date.now() });
      if (entries.size > cap) {
        // Evict oldest-by-updatedAt beyond the cap, at write time — a store
        // that only trims at read time never actually shrinks.
        const overflow = [...entries.values()].sort(byRecency).slice(cap);
        for (const e of overflow) entries.delete(e.key);
      }
    },
    async remove(key) {
      entries.delete(key);
    },
  };
}

/** localStorage-backed store — same defensiveness as the job/file stores. */
export function createLocalMemoryStore(storageKey = "superchat:memory", opts: { maxEntries?: number } = {}): MemoryStore {
  const cap = opts.maxEntries ?? DEFAULT_STORE_CAP;
  const read = (): Record<string, MemoryEntry> => {
    try {
      const raw = globalThis.localStorage?.getItem(storageKey) ?? null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, MemoryEntry>) : {};
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, MemoryEntry>) => {
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(all));
    } catch {
      // Quota/private mode — a lost memory degrades to "not remembered".
    }
  };
  return {
    async list() {
      return Object.values(read()).sort(byRecency);
    },
    async set(key, value) {
      const all = read();
      all[key] = { key, value, updatedAt: Date.now() };
      const keys = Object.keys(all);
      if (keys.length > cap) {
        const overflow = keys.map((k) => all[k]!).sort(byRecency).slice(cap);
        for (const e of overflow) delete all[e.key];
      }
      write(all);
    },
    async remove(key) {
      const all = read();
      delete all[key];
      write(all);
    },
  };
}

export type MemorySourceOptions = {
  id?: string;
  /** Budget-pressure priority; identity is 1000, skills ~800. */
  priority?: number;
  /** Cap on injected entries — memory must not crowd out the conversation. */
  maxEntries?: number;
};

/** The read half: remembered facts as a context layer, every turn. */
export function createMemorySource(store: MemoryStore, opts: MemorySourceOptions = {}): ContextSource {
  return {
    id: opts.id ?? "memory",
    async run({ vars }) {
      const entries = (await store.list(vars)).slice(0, opts.maxEntries ?? 50);
      if (!entries.length) return {};
      const text = [
        "Things you remember about this user, from earlier conversations:",
        ...entries.map((e) => `- ${e.key}: ${e.value}`),
        "Apply them without re-asking. Update them with the `remember` tool when they change.",
      ].join("\n");
      return {
        layers: [
          {
            id: opts.id ?? "memory",
            kind: "memory",
            text,
            tokens: estimateTokens(text),
            priority: opts.priority ?? 500,
          },
        ],
      };
    },
  };
}

/** The write half: the model saves/updates/forgets a fact, visibly. */
export function createRememberTool(store: MemoryStore): ToolDefinition {
  return {
    name: "remember",
    side: "write",
    description:
      "Save a durable fact about the user for future conversations — a preference, a standing constraint, a correction. " +
      "Use a stable key so updating a fact replaces it instead of duplicating it. " +
      "Pass value: null to forget a fact. Do NOT store conversation history or anything the user would not expect to be remembered.",
    inputSchema: {
      type: "object",
      required: ["key"],
      properties: {
        key: { type: "string", description: 'Stable slug, e.g. "preferred-language".' },
        value: { type: ["string", "null"], description: "The fact to remember, or null to forget the key." },
      },
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const { key, value } = (input ?? {}) as { key?: string; value?: string | null };
      if (!key) return { output: { ok: false, error: "`key` is required." }, failure: "invalid-input" as const };
      if (value == null || value === "") {
        await store.remove(key, ctx.vars);
        return { output: { ok: true, forgot: key } };
      }
      await store.set(key, value, ctx.vars);
      return { output: { ok: true, remembered: { key, value } } };
    },
  };
}
