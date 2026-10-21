// AgentClient — the framework-agnostic controller the React hooks wrap.
//
// It owns: the thread, the current run, pending user decisions, and background
// jobs. Kept outside React so the same object can be driven from a test, a CLI,
// or a non-React host — the hooks are a thin `useSyncExternalStore` over it.

import {
  initialRunState,
  reduceRunEvent,
  runAgent,
  resumeJobs,
  type Card,
  type CardAction,
  type ContentPart,
  type ContextBuilder,
  type JobStore,
  type Message,
  type Provider,
  type RunConfig,
  type RunEvent,
  type RunMode,
  type RunState,
  type StoredJob,
  type ThreadMeta,
  type ThreadStore,
  type ToolCallRequest,
  type ToolRegistry,
  type ToolResolution,
  assistantMessage,
  latestLeaf,
  linkLinear,
  nextId,
  pathTo,
  siblingsOf,
  threadSnapshot,
  userMessage,
  withQuotes,
  formatQuotes,
  checkQuoteDrift,
  QUOTES_METADATA_KEY,
  type DocumentQuoteRef,
  type DocumentStore,
} from "@zzyzxlabs/super-chat-core";
import { Store } from "./store.js";

export type ThreadState = {
  id: string;
  /**
   * The ACTIVE PATH — root to head — which is what the UI renders and a run
   * consumes. Always derived from `tree` + `headId`; treat as read-only.
   */
  messages: Message[];
  /**
   * Every message ever sent in this thread, abandoned branches included.
   * Replaced on every change, never mutated in place — `useBranches` caches
   * its sibling index per array. Treat as read-only.
   */
  tree: Message[];
  /** Leaf of the active branch. */
  headId: string | null;
  run: RunState;
  /** Cards from the CURRENT run; committed to messages when the run finishes. */
  cards: Card[];
  jobs: StoredJob[];
  /** Parts staged for the NEXT send (file/image attachments). Thread-scoped. */
  attachments: ContentPart[];
  status: RunState["status"];
  error?: unknown;
  /**
   * A stop was requested but the run has not unwound yet.
   *
   * Needed because `stop()` only aborts a signal — a tool that ignores its
   * signal keeps running, and without this the UI cannot distinguish "stopping"
   * from "the button did nothing".
   */
  stopping?: boolean;
};

/** What a finished turn cost, attached to the committed message. */
export type TurnMeta = { model: string; ms: number; usage?: RunState["usage"]; steps?: number };

export type AgentClientConfig = {
  provider: Provider;
  model: string;
  contextBuilder: ContextBuilder;
  tools: ToolRegistry;
  toolResolution: ToolResolution;
  mode?: RunMode;
  maxSteps?: number;
  vars?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?: RunConfig["reasoning"];
  // Full RunConfig surface — a React host must not get LESS control than a
  // direct runAgent caller.
  stopWhen?: RunConfig["stopWhen"];
  toolTimeoutMs?: number;
  useServerHistory?: boolean;
  toolChoice?: RunConfig["toolChoice"];
  providerTools?: RunConfig["providerTools"];
  responseFormat?: RunConfig["responseFormat"];
  topP?: number;
  stopSequences?: string[];
  store?: boolean;
  metadata?: Record<string, string>;
  providerOptions?: RunConfig["providerOptions"];
  meter?: RunConfig["meter"];
  meteringMetadata?: RunConfig["meteringMetadata"];
  jobStore?: JobStore;
  /** When set, the thread is saved after each user and assistant turn. */
  threadStore?: ThreadStore;
  onHostTool?: (call: ToolCallRequest) => Promise<unknown>;
  /** Persisted thread to hydrate from (linear list or a parentId tree). */
  initialMessages?: Message[];
  /** Active-branch leaf when `initialMessages` is a tree. Default: last message. */
  initialHeadId?: string | null;
  threadId?: string;
  /**
   * Where quoted documents can be looked up at send time, to catch a quote
   * taken from a revision the document has since moved past. Only `get` is
   * used; a host whose store lives on a server can pass a fetch-backed one.
   * Unset, quotes are sent as taken.
   */
  documentStore?: Pick<DocumentStore, "get">;
};

