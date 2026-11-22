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
  type CardRegistry,
  type SurfaceAction,
  type SurfaceActivity,
  type SurfaceActivityState,
  type SurfaceCardAnswer,
  type SurfaceCatalogue,
  type SurfaceComponent,
  type SurfaceEventRecord,
  type SurfaceSpec,
  SURFACE_EVENT_METADATA_KEY,
  SURFACE_LIMITS,
  SurfaceLedger,
  authorizeSurfaceTool,
  evaluateSurfaceCondition,
  foldSurfaces,
  getAt,
  isSurfaceSpec,
  resolveSurfaceAction,
  runSurfaceToolAction,
  setAt,
  stripCardPayload,
  surfaceCardId,
} from "@supersolutions/super-chat-core";
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
  /** Current state of each surface on the active path, the person's edits included. */
  surfaces: Record<string, SurfaceSpec>;
  /** What became of the last action pressed on each surface. */
  surfaceActivity: Record<string, SurfaceActivity>;
};

/** What a finished turn cost, attached to the committed message. */
export type TurnMeta = {
  model: string;
  ms: number;
  usage?: RunState["usage"];
  steps?: number;
  /** Set when a person's button press produced this turn rather than a model. */
  origin?: "surface-action";
};

/** What started a turn. */
export type TurnKind = "send" | "regenerate" | "edit" | "surface-event" | "resume";

/** What a `TurnRunner` is told about the turn beyond its messages and `RunConfig`. */
export type TurnContext = {
  /** The thread the turn belongs to, as this client knows it. */
  readonly threadId: string;
  readonly kind: TurnKind;
  /**
   * True once the person asked for this turn to stop (`stop()`, `clear()`).
   *
   * `config.signal` aborts in that case and also when the client only stops
   * FOLLOWING the turn, because another thread was opened. A turn that runs
   * somewhere else should be cancelled there in the first case and left
   * running in the second, and the signal alone cannot tell them apart.
   */
  readonly stopRequested: boolean;
};

/**
 * Where a turn runs.
 *
 * The default is core's `runAgent`: the loop runs in this process. A host whose
 * agent loop runs on a server passes its own, which starts the turn there and
 * yields what the server reports as `RunEvent`s. Everything above the client —
 * the store, the hooks, the renderers — is the same either way.
 *
 * From `config` a runner outside this process uses three things: `signal`
 * (stop reading; see `TurnContext.stopRequested` for whether to cancel),
 * `onUserDecision` (await it after yielding `awaiting-user` to get the person's
 * answer, pass the answer on, then yield `user-responded`) and `forceSkillIds`.
 * A throw is shown as the turn's error.
 */
export type TurnRunner = (messages: Message[], config: RunConfig, turn: TurnContext) => AsyncIterable<RunEvent>;

export type AgentClientConfig = {
  /** Where turns run. Default: in this process, with the fields below. See `TurnRunner`. */
  runner?: TurnRunner;
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
  /** The card registry in use, so the UI can ask it which kinds are interactive. */
  cards?: CardRegistry;
  /** The surface catalogue in use, so the renderer validates against what the tools accept. */
  surfaceCatalogue?: SurfaceCatalogue;
};

/** How long local edits gather before they are written into the thread and saved. */
const SURFACE_SAVE_DELAY_MS = 300;
const SURFACE_QUEUE_LIMIT = 8;
const SURFACE_CONTEXT_CHARS = 4_000;

type QueuedSurfaceAction = { spec: SurfaceSpec; component: SurfaceComponent; action: Exclude<SurfaceAction, { type: "set" }> };

/** A card waiting on the user, with the resolver that unblocks the run. */
type PendingDecision = { card: Card; resolve: (action: CardAction) => void; reject: (reason: unknown) => void };

export class AgentClient {
  readonly store: Store<ThreadState>;
  private config: AgentClientConfig;
  private controller: AbortController | null = null;
  /** Whether the person asked the CURRENT turn to stop. One object per turn, so a turn left behind keeps its own answer. */
  private turnStop: { requested: boolean } = { requested: false };
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
  /** The current run's view of the surfaces, kept level with the person's edits. */
  private surfaceLedger: SurfaceLedger | null = null;
  private dirtySurfaces = new Set<string>();
  private surfaceSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Actions pressed while a run was busy. One run at a time, so they wait their turn. */
  private surfaceQueue: QueuedSurfaceAction[] = [];

