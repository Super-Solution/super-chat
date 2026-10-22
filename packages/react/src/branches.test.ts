// useBranches reads every message's sibling position from one index per tree.
//
// Two things are pinned here. The answer: identical to what the hook computed
// before the index existed (the pre-fix reference below), for every tree shape
// and after every store notify of a real AgentClient. And the cost: a streamed
// token must not scan the tree at all, however many BranchNavs are mounted.

import * as React from "react";
import { describe, expect, it } from "vitest";
import {
  ContextBuilder,
  ToolRegistry,
  createMemoryThreadStore,
  createOpenAIProvider,
  type Message,
  type Transport,
} from "@super-solution/super-chat-core";
import { AgentClient } from "./client.js";
import { branchPosition, useBranches } from "./hooks.js";

// ── Pre-fix reference (origin/main 6a965ed), used only by this test ─────────
// core/src/content/branching.ts `indexByParent` + `siblingsOf`, and the selector
// useBranches ran for every message on every notify before the per-tree index.

function prefixIndexByParent(tree: readonly Message[]): Map<string | null, Message[]> {
  const index = new Map<string | null, Message[]>();
  for (const m of tree) {
    const parentId = m.parentId ?? null;
    const kids = index.get(parentId);
    if (kids) kids.push(m);
    else index.set(parentId, [m]);
  }
  return index;
}

function prefixSiblingsOf(tree: readonly Message[], id: string): Message[] {
  const self = tree.find((m) => m.id === id);
  if (!self) return [];
  return prefixIndexByParent(tree).get(self.parentId ?? null) ?? [];
}