/** A card waiting on the user, with the resolver that unblocks the run. */
type PendingDecision = { card: Card; resolve: (action: CardAction) => void };

export class AgentClient {
  readonly store: Store<ThreadState>;
  private config: AgentClientConfig;
  private controller: AbortController | null = null;
  private pending = new Map<string, PendingDecision>();
  /** Meta of the last snapshot saved, so createdAt/title survive re-saves. */
  private threadMeta: ThreadMeta | undefined;
  /**
   * Bumped by every thread switch. A run captures the value it started under
   * and stops writing to the store the moment they diverge — so a run dying
   * from `openThread()`'s stop() cannot leak its error/status/commit into the
   * thread the user just opened.
   */
  private generation = 0;
  /** Wall-clock start of the current turn, for the committed TurnMeta. */
  private turnStartedAt = 0;

  constructor(config: AgentClientConfig) {
    this.config = config;
    // `initialMessages` may be a plain linear list (pre-branching hosts) or a
    // tree with parentIds (a v2 snapshot); linkLinear handles both.
    const tree = linkLinear(config.initialMessages ?? []);
    const headId = config.initialHeadId ?? tree.at(-1)?.id ?? null;
    this.store = new Store<ThreadState>({
      id: config.threadId ?? nextId("thread"),
      messages: pathTo(tree, headId),
      tree,
      headId,
      run: initialRunState("", config.mode ?? "stream"),
      cards: [],
      jobs: [],
      attachments: [],
      status: "idle",
    });
  }

  /**
   * Append under `parent` (default: the current head) and move the head there.
   *
   * `extra` merges into the SAME `store.set()` — e.g. clearing `attachments`
   * alongside the append — so a caller touching both fields does not force two
   * notifications for one logical change.
   */
  private appendMessage(message: Message, parent?: string | null, extra?: Partial<ThreadState>): void {
    this.store.set((s) => {
      const parentId = parent !== undefined ? parent : s.headId;
      const linked: Message = { ...message, parentId };
      const tree = [...s.tree, linked];
      return { ...s, tree, headId: linked.id, messages: pathTo(tree, linked.id), ...extra };
    });
  }

  /**
   * Stage a part (a file/image the host uploaded) for the next send. The
   * Composer only carries text; this is how binary content joins the turn.
   */
  attach(part: ContentPart): void {
    this.store.set((s) => ({ ...s, attachments: [...s.attachments, part] }));
  }

  removeAttachment(index: number): void {
    this.store.set((s) => ({ ...s, attachments: s.attachments.filter((_, i) => i !== index) }));
  }

  clearAttachments(): void {
    this.store.set((s) => (s.attachments.length ? { ...s, attachments: [] } : s));
  }

