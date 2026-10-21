"use client";

// Chat primitives.
//
// The layout rule that matters: interactive cards render at TOP LEVEL, in part
// order, never inside a collapsible "steps" group. Read-only tool activity does
// collapse — a turn that made six lookups should not push the answer off screen.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  estimateTokens,
  isCardCarrier,
  type Card,
  type CardSpec,
  type ContentPart,
  type MediaSource,
  type Message,
  type RunState,
} from "@zzyzxlabs/super-chat-core";
import {
  useAgentClient,
  useAttachments,
  useBranches,
  useCardAction,
  useCards,
  useRun,
  useSkills,
  useThread,
  useTools,
  type TurnMeta,
} from "@zzyzxlabs/super-chat-react";
import { CardRenderer, CardSkeleton } from "./renderer-registry.js";
import { newMarkdownStream, renderMarkdown, renderMarkdownStream } from "./markdown.js";
import { useDocumentQuotes } from "./quotes.js";
import {
  applyPick,
  findTrigger,
  rankItems,
  SuggestMenu,
  useActiveIndex,
  useSuggestItems,
  type SuggestItem,
  type TriggerState,
} from "./Autocomplete.js";
import { Orb } from "./agent/Orb.js";
import { Thinking } from "./agent/Thinking.js";

function partsOf(message: Message) {
  const cards: Card[] = [];
  const rest: ContentPart[] = [];
  const providerTools: { id: string; kind: string }[] = [];
  for (const p of message.parts) {
    if (p.type === "artifact" && p.kind.startsWith("provider-tool:")) {
      // Work the PROVIDER did (web search, code interpreter) — no call of ours
      // to render, but the user should see it happened.
      providerTools.push({ id: p.id, kind: p.kind.slice("provider-tool:".length) });
      continue;
    }
    if (p.type === "artifact" && p.kind.startsWith("card:")) {
      // `data` stays the spec itself rather than a { spec, action } envelope:
      // core's history-shedding reads `data.kind` to build the expired stub,
      // and nesting would hide it. The user's answer rides alongside in
      // `action` — it has to survive, because an answered card re-rendered
      // from history must show what was actually chosen, and the renderer's
      // own state is long gone by then.
      const expired = (p.data as { expired?: boolean } | null)?.expired === true;
      cards.push({
        id: p.id,
        spec: p.data as Card["spec"],
        ...(p.action ? { action: p.action as Card["action"] } : {}),
        ...(expired ? { expired: true } : {}),
      });
      continue;
    }
    rest.push(p);
  }
  return { cards, rest, providerTools };
}

const PROVIDER_TOOL_LABELS: Record<string, string> = {
  web_search_call: "Searched the web",
  web_fetch_tool_result: "Fetched a page",
  code_interpreter_call: "Ran code",
  server_tool_use: "Used a hosted tool",
  web_search_tool_result: "Searched the web",
  bash_code_execution_tool_result: "Ran code",
};

