"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AgentClient, AgentProvider, useAgentClient, useAgentState, useAttachments, useJobs, useThread, useThreadList } from "@zzyzxlabs/super-chat-react";
import { BUILTIN_RENDERERS, CardRendererProvider, ContextInspector, Composer, DocumentQuoteProvider, Thread } from "@zzyzxlabs/super-chat-ui";
import {
  ToolRegistry,
  createGenerateImageTool,
  createOpenAIImageProvider,
  type RunEvent,
  type RunMode,
  type StoredFile,
} from "@zzyzxlabs/super-chat-core";
import {
  MODELS,
  PROVIDER_PROFILES,
  WEB_SEARCH_TOOLS,
  buildContextBuilder,
  buildProvider,
  buildTransport,
  documentStore,
  fileStore,
  jobStore,
  threadStores,
  toolRegistry,
  type ThreadBackend,
  type TransportMode,
  type ProviderId,
} from "@/agent/setup";
import { IS_STATIC_DEMO } from "@/agent/deployment";

const EXAMPLES = [
  { title: "Legal — clause review", prompt: "Review the Vertex MSA for liability exposure." },
  { title: "Legal — sourced answer", prompt: "Can we exclude liability entirely in our standard terms?" },
  { title: "Marketing — funnel", prompt: "Where are we losing people in the signup funnel?" },
  { title: "Marketing — positioning", prompt: "How do we compare against Northwind and Acme?" },
  { title: "Markets — chart", prompt: "Show me SUI price action over the last 60 days." },
  { title: "Interactive — confirm", prompt: "Set an alert for when SUI goes above $5." },
  { title: "Manual skill", prompt: "Do a deep research pass on the market structure." },
];

