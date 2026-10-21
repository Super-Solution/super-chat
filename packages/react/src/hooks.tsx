"use client";

// React bindings. Every hook is a selector over one `AgentClient` store, so a
// component that only reads `status` does not re-render on every streamed token.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  type AppStateBinding,
  type Card,
  type CardAction,
  type ContentPart,
  type ContextTrace,
  type Message,
  type PartialToolCall,
  type RunState,
  type Skill,
  type ThreadMeta,
  type ToolDefinition,
} from "@zzyzxlabs/super-chat-core";
import { AgentClient, type AgentClientConfig, type ThreadState } from "./client.js";

const AgentContext = createContext<AgentClient | null>(null);

export function AgentProvider({ client, children }: { client: AgentClient; children: ReactNode }) {
  return <AgentContext.Provider value={client}>{children}</AgentContext.Provider>;
}

export function useAgentClient(): AgentClient {
  const client = useContext(AgentContext);
  if (!client) throw new Error("useAgentClient must be used inside <AgentProvider>.");
  return client;
}

/**
 * Subscribe to a slice of thread state.
 *
 * `isEqual` defaults to `Object.is`. Selectors that build a new object each call
 * must pass a comparator, or they re-render on every notify — which during a
 * stream is every token.
 */
export function useAgentState<T>(selector: (state: ThreadState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const client = useAgentClient();
  const lastRef = useRef<{ value: T } | null>(null);

  const getSnapshot = useCallback(() => {
    const next = selector(client.store.get());
    if (lastRef.current && isEqual(lastRef.current.value, next)) return lastRef.current.value;
    lastRef.current = { value: next };
    return next;
  }, [client, selector, isEqual]);

  return useSyncExternalStore(client.store.subscribe, getSnapshot, getSnapshot);
}

const sameIds = (a: readonly { id: string }[], b: readonly { id: string }[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i]?.id);

export function useThread() {
  const client = useAgentClient();
  const messages = useAgentState((s) => s.messages);
  const status = useAgentState((s) => s.status);
  const error = useAgentState((s) => s.error);
  const stopping = useAgentState((s) => s.stopping ?? false);

  return useMemo(
    () => ({
      messages,
      status,
      error,
      /** A stop was requested; the run has not unwound yet. */
      stopping,
      send: (input: Parameters<AgentClient["send"]>[0], opts?: Parameters<AgentClient["send"]>[1]) => client.send(input, opts),
      regenerate: () => client.regenerate(),
      editMessage: (id: string, input: Parameters<AgentClient["send"]>[0]) => client.editMessage(id, input),
      stop: () => client.stop(),
      clear: () => client.clear(),
      isRunning: status === "running" || status === "awaiting-user",
    }),
    [client, messages, status, error, stopping],
  );
}

type BranchPosition = { index: number; count: number };

const NOT_IN_TREE: BranchPosition = Object.freeze({ index: -1, count: 0 });

/**
 * Every message's position among its siblings, one pass per tree.
 *
 * A thread renders a BranchNav per message and each reads its position on
 * every notify — during a stream, every token — so a `siblingsOf` scan each
 * was O(messages × tree) per token. The tree only changes when a message is
 * appended or the thread is swapped, and AgentClient replaces the array every
 * time rather than mutating it, so the array itself versions this cache: a
 * token reuses the index, a new tree builds a new one.
 */
const branchIndexes = new WeakMap<readonly Message[], Map<string, BranchPosition>>();

/** What `siblingsOf` + `findIndex` answer, read from the shared per-tree index. */
export function branchPosition(tree: readonly Message[], messageId: string): BranchPosition {
  let index = branchIndexes.get(tree);
  if (!index) {
    index = new Map();
    // Same grouping as siblingsOf: `parentId ?? null`, insertion order, and
    // the FIRST message with an id is the one whose siblings are counted.
    const groups = new Map<string | null, BranchPosition[]>();
    for (const m of tree) {
      const parentId = m.parentId ?? null;
      let group = groups.get(parentId);
      if (!group) groups.set(parentId, (group = []));
      const position = { index: group.length, count: 0 };
      group.push(position);
      if (!index.has(m.id)) index.set(m.id, position);
    }
    for (const group of groups.values()) for (const position of group) position.count = group.length;
    branchIndexes.set(tree, index);
  }
  return index.get(messageId) ?? NOT_IN_TREE;
}

/**
 * Branch position of one message: its index among siblings and the switcher
 * actions. `count === 1` means no branches — render nothing.
 */
export function useBranches(messageId: string): { index: number; count: number; prev: () => void; next: () => void } {
  const client = useAgentClient();
  const info = useAgentState(
    (s) => branchPosition(s.tree, messageId),
    (a, b) => a.index === b.index && a.count === b.count,
  );
  return useMemo(
    () => ({
      ...info,
      prev: () => client.switchBranch(messageId, -1),
      next: () => client.switchBranch(messageId, +1),
    }),
    [client, messageId, info],
  );
}

/**
 * The in-flight assistant turn: streamed parts, usage, step count.
 *
 * Called with no arguments, this subscribes to the WHOLE `RunState` — every
 * RunEvent (a streamed token included) re-renders the caller, which is what a
 * live-turn renderer wants. A consumer that only needs a slice — `status`,
 * `job`, `pendingCard` — should pass a selector (and, if it returns a new
 * object each call, an `isEqual`) so a token landing does not wake it. Same
 * pattern as `useAgentState`.
 */
export function useRun(): RunState;
export function useRun<T>(selector: (run: RunState) => T, isEqual?: (a: T, b: T) => boolean): T;
export function useRun<T = RunState>(selector?: (run: RunState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useAgentState((s) => (selector ? selector(s.run) : (s.run as unknown as T)), isEqual);
}

/** Streamed text of the current turn, without re-rendering on tool events. */
export function useStreamingText(): string {
  const client = useAgentClient();

  const compute = useCallback(
    () =>
      client.store
        .get()
        .run.parts.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join(""),
    [client],
  );

  // This recomputes (filter+map+join over `parts`) on every notify, which
  // during a stream is every token. Coalesce those to one recompute per
  // animation frame instead of one per token — but flush immediately the
  // moment the run leaves "running", so the final text is never one frame
  // stale once streaming actually ends.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      let raf: number | null = null;
      const unsub = client.store.subscribe(() => {
        if (client.store.get().status !== "running") {
          if (raf != null) cancelAnimationFrame(raf);
          raf = null;
          onStoreChange();
          return;
        }
        if (raf != null) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          onStoreChange();
        });
      });
      return () => {
        if (raf != null) cancelAnimationFrame(raf);
        unsub();
      };
    },
    [client],
  );

  return useSyncExternalStore(subscribe, compute, compute);
}