  constructor(config: AgentClientConfig) {
    this.config = config;
    // `initialMessages` may be a plain linear list (pre-branching hosts) or a
    // tree with parentIds (a v2 snapshot); linkLinear handles both.
    const tree = linkLinear(config.initialMessages ?? []);
    const headId = config.initialHeadId ?? tree.at(-1)?.id ?? null;
    const messages = pathTo(tree, headId);
    this.store = new Store<ThreadState>({
      id: config.threadId ?? nextId("thread"),
      messages,
      tree,
      headId,
      run: initialRunState("", config.mode ?? "stream"),
      cards: [],
      jobs: [],
      attachments: [],
      status: "idle",
      surfaces: foldSurfaces(messages),
      surfaceActivity: {},
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
    const gen = this.generation;
    const quotes =
      opts.quotes?.length && documentStore ? await checkQuoteDrift(opts.quotes, documentStore) : (opts.quotes ?? []);
    // The drift lookup is an await, and a second send could have started in it.
    if (this.isRunning) throw new Error("A run is already in progress. Call stop() first.");
    // The user opened or started another thread while the drift lookup was out: the text they
    // typed belongs to the thread they left, and appending it to this one would be worse than
    // dropping it.
    if (gen !== this.generation) return;
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
    await this.run([...this.store.get().messages], opts, "send");
  }

  /**
   * Follow a turn that is already running somewhere else: a turn on a server
   * after this page reloaded, or one the server started by itself.
   *
   * Needs a `runner`, which is called with `kind: "resume"` and yields that
   * turn's events — usually a `run-snapshot` first. Yielding nothing means
   * there was nothing to follow, and the thread is left as it was. The thread
   * reads as running until the runner returns, so call this when the host has
   * reason to think a turn is live, not on every mount.
   */
  async resume(): Promise<void> {
    if (!this.config.runner || this.isRunning) return;
    await this.run([...this.store.get().messages], {}, "resume");
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
        this.flushSurfaceWrites();
        this.store.set((s) => onPath({ ...s, headId: m.id, messages: pathTo(s.tree, m.id) }));
        await this.run([...this.store.get().messages], opts, "regenerate");
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
    this.flushSurfaceWrites();
    this.appendMessage(userMessage(input), original.parentId ?? null);
    this.store.set(onPath);
    this.persist();
    await this.run([...this.store.get().messages], opts, "edit");
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
    this.flushSurfaceWrites();
    this.store.set((prev) => onPath({ ...prev, headId, messages: pathTo(prev.tree, headId) }));
    this.persist();
  }

  private async run(messages: Message[], opts: { forceSkillIds?: string[] }, kind: TurnKind): Promise<void> {
    const gen = this.generation;
    this.flushSurfaceWrites();
    const surfaces = new SurfaceLedger(this.store.get().surfaces);
    this.surfaceLedger = surfaces;
    const controller = new AbortController();
    this.controller = controller;
    const stop = { requested: false };
    this.turnStop = stop;
    const turn: TurnContext = {
      threadId: this.store.get().id,
      kind,
      get stopRequested() {
        return stop.requested;
      },
    };
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
      signal: controller.signal,
      forceSkillIds: opts.forceSkillIds,
      onHostTool: this.config.onHostTool,
      surfaces,
      // Suspend the run on an interactive card; `respond()` resolves it.
      onUserDecision: this.awaitDecision,
    };

    const runner: TurnRunner = this.config.runner ?? runAgent;
    try {
      for await (const event of runner(messages, runConfig, turn)) {
        if (gen !== this.generation) return; // thread switched under us — drop the rest
        this.apply(event);
      }
    } catch (e) {
      if (gen === this.generation) this.store.set((s) => ({ ...s, status: "error", error: e }));
    } finally {
      // Only what is still this turn's: a turn left behind can unwind after the
      // next one has started, and must not take that one's controller with it.
      if (this.controller === controller) this.controller = null;
      if (this.surfaceLedger === surfaces) this.surfaceLedger = null;
      if (gen === this.generation) {
        this.commitRun();
        this.drainSurfaceQueue();
      }
    }
  }

  private awaitDecision = (callId: string, card: Card): Promise<CardAction> =>
    new Promise<CardAction>((resolve, reject) => {
      this.pending.set(callId, { card, resolve, reject });
    });

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
      if (event.type === "card" && isSurfaceSpec(event.card.spec)) {
        next.surfaces = { ...s.surfaces, [event.card.spec.surfaceId]: event.card.spec };
      }
      if (event.type === "run-snapshot") {
        for (const { spec } of event.cards) {
          if (isSurfaceSpec(spec)) next.surfaces = { ...next.surfaces, [spec.surfaceId]: spec };
        }
      }
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
  private commitRun(origin?: TurnMeta["origin"]): void {
    // Edits still gathering belong to this turn's snapshot of the surface.
    this.flushSurfaceWrites(true);
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
        // Where the card belongs among the turn's text.
        ...(c.callId ? { callId: c.callId } : {}),
        // Where it is shown: a panel card reloads into the panel, not the chat.
        ...(c.placement === "panel" ? { placement: "panel" as const } : {}),
      }));

      // What the turn cost, recorded on the message. The UI has no other way to
      // show it after the fact: run state is reset by the next turn.
      const meta: TurnMeta = {
        model: this.config.model,
        ms: this.turnStartedAt ? Date.now() - this.turnStartedAt : 0,
        ...(s.run.usage && Object.keys(s.run.usage).length ? { usage: s.run.usage } : {}),
        ...(s.run.steps ? { steps: s.run.steps } : {}),
        ...(origin ? { origin } : {}),
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
    this.saveSurfacesNow();
    this.generation += 1; // invalidate any in-flight run before replacing state
    this.halt(false);
    this.surfaceQueue = [];
    this.threadMeta = stored.meta;
    const tree = linkLinear(stored.messages);
    const headId = stored.headId ?? tree.at(-1)?.id ?? null;
    this.store.set((s) => onPath({
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
      surfaceActivity: {},
    }));
    return true;
  }

  /** Start a fresh thread under a new id (`clear()` keeps the id; this doesn't). */
  newThread(): void {
    this.saveSurfacesNow();
    this.generation += 1;
    this.halt(false);
    this.surfaceQueue = [];
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
      surfaces: {},
      surfaceActivity: {},
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
    this.halt(true);
  }

  /**
   * End the current turn here. `byPerson` is false when the client is only
   * moving to another thread: a runner outside this process reads that from
   * `TurnContext.stopRequested` and leaves its turn running.
   */
  private halt(byPerson: boolean): void {
    if (!this.isRunning) return;
    if (byPerson) this.turnStop.requested = true;
    // A turn that was only left keeps its answer for good: nothing pressed later reaches it.
    else this.turnStop = { requested: false };
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
    // Release any suspended tool so the run can unwind instead of hanging. A
    // runner outside this process would pass a "cancel" on as the person's
    // answer, and leaving a thread is not an answer: its wait is aborted instead.
    const left = !byPerson && this.config.runner !== undefined;
    for (const [callId, entry] of this.pending) {
      if (left) entry.reject(Object.assign(new Error("The client stopped following this turn."), { name: "AbortError" }));
      else entry.resolve({ cardId: entry.card.id, callId, kind: "cancel", type: "cancel", at: Date.now() });
    }
    this.pending.clear();
    // Stop means stop: what was waiting behind this run does not start after it.
    for (const queued of this.surfaceQueue.splice(0)) {
      this.noteSurfaceActivity(queued.spec.surfaceId, queued.component.id, "cancelled", "Cancelled.");
    }
  }

  // ── surfaces ──────────────────────────────────────────────────────────────

  /**
   * Write one value into a surface's data model. Neighbours bound to it update at
   * once and no model is called. The thread is rewritten shortly after, not per
   * keystroke, so typing does not re-render every message.
   */
  setSurfaceData(surfaceId: string, path: string, value: unknown): boolean {
    const current = this.store.get().surfaces[surfaceId];
    if (!current || current.deleted || current.expired) return false;
    const data = setAt(current.data, path, value);
    if (!data || JSON.stringify(data).length > SURFACE_LIMITS.dataChars) return false;
    this.putSurface({ ...current, data, revision: current.revision + 1 });
    return true;
  }

  private putSurface(spec: SurfaceSpec): void {
    this.surfaceLedger?.put(spec);
    this.store.set((s) => ({ ...s, surfaces: { ...s.surfaces, [spec.surfaceId]: spec } }));
    this.dirtySurfaces.add(spec.surfaceId);
    if (this.surfaceSaveTimer) return;
    this.surfaceSaveTimer = setTimeout(() => this.saveSurfacesNow(), SURFACE_SAVE_DELAY_MS);
  }

  private saveSurfacesNow(): void {
    if (this.surfaceSaveTimer) clearTimeout(this.surfaceSaveTimer);
    this.surfaceSaveTimer = null;
    if (!this.dirtySurfaces.size) return;
    this.flushSurfaceWrites();
    this.persist();
  }

  /**
   * Fold pending edits into the newest snapshot of each surface: the live card, or
   * the stored one. A finished run's cards stay in `run` until the next one starts,
   * so they only count as the newest copy while that run has yet to commit.
   */
  private flushSurfaceWrites(uncommittedRun = this.isRunning): void {
    if (this.surfaceSaveTimer) clearTimeout(this.surfaceSaveTimer);
    this.surfaceSaveTimer = null;
    if (!this.dirtySurfaces.size) return;
    const ids = [...this.dirtySurfaces];
    this.dirtySurfaces.clear();
    this.store.set((s) => {
      let { run, tree } = s;
      for (const id of ids) {
        const spec = s.surfaces[id];
        if (!spec) continue;
        const cardId = surfaceCardId(id);
        if (uncommittedRun && run.cards.some((c) => c.id === cardId)) {
          run = { ...run, cards: run.cards.map((c) => (c.id === cardId ? { ...c, spec } : c)) };
          continue;
        }
        const holder = [...s.messages].reverse().find((m) => m.parts.some((p) => p.type === "artifact" && p.id === cardId));
        if (!holder) continue;
        tree = tree.map((m) =>
          m.id === holder.id
            ? { ...m, parts: m.parts.map((p) => (p.type === "artifact" && p.id === cardId ? { ...p, data: spec } : p)) }
            : m,
        );
      }
      if (run === s.run && tree === s.tree) return s;
      return { ...s, run, cards: run.cards, tree, messages: tree === s.tree ? s.messages : pathTo(tree, s.headId) };
    });
  }

  private noteSurfaceActivity(surfaceId: string, componentId: string, state: SurfaceActivityState, message?: string): SurfaceActivityState {
    this.store.set((s) => ({
      ...s,
      surfaceActivity: { ...s.surfaceActivity, [surfaceId]: { componentId, state, ...(message ? { message } : {}), at: Date.now() } },
    }));
    return state;
  }

  /**
   * Run the action of a control the person pressed.
   *
   * Takes the component's id rather than an action: what runs is read from the
   * validated spec here, so nothing in the page can substitute a different one.
   */
  async dispatchSurfaceAction(
    surfaceId: string,
    componentId: string,
    scope: { item?: unknown; index?: number } = {},
  ): Promise<SurfaceActivityState> {
    const spec = this.store.get().surfaces[surfaceId];
    const component = spec?.components.find((c) => c.id === componentId);
    const action = component?.["action"] as SurfaceAction | undefined;
    if (!spec || spec.deleted || spec.expired || !component || !action) {
      return this.noteSurfaceActivity(surfaceId, componentId, "refused", "This control is no longer available.");
    }
    const binding = { data: spec.data, ...scope };
    const disabledWhen = component["disabledWhen"] as Parameters<typeof evaluateSurfaceCondition>[0];
    if (disabledWhen && evaluateSurfaceCondition(disabledWhen, binding)) {
      return this.noteSurfaceActivity(surfaceId, componentId, "refused", "This control is unavailable right now.");
    }

    const resolved = resolveSurfaceAction(action, binding);
    if (resolved.type === "set") {
      let data: Record<string, unknown> | undefined = spec.data;
      for (const update of resolved.updates) data = data && setAt(data, update.path, update.value);
      if (!data) return this.noteSurfaceActivity(surfaceId, componentId, "failed", "That change could not be applied.");
      this.putSurface({ ...spec, data, revision: spec.revision + 1 });
      return this.noteSurfaceActivity(surfaceId, componentId, "done");
    }

    if (resolved.type === "tool") {
      const verdict = authorizeSurfaceTool(resolved.tool, resolved.args, this.config.tools, this.config.toolResolution);
      if (!verdict.ok) return this.noteSurfaceActivity(surfaceId, componentId, "refused", verdict.reason);
    }

    const queued: QueuedSurfaceAction = { spec, component, action: resolved };
    if (this.isRunning) {
      if (this.surfaceQueue.length >= SURFACE_QUEUE_LIMIT) {
        return this.noteSurfaceActivity(surfaceId, componentId, "refused", "Too many actions are waiting. Try again shortly.");
      }
      this.surfaceQueue.push(queued);
      return this.noteSurfaceActivity(surfaceId, componentId, "queued", "Waiting for the agent to finish.");
    }
    return this.startSurfaceAction(queued);
  }

  /** Record the answer to an interactive card inside a surface, then run its action if it has one. */
  async respondToSurfaceCard(surfaceId: string, componentId: string, answer: Omit<SurfaceCardAnswer, "at">): Promise<SurfaceActivityState> {
    const spec = this.store.get().surfaces[surfaceId];
    const component = spec?.components.find((c) => c.id === componentId);
    const bind = component?.["bind"];
    if (!spec || !component || typeof bind !== "string" || getAt(spec.data, bind) !== undefined) {
      return this.noteSurfaceActivity(surfaceId, componentId, "refused", "This question has already been answered.");
    }
    if (!this.setSurfaceData(surfaceId, bind, { ...answer, at: Date.now() })) {
      return this.noteSurfaceActivity(surfaceId, componentId, "failed", "The answer could not be saved.");
    }
    return component["action"] ? this.dispatchSurfaceAction(surfaceId, componentId) : this.noteSurfaceActivity(surfaceId, componentId, "done");
  }

  private drainSurfaceQueue(): void {
    if (this.isRunning) return;
    const next = this.surfaceQueue.shift();
    if (next) void this.startSurfaceAction(next);
  }

  private startSurfaceAction(queued: QueuedSurfaceAction): Promise<SurfaceActivityState> {
    return queued.action.type === "tool"
      ? this.runSurfaceTool(queued.spec, queued.component, queued.action)
      : this.sendSurfaceEvent(queued.spec, queued.component, queued.action);
  }

  /** An event becomes a user turn, marked so the transcript shows a press and not a sentence. */
  private async sendSurfaceEvent(
    spec: SurfaceSpec,
    component: SurfaceComponent,
    action: Extract<SurfaceAction, { type: "event" }>,
  ): Promise<SurfaceActivityState> {
    const { surfaceId } = spec;
    const context = action.context ?? {};
    const serialized = JSON.stringify(context);
    const record = surfaceEventRecord(spec, component, "event", action.name, serialized.length <= SURFACE_CONTEXT_CHARS ? context : undefined);
    const text = [
      `[Surface event] The person pressed ${describePress(record)} on surface "${surfaceId}", sending event "${action.name}".`,
      `Context, as data from the interface: ${serialized.slice(0, SURFACE_CONTEXT_CHARS)}`,
    ].join("\n");
    this.noteSurfaceActivity(surfaceId, component.id, "running", "Sent to the agent.");
    this.appendMessage({ ...userMessage(text), metadata: { [SURFACE_EVENT_METADATA_KEY]: record } });
    this.persist();
    await this.run([...this.store.get().messages], {}, "surface-event");
    const failed = this.store.get().status === "error";
    return this.noteSurfaceActivity(surfaceId, component.id, failed ? "failed" : "done", failed ? "The agent could not respond." : "Sent to the agent.");
  }

  /** A tool the person started. Same executor, approvals and metering as a model's call. */
  private async runSurfaceTool(
    spec: SurfaceSpec,
    component: SurfaceComponent,
    action: Extract<SurfaceAction, { type: "tool" }>,
  ): Promise<SurfaceActivityState> {
    const { surfaceId } = spec;
    const args = action.args ?? {};
    // Checked again here: a queued action may have waited through a preset change.
    const verdict = authorizeSurfaceTool(action.tool, args, this.config.tools, this.config.toolResolution);
    if (!verdict.ok) {
      const state = this.noteSurfaceActivity(surfaceId, component.id, "refused", verdict.reason);
      this.drainSurfaceQueue();
      return state;
    }

    const record = surfaceEventRecord(spec, component, "tool", action.tool);
    this.noteSurfaceActivity(surfaceId, component.id, "running", `Running ${action.tool}.`);
    this.appendMessage({
      ...userMessage(`[Surface action] The person pressed ${describePress(record)} on surface "${surfaceId}", which called the tool "${action.tool}".`),
      metadata: { [SURFACE_EVENT_METADATA_KEY]: record },
    });
    this.persist();

    const gen = this.generation;
    this.flushSurfaceWrites();
    this.controller = new AbortController();
    this.turnStartedAt = Date.now();
    this.store.set((s) => ({
      ...s,
      run: initialRunState(nextId("run"), "sync"),
      cards: [],
      status: "running",
      error: undefined,
      stopping: false,
    }));

    let result: Extract<RunEvent, { type: "tool-result" }> | undefined;
    try {
      const events = runSurfaceToolAction({
        tool: verdict.tool,
        args,
        surfaceId,
        componentId: component.id,
        provider: this.config.provider.id,
        model: this.config.model,
        vars: this.config.vars,
        signal: this.controller.signal,
        toolTimeoutMs: this.config.toolTimeoutMs,
        meter: this.config.meter,
        meteringMetadata: this.config.meteringMetadata,
        onUserDecision: this.awaitDecision,
        onHostTool: this.config.onHostTool,
      });
      for await (const event of events) {
        if (gen !== this.generation) return "cancelled";
        if (event.type === "tool-result") result = event;
        this.apply(event);
      }
    } catch (e) {
      if (gen === this.generation) this.store.set((s) => ({ ...s, status: "error", error: e }));
    } finally {
      this.controller = null;
    }
    if (gen !== this.generation) return "cancelled";

    let state: SurfaceActivityState;
    let message: string | undefined;
    if (!result || (result.failure && result.failure !== "denied")) {
      state = "failed";
      message = failureMessage(result?.output) ?? `${action.tool} failed.`;
    } else if (result.failure === "denied") {
      state = "cancelled";
      message = "Cancelled.";
    } else {
      state = "done";
      message = "Done.";
      if (action.resultPath && !this.setSurfaceData(surfaceId, action.resultPath, stripCardPayload(result.output))) {
        state = "failed";
        message = "The result was too large to show here.";
      }
    }
    this.commitRun("surface-action");
    this.noteSurfaceActivity(surfaceId, component.id, state, message);
    this.drainSurfaceQueue();
    return state;
  }

  clear(): void {
    this.dirtySurfaces.clear();
    this.generation += 1;
    this.stop();
    this.surfaceQueue = [];
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
      surfaces: {},
      surfaceActivity: {},
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

/** Re-derive surfaces after the head moved: each branch shows them as it left them. */
const onPath = (s: ThreadState): ThreadState => ({ ...s, surfaces: foldSurfaces(s.messages) });

function surfaceEventRecord(
  spec: SurfaceSpec,
  component: SurfaceComponent,
  type: SurfaceEventRecord["type"],
  name: string,
  context?: Record<string, unknown>,
): SurfaceEventRecord {
  const label = component["label"];
  return {
    surfaceId: spec.surfaceId,
    componentId: component.id,
    ...(spec.title ? { title: spec.title } : {}),
    ...(typeof label === "string" ? { label } : {}),
    type,
    name,
    ...(context ? { context } : {}),
  };
}

const describePress = (record: SurfaceEventRecord) => (record.label ? JSON.stringify(record.label) : `control "${record.componentId}"`);

const failureMessage = (output: unknown): string | undefined => {
  const error = (output as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error.slice(0, 200) : undefined;
};

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