export default function RunPanel() {
  const [transportMode, setTransportMode] = useState<TransportMode>("demo");
  const [providerId, setProviderId] = useState<ProviderId>("openai");
  const [customBaseUrl, setCustomBaseUrl] = useState(PROVIDER_PROFILES.oneapi.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(MODELS.openai[0]!);
  const [imageModel, setImageModel] = useState("gpt-image-1");
  const [mode, setMode] = useState<RunMode>("stream");
  const [presets, setPresets] = useState<string[]>(["observer", "executor"]);
  const [threadBackend, setThreadBackend] = useState<ThreadBackend>("local");
  const [webSearch, setWebSearch] = useState(false);
  const effectiveThreadBackend: ThreadBackend = IS_STATIC_DEMO ? "local" : threadBackend;
  const threadStore = threadStores[effectiveThreadBackend];

  const contextBuilder = useMemo(() => buildContextBuilder(), []);
  const customBaseUrlValid = /^https?:\/\/[^\s]+$/i.test(customBaseUrl);
  const profile = useMemo(
    () =>
      providerId === "oneapi" && customBaseUrlValid
        ? { ...PROVIDER_PROFILES.oneapi, baseUrl: customBaseUrl }
        : PROVIDER_PROFILES[providerId],
    [providerId, customBaseUrl, customBaseUrlValid],
  );

  // BYOK with an empty key falls back to demo — track that as a VISIBLE fact,
  // not a silent one, so nobody attaches a demo-minted file id believing it is
  // real. The demo script speaks OpenAI's wire shape, so Anthropic has no demo
  // mode: it falls back to the proxy instead.
  const effectiveMode: TransportMode = IS_STATIC_DEMO
    ? "demo"
    : transportMode === "direct" && !apiKey.trim() && providerId === "openai"
      ? "demo"
      : transportMode === "demo" && providerId !== "openai"
        ? "proxy"
        : transportMode;

  const provider = useMemo(() => {
    const directKey = providerId === "oneapi" && !customBaseUrlValid ? undefined : apiKey || undefined;
    return buildProvider(buildTransport(effectiveMode, profile, directKey), effectiveMode, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportMode, profile, transportMode === "direct" ? apiKey : "static"]);

  // Clone the shared catalogue (including its preset grants) so this client can
  // add a provider-bound media tool without mutating every other dev panel.
  const tools = useMemo(() => {
    const registry = new ToolRegistry();
    for (const tool of toolRegistry.list()) registry.register(tool, toolRegistry.presetsFor(tool.name));
    if (effectiveMode !== "demo" && profile.protocol !== "anthropic-messages") {
      const images = createOpenAIImageProvider({
        transport: provider.transport,
        id: provider.id,
        label: `${provider.label} Images`,
        ...(imageModel.trim() ? { defaultModel: imageModel.trim() } : {}),
      });
      registry.register(createGenerateImageTool(images), ["executor"]);
    }
    return registry;
  }, [effectiveMode, profile.protocol, provider, imageModel]);

  const client = useMemo(() => {
    return new AgentClient({
      provider,
      model,
      contextBuilder,
      tools,
      toolResolution: { presets },
      mode,
      maxSteps: 8,
      jobStore,
      threadStore,
      documentStore,
    });
    // Rebuilt when the persistence backend changes too — the thread list and
    // hydration both read through the store the client holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, effectiveThreadBackend]);

  // The outgoing client's in-flight run does not stop on its own just because
  // a new one replaced it in the provider — without this, switching provider
  // or thread backend mid-stream leaves the old run streaming into a store
  // nothing renders anymore.
  useEffect(() => {
    return () => {
      client.stop();
    };
  }, [client]);

  /** Upload (or reuse a previous upload of the same file) and stage the part. */
  const attachFile = async (picked: File) => {
    if (!provider.uploadFile) return;
    // Dedup: the same filename+size already uploaded to THIS provider means
    // "reference the existing id", not "mint a second one".
    const prior = (await fileStore.list()).find(
      (f) => f.filename === picked.name && f.sizeBytes === picked.size && f.ref.provider === provider.id,
    );
    const stored: StoredFile =
      prior ??
      (await (async () => {
        const ref = await provider.uploadFile!({
          data: picked,
          filename: picked.name,
          ...(picked.type ? { mediaType: picked.type } : {}),
        });
        const fresh: StoredFile = {
          ref,
          filename: picked.name,
          ...(picked.type ? { mediaType: picked.type } : {}),
          sizeBytes: picked.size,
          threadId: client.store.get().id,
          createdAt: Date.now(),
        };
        await fileStore.put(fresh);
        return fresh;
      })());
    client.attach({
      type: "file",
      source: stored.ref,
      mediaType: stored.mediaType ?? "application/octet-stream",
      filename: stored.filename,
    });
  };

  useEffect(() => {
    client.configure({
      model,
      mode,
      toolResolution: { presets },
      // Provider-hosted: declared here, executed inside the provider's own
      // response. No registry entry and no preset — there is no executor of
      // ours to gate, so the gate is this toggle.
      providerTools: webSearch ? WEB_SEARCH_TOOLS : undefined,
    });
  }, [client, model, mode, presets, webSearch]);

  // Reopen the live thread whenever the client is rebuilt (reload, transport
  // switch) — before this, both silently discarded the conversation.
  const lastThreadId = useRef<string | null>(null);
  useEffect(() => {
    const unsub = client.store.subscribe(() => {
      lastThreadId.current = client.store.get().id;
    });
    void (async () => {
      const target = lastThreadId.current ?? (await threadStore.list())[0]?.id;
      // Guard against the fast-first-send race: if the user already started
      // talking to the fresh client while we awaited the list, opening the old
      // thread now would DISCARD their turn. Their action wins.
      if (client.isRunning || client.store.get().messages.length) return;
      if (target && target !== client.store.get().id) await client.openThread(target);
    })();
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return (
    <AgentProvider client={client}>
      <CardRendererProvider renderers={BUILTIN_RENDERERS}>
        <DocumentQuoteProvider>
        <div className="dev__run">
          <div className="dev__runmain">
            <div className="dev__runbar">
              {IS_STATIC_DEMO ? null : <select
                className="dev__select"
                aria-label="Chat provider"
                value={providerId}
                onChange={(e) => {
                  const v = e.target.value as ProviderId;
                  setProviderId(v);
                  setModel(MODELS[v][0]!);
                  setImageModel(v === "openai" ? "gpt-image-1" : v === "oneapi" ? "dall-e-3" : "");
                  setWebSearch(false);
                  if (v !== "openai" && mode === "background") setMode("stream");
                  if (v !== "openai" && transportMode === "demo") setTransportMode("proxy");
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="oneapi">OpenAI-compatible / oneAPI</option>
                <option value="anthropic">Anthropic</option>
              </select>}
              {IS_STATIC_DEMO ? null : <select
                className="dev__select"
                aria-label="Transport mode"
                value={transportMode}
                onChange={(e) => setTransportMode(e.target.value as TransportMode)}
              >
                <option value="demo" disabled={providerId !== "openai"}>
                  Demo transport
                </option>
                <option value="proxy">Server proxy</option>
                <option value="direct">BYOK direct</option>
              </select>}
              {!IS_STATIC_DEMO && transportMode === "direct" ? (
                <>
                  {providerId === "oneapi" ? (
                    <input
                      className="dev__select"
                      type="url"
                      aria-label="Provider base URL"
                      title={customBaseUrlValid ? "OpenAI-compatible API root" : "Enter an absolute http(s) URL"}
                      value={customBaseUrl}
                      onChange={(e) => setCustomBaseUrl(e.target.value)}
                    />
                  ) : null}
                  <input
                    className="dev__select"
                    type="password"
                    aria-label="Provider API key"
                    placeholder="API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </>
              ) : null}
              {IS_STATIC_DEMO ? null : providerId === "oneapi" ? (
                <input className="dev__select" aria-label="Model id" placeholder="Model id" value={model} onChange={(e) => setModel(e.target.value)} />
              ) : (
                <select className="dev__select" aria-label="Model id" value={model} onChange={(e) => setModel(e.target.value)}>
                  {MODELS[providerId].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              {!IS_STATIC_DEMO && profile.protocol !== "anthropic-messages" && effectiveMode !== "demo" ? (
                <input
                  className="dev__select"
                  aria-label="Image model id"
                  title="Default model used by the generateImage agent tool"
                  placeholder="Image model id"
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                />
              ) : null}
              {IS_STATIC_DEMO ? null : <select className="dev__select" aria-label="Run mode" value={mode} onChange={(e) => setMode(e.target.value as RunMode)}>
                <option value="stream">stream</option>
                <option value="sync">sync</option>
                <option value="background" disabled={!provider.capabilities.backgroundJobs}>background</option>
              </select>}
              {(["observer", "executor"] as const).map((p) => (
                <label key={p} className="dev__toggle">
                  <input
                    type="checkbox"
                    checked={presets.includes(p)}
                    onChange={(e) => setPresets((prev) => (e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)))}
                  />
                  {p}
                </label>
              ))}
              {IS_STATIC_DEMO ? null : <label className="dev__toggle" title="Provider-hosted web search — no executor, no preset">
                <input
                  type="checkbox"
                  checked={webSearch}
                  disabled={effectiveMode === "demo" || !WEB_SEARCH_TOOLS[providerId]}
                  onChange={(e) => setWebSearch(e.target.checked)}
                />
                web search
              </label>}
              <ReattachPicker providerId={provider.id} />
              <ClearButton />
            </div>

            {effectiveMode === "demo" ? (
              <p className="dev__banner">
                {transportMode === "direct"
                  ? "No API key entered — running on the DEMO transport until you paste one. Uploads mint demo ids, not real ones."
                  : IS_STATIC_DEMO
                    ? "Public demo: replies are scripted and all state stays in this browser. The adapter, tool loop, cards and context assembly are real."
                    : "Demo transport: replies are scripted, but everything below the provider is real — request building, the tool loop, card suspension and context assembly. Switch to proxy or BYOK for a live model."}
              </p>
            ) : null}
            {!IS_STATIC_DEMO && providerId === "oneapi" && transportMode === "proxy" ? (
              <p className="dev__banner">
                Server proxy uses OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_API_KEY. The browser never sends either value.
              </p>
            ) : null}
            {!IS_STATIC_DEMO && providerId === "oneapi" && transportMode === "direct" && !customBaseUrlValid ? (
              <p className="dev__banner">Enter an absolute http(s) Base URL before using this provider.</p>
            ) : null}
            {!IS_STATIC_DEMO && providerId !== "openai" && transportMode === "direct" && !apiKey.trim() ? (
              <p className="dev__banner">Enter an API key before sending a BYOK request.</p>
            ) : null}

            <Thread empty={<Examples />} />
            <Composer placeholder="Ask about a contract, a funnel, or a market…" onAttachFile={attachFile} />
          </div>

          <aside className="dev__runside">
            <ThreadsPanel backend={IS_STATIC_DEMO ? undefined : { value: threadBackend, onChange: setThreadBackend }} />
            <EventStream />
            <ContextInspector />
          </aside>
        </div>
        </DocumentQuoteProvider>
      </CardRendererProvider>
    </AgentProvider>
  );
}

const THREADS_PAGE_SIZE = 20;

/**
 * The thread picker — the ThreadStore demo. Snapshot-per-thread in
 * localStorage: reload the page and the conversation is still here.
 */
function ThreadsPanel({ backend }: { backend?: { value: ThreadBackend; onChange: (v: ThreadBackend) => void } }) {
  const { threads, activeId, open, create, remove } = useThreadList();
  const { isRunning } = useThread();
  // A demo cap, not virtualization — the list only grows while this panel is
  // open, so "show more" is enough to keep it from rendering everything ever
  // saved.
  const [visible, setVisible] = useState(THREADS_PAGE_SIZE);
  const shown = threads.slice(0, visible);

  return (
    <div className="dev__events">
      <div className="sc-panel__title">
        Threads
        <button
          type="button"
          className="sc-btn sc-btn--ghost sc-btn--sm"
          style={{ float: "right" }}
          disabled={isRunning}
          onClick={create}
        >
          + New
        </button>
      </div>
      {backend ? (
        <div className="dev__row" style={{ marginBottom: 6 }}>
          <select
            className="dev__select"
            value={backend.value}
            disabled={isRunning}
            onChange={(e) => backend.onChange(e.target.value as ThreadBackend)}
            title="Same ThreadStore interface, different backend"
          >
            <option value="local">localStorage</option>
            <option value="server">Server (REST)</option>
          </select>
        </div>
      ) : null}
      {threads.length === 0 ? (
        <p className="sc-muted" style={{ fontSize: 12 }}>
          Threads persist to localStorage as you chat.
        </p>
      ) : (
        <>
          {shown.map((t) => (
            <div key={t.id} className="dev__event" style={{ alignItems: "center", gap: 6 }}>
              <button
                type="button"
                className="sc-btn sc-btn--ghost sc-btn--sm"
                style={{ flex: 1, textAlign: "left", ...(t.id === activeId ? { fontWeight: 600 } : {}) }}
                disabled={isRunning}
                onClick={() => void open(t.id)}
                title={t.id}
              >
                {t.title ?? "(untitled)"}
                <span className="sc-muted" style={{ display: "block", fontSize: 11 }}>
                  {t.messageCount} message{t.messageCount === 1 ? "" : "s"}
                </span>
              </button>
              <button
                type="button"
                className="sc-btn sc-btn--ghost sc-btn--sm"
                aria-label={`Delete ${t.title ?? t.id}`}
                disabled={isRunning}
                onClick={() => void remove(t.id)}
              >
                ×
              </button>
            </div>
          ))}
          {threads.length > visible ? (
            <button
              type="button"
              className="sc-btn sc-btn--ghost sc-btn--sm"
              style={{ width: "100%", marginTop: 4 }}
              onClick={() => setVisible((n) => n + THREADS_PAGE_SIZE)}
            >
              Show more ({threads.length - visible} more)
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Re-attach a previous upload without re-uploading — the FileStore's read
 * path. Only refs minted by the CURRENT provider are offered; a foreign ref
 * would degrade to a placeholder.
 */
function ReattachPicker({ providerId }: { providerId: string }) {
  const client = useAgentClient();
  const { attachments } = useAttachments();
  const [files, setFiles] = useState<StoredFile[]>([]);

  useEffect(() => {
    // A fast provider switch can let an older `.list()` resolve after a newer
    // one — the ignore flag makes sure a stale response never overwrites a
    // fresher one that already landed.
    let ignore = false;
    void fileStore.list().then((all) => {
      if (ignore) return;
      setFiles(all.filter((f) => f.ref.provider === providerId));
    });
    return () => {
      ignore = true;
    };
  }, [providerId, attachments.length]);

  if (!files.length) return null;
  return (
    <select
      className="dev__select"
      value=""
      title="Attach a previous upload by id — no re-upload"
      onChange={(e) => {
        const picked = files.find((f) => f.ref.id === e.target.value);
        if (picked) {
          client.attach({
            type: "file",
            source: picked.ref,
            mediaType: picked.mediaType ?? "application/octet-stream",
            filename: picked.filename,
          });
        }
        e.target.value = "";
      }}
    >
      <option value="" disabled>
        ↻ Re-attach…
      </option>
      {files.map((f) => (
        <option key={f.ref.id} value={f.ref.id}>
          {f.filename}
        </option>
      ))}
    </select>
  );
}

function ClearButton() {
  const { clear, messages, isRunning } = useThread();
  return (
    <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" disabled={!messages.length || isRunning} onClick={clear}>
      Clear
    </button>
  );
}

function Examples() {
  const { send } = useThread();
  return (
    <div className="dev__prompts">
      <p className="sc-muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
        One agent, three unrelated domains. Which skill loads — and which tools it unlocks — is decided per message by
        the registry, not by which app you opened.
      </p>
      {EXAMPLES.map((e) => (
        <button key={e.title} type="button" className="dev__prompt" onClick={() => void send(e.prompt)}>
          <strong>{e.title}</strong>
          <span>{e.prompt}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The raw event stream.
 *
 * Included because the events ARE the runtime's public API — React state, a CLI
 * renderer and a server-side recorder are all reducers over this one stream, and
 * a developer evaluating the framework needs to see its shape.
 */
function EventStream() {
  // Also resumes background jobs from a previous session (one-shot on mount) —
  // without this call, a persisted job handle would never be polled again.
  const jobs = useJobs();
  const run = useAgentState((s) => s.run);
  type LogEntry = { type: string; detail: string };
  const [streamEvents, setStreamEvents] = useState<LogEntry[]>([]);

  // `run.parts`/`run.cards` only ever GROW within one run (text deltas merge
  // into the last part rather than appending), so re-scanning all of them on
  // every notify — which during a stream is every token — redoes the same
  // work each time. Track how far in we already are and append only what's
  // new; a new run (fresh `runId`) resets the cursors and the log.
  const partsSeen = useRef(0);
  const cardsSeen = useRef(0);
  const traceSeen = useRef(false);
  const runIdSeen = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (run.runId !== runIdSeen.current) {
      runIdSeen.current = run.runId;
      partsSeen.current = 0;
      cardsSeen.current = 0;
      traceSeen.current = false;
      setStreamEvents([]);
    }

    const additions: LogEntry[] = [];
    if (run.trace && !traceSeen.current) {
      traceSeen.current = true;
      additions.push({ type: "context-built", detail: `${run.trace.totals.total} tok · ${run.trace.entries.length} layers` });
    }
    for (let i = partsSeen.current; i < run.parts.length; i += 1) {
      const p = run.parts[i]!;
      if (p.type === "tool-call") additions.push({ type: "tool-call", detail: `${p.name}(${JSON.stringify(p.input).slice(0, 46)}…)` });
      if (p.type === "tool-result") additions.push({ type: "tool-result", detail: `${p.name}${p.failure ? ` · ${p.failure}` : ""}` });
    }
    partsSeen.current = run.parts.length;
    for (let i = cardsSeen.current; i < run.cards.length; i += 1) {
      additions.push({ type: "card", detail: (run.cards[i]!.spec as { kind?: string }).kind ?? "?" });
    }
    cardsSeen.current = run.cards.length;

    if (additions.length) setStreamEvents((prev) => [...prev, ...additions]);
  }, [run]);

  // These reflect a CURRENT value rather than an accumulating list — cheap to
  // recompute in full each render, unlike the parts/cards scan above.
  const events = useMemo(() => {
    const extras: LogEntry[] = [];
    if (run.pendingCard) extras.push({ type: "awaiting-user", detail: (run.pendingCard.spec as { kind?: string }).kind ?? "?" });
    if (run.job) extras.push({ type: "job-status", detail: `${run.job.handle.id.slice(0, 14)}… ${run.job.status}` });
    for (const j of jobs) {
      if (j.handle.id !== run.job?.handle.id) extras.push({ type: "job-resumed", detail: `${j.handle.id.slice(0, 14)}… ${j.status}` });
    }
    if (run.usage.totalTokens) extras.push({ type: "usage", detail: `${run.usage.totalTokens} tok total` });
    if (run.status === "done") extras.push({ type: "run-finish", detail: `${run.finishReason} · ${run.steps} step(s)` });
    return [...streamEvents, ...extras];
  }, [streamEvents, run.pendingCard, run.job, jobs, run.usage.totalTokens, run.status, run.finishReason, run.steps]);

  const cls = (t: string) =>
    t.startsWith("tool") ? "tool" : t === "card" ? "card" : t === "awaiting-user" ? "user" : t === "error" ? "error" : "";

  return (
    <div className="dev__events">
      <div className="sc-panel__title">Run events</div>
      {events.length === 0 ? (
        <p className="sc-muted" style={{ fontSize: 12 }}>
          Send a message to see the event stream.
        </p>
      ) : (
        events.map((e, i) => (
          <div key={i} className={`dev__event dev__event--${cls(e.type)}`}>
            <span className="dev__event-dot" aria-hidden />
            <span className="dev__event-body">
              {e.type}
              <div className="dev__event-detail">{e.detail}</div>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