export function useCards(): Card[] {
  return useAgentState((s) => s.cards, sameIds);
}

const NO_PARTIAL_TOOLS: Record<string, PartialToolCall> = {};

/**
 * Tool calls whose arguments are streaming, keyed by callId — each with the
 * tolerant parse so far and, for a tool that previews one, a valid but
 * incomplete card. Live-only: it empties when the run commits, and nothing in
 * it is ever written to the thread. Interactive kinds never appear here as a
 * `partialCard`; they render only once validated.
 */
export function usePartialTools(): Record<string, PartialToolCall> {
  return useAgentState((s) => s.run.partialTools ?? NO_PARTIAL_TOOLS);
}

/**
 * The card blocking the run, plus the responder.
 *
 * `respond` is what closes the human-in-the-loop: it resolves the suspended
 * tool, and the agent loop continues with the user's answer as the result.
 */
export function useCardAction(): { pending: Card | undefined; respond: (action: Omit<CardAction, "at">) => void } {
  const client = useAgentClient();
  const pending = useAgentState((s) => s.run.pendingCard, (a, b) => a?.id === b?.id);

  const respond = useCallback(
    (action: Omit<CardAction, "at">) => client.respond({ ...action, at: Date.now() }),
    [client],
  );

  return { pending, respond };
}

/** What actually went into the last request, and why. */
export function useContextTrace(): ContextTrace | undefined {
  return useAgentState((s) => s.run.trace);
}

/**
 * All registered skills, plus which ones the last run actually loaded.
 *
 * The `matched` half is the useful part for a UI: it answers "why did the agent
 * know that" without the user reading a system prompt.
 */
export function useSkills(): { skills: Skill[]; matched: string[]; index: string } {
  const client = useAgentClient();
  const registry = client.getConfig().contextBuilder.skillRegistry;
  const detail = useAgentState((s) => s.run.trace?.entries.find((e) => e.id === "skills")?.detail ?? "");

  return useMemo(() => {
    const skills = registry?.list() ?? [];
    const matched =
      detail === "none matched"
        ? []
        : detail
            .split(",")
            .map((s) => s.trim().replace(/\(.*\)$/, ""))
            .filter(Boolean);
    return { skills, matched, index: registry?.manualIndex() ?? "" };
  }, [registry, detail]);
}

/**
 * Registered tools, and the set actually exposed.
 *
 * `active` prefers what the last run recorded, because a matched skill can
 * unlock tools beyond the base presets — recomputing from the presets alone
 * under-reports, which is misleading in an inspector whose whole job is to say
 * what the model saw.
 */