  /** Update config in place (model switch, preset toggle) without losing the thread. */
  configure(patch: Partial<AgentClientConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  getConfig(): AgentClientConfig {
    return this.config;
  }

  get isRunning(): boolean {
    const { status } = this.store.get();
    return status === "running" || status === "awaiting-user";
  }

  /**
   * Append a user message (plus any staged attachments) and run a turn.
   *
   * `quotes` are spans the user highlighted in a document artifact. They are
   * flattened into the message's own text rather than injected as context, and
   * the reasoning is in content/quotes.ts: a quote is part of what the user
   * SAID, so it must not go stale between turns and must not be droppable
   * under budget pressure. The structured form rides on `metadata`, which never
   * reaches a provider, so the chips can be re-rendered from history.
   *
   * With a `documentStore` configured, each quote is first checked against the
   * document as it is now, and a quote taken from an older revision goes out
   * with its drift — in the text, so the model re-reads, and in the metadata,
   * so the UI can say so.
   */
  async send(
    input: string | ContentPart[],
    opts: { forceSkillIds?: string[]; quotes?: readonly DocumentQuoteRef[] } = {},
  ): Promise<void> {
    if (this.isRunning) throw new Error("A run is already in progress. Call stop() first.");
    const { documentStore } = this.config;
    const quotes =
      opts.quotes?.length && documentStore ? await checkQuoteDrift(opts.quotes, documentStore) : (opts.quotes ?? []);
    // The drift lookup is an await, and a second send could have started in it.
    if (this.isRunning) throw new Error("A run is already in progress. Call stop() first.");
    const staged = this.store.get().attachments;
    const quoted: string | ContentPart[] =
      quotes.length === 0
        ? input
        : typeof input === "string"
          ? withQuotes(input, quotes)
          : [{ type: "text", text: formatQuotes(quotes) } as ContentPart, ...input];
    const parts: ContentPart[] = typeof quoted === "string" ? [{ type: "text", text: quoted }] : [...quoted];
    const base = userMessage(staged.length ? [...parts, ...staged] : quoted);
    const message: Message = quotes.length
      ? { ...base, metadata: { ...base.metadata, [QUOTES_METADATA_KEY]: quotes } }
      : base;
    this.appendMessage(message, undefined, { attachments: [] });
    // Persist the user turn before running — a reload mid-run keeps it.
    this.persist();
    await this.run([...this.store.get().messages], opts);
  }

  /**
   * Re-run from the last user message. A FORK, not a rewrite: the head moves
   * back to that user message and the new answer grows as a sibling of the
   * old one, which stays switchable via `switchBranch`.
   */
  async regenerate(opts: { forceSkillIds?: string[] } = {}): Promise<void> {
    if (this.isRunning) throw new Error("A run is already in progress.");
    const { messages } = this.store.get();
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.role === "user") {
        this.store.set((s) => ({ ...s, headId: m.id, messages: pathTo(s.tree, m.id) }));
        await this.run([...this.store.get().messages], opts);
        return;
      }
    }
  }

  /**
   * Edit a user message: a SIBLING fork under the same parent, preserving the
   * original and everything under it. The edited branch runs immediately.
   */
  async editMessage(messageId: string, input: string | ContentPart[], opts: { forceSkillIds?: string[] } = {}): Promise<void> {
    if (this.isRunning) throw new Error("A run is already in progress.");
    const original = this.store.get().tree.find((m) => m.id === messageId);
    if (!original || original.role !== "user") return;
    this.appendMessage(userMessage(input), original.parentId ?? null);
    this.persist();
    await this.run([...this.store.get().messages], opts);
  }

  /**
   * Move the active branch to a SIBLING of `messageId` (delta −1/+1 in
   * insertion order), resuming at that branch's latest leaf.
   */
  switchBranch(messageId: string, delta: number): void {
    if (this.isRunning) return; // switching under a live run would cross-write threads of the same id
    const s = this.store.get();
    const siblings = siblingsOf(s.tree, messageId);
    if (siblings.length < 2) return;
    const index = siblings.findIndex((m) => m.id === messageId);
    const next = siblings[(index + delta + siblings.length) % siblings.length]!;
    const headId = latestLeaf(s.tree, next.id);
    this.store.set((prev) => ({ ...prev, headId, messages: pathTo(prev.tree, headId) }));
    this.persist();
  }

  private async run(messages: Message[], opts: { forceSkillIds?: string[] }): Promise<void> {
    const gen = this.generation;
    this.controller = new AbortController();
    const mode = this.config.mode ?? "stream";
    this.turnStartedAt = Date.now();
    this.store.set((s) => ({
      ...s,
      run: initialRunState(nextId("run"), mode),
      cards: [],
      status: "running",
      error: undefined,
      stopping: false,
    }));

    const runConfig: RunConfig = {
      provider: this.config.provider,
      model: this.config.model,
      contextBuilder: this.config.contextBuilder,
      tools: this.config.tools,
      toolResolution: this.config.toolResolution,
      mode,
      maxSteps: this.config.maxSteps,
      vars: this.config.vars,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
      reasoning: this.config.reasoning,
      stopWhen: this.config.stopWhen,
      toolTimeoutMs: this.config.toolTimeoutMs,
      useServerHistory: this.config.useServerHistory,
      toolChoice: this.config.toolChoice,
      providerTools: this.config.providerTools,
      responseFormat: this.config.responseFormat,
      topP: this.config.topP,
      stopSequences: this.config.stopSequences,
      store: this.config.store,
      metadata: this.config.metadata,
      providerOptions: this.config.providerOptions,
      meter: this.config.meter,
      meteringMetadata: this.config.meteringMetadata,
      signal: this.controller.signal,
      forceSkillIds: opts.forceSkillIds,
      onHostTool: this.config.onHostTool,
      // Suspend the run on an interactive card; `respond()` resolves it.
      onUserDecision: (callId, card) =>
        new Promise<CardAction>((resolve) => {
          this.pending.set(callId, { card, resolve });
        }),
    };

    try {
      for await (const event of runAgent(messages, runConfig)) {
        if (gen !== this.generation) return; // thread switched under us — drop the rest
        this.apply(event);
      }
    } catch (e) {
      if (gen === this.generation) this.store.set((s) => ({ ...s, status: "error", error: e }));
    } finally {
      this.controller = null;
      if (gen === this.generation) this.commitRun();
    }
  }

  private apply(event: RunEvent): void {
    this.store.set((s) => {
      const run = reduceRunEvent(s.run, event);
      const next: ThreadState = { ...s, run, status: run.status, cards: run.cards };
      if (event.type === "job-started" && this.config.jobStore) {
        const job: StoredJob = {
          handle: event.handle,
          status: "queued",
          threadId: s.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        // Fire and forget: persistence must not stall the run.
        void this.config.jobStore.put(job);
        next.jobs = [job, ...s.jobs];
      }
      if (event.type === "job-status") {
        next.jobs = s.jobs.map((j) => (j.handle.id === event.handle.id ? { ...j, status: event.status, updatedAt: Date.now() } : j));
      }
      if (event.type === "error") next.error = event.error;
      return next;
    });
  }

  /**
   * Fold the finished run's parts into the thread as one assistant message.
   *
   * Cards are attached as artifact parts so a reloaded thread still renders
   * them — the ContextBuilder strips artifacts before they reach a provider,
   * so this costs nothing at request time.
   */
  private commitRun(): void {
    this.store.set((s) => {
      // run.status reflects only what the agent loop itself saw, never a
      // throw caught in run()'s catch block — so a caught error must win
      // over it here, or the catch's "error" status gets overwritten back
      // to whatever the loop last reduced to (e.g. "running").
      const status = s.status === "error" ? "error" : s.run.status;
      // Streaming-argument previews are live-only. run-finish already clears
      // them; a run that died by throwing never sent one, so clear them here
      // too rather than leave a half-drawn card on an errored turn.
      const run = s.run.partialTools && Object.keys(s.run.partialTools).length ? { ...s.run, partialTools: {} } : s.run;
      const parts = run.parts;
      if (!parts.length && !run.cards.length) return { ...s, run, status };

      // `data` carries the answer alongside the spec: an answered card that
      // re-renders from history has to show what the user actually chose, and
      // the renderer's own state is gone by then.
      const cardParts: ContentPart[] = s.run.cards.map((c) => ({
        type: "artifact",
        id: c.id,
        kind: `card:${(c.spec as { kind?: string }).kind ?? "unknown"}`,
        data: c.spec,
        ...(c.action ? { action: c.action } : {}),
      }));

      // What the turn cost, recorded on the message. The UI has no other way to
      // show it after the fact: run state is reset by the next turn.
      const meta: TurnMeta = {
        model: this.config.model,
        ms: this.turnStartedAt ? Date.now() - this.turnStartedAt : 0,
        ...(s.run.usage && Object.keys(s.run.usage).length ? { usage: s.run.usage } : {}),
        ...(s.run.steps ? { steps: s.run.steps } : {}),
      };

      const linked: Message = {
        ...assistantMessage([...toolResultsInCallOrder(parts), ...cardParts]),
        parentId: s.headId,
        metadata: { turn: meta },
      };
      const tree = [...s.tree, linked];
      return {
        ...s,
        run,
        tree,
        headId: linked.id,
        messages: pathTo(tree, linked.id),
        status: s.run.status,
        stopping: false,
      };
    });
    this.persist();
  }

  /**
   * Fire-and-forget save, the same posture as the job store put: persistence
   * must not stall the run, and a failed save degrades to "not saved", never
   * to a broken thread.
   */
  private persist(): void {
    const store = this.config.threadStore;
    if (!store) return;
    const s = this.store.get();
    if (this.threadMeta && this.threadMeta.id !== s.id) this.threadMeta = undefined;
    void (async () => {
      // A client hydrated via config (threadId/initialMessages) has no meta in
      // hand; read the stored one so createdAt and title survive the reload.
      const prior = this.threadMeta ?? (await store.load(s.id))?.meta;
      // The TREE persists — abandoned branches included — plus the active head.
      const snapshot = threadSnapshot(s.id, s.tree, prior, s.headId);
      this.threadMeta = snapshot.meta;
      await store.save(snapshot);
    })().catch(() => {
      // Fire-and-forget: a failed save degrades to "not saved", never a crash.
    });
  }

  /**
   * Load a stored thread and replace the current one. Returns false when the
   * id is unknown (the current thread is left untouched).
   */
  async openThread(id: string): Promise<boolean> {
    const store = this.config.threadStore;
    if (!store) return false;
    const stored = await store.load(id);
    if (!stored) return false;
    this.generation += 1; // invalidate any in-flight run before replacing state
    this.stop();
    this.threadMeta = stored.meta;
    const tree = linkLinear(stored.messages);
    const headId = stored.headId ?? tree.at(-1)?.id ?? null;
    this.store.set((s) => ({
      ...s,
      id: stored.meta.id,
      tree,
      headId,
      messages: pathTo(tree, headId),
      cards: [],
      attachments: [],
      run: initialRunState("", this.config.mode ?? "stream"),
      status: "idle",
      error: undefined,
    }));
    return true;
  }

  /** Start a fresh thread under a new id (`clear()` keeps the id; this doesn't). */
  newThread(): void {
    this.generation += 1;
    this.stop();
    this.threadMeta = undefined;
    this.store.set((s) => ({
      ...s,
      id: nextId("thread"),
      messages: [],
      tree: [],
      headId: null,
      cards: [],
      attachments: [],
      run: initialRunState("", this.config.mode ?? "stream"),
      status: "idle",
      error: undefined,
    }));
  }

  /** Answer an interactive card. Unblocks the suspended tool. */
  respond(action: CardAction): void {
    const entry = this.pending.get(action.callId ?? "");
    if (!entry) return;
    this.pending.delete(action.callId ?? "");
    entry.resolve(action);
  }

  /** The card currently blocking the run, if any. */
  pendingCard(): Card | undefined {
    return this.store.get().run.pendingCard;
  }

  stop(): void {
    if (!this.isRunning) return;
    // Mark the request immediately. Aborting is not the same as having stopped:
    // a tool that ignores its signal runs to completion, and the UI has to be
    // able to say "stopping" instead of looking inert.
    this.store.set((s) => ({ ...s, stopping: true }));
    this.controller?.abort();
    // A background job keeps running (and billing) server-side after a local
    // abort — cancel it there too, best-effort.
    const job = this.store.get().run.job;
    if (job && this.config.provider.cancelJob && !["completed", "failed", "cancelled"].includes(job.status)) {
      void this.config.provider.cancelJob(job.handle).catch(() => {});
      void this.config.jobStore?.remove(job.handle.id);
    }
    // Release any suspended tool so the run can unwind instead of hanging.
    for (const [callId, entry] of this.pending) {
      entry.resolve({ cardId: entry.card.id, callId, kind: "cancel", type: "cancel", at: Date.now() });
    }
    this.pending.clear();
  }

  clear(): void {
    this.generation += 1;
    this.stop();
    this.store.set((s) => ({
      ...s,
      messages: [],
      tree: [],
      headId: null,
      cards: [],
      attachments: [],
      run: initialRunState("", this.config.mode ?? "stream"),
      status: "idle",
      error: undefined,
      stopping: false,
    }));
    // Without this, reload restores the conversation the user just cleared.
    this.persist();
  }

  /**
   * Re-poll background jobs from a previous session. Call on mount.
   *
   * Results are routed by `StoredJob.threadId`: the current thread gets its
   * results appended live; another thread's results are written into its
   * stored snapshot (when a ThreadStore is configured), so an answer to
   * thread A never gets pasted into thread B.
   */
  async resumeBackgroundJobs(): Promise<void> {
    const store = this.config.jobStore;
    if (!store) return;
    const results = await resumeJobs(store, { [this.config.provider.id]: this.config.provider });
    this.store.set((s) => ({ ...s, jobs: results.map((r) => r.job) }));

    const currentId = this.store.get().id;
    // Jobs landing in an AWAY thread are grouped by threadId: two jobs for the
    // SAME away thread read-modify-write that thread's one stored snapshot, so
    // they must land in order or the second save clobbers the first. Jobs for
    // DIFFERENT away threads touch different snapshots and have no ordering
    // dependency on each other, so those groups load/save concurrently.
    const away = new Map<string, ContentPart[][]>();

    for (const { job, snapshot } of results) {
      const parts: ContentPart[] | null =
        snapshot.status === "completed" && snapshot.result
          ? snapshot.result.parts
          : snapshot.status === "failed"
            ? [{ type: "text", text: `_${snapshot.error?.message ?? "A background job failed."}_` }]
            : null;
      if (!parts) continue;

      if (!job.threadId || job.threadId === currentId) {
        this.appendMessage(assistantMessage(parts));
        if (job.threadId === currentId) this.persist();
        continue;
      }

      const bucket = away.get(job.threadId) ?? [];
      bucket.push(parts);
      away.set(job.threadId, bucket);
    }

    const threads = this.config.threadStore;
    if (!threads || !away.size) return; // nowhere to put it; the handle was already reaped

    await Promise.all(
      [...away].map(async ([threadId, partsList]) => {
        for (const parts of partsList) {
          const stored = await threads.load(threadId);
          if (!stored) continue;
          const awayHead = stored.headId ?? stored.messages.at(-1)?.id ?? null;
          const appended: Message = { ...assistantMessage(parts), parentId: awayHead };
          await threads.save(
            threadSnapshot(threadId, [...stored.messages, appended], stored.meta, appended.id),
          );
        }
      }),
    );
  }
}

/**
 * Run state appends tool results as they finish; a committed turn keeps them in
 * the order they were called, the same order runAgent writes back to history.
 * Only results that sit next to each other move, and only among themselves.
 */
function toolResultsInCallOrder(parts: readonly ContentPart[]): ContentPart[] {
  const callAt = new Map<string, number>();
  parts.forEach((p, i) => {
    if (p.type === "tool-call") callAt.set(p.callId, i);
  });
  const rank = (p: ContentPart) =>
    p.type === "tool-result" ? (callAt.get(p.callId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;

  const out: ContentPart[] = [];
  let batch: ContentPart[] = [];
  const flush = () => {
    out.push(...batch.sort((a, b) => rank(a) - rank(b)));
    batch = [];
  };
  for (const p of parts) {
    if (p.type === "tool-result") batch.push(p);
    else {
      flush();
      out.push(p);
    }
  }
  flush();
  return out;
}