function prefixPosition(tree: readonly Message[], messageId: string): { index: number; count: number } {
  const siblings = prefixSiblingsOf(tree, messageId);
  return { index: siblings.findIndex((m) => m.id === messageId), count: siblings.length };
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/** mulberry32: deterministic, so a failure names its seed and replays. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const msg = (id: string, parentId: string | null | undefined, role: Message["role"] = "user"): Message =>
  parentId === undefined ? { id, role, parts: [] } : { id, role, parts: [], parentId };

type Shape = "chain" | "roots" | "star" | "forks" | "chaos" | "pruned";
const SHAPES: Shape[] = ["chain", "roots", "star", "forks", "chaos", "pruned"];

/**
 * - chain: one deep linear thread.       - roots: every message a root.
 * - star: one parent, many children.     - forks: a thread with edit/regenerate forks.
 * - chaos: null / absent / "" parents, dangling parents, duplicate and odd ids.
 * - pruned: forks with a third of the nodes deleted, orphaning their children.
 */
function randomTree(r: () => number, n: number, shape: Shape): Message[] {
  const out: Message[] = [];
  const earlier = () => out[Math.floor(r() * out.length)]!.id;
  for (let i = 0; i < n; i += 1) {
    const id = `m${i}`;
    if (shape === "chain") out.push(msg(id, i === 0 ? null : `m${i - 1}`));
    else if (shape === "roots") out.push(msg(id, r() < 0.5 ? null : undefined));
    else if (shape === "star") out.push(msg(id, i === 0 ? null : "m0"));
    else if (shape === "forks" || shape === "pruned") {
      const parent = i === 0 ? null : r() < 0.8 ? `m${i - 1}` : earlier();
      out.push(msg(id, parent, i % 2 ? "assistant" : "user"));
    } else {
      const k = r();
      const parent =
        !out.length || k < 0.15 ? null : k < 0.25 ? undefined : k < 0.32 ? "" : k < 0.42 ? `gone${Math.floor(r() * 3)}` : earlier();
      const j = r();
      const chaosId = out.length && j < 0.12 ? earlier() : j < 0.15 ? ["", "__proto__", "constructor"][Math.floor(r() * 3)]! : id;
      out.push(msg(chaosId, parent));
    }
  }
  return shape === "pruned" ? out.filter(() => r() >= 0.33) : out;
}

/** Ids worth asking about: everything present, plus ids that are not messages. */
const probes = (tree: readonly Message[]) => [
  ...new Set([...tree.map((m) => m.id), "missing", "", "gone0", "__proto__", "constructor", "toString"]),
];

/** A tree that counts element reads, however they happen (for..of, find, index). */
function counted(tree: Message[]): { tree: Message[]; reads: () => number } {
  let reads = 0;
  const proxy = new Proxy(tree, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { tree: proxy, reads: () => reads };
}

// ── A hook host ─────────────────────────────────────────────────────────────

type HookInternals = { H: unknown };
const reactModule = React as unknown as Record<string, unknown> & { default?: Record<string, unknown> };
const internals = (reactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ??
  reactModule.default?.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE) as HookInternals | undefined;

/**
 * Runs a hook with no DOM renderer — this package depends on none. The
 * stand-in dispatcher implements only the hooks useBranches reaches, and
 * useSyncExternalStore the way React does: subscribe once, and on every store
 * notify call getSnapshot, re-rendering when it returns a different value.
 */
function mountHook<T>(client: AgentClient, hook: () => T): { readonly current: T; unmount: () => void } {
  if (!internals) throw new Error("React hook dispatcher not found (expected React 19).");
  const host = internals;
  const refs: { current: unknown }[] = [];
  let slot = 0;
  let getSnapshot: () => unknown = () => undefined;
  let snapshot: unknown;
  let unsubscribe: (() => void) | undefined;
  let current: T | undefined;
  const dispatcher = {
    useContext: () => client,
    useRef: (initial: unknown) => {
      const ref = (refs[slot] ??= { current: initial });
      slot += 1;
      return ref;
    },
    useCallback: <F>(fn: F) => fn,
    useMemo: <V>(create: () => V) => create(),
    useSyncExternalStore: (subscribe: (onChange: () => void) => () => void, get: () => unknown) => {
      getSnapshot = get;
      unsubscribe ??= subscribe(() => {
        if (!Object.is(getSnapshot(), snapshot)) render();
      });
      snapshot = get();
      return snapshot;
    },
  };
  const render = () => {
    const previous = host.H;
    host.H = dispatcher;
    slot = 0;
    try {
      current = hook();
    } finally {
      host.H = previous;
    }
  };
  render();
  return {
    get current() {
      return current as T;
    },
    unmount: () => unsubscribe?.(),
  };
}

/** Streams a few text deltas per turn (Chat Completions SSE), no network. */
function streamingTransport(r: () => number): Transport {
  const encoder = new TextEncoder();
  const chunk = (delta: unknown, finish: string | null = null) => ({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  return {
    kind: "custom",
    credentialSafe: true,
    async fetch(): Promise<Response> {
      const tokens = 1 + Math.floor(r() * 6);
      const chunks = [
        chunk({ role: "assistant" }),
        ...Array.from({ length: tokens }, (_, i) => chunk({ content: `t${i} ` })),
        chunk({}, "stop"),
      ];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  };
}

function makeClient(r: () => number, over: Partial<ConstructorParameters<typeof AgentClient>[0]> = {}) {
  return new AgentClient({
    provider: createOpenAIProvider({ transport: streamingTransport(r), dialect: "chat" }),
    model: "test-model",
    contextBuilder: new ContextBuilder({ identity: "You are a test agent.", contextWindow: 32_000 }),
    tools: new ToolRegistry(),
    toolResolution: { presets: [] },
    mode: "stream",
    ...over,
  });
}

/** A realistic branched thread: mostly a chain, with edit/regenerate forks. */
function branchedThread(r: () => number, n: number): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < n; i += 1) {
    const parent = i === 0 ? undefined : r() < 0.85 ? out[i - 1] : out[Math.floor(r() * i)];
    const role = !parent || parent.role !== "user" ? "user" : "assistant";
    out.push(msg(`t${i}`, parent?.id ?? null, role));
  }
  return out;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── Tests ───────────────────────────────────────────────────────────────────

describe("branchPosition", () => {
  it("matches the pre-fix siblingsOf answer for every tree shape", () => {
    let compared = 0;
    for (const shape of SHAPES) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const r = rng(seed * 7919 + shape.length);
        const tree = randomTree(r, Math.floor(r() * 80), shape);
        for (const id of probes(tree)) {
          const expected = prefixPosition(tree, id);
          expect(branchPosition(tree, id), `${shape} seed ${seed} id ${JSON.stringify(id)}`).toEqual(expected);
          // Second read comes from the cached index.
          expect(branchPosition(tree, id), `${shape} seed ${seed} id ${JSON.stringify(id)} (cached)`).toEqual(expected);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(5000);
  });

  it("covers the edge cases by name", () => {
    expect(branchPosition([], "x")).toEqual({ index: -1, count: 0 });
    // Root-level siblings: null and absent parents are the same group.
    const roots = [msg("a", null), msg("b", undefined), msg("c", null)];
    expect(branchPosition(roots, "b")).toEqual({ index: 1, count: 3 });
    // "" is a parent id like any other, not a root.
    const empty = [msg("a", null), msg("b", ""), msg("c", "")];
    expect(branchPosition(empty, "a")).toEqual({ index: 0, count: 1 });
    expect(branchPosition(empty, "c")).toEqual({ index: 1, count: 2 });
    // Duplicate ids: the first message with the id decides.
    const dup = [msg("p", null), msg("q", null), msg("x", "q"), msg("x", "p"), msg("y", "p")];
    expect(branchPosition(dup, "x")).toEqual(prefixPosition(dup, "x"));
    expect(branchPosition(dup, "x")).toEqual({ index: 0, count: 1 });
    // A parent deleted from the tree still groups its orphans.
    const pruned = [msg("a", "gone"), msg("b", null), msg("c", "gone")];
    expect(branchPosition(pruned, "c")).toEqual({ index: 1, count: 2 });
    expect(branchPosition(pruned, "gone")).toEqual({ index: -1, count: 0 });
    // Deep chain: every level is an only child.
    const chain = randomTree(rng(3), 2000, "chain");
    expect(branchPosition(chain, "m1999")).toEqual({ index: 0, count: 1 });
  });

  it("builds one index per tree version, however many lookups", () => {
    const base = randomTree(rng(11), 300, "forks");
    const first = counted(base);
    for (let round = 0; round < 20; round += 1) for (const m of base) branchPosition(first.tree, m.id);
    expect(first.reads()).toBeGreaterThan(0);
    expect(first.reads()).toBeLessThanOrEqual(2 * base.length);

    // A new array is a new version: indexed again, once.
    const plain = [...base, msg("late", "m0")];
    const next = counted(plain);
    const expected = prefixPosition(plain, "late");
    for (let round = 0; round < 20; round += 1) expect(branchPosition(next.tree, "late")).toEqual(expected);
    expect(next.reads()).toBeGreaterThan(0);
    expect(next.reads()).toBeLessThanOrEqual(2 * plain.length);
  });
});

/**
 * Mounts a useBranches for every message as it appears (plus two ids that are
 * never messages) and, after EVERY store notify, compares each one with the
 * pre-fix answer for the tree the store holds at that moment.
 */
function watchBranches(client: AgentClient, label: string) {
  const hooks = new Map<string, { readonly current: { index: number; count: number }; unmount: () => void }>();
  const stats = { notifies: 0, branched: 0, orphaned: 0 };
  const check = () => {
    stats.notifies += 1;
    const tree = client.store.get().tree;
    for (const [id, hook] of hooks) {
      const { index, count } = hook.current;
      const expected = prefixPosition(tree, id);
      // expect() only on a mismatch: ~15k comparisons per seed.
      if (index !== expected.index || count !== expected.count) {
        expect({ index, count }, `${label} notify ${stats.notifies} id ${id}`).toEqual(expected);
      }
      if (count > 1) stats.branched += 1;
      if (count === 0 && id !== "missing" && id !== "") stats.orphaned += 1; // its thread was cleared or swapped
    }
  };
  let unsubscribeCheck = client.store.subscribe(check);
  // Mount what is new, and keep the checker subscribed LAST so it reads hooks
  // that have already seen the notify.
  const mountNew = () => {
    for (const id of ["missing", "", ...client.store.get().tree.map((m) => m.id)]) {
      if (!hooks.has(id)) hooks.set(id, mountHook(client, () => useBranches(id)));
    }
    unsubscribeCheck();
    unsubscribeCheck = client.store.subscribe(check);
    check();
  };
  mountNew();
  const stop = () => {
    for (const hook of hooks.values()) hook.unmount();
    unsubscribeCheck();
  };
  return { stats, mountNew, stop };
}

describe("useBranches", () => {
  it("stays equal to the pre-fix answer after every notify of a real client", async () => {
    let branched = 0;
    let orphaned = 0;
    for (const seed of [1, 2, 3, 4]) {
      const r = rng(seed);
      const client = makeClient(r, { threadStore: createMemoryThreadStore() });
      const watcher = watchBranches(client, `seed ${seed}`);
      const threads = new Set<string>();

      for (let op = 0; op < 30; op += 1) {
        const tree = client.store.get().tree;
        const some = tree[Math.floor(r() * tree.length)];
        const users = tree.filter((m) => m.role === "user");
        const user = users[Math.floor(r() * users.length)];
        const k = r();
        if (k < 0.35 || !tree.length) await client.send(`say ${op}`); // append user + streamed answer
        else if (k < 0.5) await client.regenerate(); // sibling of the last answer
        else if (k < 0.65 && user) await client.editMessage(user.id, `edit ${op}`); // sibling of a user turn
        else if (k < 0.85 && some) client.switchBranch(some.id, r() < 0.5 ? -1 : 1); // same tree, new head
        else if (k < 0.9) client.clear();
        else if (k < 0.95) {
          threads.add(client.store.get().id);
          client.newThread();
        } else {
          threads.add(client.store.get().id);
          const ids = [...threads];
          await client.openThread(ids[Math.floor(r() * ids.length)]!); // a new array, same ids
        }
        await flush(); // let fire-and-forget saves land
        watcher.mountNew();
      }

      watcher.stop();
      expect(watcher.stats.notifies, `seed ${seed}`).toBeGreaterThan(100);
      branched += watcher.stats.branched;
      orphaned += watcher.stats.orphaned;
    }
    // Not vacuous: branches formed, and messages of a cleared or swapped thread were asked about.
    expect(branched).toBeGreaterThan(0);
    expect(orphaned).toBeGreaterThan(0);
  });

  it("never answers for the previous thread after swapping to one of the same length", async () => {
    const client = makeClient(rng(9), { threadStore: createMemoryThreadStore() });
    const watcher = watchBranches(client, "swap");
    await client.send("a1");
    await client.send("a2"); // A: a linear 4-message thread
    const a = client.store.get().id;
    client.newThread();
    await client.send("b1");
    await client.regenerate();
    await client.regenerate(); // B: a user turn with three sibling answers — also 4 messages
    const b = client.store.get().id;
    await flush();
    watcher.mountNew();

    const lengths = new Set<number>();
    for (const id of [a, b, a, b]) {
      expect(await client.openThread(id)).toBe(true);
      lengths.add(client.store.get().tree.length);
      watcher.mountNew();
    }
    watcher.stop();
    expect([...lengths]).toEqual([4]); // the premise: every swap kept the length
    expect(watcher.stats.branched).toBeGreaterThan(0);
    expect(watcher.stats.orphaned).toBeGreaterThan(0);
  });

  it("a streamed token scans the tree zero times, however many BranchNavs are mounted", async () => {
    const r = rng(5);
    const thread = branchedThread(r, 200);
    const client = makeClient(r, { initialMessages: thread });
    const { tree, reads } = counted(client.store.get().tree);
    client.store.set((s) => ({ ...s, tree }));

    const hooks = thread.map((m) => mountHook(client, () => useBranches(m.id)));
    const afterMount = reads();
    expect(afterMount).toBeGreaterThan(0);
    expect(afterMount).toBeLessThanOrEqual(2 * thread.length); // one index shared by 200 mounts

    // regenerate() streams a turn without touching the tree until the commit.
    // Subscribed after the hooks, this sees the reads each notify caused.
    const whileStreaming: number[] = [];
    const unsubscribe = client.store.subscribe(() => {
      if (client.store.get().tree === tree) whileStreaming.push(reads());
    });
    await client.regenerate();
    unsubscribe();
    expect(whileStreaming.length).toBeGreaterThan(5); // run start, deltas, finish
    expect(new Set(whileStreaming).size).toBe(1); // not one read across all of them
    // The rest are the client's own O(n) steps: pathTo when the head moves
    // back, the copy when the answer commits.
    expect(reads() - afterMount).toBeLessThanOrEqual(4 * thread.length);

    const after = client.store.get().tree;
    for (const [i, hook] of hooks.entries()) {
      const id = thread[i]!.id;
      expect({ index: hook.current.index, count: hook.current.count }).toEqual(prefixPosition(after, id));
      hook.unmount();
    }
  });
});
