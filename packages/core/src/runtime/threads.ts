// Thread persistence.
//
// Snapshot-per-thread, not event sourcing: the client folds a finished run into
// messages at exactly one point, which makes "after that fold" a natural save
// point, and a snapshot needs no replay machinery to load. Hosts that want an
// event log can record `RunEvent`s through `reduceRunEvent` themselves — the
// seam exists; this module just doesn't require it.
//
// What is deliberately NOT persisted: compaction summaries and any other
// derived context. Context is derived, never accumulated — persisting it would
// freeze one turn's derivation into every later turn.
//
// Three implementations ship: memory, localStorage, and REST
// (`createRestThreadStore`) — the last one so "bring your own backend" is a
// config line rather than an exercise, and so the interface is proven against
// something that isn't synchronous key-value storage.

import { linkLinear } from "../content/branching.js";
import type { Message } from "../content/types.js";

export type ThreadMeta = {
  id: string;
  /** Derived at save time from the first user message; never model-generated. */
  title?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
};

export const THREAD_SCHEMA_VERSION = 2 as const;

export type StoredThread = {
  version: typeof THREAD_SCHEMA_VERSION;
  meta: ThreadMeta;
  /** The full message TREE (flat, parentId pointers) — abandoned branches included. */
  messages: Message[];
  /** Leaf of the active branch. Absent → the last message (v1-era linearity). */
  headId?: string | null;
};

/**
 * v1 stored threads (linear, no parent pointers) migrate on read: the list is
 * linked into a chain and the head is the last message. Never thrown away —
 * a stored conversation outliving a schema bump is the whole point of the
 * version field.
 */
function migrate(parsed: { version?: number; meta?: ThreadMeta; messages?: Message[]; headId?: string | null }): StoredThread | undefined {
  if (!parsed || !Array.isArray(parsed.messages) || !parsed.meta) return undefined;
  if (parsed.version === THREAD_SCHEMA_VERSION) return parsed as StoredThread;
  if (parsed.version === 1) {
    const messages = linkLinear(parsed.messages);
    return {
      version: THREAD_SCHEMA_VERSION,
      meta: parsed.meta,
      messages,
      headId: messages.at(-1)?.id ?? null,
    };
  }
  return undefined; // a FUTURE version reads as absent, never a crash
}

export type ThreadStore = {
  /** Metadata only — a thread picker must not load every message ever sent. */
  list(): Promise<ThreadMeta[]>;
  load(id: string): Promise<StoredThread | undefined>;
  save(thread: StoredThread): Promise<void>;
  remove(id: string): Promise<void>;
};

const TITLE_MAX = 64;

function deriveTitle(messages: readonly Message[]): string | undefined {
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts) {
      if (p.type === "text" && p.text.trim()) {
        const line = p.text.trim().split("\n", 1)[0]!;
        return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
      }
    }
  }
  return undefined;
}

/**
 * Deep-clone through JSON, per message.
 *
 * Tool inputs/outputs and artifact data are `unknown` — a host's execute can
 * return a Date, a Map, or something circular. The round-trip normalizes what
 * JSON can carry and a per-message fallback replaces what it can't, because
 * persistence must never take down a run.
 */
function safeCloneMessages(messages: readonly Message[]): Message[] {
  try {
    return JSON.parse(JSON.stringify(messages)) as Message[];
  } catch {
    return messages.map((m) => {
      try {
        return JSON.parse(JSON.stringify(m)) as Message;
      } catch {
        return {
          id: m.id,
          role: m.role,
          parts: [{ type: "text", text: "[unserializable message dropped]" }],
          ...(m.createdAt != null ? { createdAt: m.createdAt } : {}),
        };
      }
    });
  }
}

/** Build a JSON-safe snapshot: safe-clone, derive title, stamp meta. */
export function threadSnapshot(
  id: string,
  messages: readonly Message[],
  prior?: ThreadMeta,
  headId?: string | null,
): StoredThread {
  const cloned = safeCloneMessages(messages);
  const title = deriveTitle(cloned) ?? prior?.title;
  return {
    version: THREAD_SCHEMA_VERSION,
    meta: {
      id,
      ...(title ? { title } : {}),
      createdAt: prior?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      messageCount: cloned.length,
    },
    messages: cloned,
    headId: headId !== undefined ? headId : (cloned.at(-1)?.id ?? null),
  };
}

