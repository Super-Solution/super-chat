"use client";

// Chat primitives.
//
// The layout rule that matters: interactive cards render at TOP LEVEL, in part
// order, never inside a collapsible "steps" group. Read-only tool activity does
// collapse — a turn that made six lookups should not push the answer off screen.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  SURFACE_CARD_KIND,
  SURFACE_EVENT_METADATA_KEY,
  estimateTokens,
  hasTurnOrder,
  isCardCarrier,
  layoutTurn,
  type Card,
  type CardSpec,
  type ContentPart,
  type MediaSource,
  type Message,
  type RunState,
  type SurfaceEventRecord,
} from "@supersolutions/super-chat-core";
import {
  useAgentClient,
  useAttachments,
  useBranches,
  useCardAction,
  useRun,
  useSkills,
  useThread,
  useTools,
} from "@supersolutions/super-chat-react";
import type { TurnMeta } from "@supersolutions/super-chat-client";
import { CardRenderer, CardSkeleton, useInteractiveKinds } from "./renderer-registry.js";
import { AttachIcon, Chevron, FileIcon, ImageIcon, StatusMark, ToolIcon, SpeakerIcon } from "./cards/icons.js";
import { newMarkdownStream, renderMarkdown, renderMarkdownBlocks } from "@supersolutions/super-chat-ui-core";
import { useMarkdownOptions } from "./markdown-options.js";
import { CardRefProvider, ProseHtml, useCardRefHost } from "./card-refs.js";
import { builtinCardRefHost } from "./card-ref-targets.js";
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
import { formatBytes, useLabels, type Labels } from "./labels.js";
import { EmptyThread, type Suggestion } from "./Suggestions.js";

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
        ...(p.callId ? { callId: p.callId } : {}),
        ...(p.placement === "panel" ? { placement: "panel" as const } : {}),
        ...(expired ? { expired: true } : {}),
      });
      continue;
    }
    rest.push(p);
  }
  return { cards, rest, providerTools };
}