/** "Searched the web" chips — provider-side work, shown so answers aren't magic. */
function ProviderToolChips({ items }: { items: { id: string; kind: string }[] }) {
  return (
    <div className="sc-providertools" style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0" }}>
      {items.map((t) => (
        <span key={t.id} className="sc-pill" title={t.kind}>
          ⚙ {PROVIDER_TOOL_LABELS[t.kind] ?? t.kind.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

/**
 * The line under a finished answer: what it cost, and what you can do with it.
 *
 * Actions are always visible rather than revealed on hover — a hover-only
 * control does not exist on a touch device.
 */
function MessageMeta({ meta, onRegenerate }: { meta?: TurnMeta; onRegenerate?: () => void }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const bits = [
    meta?.ms ? formatMs(meta.ms) : null,
    // Step count only when the turn actually looped — "1 step" is noise.
    meta?.steps && meta.steps > 1 ? `${meta.steps} steps` : null,
    meta?.model ?? null,
    meta?.usage?.totalTokens ? `${meta.usage.totalTokens.toLocaleString()} tok` : null,
  ].filter(Boolean);

  return (
    <div className="sc-msgmeta">
      {bits.length ? <span className="sc-msgmeta__facts">{bits.join(" · ")}</span> : null}
      <button
        type="button"
        className={`sc-btn sc-btn--ghost sc-btn--sm${copyState === "failed" ? " sc-tone--negative" : ""}`}
        onClick={(e) => {
          const body = e.currentTarget.closest(".sc-msg")?.querySelector(".sc-msg__text");
          // Report the failure rather than swallowing it — a copy button that
          // does nothing visible is indistinguishable from a broken one.
          void (navigator.clipboard?.writeText(body?.textContent ?? "") ?? Promise.reject())
            .then(() => setCopyState("copied"))
            .catch(() => setCopyState("failed"))
            .finally(() => setTimeout(() => setCopyState("idle"), 1500));
        }}
      >
        {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
      </button>
      {onRegenerate ? (
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" onClick={onRegenerate}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function MessageView({
  message,
  respond,
  onRegenerate,
}: {
  message: Message;
  respond?: ReturnType<typeof useCardAction>["respond"];
  onRegenerate?: () => void;
}) {
  const { cards, rest, providerTools } = useMemo(() => partsOf(message), [message]);

  // One pass over `rest` instead of four separate filter/map passes.
  const { text, reasoning, calls, results } = useMemo(() => {
    let text = "";
    let reasoning = "";
    const calls: Extract<ContentPart, { type: "tool-call" }>[] = [];
    const results: Extract<ContentPart, { type: "tool-result" }>[] = [];
    for (const p of rest) {
      if (p.type === "text") text += (p as { text: string }).text;
      else if (p.type === "reasoning") reasoning += (p as { text: string }).text;
      else if (p.type === "tool-call") calls.push(p);
      else if (p.type === "tool-result") results.push(p);
    }
    return { text, reasoning, calls, results };
  }, [rest]);
  const html = useMemo(() => renderMarkdown(text), [text]);

  // Split cards: interactive ones stay at top level, read-only ones may sit with
  // the tool activity they came from. One pass rather than a filter whose
  // predicate does an O(n) `.includes()` scan of the other filter's output.
  const { interactive, passive } = useMemo(() => {
    const interactive: Card[] = [];
    const passive: Card[] = [];
    for (const c of cards) {
      (isInteractiveKind((c.spec as { kind?: string }).kind) ? interactive : passive).push(c);
    }
    return { interactive, passive };
  }, [cards]);

  const media = rest.filter(
    (p): p is Extract<ContentPart, { type: "image" | "file" | "audio" }> =>
      p.type === "image" || p.type === "file" || p.type === "audio",
  );

  if (message.role === "user") {
    // Attachments render inside the bubble: a file the user sent that vanishes
    // from the transcript makes the following answer unexplainable.
    const media = rest.filter((p) => p.type === "image" || p.type === "file");
    return (
      <div className="sc-msg sc-msg--user">
        {/* Attachments render above the bubble: a file the user sent that
            vanishes from the transcript makes the following answer
            unexplainable. */}
        {media.length ? <MediaParts parts={media} /> : null}
        <UserBubble message={message} text={text} />
        <BranchNav messageId={message.id} />
      </div>
    );
  }

  if (message.role === "tool") {
    return results.length ? <ToolActivity calls={[]} results={results} /> : null;
  }

  return (
    <div className="sc-msg sc-msg--assistant">
      {/* A finished turn: the reasoning is complete, so it folds into its
          summary. History carries no timing — the summary reads a bare
          "Thought" rather than persisting a decorative number. */}
      {reasoning ? <Thinking text={reasoning} /> : null}
      {media.length ? <MediaParts parts={media} /> : null}
      {providerTools.length ? <ProviderToolChips items={providerTools} /> : null}
      {calls.length || results.length ? <ToolActivity calls={calls} results={results} /> : null}
      {passive.map((c) => (
        <CardRenderer key={c.id} card={c} />
      ))}
      {interactive.map((c) => (
        <CardRenderer key={c.id} card={c} respond={respond} answered />
      ))}
      {text ? <div className="sc-prose sc-msg__text" dangerouslySetInnerHTML={{ __html: html }} /> : null}
      {!text && !cards.length && !calls.length ? <div className="sc-muted">(no response)</div> : null}
      {text || cards.length ? (
        <MessageMeta meta={(message.metadata as { turn?: TurnMeta } | undefined)?.turn} onRegenerate={onRegenerate} />
      ) : null}
      <BranchNav messageId={message.id} />
    </div>
  );
}

/** "‹ 2/3 ›" — rendered only when the message actually has siblings. */
function BranchNav({ messageId }: { messageId: string }) {
  const { index, count, prev, next } = useBranches(messageId);
  const { isRunning } = useThread();
  if (count < 2) return null;
  return (
    <div className="sc-branchnav" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
      <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" disabled={isRunning} onClick={prev} aria-label="Previous branch">
        ‹
      </button>
      <span className="sc-muted">
        {index + 1}/{count}
      </span>
      <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" disabled={isRunning} onClick={next} aria-label="Next branch">
        ›
      </button>
    </div>
  );
}

/** The user bubble, with edit-as-fork: saving runs a sibling branch. */
function UserBubble({ message, text }: { message: Message; text: string }) {
  const client = useAgentClient();
  const { isRunning } = useThread();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (!text && !editing) return null;
  if (!editing) {
    return (
      <div className="sc-bubble" style={{ position: "relative" }}>
        {text}
        <button
          type="button"
          className="sc-btn sc-btn--ghost sc-btn--sm"
          style={{ marginLeft: 6 }}
          disabled={isRunning}
          aria-label="Edit message"
          title="Edit — the original stays as a switchable branch"
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          ✎
        </button>
      </div>
    );
  }
  return (
    <div className="sc-bubble" style={{ width: "100%" }}>
      <textarea
        className="sc-composer__input"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: "100%" }}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          type="button"
          className="sc-btn sc-btn--primary sc-btn--sm"
          disabled={!draft.trim() || isRunning}
          onClick={() => {
            setEditing(false);
            void client.editMessage(message.id, draft.trim());
          }}
        >
          Send edited
        </button>
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** `2026-08-04` → `Today` / `Yesterday` / a written date. */
function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((midnight(today) - midnight(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const INTERACTIVE_KINDS = new Set(["choice", "form", "confirm"]);
const isInteractiveKind = (kind?: string) => (kind ? INTERACTIVE_KINDS.has(kind) : false);

const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** `840ms` under a second, `1.4s` above it — two digits of precision, never more. */
function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const GLYPH = { pending: "○", done: "●", failed: "✕" } as const;

const mediaSrc = (source: MediaSource, mediaType?: string): string | null => {
  if (source.kind === "url") return source.url;
  if (source.kind === "base64") return `data:${mediaType ?? "image/png"};base64,${source.data}`;
  return null; // providerFile lives server-side; there is nothing to inline
};

/**
 * Attached media, rendered instead of silently dropped — a file the user
 * attached (and is billed for on every turn) must stay visible in the
 * transcript, including after a reload.
 */
function MediaParts({ parts }: { parts: Extract<ContentPart, { type: "image" | "file" | "audio" }>[] }) {
  return (
    <div className="sc-media">
      {parts.map((p, i) => {
        if (p.type === "image") {
          const src = mediaSrc(p.source, p.mediaType);
          return src ? (
            <img key={i} className="sc-media__img" src={src} alt="attached image" style={{ maxWidth: "min(100%, 360px)", borderRadius: 8 }} />
          ) : (
            <span key={i} className="sc-pill" title={(p.source as { id?: string }).id}>
              🖼 attached image
            </span>
          );
        }
        if (p.type === "file") {
          const name = p.filename ?? (p.source.kind === "providerFile" ? p.source.id : "attachment");
          return (
            <span key={i} className="sc-pill" title={p.mediaType}>
              📄 {name}
            </span>
          );
        }
        const src = mediaSrc(p.source, p.mediaType);
        return src ? (
          <span key={i} className="sc-media__audio">
            <audio src={src} controls preload="metadata" aria-label="Attached audio" />
            {p.transcript ? <span className="sc-muted">{p.transcript.slice(0, 60)}{p.transcript.length > 60 ? "…" : ""}</span> : null}
          </span>
        ) : (
          <span key={i} className="sc-pill">
            🔊 audio{p.transcript ? ` — “${p.transcript.slice(0, 60)}${p.transcript.length > 60 ? "…" : ""}”` : ""}
          </span>
        );
      })}
    </div>
  );
}

function ToolActivity({
  calls,
  results,
}: {
  calls: Extract<ContentPart, { type: "tool-call" }>[];
  results: Extract<ContentPart, { type: "tool-result" }>[];
}) {
  const [open, setOpen] = useState(false);
  const { byId, items } = useMemo(() => {
    const byId = new Map(results.map((r) => [r.callId, r]));
    const items = calls.length ? calls : results.map((r) => ({ callId: r.callId, name: r.name, input: undefined, status: "done" as const }));
    return { byId, items };
  }, [calls, results]);
  const failures = results.filter((r) => r.failure).length;

  const running = items.filter((c) => !byId.has(c.callId));
  const isRunning = running.length > 0;
  const current = running[0];
  // Sum, not wall-clock: tools can run in parallel, so this is total work done
  // rather than elapsed time, and the label says so.
  const totalMs = results.reduce((sum, r) => sum + (r.ms ?? 0), 0);

  const summary = isRunning
    ? `Running tools ${items.length - running.length}/${items.length}${current ? ` · ${current.name}` : ""}…`
    : `${items.length} tool ${items.length === 1 ? "call" : "calls"}${totalMs ? ` · ${formatMs(totalMs)}` : ""}`;

  const row = (c: { callId: string; name: string; input?: unknown }) => {
    const result = byId.get(c.callId);
    const state = !result ? "running" : result.failure ? "failed" : "done";
    return (
      <li key={c.callId} className="sc-tools__item">
        <div className="sc-tools__row">
          <span className="sc-tools__status" aria-hidden>
            {state === "running" ? <span className="sc-spinner" /> : GLYPH[state]}
          </span>
          <code className="sc-mono">{c.name}</code>
          {result?.failure ? <span className="sc-pill sc-pill--negative">{result.failure}</span> : null}
          {result?.ms != null ? <span className="sc-tools__ms sc-muted">{formatMs(result.ms)}</span> : null}
        </div>
        {open ? (
          <>
            {c.input !== undefined ? <pre className="sc-pre sc-pre--sm">{JSON.stringify(c.input, null, 2)}</pre> : null}
            {result ? (
              <pre className="sc-pre sc-pre--sm">
                {JSON.stringify(isCardCarrier(result.output) ? { ...result.output, $card: "[card]" } : result.output, null, 2).slice(0, 1200)}
              </pre>
            ) : null}
          </>
        ) : null}
      </li>
    );
  };

  return (
    <div className="sc-tools">
      <button type="button" className="sc-tools__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sc-tools__icon" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="sc-tools__summary">{summary}</span>
        {failures ? <span className="sc-pill sc-pill--negative">{failures} failed</span> : null}
      </button>
      {/* While running, the in-flight call shows without expanding the group —
          seeing which tool is live is the point; the other rows are history. */}
      {open ? (
        <ul className="sc-tools__list">{items.map(row)}</ul>
      ) : isRunning && current ? (
        <ul className="sc-tools__list">{row(current)}</ul>
      ) : null}
    </div>
  );
}

/**
 * Seconds spent reasoning before the answer began.
 *
 * Measured here rather than read from the stream because no event carries a
 * timestamp. That makes it live-only by nature: a reloaded thread has no
 * measurement to recover, which is why history shows a bare "Thought".
 */
function useThinkingDuration(runId: string, hasReasoning: boolean, hasText: boolean): number | undefined {
  const startRef = useRef<{ runId: string; at: number } | null>(null);
  const [seconds, setSeconds] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (startRef.current?.runId !== runId) {
      startRef.current = null;
      setSeconds(undefined);
    }
    if (hasReasoning && !startRef.current) startRef.current = { runId, at: Date.now() };
    if (hasText && startRef.current && seconds === undefined) {
      setSeconds(Math.max(1, Math.round((Date.now() - startRef.current.at) / 1000)));
    }
  }, [runId, hasReasoning, hasText, seconds]);

  return seconds;
}

/**
 * Batches a fast-changing value to at most once per animation frame while
 * `active`, so a caller doing real work off it (e.g. reparsing markdown) does
 * that work once per frame instead of once per streamed token. Once `active`
 * goes false, any pending frame is dropped and the exact current value is
 * returned immediately — no stale throttled snapshot lingers past the point
 * the caller stops throttling.
 */
function useFrameThrottled<T>(value: T, active: boolean): T {
  const [display, setDisplay] = useState(value);
  const frame = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!active) {
      if (frame.current != null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      setDisplay(value);
      return;
    }
    if (frame.current != null) return; // a frame is already pending — it will pick up the latest value
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setDisplay(latest.current);
    });
  }, [value, active]);

  useEffect(
    () => () => {
      // Clear the id as well as cancelling it. StrictMode remounts every
      // component once in development, and a stale id left here reads as
      // "a frame is already pending" to the effect above — so a component
      // that mounts while active (a card preview does) never schedules
      // another frame and freezes on its first value.
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  return active ? display : value;
}

/**
 * A write-head is steady while deltas are arriving and blinks only after a
 * short quiet gap. The gap is deliberately longer than a normal token cadence:
 * blinking should mean "the stream is open but waiting", never "text is moving".
 */
function useStreamingPulse(value: string, active: boolean, quietMs = 420): "receiving" | "paused" {
  const [phase, setPhase] = useState<"receiving" | "paused">("receiving");
  const previous = useRef(value);

  useEffect(() => {
    if (!active) {
      previous.current = value;
      setPhase("receiving");
      return;
    }
    if (value === previous.current) return;
    previous.current = value;
    setPhase("receiving");
    const timer = setTimeout(() => setPhase("paused"), quietMs);
    return () => clearTimeout(timer);
  }, [value, active, quietMs]);

  return phase;
}

/**
 * A card whose spec is still streaming in. Core only previews kinds that can
 * show part of themselves and are not interactive, and hands over a spec that
 * already passes the kind's validator — just an incomplete one.
 *
 * Keyed apart from the validated card that replaces it, so that card mounts
 * fresh: a table's initial sort, for one, is read from the spec at mount, and
 * the preview never had it.
 */
function PartialCard({ callId, spec }: { callId: string; spec: CardSpec }) {
  // Arguments arrive at token rate; drawing more than once a frame is waste.
  const shown = useFrameThrottled(spec, true);
  const card = useMemo<Card>(() => ({ id: `partial:${callId}`, callId, spec: shown }), [callId, shown]);
  return (
    <div className="sc-cardstream" aria-busy="true">
      <CardRenderer card={card} partial />
    </div>
  );
}

/** The live turn: streamed text, cards as they arrive, and any blocking card. */
export function LiveTurn() {
  const run = useRun();
  const cards = useCards();
  const { pending, respond } = useCardAction();

  // Hooks must run on every render path — this sits above the early return, or
  // the hook count changes the moment a run starts and React tears the page down.
  const text = run.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
  // Streamed text arrives token by token; re-running the markdown pipeline on
  // every one of them is O(n²) over the full response. Batch it to once per
  // frame while the run is actually streaming, and snap to the exact final
  // text the instant it isn't. Each frame then re-renders only the blocks the
  // stream can still change; the settled ones are kept from earlier frames.
  const throttledText = useFrameThrottled(text, run.status === "running");
  const [markdownStream] = useState(newMarkdownStream);
  const html = useMemo(() => renderMarkdownStream(throttledText, markdownStream), [throttledText, markdownStream]);
  const thoughtFor = useThinkingDuration(run.runId, run.parts.some((p) => p.type === "reasoning"), Boolean(text));
  const streamPhase = useStreamingPulse(text, run.status === "running");

  if (run.status === "idle" || run.status === "done") return null;

  const reasoning = run.parts.filter((p) => p.type === "reasoning").map((p) => (p as { text: string }).text).join("");
  const calls = run.parts.filter((p): p is Extract<ContentPart, { type: "tool-call" }> => p.type === "tool-call");
  const results = run.parts.filter((p): p is Extract<ContentPart, { type: "tool-result" }> => p.type === "tool-result");
  const providerTools = run.parts
    .filter((p): p is Extract<ContentPart, { type: "artifact" }> => p.type === "artifact" && p.kind.startsWith("provider-tool:"))
    .map((p) => ({ id: p.id, kind: p.kind.slice("provider-tool:".length) }));
  const visibleCards = cards.filter((c) => c.id !== pending?.id);
  const callIds = new Set(calls.map((call) => call.callId));
  const uncorrelatedCards = visibleCards.filter((card) => !card.callId || !callIds.has(card.callId));
  // Calls whose arguments are still being written have no tool-call part yet
  // (that lands when the step ends), but they already own an output slot.
  const partialTools = run.partialTools ?? {};
  const slots = [...callIds, ...Object.keys(partialTools).filter((id) => !callIds.has(id))];
  const outputs = slots.map((callId) => {
    const correlated = visibleCards.filter((card) => card.callId === callId);
    const preview = partialTools[callId];
    const loading = run.pendingTools?.[callId]?.loading ?? preview?.loading;
    // Validated card > streaming preview > shaped skeleton. The preview holds
    // its place past `tool-call` until the real card replaces it, so the slot
    // never drops back to a skeleton in between.
    const content = correlated.length
      ? correlated.map((card) => <CardRenderer key={card.id} card={card} />)
      : preview?.partialCard
        ? <PartialCard key={`partial:${callId}`} callId={callId} spec={preview.partialCard} />
        : loading
          ? <CardSkeleton hint={loading} />
          : null;
    return content ? { callId, content } : null;
  });

  return (
    <div className="sc-msg sc-msg--assistant">
      {run.job ? (
        <div className="sc-jobchip">
          <span className="sc-spinner" aria-hidden /> Background job <code className="sc-mono">{run.job.handle.id.slice(0, 18)}…</code>{" "}
          <span className="sc-pill">{run.job.status}</span>
        </div>
      ) : null}
      {/* Live: the stream stays open and scrolls itself, then collapses to its
          summary once the answer starts — the first token of text is what ends
          the thinking, not the end of the run. */}
      {reasoning ? (
        <Thinking text={reasoning} streaming={!text} elapsedMs={thoughtFor != null ? thoughtFor * 1000 : undefined} />
      ) : null}
      {providerTools.length ? <ProviderToolChips items={providerTools} /> : null}
      {calls.length ? <ToolActivity calls={calls} results={results} /> : null}
      {/* A known tool output owns one stable slot from arguments → preview or
          skeleton → card. Keeping the wrapper keyed by callId prevents a
          generated image or chart from jumping to a new position when its
          real card arrives. */}
      {outputs.map((slot) =>
        slot ? (
          <div className="sc-tooloutput" key={slot.callId} data-call-id={slot.callId}>
            {slot.content}
          </div>
        ) : null,
      )}
      {uncorrelatedCards.map((card) => <CardRenderer key={card.id} card={card} />)}
      {/* The blocking card renders last and un-collapsed — it is the thing the
          user must act on, so nothing may hide it. */}
      {pending ? <CardRenderer key={pending.id} card={pending} respond={respond} /> : null}
      {text ? (
        <div
          className={`sc-prose sc-msg__text${run.status === "running" ? ` sc-msg__text--streaming sc-msg__text--${streamPhase}` : ""}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
      {/* Nothing to show yet. The orb carries the wait; the label stays derived
          from run state rather than a rotation of invented phrases. */}
      {run.status === "running" && !text && !calls.length && !outputs.some(Boolean) ? (
        <div className="sc-status" aria-live="polite">
          <Orb variant="S1" pill label={statusLine(run)} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the agent is doing right now, in words.
 *
 * Derived from run state rather than a timed rotation of invented phrases: a
 * status line that cycles through plausible-sounding stages while the agent does
 * something else is a lie, and users notice when it never matches the tool list.
 */
function statusLine(run: RunState): string {
  if (run.job) return `Working in the background — ${run.job.status}`;
  if (run.pendingCard) return "Waiting for you";
  const writing = Object.values(run.partialTools ?? {}).find(
    (p) => !run.parts.some((part) => part.type === "tool-call" && part.callId === p.callId),
  );
  if (writing) return `Preparing ${writing.name}…`;
  const lastCall = [...run.parts].reverse().find((p) => p.type === "tool-call") as
    | Extract<ContentPart, { type: "tool-call" }>
    | undefined;
  if (lastCall && lastCall.status === "running") return `Running ${lastCall.name}…`;
  if (run.parts.some((p) => p.type === "reasoning")) return "Thinking…";
  if (run.steps > 1) return `Working — step ${run.steps}`;
  return "Thinking…";
}

/** Inline error block for a failed run, with a retry that re-runs the last turn. */
function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const detail = error != null ? (error instanceof Error ? error.message : String(error)) : "";
  return (
    <div className="sc-card sc-card--error" role="alert">
      {detail || "Something went wrong."}
      <div className="sc-card__actions">
        <button type="button" className="sc-btn sc-btn--sm" onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

export function Thread({ empty }: { empty?: ReactNode }) {
  const { messages, status, error, regenerate, isRunning } = useThread();
  const { respond } = useCardAction();
  const run = useRun();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Autoscroll, but yield to the user: once they scroll up mid-stream, stop
  // yanking them back down.
  useEffect(() => {
    if (pinned) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, run.parts.length, pinned]);

  // Only the last assistant message is retryable: regenerate() rewinds to the
  // last user turn, so offering it mid-thread would silently discard everything
  // after the message the user clicked.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  let lastDay = "";
  return (
    <div className="sc-threadwrap">
      <div
        className="sc-thread"
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        {messages.length === 0 && run.status === "idle" ? <div className="sc-empty">{empty}</div> : null}
        {messages.map((m) => {
          const day = m.createdAt ? dayLabel(m.createdAt) : "";
          const divider = day && day !== lastDay ? day : "";
          if (day) lastDay = day;
          return (
            <div key={m.id}>
              {divider ? (
                <div className="sc-daydivider">
                  <span>{divider}</span>
                </div>
              ) : null}
              <MessageView
                message={m}
                respond={respond}
                onRegenerate={m.id === lastAssistant && !isRunning ? () => void regenerate() : undefined}
              />
            </div>
          );
        })}
        <LiveTurn />
        {status === "error" ? <ErrorBlock error={error} onRetry={() => void regenerate()} /> : null}
        <div ref={bottomRef} />
      </div>
      {/* Only offered when it does something: pinned means already at the end. */}
      {!pinned ? (
        <button
          type="button"
          className="sc-jump"
          onClick={() => {
            setPinned(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
          }}
        >
          <span aria-hidden>↓</span> Latest
        </button>
      ) : null}
    </div>
  );
}

export type ComposerProps = {
  placeholder?: string;
  /** Refuse to send past this. Omit for no limit — the kit does not guess. */
  maxInputTokens?: number;
  /** Model picker. Omit to hide it — the kit never invents a model list. */
  models?: string[];
  model?: string;
  onModelChange?: (model: string) => void;
  /** On/off chips for host-defined capabilities (web search, a preset, …). */
  toolToggles?: { id: string; label: string; on: boolean; onChange: (on: boolean) => void }[];
  /**
   * Turn a picked browser File into staged attachment part(s) — typically
   * upload via `provider.uploadFile` and then `client.attach(file(ref, …))`.
   *
   * Without it the composer inlines files as base64 itself, which is the
   * zero-config path. With it, staging belongs to the host and the chips are
   * read back from `useAttachments()` — the two never both hold a file.
   */
  onAttachFile?: (file: File) => void | Promise<void>;
};

export function Composer({
  placeholder = "Ask anything…",
  maxInputTokens,
  models,
  model,
  onModelChange,
  toolToggles,
  onAttachFile,
}: ComposerProps) {
  const { send, stop, isRunning, stopping, messages } = useThread();
  const quoteBus = useDocumentQuotes();
  const quotes = quoteBus?.quotes ?? [];
  const { skills } = useSkills();
  const { all: allTools } = useTools();
  const staged = useAttachments();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const tokens = useMemo(() => (value ? estimateTokens(value) : 0), [value]);
  const overLimit = maxInputTokens != null && tokens > maxInputTokens;
  const [local, setLocal] = useState<{ id: string; name: string; size: number; part: ContentPart }[]>([]);

  // One list to render and to gate "can send", whichever path staged the file.
  const attachments = onAttachFile
    ? staged.attachments.map((p, i) => ({
        id: `staged:${i}`,
        name: (p as { filename?: string }).filename ?? p.type,
        size: 0,
        part: p,
      }))
    : local;
  const setAttachments = setLocal;

  // `/` skills, `@` tools. Both read the live registries, so a host that
  // registers something new gets it in the menu with no extra wiring.
  const [trigger, setTrigger] = useState<TriggerState>(null);
  const catalogue = useSuggestItems(skills, allTools);
  const suggestions = trigger ? rankItems(catalogue[trigger.trigger as "/" | "@"] ?? [], trigger.query) : [];
  const [activeIdx, setActiveIdx] = useActiveIndex(suggestions.length);

  const syncTrigger = (el: HTMLTextAreaElement) => setTrigger(findTrigger(el.value, el.selectionStart ?? 0, ["/", "@"]));

  const pick = (item: SuggestItem) => {
    const el = inputRef.current;
    if (!el || !trigger) return;
    const next = applyPick(el.value, trigger, el.selectionStart ?? el.value.length, item.id);
    setValue(next.text);
    setTrigger(null);
    // Restore the caret after React re-renders with the new value.
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = next.caret;
      el.focus();
    });
  };

  // Files become base64 parts here rather than being uploaded: the kit has no
  // storage of its own, and `MediaSource` already carries inline data. A host
  // with a file API can swap these for `providerFile` sources before sending.
  const addFiles = async (files: FileList | File[]) => {
    const accepted = [...files].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf" || f.type.startsWith("text/"));
    // With a host seam, staging is the host's job — it may need to upload and
    // hand back a providerFile reference, which base64 here cannot produce.
    if (onAttachFile) {
      for (const f of accepted) await onAttachFile(f);
      return;
    }
    const read = await Promise.all(
      accepted.map(
        (f) =>
          new Promise<{ id: string; name: string; size: number; part: ContentPart }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => {
              const data = String(reader.result).split(",")[1] ?? "";
              const source = { kind: "base64" as const, data };
              resolve({
                id: `${f.name}:${f.size}:${f.lastModified}`,
                name: f.name,
                size: f.size,
                part: f.type.startsWith("image/")
                  ? { type: "image", source, mediaType: f.type }
                  : { type: "file", source, mediaType: f.type, filename: f.name },
              });
            };
            reader.readAsDataURL(f);
          }),
      ),
    );
    // Dedupe by identity so dropping the same file twice does not send it twice.
    setAttachments((prev) => [...prev, ...read.filter((r) => !prev.some((p) => p.id === r.id))]);
  };

  const submit = () => {
    const text = value.trim();
    // Attachments alone are a valid send — "summarize this file" is the text-less
    // case — and so is a quote alone: pointing at a paragraph and hitting send
    // is a complete request ("what about this?").
    if ((!text && !attachments.length && !quotes.length) || isRunning || overLimit) return;
    // Host-staged parts are already on the client and get appended by send();
    // inlining them here too would send every file twice.
    const parts: ContentPart[] = [
      ...(onAttachFile ? [] : local.map((a) => a.part)),
      ...(text ? [{ type: "text" as const, text }] : []),
    ];
    setValue("");
    setAttachments([]);
    // Cleared before the run, not after: a quote left in the composer would be
    // re-sent with the next message, which is the stale-context bug that keeping
    // quotes off app-state was meant to avoid in the first place.
    const sending = quotes;
    quoteBus?.clear();
    void send(parts, sending.length ? { quotes: sending } : undefined);
    // Auto-grow only expands the box; clearing the value must collapse it
    // back to the CSS base height instead of leaving a tall empty textarea.
    const el = inputRef.current;
    if (el) el.style.height = "";
  };

  const stacked = Boolean(models?.length || toolToggles?.length);

  // Built once so the single-row and stacked layouts cannot drift apart.
  const counter =
    // Only once the input is long enough for the number to matter — a token
    // count next to three words is clutter, not information.
    tokens > 400 ? (
      <span className={`sc-composer__tokens${overLimit ? " sc-tone--negative" : ""}`}>{tokens.toLocaleString()} tok</span>
    ) : null;

  // Drag-and-drop is not discoverable on its own, and does not exist at all on
  // a touch device — so the picker is always offered too.
  const attachButton = (
    <label className="sc-btn sc-btn--ghost sc-btn--sm" title="Attach a file" aria-disabled={isRunning}>
      📎
      <input
        type="file"
        multiple
        style={{ display: "none" }}
        disabled={isRunning}
        onChange={(e) => {
          const files = e.target.files;
          e.target.value = "";
          if (files?.length) void addFiles(files);
        }}
      />
    </label>
  );

  const actionButton = isRunning ? (
    // Disabled once requested: pressing Stop twice does nothing extra, and a
    // still-live button after a stop reads as the button being broken.
    <button type="button" className="sc-btn sc-btn--ghost" onClick={stop} disabled={stopping}>
      {stopping ? "Stopping…" : "Stop"}
    </button>
  ) : (
    <button type="submit" className="sc-btn sc-btn--primary" disabled={(!value.trim() && !attachments.length) || overLimit}>
      Send
    </button>
  );

  return (
    <form
      className={`sc-composer${stacked ? " sc-composer--stacked" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
      {trigger && suggestions.length ? (
        <SuggestMenu items={suggestions} active={activeIdx} onPick={pick} />
      ) : null}
      {quotes.length ? (
        <ul className="sc-quotes" aria-label="Quoted from a document">
          {quotes.map((q, i) => (
            <li key={`${q.docId}:${q.start}:${q.end}`} className="sc-quote">
              <span className="sc-quote__doc">{q.title}</span>
              <span className="sc-quote__text">{q.text.trim().replace(/\s+/g, " ")}</span>
              <button
                type="button"
                className="sc-quote__remove"
                aria-label={`Remove quote from ${q.title}`}
                onClick={() => quoteBus?.remove(i)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {attachments.length ? (
        <ul className="sc-attachments">
          {attachments.map((a, i) => (
            <li key={a.id} className="sc-attachment">
              <span className="sc-attachment__name">{a.name}</span>
              {/* Host-staged parts carry no byte count — omit rather than print "0 B". */}
              {a.size ? <span className="sc-attachment__size sc-muted">{formatBytes(a.size)}</span> : null}
              <button
                type="button"
                className="sc-attachment__remove"
                aria-label={`Remove ${a.name}`}
                onClick={() =>
                  onAttachFile ? staged.remove(i) : setAttachments((prev) => prev.filter((p) => p.id !== a.id))
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        ref={inputRef}
        className="sc-composer__input"
        rows={1}
        value={value}
        placeholder={placeholder}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (!files.length) return;
          e.preventDefault();
          void addFiles(files);
        }}
        onSelect={(e) => syncTrigger(e.currentTarget)}
        onBlur={() => setTrigger(null)}
        onChange={(e) => {
          setValue(e.target.value);
          syncTrigger(e.target);
          // Auto-grow: collapse first so a shrinking edit doesn't stick at its
          // previous (taller) scrollHeight, then clamp to the CSS max-height.
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
        }}
        onKeyDown={(e) => {
          // The suggestion menu owns the arrows, Enter/Tab and Esc while it is
          // open — otherwise Enter would send the half-typed `/legal` instead of
          // completing it.
          const menuOpen = Boolean(trigger) && suggestions.length > 0;
          if (menuOpen && !e.nativeEvent.isComposing) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((activeIdx + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((activeIdx - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              const chosen = suggestions[activeIdx];
              if (chosen) pick(chosen);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setTrigger(null);
              return;
            }
          }
          // Enter sends, Shift+Enter breaks the line — the convention every
          // chat UI has trained users on. isComposing (plus the keyCode 229
          // fallback Safari uses once composition ends) guards against an
          // IME candidate-confirm Enter — e.g. Bopomofo/Japanese — sending.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            submit();
            return;
          }
          // Esc stops the run. Guarded on composition too: Esc cancels an IME
          // candidate window, and that keystroke must not also kill the turn.
          if (e.key === "Escape" && isRunning && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            stop();
            return;
          }
          // ArrowUp on an empty box recalls the last thing you sent, so a typo
          // does not have to be retyped. Only when empty — otherwise it is a
          // cursor key and stealing it would break editing.
          if (e.key === "ArrowUp" && !value && !e.nativeEvent.isComposing) {
            const lastUser = [...messages].reverse().find((m) => m.role === "user");
            const prior = lastUser?.parts.find((p) => p.type === "text") as { text?: string } | undefined;
            if (prior?.text) {
              e.preventDefault();
              setValue(prior.text);
            }
          }
        }}
      />
      {/* Accessories move the controls onto their own row. Without them the
          composer stays a single line, which is the whole point of the default. */}
      {stacked ? (
        <div className="sc-composer__bar">
          {models?.length ? (
            <select
              className="sc-composer__model"
              value={model ?? models[0]}
              onChange={(e) => onModelChange?.(e.target.value)}
              aria-label="Model"
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : null}
          {toolToggles?.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`sc-toggle${t.on ? " sc-toggle--on" : ""}`}
              aria-pressed={t.on}
              onClick={() => t.onChange(!t.on)}
            >
              {t.label}
            </button>
          ))}
          <span className="sc-composer__spacer" />
          {attachButton}
          {counter}
          {actionButton}
        </div>
      ) : (
        <>
          {attachButton}
          {counter}
          {actionButton}
        </>
      )}
    </form>
  );
}