export function createMemoryThreadStore(): ThreadStore {
  const threads = new Map<string, StoredThread>();
  return {
    async list() {
      return [...threads.values()].map((t) => t.meta).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async load(id) {
      const t = threads.get(id);
      return t ? migrate(t) : undefined;
    },
    async save(thread) {
      threads.set(thread.meta.id, thread);
    },
    async remove(id) {
      threads.delete(id);
    },
  };
}

/**
 * localStorage-backed store, key per thread: `{prefix}:index` holds the meta
 * list, `{prefix}:{id}` holds one thread. One growing thread must not rewrite
 * every other thread on each save (the job store's single-blob layout is fine
 * for handles; it is wrong for conversations).
 *
 * Every read is defensive — a corrupted entry reads as absent, never a throw.
 * A version other than the current one also reads as absent: v2 migrates
 * deliberately, it does not crash v1 readers.
 */
export function createLocalThreadStore(prefix = "superchat:threads"): ThreadStore {
  const indexKey = `${prefix}:index`;
  const threadKey = (id: string) => `${prefix}:${id}`;

  const readIndex = (): ThreadMeta[] => {
    try {
      const raw = globalThis.localStorage?.getItem(indexKey) ?? null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as ThreadMeta[]).filter((m) => typeof m?.id === "string") : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (metas: ThreadMeta[]): void => {
    try {
      globalThis.localStorage?.setItem(indexKey, JSON.stringify(metas));
    } catch {
      // Quota or private mode — the thread entries themselves may still exist;
      // a stale index degrades to an incomplete picker, not a crash.
    }
  };

  return {
    async list() {
      return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async load(id) {
      try {
        const raw = globalThis.localStorage?.getItem(threadKey(id)) ?? null;
        if (!raw) return undefined;
        return migrate(JSON.parse(raw) as StoredThread);
      } catch {
        return undefined;
      }
    },

    async save(thread) {
      const store = globalThis.localStorage;
      if (!store) return;
      const key = threadKey(thread.meta.id);
      let payload = thread;
      try {
        store.setItem(key, JSON.stringify(payload));
      } catch {
        // Quota. Shed the heaviest cargo — artifact payloads (card specs,
        // chart data) — and mark them expired so the UI says "this result
        // expired, ask again" instead of rendering an empty shell. One retry;
        // if that also fails, the previous snapshot stays.
        payload = { ...thread, messages: expireArtifacts(thread.messages) };
        try {
          store.setItem(key, JSON.stringify(payload));
        } catch {
          return;
        }
      }
      const index = readIndex().filter((m) => m.id !== thread.meta.id);
      index.push(payload.meta);
      writeIndex(index);
    },

    async remove(id) {
      try {
        globalThis.localStorage?.removeItem(threadKey(id));
      } catch {
        // removeItem does not throw for quota; being defensive costs nothing.
      }
      writeIndex(readIndex().filter((m) => m.id !== id));
    },
  };
}

export type RestThreadStoreConfig = {
  /** Base path of your thread API, e.g. "/api/threads". */
  url: string;
  /** Extra headers (auth, CSRF). A function is called per request. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
  /**
   * Called when a request fails. Default: swallow. Persistence is
   * fire-and-forget at the call site, so a thrown error would surface as an
   * unhandled rejection rather than anything a user can act on — but a host
   * that wants telemetry needs the hook.
   */
  onError?: (error: unknown, op: "list" | "load" | "save" | "remove") => void;
};

/**
 * REST-backed store — the "bring your own backend" implementation.
 *
 * The wire contract, four calls:
 *   GET    {url}          → ThreadMeta[]
 *   GET    {url}/{id}     → StoredThread (404 = absent, not an error)
 *   PUT    {url}/{id}     ← StoredThread
 *   DELETE {url}/{id}
 *
 * Reads stay defensive in the same way the localStorage store is: a failed or
 * malformed response degrades to "not found" / "empty list" rather than
 * throwing into a render or a run. Records still go through `migrate`, so a
 * server that stored v1 payloads keeps working.
 */
export function createRestThreadStore(config: RestThreadStoreConfig): ThreadStore {
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const base = config.url.replace(/\/$/, "");
  const path = (id: string) => `${base}/${encodeURIComponent(id)}`;

  const headers = async (): Promise<Record<string, string>> =>
    typeof config.headers === "function" ? await config.headers() : (config.headers ?? {});

  const request = async (input: string, init: RequestInit, op: "list" | "load" | "save" | "remove"): Promise<Response | undefined> => {
    try {
      const res = await doFetch(input, {
        ...init,
        headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(await headers()), ...init.headers },
        credentials: config.credentials ?? "same-origin",
      });
      // 404 on load is a legitimate "no such thread", not a failure.
      if (!res.ok && !(op === "load" && res.status === 404)) {
        config.onError?.(new Error(`Thread store ${op} failed: ${res.status}`), op);
        return undefined;
      }
      return res;
    } catch (e) {
      config.onError?.(e, op);
      return undefined;
    }
  };

  return {
    async list() {
      const res = await request(base, { method: "GET" }, "list");
      if (!res) return [];
      try {
        const parsed = (await res.json()) as unknown;
        return Array.isArray(parsed)
          ? (parsed as ThreadMeta[]).filter((m) => typeof m?.id === "string").sort((a, b) => b.updatedAt - a.updatedAt)
          : [];
      } catch (e) {
        config.onError?.(e, "list");
        return [];
      }
    },

    async load(id) {
      const res = await request(path(id), { method: "GET" }, "load");
      if (!res || res.status === 404) return undefined;
      try {
        return migrate((await res.json()) as StoredThread);
      } catch (e) {
        config.onError?.(e, "load");
        return undefined;
      }
    },

    async save(thread) {
      await request(path(thread.meta.id), { method: "PUT", body: JSON.stringify(thread) }, "save");
    },

    async remove(id) {
      await request(path(id), { method: "DELETE" }, "remove");
    },
  };
}

/** Replace every artifact part's data with an expired stub. */
function expireArtifacts(messages: readonly Message[]): Message[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) =>
      p.type === "artifact"
        ? { ...p, data: { kind: (p.data as { kind?: string } | null)?.kind ?? p.kind, expired: true } }
        : p,
    ),
  }));
}