/** "Searched the web" chips — provider-side work, shown so answers aren't magic. */
function ProviderToolChips({ items }: { items: { id: string; kind: string }[] }) {
  const labels = useLabels();
  return (
    <div className="sc-providertools">
      {items.map((t) => (
        <span key={t.id} className="sc-pill" title={t.kind}>
          <ToolIcon /> {labels.providerTools[t.kind] ?? labels.providerToolFallback}
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
 *
 * Copy takes the answer's Markdown source, not what is on screen: copying the rendered text
 * ran the cells of a table together and dropped a code block's fence and language.
 */
function MessageMeta({ meta, source, onRegenerate }: { meta?: TurnMeta; source: string; onRegenerate?: () => void }) {
  const labels = useLabels();
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
        onClick={() => {
          // Report the failure rather than swallowing it — a copy button that
          // does nothing visible is indistinguishable from a broken one.
          void (navigator.clipboard?.writeText(source) ?? Promise.reject())
            .then(() => setCopyState("copied"))
            .catch(() => setCopyState("failed"))
            .finally(() => setTimeout(() => setCopyState("idle"), 1500));
        }}
      >
        {copyState === "copied" ? labels.copied : copyState === "failed" ? labels.copyFailed : labels.copy}
      </button>
      {onRegenerate ? (
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" onClick={onRegenerate}>
          {labels.retry}
        </button>
      ) : null}
    </div>
  );
}

/** A finished block of prose. Memoised for identity: see HANDOFF, bug 8. */
function SettledText({ text }: { text: string }) {
  const options = useMarkdownOptions();
  const html = useMemo(() => renderMarkdown(text, options), [text, options]);
  return <ProseHtml className="sc-prose sc-msg__text" html={html} />;
}

/** A press on a surface, shown as what it was rather than as words the person typed. */
function SurfaceEventNote({ record }: { record: SurfaceEventRecord }) {
  return (
    <div className="sc-surface-event">
      <span className="sc-surface-event__label">{record.label ?? record.name}</span>
      {record.title ? <span className="sc-muted">{record.title}</span> : null}
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
  const labels = useLabels();
  const { cards, rest, providerTools } = useMemo(() => partsOf(message), [message]);
  const isInteractive = useInteractiveKinds();
  // Turns saved before order was recorded keep the layout they were written for.
  const segments = useMemo(() => (hasTurnOrder(message.parts) ? layoutTurn(message.parts, cards) : null), [message, cards]);

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
  const options = useMarkdownOptions();
  const html = useMemo(() => renderMarkdown(text, options), [text, options]);
  // What Copy hands over: the answer's own Markdown, its text parts in the order they were
  // written (a turn's text can sit in several blocks, either side of its cards).
  const source = useMemo(
    () => (segments ? segments.flatMap((segment) => (segment.type === "text" ? [segment.text] : [])).join("\n\n") : text),
    [segments, text],
  );

  // Split cards: interactive ones stay at top level, read-only ones may sit with
  // the tool activity they came from. One pass rather than a filter whose
  // predicate does an O(n) `.includes()` scan of the other filter's output.
  const { interactive, passive } = useMemo(() => {
    const interactive: Card[] = [];
    const passive: Card[] = [];
    for (const c of cards) {
      (isInteractive((c.spec as { kind?: string }).kind) ? interactive : passive).push(c);
    }
    return { interactive, passive };
  }, [cards, isInteractive]);

  const renderCard = (c: Card) =>
    isInteractive((c.spec as { kind?: string }).kind) ? (
      <CardRenderer key={c.id} card={c} respond={respond} answered />
    ) : (
      <CardRenderer key={c.id} card={c} />
    );

  const media = rest.filter(
    (p): p is Extract<ContentPart, { type: "image" | "file" | "audio" }> =>
      p.type === "image" || p.type === "file" || p.type === "audio",
  );

  const surfaceEvent = message.metadata?.[SURFACE_EVENT_METADATA_KEY] as SurfaceEventRecord | undefined;
  if (message.role === "user" && surfaceEvent) {
    return (
      <div className="sc-msg sc-msg--user">
        <SurfaceEventNote record={surfaceEvent} />
      </div>
    );
  }

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
      {segments ? (
        segments.map((segment) =>
          segment.type === "text" ? (
            <SettledText key={segment.key} text={segment.text} />
          ) : segment.type === "output" ? (
            <div className="sc-tooloutput" key={segment.key} data-call-id={segment.callId}>
              {segment.cards.map(renderCard)}
            </div>
          ) : (
            renderCard(segment.card)
          ),
        )
      ) : (
        <>
          {passive.map((c) => (
            <CardRenderer key={c.id} card={c} />
          ))}
          {interactive.map((c) => (
            <CardRenderer key={c.id} card={c} respond={respond} answered />
          ))}
          {text ? <ProseHtml className="sc-prose sc-msg__text" html={html} /> : null}
        </>
      )}
      {!text && !cards.length && !calls.length ? <div className="sc-muted">{labels.noResponse}</div> : null}
      {(text || cards.length) && (message.metadata as { turn?: TurnMeta } | undefined)?.turn?.origin !== "surface-action" ? (
        <MessageMeta meta={(message.metadata as { turn?: TurnMeta } | undefined)?.turn} source={source} onRegenerate={onRegenerate} />
      ) : null}
      <BranchNav messageId={message.id} />
    </div>
  );
}

/** "‹ 2/3 ›" — rendered only when the message actually has siblings. */
function BranchNav({ messageId }: { messageId: string }) {
  const labels = useLabels();
  const { index, count, prev, next } = useBranches(messageId);
  const { isRunning } = useThread();
  if (count < 2) return null;
  return (
    <div className="sc-branchnav">
      <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" disabled={isRunning} onClick={prev} aria-label={labels.previousBranch}>
        ‹
      </button>
      <span className="sc-muted">
        {index + 1}/{count}
      </span>
      <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" disabled={isRunning} onClick={next} aria-label={labels.nextBranch}>
        ›
      </button>
    </div>
  );
}

/**
 * The user bubble, with edit-as-fork: saving runs a sibling branch.
 *
 * The edit keeps what the message carried besides its words (an attached image or file): the
 * branch is the same question reworded, not the same question with its evidence taken away.
 * The box takes focus when it opens; Escape cancels it and Ctrl or Cmd with Enter sends.
 */
function UserBubble({ message, text }: { message: Message; text: string }) {
  const client = useAgentClient();
  const labels = useLabels();
  const { isRunning } = useThread();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const box = useRef<HTMLTextAreaElement>(null);
  const edit = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  if (!text && !editing) return null;

  const close = () => {
    setEditing(false);
    // Back to the button that opened the box, so a keyboard user is not dropped at the top of the page.
    requestAnimationFrame(() => edit.current?.focus());
  };
  const save = () => {
    const words = draft.trim();
    if (!words || isRunning) return;
    setEditing(false);
    const kept = message.parts.filter((p) => p.type !== "text");
    void client.editMessage(message.id, kept.length ? [...kept, { type: "text", text: words }] : words);
  };

  if (!editing) {
    return (
      <div className="sc-bubblerow">
        {/* Beside the bubble, not in it: the message reads as written, and the
            control shows on hover or focus (always, on touch). */}
        <button
          ref={edit}
          type="button"
          className="sc-bubble__edit"
          disabled={isRunning}
          aria-label={labels.editMessage}
          title={labels.editHint}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M10.6 2.6a1.5 1.5 0 0 1 2.1 0l.7.7a1.5 1.5 0 0 1 0 2.1L6 12.8 2.5 13.5l.7-3.5 7.4-7.4Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="sc-bubble">{text}</div>
      </div>
    );
  }
  return (
    <div className="sc-bubble sc-bubble--editing">
      <textarea
        ref={box}
        className="sc-composer__input"
        rows={2}
        value={draft}
        aria-label={labels.editMessage}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Neither key means anything while an IME candidate is open.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="sc-bubble__editbar">
        <button type="button" className="sc-btn sc-btn--primary sc-btn--sm" disabled={!draft.trim() || isRunning} onClick={save}>
          {labels.sendEdited}
        </button>
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" onClick={close}>
          {labels.cancel}
        </button>
      </div>
    </div>
  );
}

/** `2026-08-04` → `Today` / `Yesterday` / a written date. */
function dayLabel(at: number, labels: Labels): string {
  const d = new Date(at);
  const today = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((midnight(today) - midnight(d)) / 86_400_000);
  if (diffDays === 0) return labels.today;
  if (diffDays === 1) return labels.yesterday;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** `840ms` under a second, `1.4s` above it — two digits of precision, never more. */
function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}


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
  const labels = useLabels();
  return (
    <div className="sc-media">
      {parts.map((p, i) => {
        if (p.type === "image") {
          const src = mediaSrc(p.source, p.mediaType);
          return src ? (
            <img key={i} className="sc-media__img" src={src} alt={labels.attachedImage} />
          ) : (
            <span key={i} className="sc-pill" title={(p.source as { id?: string }).id}>
              <ImageIcon /> {labels.attachedImage}
            </span>
          );
        }
        if (p.type === "file") {
          const name = p.filename ?? (p.source.kind === "providerFile" ? p.source.id : labels.attachment);
          return (
            <span key={i} className="sc-pill" title={p.mediaType}>
              <FileIcon /> {name}
            </span>
          );
        }
        const src = mediaSrc(p.source, p.mediaType);
        return src ? (
          <span key={i} className="sc-media__audio">
            <audio src={src} controls preload="metadata" aria-label={labels.attachedAudio} />
            {p.transcript ? <span className="sc-muted">{p.transcript.slice(0, 60)}{p.transcript.length > 60 ? "…" : ""}</span> : null}
          </span>
        ) : (
          <span key={i} className="sc-pill">
            <SpeakerIcon /> {labels.attachedAudio}
            {p.transcript ? ` — “${p.transcript.slice(0, 60)}${p.transcript.length > 60 ? "…" : ""}”` : ""}
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
  const labels = useLabels();
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
    ? labels.toolsRunning(items.length - running.length, items.length, current?.name)
    : labels.toolCalls(items.length, totalMs ? formatMs(totalMs) : undefined);

  const row = (c: { callId: string; name: string; input?: unknown }) => {
    const result = byId.get(c.callId);
    const state = !result ? "running" : result.failure ? "failed" : "done";
    return (
      <li key={c.callId} className="sc-tools__item">
        <div className="sc-tools__row">
          <span className="sc-tools__status" aria-hidden>
            {state === "running" ? <span className="sc-spinner" /> : <StatusMark kind={state} />}
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
        {failures ? <span className="sc-pill sc-pill--negative">{labels.toolsFailed(failures)}</span> : null}
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

/**
 * A surface from its first streamed part to its finished card, as one element.
 * Swapping a preview for the real card would draw the whole interface twice; a
 * surface keeps its state in the client, so it can stay mounted throughout.
 */
function StreamedSurface({ callId, card, spec }: { callId: string; card?: Card; spec?: CardSpec }) {
  const shown = useFrameThrottled(spec, !card);
  const preview = useMemo<Card | undefined>(() => (shown ? { id: `partial:${callId}`, callId, spec: shown } : undefined), [callId, shown]);
  const current = card ?? preview;
  return current ? <CardRenderer card={current} partial={!card} /> : null;
}

/** The live turn: streamed text, cards as they arrive, and any blocking card. */
export function LiveTurn() {
  const labels = useLabels();
  const run = useRun();
  const { pending, respond } = useCardAction();

  // Hooks must run on every render path — this sits above the early return, or
  // the hook count changes the moment a run starts and React tears the page down.
  const text = run.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
  // The same order the finished message will have, so nothing moves on commit.
  // Read from the run rather than useCards, whose id comparison would hold on to
  // a card's previous spec after an in-place update.
  const segments = layoutTurn(run.parts, run.cards, { keepEmptyOutputs: true });
  const lastText = segments.reduce<Extract<(typeof segments)[number], { type: "text" }> | undefined>(
    (found, segment) => (segment.type === "text" ? segment : found),
    undefined,
  );
  // Streamed text arrives token by token; re-running the markdown pipeline on
  // every one of them is O(n²) over the full response. Batch it to once per
  // frame while the run is actually streaming, and snap to the exact final
  // text the instant it isn't. Each frame then re-renders only the blocks the
  // stream can still change; the settled ones are kept from earlier frames.
  const liveText = lastText?.text ?? "";
  const throttled = useFrameThrottled(liveText, run.status === "running");
  // A new block starts from its own text, not one frame of the block before it.
  const throttledText = liveText.startsWith(throttled) ? throttled : liveText;
  const [markdownStream] = useState(newMarkdownStream);
  const options = useMarkdownOptions();
  // Block by block: the settled blocks are the same strings from frame to frame, which is what
  // lets ProseHtml leave their DOM (and a selection in it) alone while the tail grows.
  const html = useMemo(() => renderMarkdownBlocks(throttledText, markdownStream, options), [throttledText, markdownStream, options]);
  const thoughtFor = useThinkingDuration(run.runId, run.parts.some((p) => p.type === "reasoning"), Boolean(text));
  const streamPhase = useStreamingPulse(text, run.status === "running");

  if (run.status === "idle" || run.status === "done") return null;

  const reasoning = run.parts.filter((p) => p.type === "reasoning").map((p) => (p as { text: string }).text).join("");
  const calls = run.parts.filter((p): p is Extract<ContentPart, { type: "tool-call" }> => p.type === "tool-call");
  const results = run.parts.filter((p): p is Extract<ContentPart, { type: "tool-result" }> => p.type === "tool-result");
  const providerTools = run.parts
    .filter((p): p is Extract<ContentPart, { type: "artifact" }> => p.type === "artifact" && p.kind.startsWith("provider-tool:"))
    .map((p) => ({ id: p.id, kind: p.kind.slice("provider-tool:".length) }));
  const callIds = new Set(calls.map((call) => call.callId));
  // A card waiting on the person stays in its own slot, answerable and never
  // collapsed: nothing can be written after it until they answer.
  const renderLiveCard = (card: Card) =>
    card.id === pending?.id ? <CardRenderer key={card.id} card={card} respond={respond} /> : <CardRenderer key={card.id} card={card} />;
  // Calls whose arguments are still being written have no tool-call part yet
  // (that lands when the step ends), but they already own an output slot.
  const partialTools = run.partialTools ?? {};
  const writing = Object.keys(partialTools).filter((id) => !callIds.has(id));
  const outputOf = (callId: string, correlated: Card[]) => {
    const preview = partialTools[callId];
    const loading = run.pendingTools?.[callId]?.loading ?? preview?.loading;
    // Validated card > streaming preview > shaped skeleton. The preview holds
    // its place past `tool-call` until the real card replaces it, so the slot
    // never drops back to a skeleton in between.
    const surface = correlated.find((card) => (card.spec as { kind?: string }).kind === SURFACE_CARD_KIND);
    const content = surface || (!correlated.length && preview?.partialCard?.kind === SURFACE_CARD_KIND)
      ? [
          <StreamedSurface key={`surface:${callId}`} callId={callId} card={surface} spec={preview?.partialCard} />,
          ...correlated.filter((card) => card !== surface).map(renderLiveCard),
        ]
      : correlated.length
      ? correlated.map(renderLiveCard)
      : preview?.partialCard
        ? <PartialCard key={`partial:${callId}`} callId={callId} spec={preview.partialCard} />
        : loading
          ? <CardSkeleton hint={loading} />
          : null;
    return content ? (
      <div className="sc-tooloutput" key={`call:${callId}`} data-call-id={callId}>
        {content}
      </div>
    ) : null;
  };
  const flow = [
    ...segments.map((segment) => {
      if (segment.type === "output") return outputOf(segment.callId, segment.cards);
      if (segment.type === "card") return renderLiveCard(segment.card);
      if (segment !== lastText) return <SettledText key={segment.key} text={segment.text} />;
      return (
        <ProseHtml
          key={segment.key}
          className={`sc-prose sc-msg__text${run.status === "running" ? ` sc-msg__text--streaming sc-msg__text--${streamPhase}` : ""}`}
          html={html}
        />
      );
    }),
    ...writing.map((callId) => outputOf(callId, [])),
  ];

  return (
    // Busy while the turn is open, so a screen reader holds the growing text back instead
    // of reading it token by token; the finished message that replaces this is appended to
    // the log whole, and ThreadAnnouncer says that the turn began and ended.
    <div className="sc-msg sc-msg--assistant" aria-busy={run.status === "running"}>
      {run.job ? (
        <div className="sc-jobchip">
          <span className="sc-spinner" aria-hidden /> Background job <code className="sc-mono">{run.job.handle.id.slice(0, 18)}…</code>{" "}
          <span className="sc-muted">{run.job.status}</span>
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
      {/* Text and tool outputs, in the order they happened. A known tool output
          owns one stable slot from arguments → preview or skeleton → card:
          keying the wrapper by callId keeps a generated image or chart from
          jumping to a new position when its real card arrives. */}
      {flow}
      {/* Nothing to show yet. The orb carries the wait; the label stays derived
          from run state rather than a rotation of invented phrases. */}
      {run.status === "running" && !text && !calls.length && !flow.some(Boolean) ? (
        <div className="sc-status" aria-live="polite">
          <Orb variant="S1" pill label={statusLine(run, labels)} />
        </div>
      ) : null}
      {/* The saved turn shows a meta row; holding its place now keeps the turn from growing when it is saved. */}
      {text || flow.some(Boolean) ? <div className="sc-msgmeta sc-msgmeta--reserve" aria-hidden /> : null}
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
function statusLine(run: RunState, labels: Labels): string {
  if (run.job) return labels.statusBackground(run.job.status);
  if (run.pendingCard) return labels.statusWaiting;
  const writing = Object.values(run.partialTools ?? {}).find(
    (p) => !run.parts.some((part) => part.type === "tool-call" && part.callId === p.callId),
  );
  if (writing) return labels.statusPreparing(writing.name);
  const lastCall = [...run.parts].reverse().find((p) => p.type === "tool-call") as
    | Extract<ContentPart, { type: "tool-call" }>
    | undefined;
  if (lastCall && lastCall.status === "running") return labels.statusRunning(lastCall.name);
  if (run.parts.some((p) => p.type === "reasoning")) return labels.thinking;
  if (run.steps > 1) return labels.statusStep(run.steps);
  return labels.thinking;
}

/**
 * Says, in a polite status region outside the log, that a turn began and that it ended.
 *
 * The log itself stays quiet while an answer streams (the live turn is `aria-busy`), so this is
 * what tells a person using a screen reader that something is happening and when it is done. A
 * failed turn says nothing here: its error block is a `role="alert"` and speaks for itself.
 */
function ThreadAnnouncer({ running, failed }: { running: boolean; failed: boolean }) {
  const labels = useLabels();
  const [text, setText] = useState("");
  const was = useRef(running);
  useEffect(() => {
    if (running === was.current) return;
    was.current = running;
    setText(running ? labels.responding : failed ? "" : labels.replied);
  }, [running, failed, labels]);
  return (
    <div className="sc-sr-only" role="status" aria-live="polite" data-sc-announcer>
      {text}
    </div>
  );
}

/** Inline error block for a failed run, with a retry that re-runs the last turn. */
function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const labels = useLabels();
  const detail = error != null ? (error instanceof Error ? error.message : String(error)) : "";
  return (
    <div className="sc-card sc-card--error" role="alert">
      {detail || labels.somethingWrong}
      <div className="sc-card__actions">
        <button type="button" className="sc-btn sc-btn--sm" onClick={onRetry}>
          {labels.retry}
        </button>
      </div>
    </div>
  );
}

export type ThreadProps = {
  /**
   * What to show before the first message. Omit for the built-in empty state (a title, one line
   * and `suggestions`); pass your own node to replace it, or `null` for nothing at all.
   */
  empty?: ReactNode;
  /** Starting prompts for the built-in empty state. Ignored when `empty` is given. */
  suggestions?: readonly Suggestion[];
};

/**
 * The conversation. Citations an answer makes into its own cards (`[[1]](ref:authority?cite=2)`)
 * are live without any setup; a host that wraps the thread in its own `<CardRefProvider>` answers
 * for them instead, and chains `builtinCardRefHost` in if it still wants these.
 */
export function Thread(props: ThreadProps) {
  const host = useCardRefHost();
  const body = <ThreadBody {...props} />;
  return host ? body : <CardRefProvider host={builtinCardRefHost}>{body}</CardRefProvider>;
}

function ThreadBody({ empty, suggestions }: ThreadProps) {
  const labels = useLabels();
  const { messages, status, error, regenerate, isRunning } = useThread();
  const { respond } = useCardAction();
  const run = useRun();
  const pendingCardId = useRun((r) => r.pendingCard?.id);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // A question the person has to answer is brought into view wherever they had
  // scrolled to. A button high up a surface can raise one at the bottom of the
  // thread, and an approval nobody can see reads as the button doing nothing.
  useEffect(() => {
    if (!pendingCardId) return;
    setPinned(true);
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [pendingCardId]);

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
        // A log: new messages are only ever added at the end, which is what `role="log"` (polite,
        // non-atomic) is for. Without it a screen reader is told nothing when an answer arrives.
        role="log"
        aria-label={labels.thread}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
      >
        {messages.length === 0 && run.status === "idle" ? (
          <div className="sc-empty">{empty === undefined ? <EmptyThread suggestions={suggestions} /> : empty}</div>
        ) : null}
        {messages.map((m) => {
          const day = m.createdAt ? dayLabel(m.createdAt, labels) : "";
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
      <ThreadAnnouncer running={isRunning} failed={status === "error"} />
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
          <Chevron /> {labels.latest}
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
  /**
   * The `accept` list of the file picker, and the rule a dropped or pasted file is held to.
   * Default: images, PDF and text. A file outside it is refused with a message, not dropped.
   */
  accept?: string;
  /** Refuse a file larger than this many bytes, with a message. Omit for no limit: the kit does not guess. */
  maxFileBytes?: number;
};

/** Does `file` match an `accept` list (`image/*,.pdf,text/plain`)? */
export function matchesAccept(file: { name: string; type: string }, accept: string): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .some((t) =>
      t.startsWith(".") ? name.endsWith(t) : t.endsWith("/*") ? type.startsWith(t.slice(0, -1)) : type === t,
    );
}

const DEFAULT_ACCEPT = "image/*,application/pdf,text/*";

export function Composer({
  placeholder,
  maxInputTokens,
  models,
  model,
  onModelChange,
  toolToggles,
  onAttachFile,
  accept = DEFAULT_ACCEPT,
  maxFileBytes,
}: ComposerProps) {
  const labels = useLabels();
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
  // Files that were not attached, and why. Said out loud (role="alert"): a file that vanishes with
  // no word reads as the button being broken.
  const [rejected, setRejected] = useState<string[]>([]);

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
    const refusals: string[] = [];
    const accepted = [...files].filter((f) => {
      if (!matchesAccept(f, accept)) {
        refusals.push(labels.fileNotAccepted(f.name));
        return false;
      }
      if (maxFileBytes != null && f.size > maxFileBytes) {
        refusals.push(labels.fileTooLarge(f.name, formatBytes(maxFileBytes)));
        return false;
      }
      return true;
    });
    setRejected(refusals);
    // With a host seam, staging is the host's job — it may need to upload and
    // hand back a providerFile reference, which base64 here cannot produce.
    if (onAttachFile) {
      for (const f of accepted) {
        try {
          await onAttachFile(f);
        } catch {
          refusals.push(labels.fileNotAccepted(f.name));
          setRejected([...refusals]);
        }
      }
      return;
    }
    const settled = await Promise.allSettled(
      accepted.map(
        (f) =>
          new Promise<{ id: string; name: string; size: number; part: ContentPart }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error(f.name));
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
    // A file the browser could not read is reported like any other refusal.
    const read: { id: string; name: string; size: number; part: ContentPart }[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") read.push(r.value);
      else refusals.push(labels.fileNotAccepted(accepted[i]!.name));
    });
    if (refusals.length) setRejected([...refusals]);
    // Dedupe by identity so dropping the same file twice does not send it twice.
    setAttachments((prev) => [...prev, ...read.filter((r) => !prev.some((p) => p.id === r.id))]);
  };

  const hasContent = hasComposerContent(value, attachments.length, quotes.length);

  const submit = () => {
    const text = value.trim();
    // Attachments alone are a valid send — "summarize this file" is the text-less
    // case — and so is a quote alone: pointing at a paragraph and hitting send
    // is a complete request ("what about this?").
    if (!hasContent || isRunning || overLimit) return;
    // Host-staged parts are already on the client and get appended by send();
    // inlining them here too would send every file twice.
    const parts: ContentPart[] = [
      ...(onAttachFile ? [] : local.map((a) => a.part)),
      ...(text ? [{ type: "text" as const, text }] : []),
    ];
    setValue("");
    setAttachments([]);
    setRejected([]);
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
    <label className="sc-btn sc-btn--ghost sc-btn--sm" title={labels.attachFile} aria-disabled={isRunning}>
      <AttachIcon />
      <span className="sc-sr-only">{labels.attachFile}</span>
      <input
        type="file"
        multiple
        accept={accept}
        className="sc-composer__file"
        disabled={isRunning}
        onChange={(e) => {
          // Copied before the input is cleared: the FileList is live, and clearing the value (so
          // the same file can be picked again) empties it.
          const files = e.target.files ? [...e.target.files] : [];
          e.target.value = "";
          if (files.length) void addFiles(files);
        }}
      />
    </label>
  );

  const actionButton = isRunning ? (
    // Disabled once requested: pressing Stop twice does nothing extra, and a
    // still-live button after a stop reads as the button being broken.
    <button type="button" className="sc-btn sc-btn--ghost" onClick={stop} disabled={stopping}>
      {stopping ? labels.stopping : labels.stop}
    </button>
  ) : (
    <button type="submit" className="sc-btn sc-btn--primary" disabled={!hasContent || overLimit}>
      {labels.send}
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
        <ul className="sc-quotes" aria-label={labels.quotedFromDocument}>
          {quotes.map((q, i) => (
            <li key={`${q.docId}:${q.start}:${q.end}`} className="sc-quote">
              <span className="sc-quote__doc">{q.title}</span>
              <span className="sc-quote__text">{q.text.trim().replace(/\s+/g, " ")}</span>
              <button
                type="button"
                className="sc-quote__remove"
                aria-label={labels.removeQuote(q.title)}
                onClick={() => quoteBus?.remove(i)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {rejected.length ? (
        <ul className="sc-composer__rejected" role="alert">
          {rejected.map((r) => (
            <li key={r}>{r}</li>
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
                aria-label={labels.removeAttachment(a.name)}
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
        placeholder={placeholder ?? labels.placeholder}
        aria-label={placeholder ?? labels.placeholder}
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
              aria-label={labels.model}
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

/** Keep keyboard submission and the Send button on one content rule. */
export function hasComposerContent(value: string, attachmentCount: number, quoteCount: number): boolean {
  return Boolean(value.trim() || attachmentCount > 0 || quoteCount > 0);
}