export function useTools(): { all: ToolDefinition[]; active: string[]; presets: string[]; fromRun: boolean } {
  const client = useAgentClient();
  const recorded = useAgentState(
    (s) => s.run.toolNames,
    (a, b) => a?.length === b?.length && (a ?? []).every((n, i) => n === b?.[i]),
  );
  const config = client.getConfig();
  // Re-read after LATE registrations (an MCP import lands long after mount).
  const registryVersion = useSyncExternalStore(
    useCallback((cb: () => void) => config.tools.subscribe(cb), [config.tools]),
    () => config.tools.getVersion(),
    () => config.tools.getVersion(),
  );

  return useMemo(() => {
    const base = config.tools.resolve(config.toolResolution).map((t) => t.name);
    const active = recorded?.length
      ? config.tools.resolve({ ...config.toolResolution, allow: recorded }).map((t) => t.name)
      : base;
    return {
      all: config.tools.list(),
      active,
      presets: [...config.toolResolution.presets],
      fromRun: Boolean(recorded?.length),
    };
  }, [config, recorded, registryVersion]);
}

export function useJobs() {
  const client = useAgentClient();
  const jobs = useAgentState((s) => s.jobs, (a, b) => a.length === b.length && a.every((j, i) => j.status === b[i]?.status));

  // Resume once on mount: a background job outlives the page, so a reload must
  // pick it back up rather than orphan it.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    void client.resumeBackgroundJobs();
  }, [client]);

  return jobs;
}

/**
 * Bind a piece of React state so the agent can SEE it.
 *
 * The binding reads through a ref that this hook keeps current, so the source
 * always observes the latest render's value rather than the value captured
 * when the binding was created — the stale-closure bug this seam would
 * otherwise walk into every time.
 *
 * Returns a stable `AppStateBinding`; pass the array of them to
 * `createAppStateSource()` when constructing the ContextBuilder.
 */
export function useAppState<T>(
  id: string,
  value: T,
  description: string,
  opts: { serialize?: (v: T) => string; when?: (v: T) => boolean } = {},
): AppStateBinding<T> {
  const latest = useRef(value);
  latest.current = value;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  return useMemo(
    () => ({
      id,
      description,
      read: () => latest.current,
      serialize: (v: T) => (optsRef.current.serialize ?? ((x: T) => JSON.stringify(x, null, 2)))(v),
      when: (v: T) => (optsRef.current.when ? optsRef.current.when(v) : true),
    }),
    [id, description],
  );
}

/** Parts staged for the next send, plus the stage/unstage actions. */
export function useAttachments(): {
  attachments: ContentPart[];
  attach: (part: ContentPart) => void;
  remove: (index: number) => void;
  clear: () => void;
} {
  const client = useAgentClient();
  const attachments = useAgentState((s) => s.attachments);
  return useMemo(
    () => ({
      attachments,
      attach: (part: ContentPart) => client.attach(part),
      remove: (index: number) => client.removeAttachment(index),
      clear: () => client.clearAttachments(),
    }),
    [client, attachments],
  );
}

/**
 * Stored threads, for a thread picker.
 *
 * Refreshes whenever the ACTIVE thread id changes (open/new/switch) and after
 * every save-worthy status transition, so the list tracks reality without the
 * host wiring anything. No `threadStore` configured → empty list, inert actions.
 */
export function useThreadList(): {
  threads: ThreadMeta[];
  activeId: string;
  refresh: () => Promise<void>;
  open: (id: string) => Promise<boolean>;
  create: () => void;
  remove: (id: string) => Promise<void>;
} {
  const client = useAgentClient();
  const activeId = useAgentState((s) => s.id);
  const status = useAgentState((s) => s.status);
  const [threads, setThreads] = useState<ThreadMeta[]>([]);

  const refresh = useCallback(async () => {
    const store = client.getConfig().threadStore;
    setThreads(store ? await store.list() : []);
  }, [client]);

  useEffect(() => {
    // `status` is a dependency on purpose: a run finishing is when the client
    // saves, so it is exactly when the list's metadata goes stale. But it
    // transitions through "running" (and sometimes "awaiting-user") on the
    // way there, and refreshing on those would round-trip the store 2-3x per
    // turn for no reason — only the terminal statuses actually change what a
    // save just wrote.
    if (status === "running" || status === "awaiting-user") return;
    void refresh();
  }, [refresh, activeId, status]);

  return useMemo(
    () => ({
      threads,
      activeId,
      refresh,
      open: (id: string) => client.openThread(id),
      create: () => client.newThread(),
      remove: async (id: string) => {
        await client.getConfig().threadStore?.remove(id);
        if (id === client.store.get().id) client.newThread();
        await refresh();
      },
    }),
    [client, threads, activeId, refresh],
  );
}

/** Construct a client once and keep it stable across renders. */
export function useAgentClientInstance(config: AgentClientConfig): AgentClient {
  const ref = useRef<AgentClient | null>(null);
  if (!ref.current) ref.current = new AgentClient(config);

  // The instance is constructed once and outlives every render, but not the
  // component — without this, a streaming run started before unmount keeps
  // running (and writing to a store nothing reads anymore) forever.
  useEffect(() => {
    return () => {
      ref.current?.stop();
    };
  }, []);

  return ref.current;
}

export type { Message, ThreadState };