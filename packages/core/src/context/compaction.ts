// History compaction.
//
// Two strategies, and the choice between them is a real trade:
//
//   trim      — drop oldest turns until it fits. Free, instant, and loses
//               information silently. Correct as a fallback and for short
//               overflows.
//   summarize — ask a cheap model to compress the older span into a brief, keep
//               recent turns verbatim. Costs a request and latency, preserves
//               the thread's arc. Correct for long-lived conversations.
//
// Both preserve two invariants that a naive slice breaks:
//   • a tool-call and its result must stay together, or the next request 400s;
//   • the first kept message must not be a `tool` reply to a dropped call.

import type { Message } from "../content/types.js";
import { messageText } from "../content/parts.js";
import { countMessageTokens, countMessagesTokens } from "../tokens/budget.js";
// countMessageTokens is used to price the pinned summary during a secondary trim.
import type { TokenCounter } from "../tokens/estimate.js";

export type CompactionResult = {
  messages: Message[];
  strategy: "none" | "trim" | "summarize";
  droppedCount: number;
  tokensBefore: number;
  tokensAfter: number;
  summary?: string;
};

/** True if the message pairs with a preceding assistant tool-call. */
function isToolReply(m: Message): boolean {
  return m.parts.some((p) => p.type === "tool-result");
}

/**
 * Move a cut point later until it lands on a message that can legally start a
 * history: a user or assistant turn that is not a dangling tool reply, and not
 * an assistant turn whose tool calls were left behind.
 */
export function safeCutIndex(messages: readonly Message[], desired: number): number {
  let index = Math.max(0, Math.min(desired, messages.length));
  while (index < messages.length) {
    const m = messages[index]!;
    if (isToolReply(m)) {
      index += 1;
      continue;
    }
    // An assistant message carrying tool-calls is only safe to start on if its
    // results are in the kept span — they immediately follow, so they are.
    break;
  }
  return index;
}

export function trimHistory(
  messages: readonly Message[],
  limitTokens: number,
  counter?: TokenCounter,
  /** Pass this when the caller already scanned `messages` (e.g. `compactHistory`'s `tokensBefore`) to skip a second full-history scan. */
  knownTokensBefore?: number,
): CompactionResult {
  const tokensBefore = knownTokensBefore ?? countMessagesTokens(messages, counter);
  if (tokensBefore <= limitTokens) {
    return { messages: [...messages], strategy: "none", droppedCount: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  // Walk backwards accumulating until the budget is spent — the newest turns are
  // the ones worth keeping.
  let used = 0;
  let cut = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const size = countMessageTokens(messages[i]!, counter);
    if (used + size > limitTokens) break;
    used += size;
    cut = i;
  }

  const start = safeCutIndex(messages, cut);
  const kept = messages.slice(start);
  return {
    messages: [...kept],
    strategy: "trim",
    droppedCount: start,
    tokensBefore,
    tokensAfter: countMessagesTokens(kept, counter),
  };
}

export type Summarizer = (messages: readonly Message[], signal?: AbortSignal) => Promise<string>;

export type CompactOptions = {
  limitTokens: number;
  /** Turns always kept verbatim at the tail. */
  keepRecent?: number;
  summarizer?: Summarizer;
  counter?: TokenCounter;
  signal?: AbortSignal;
};

/**
 * Compact history to fit `limitTokens`.
 *
 * Falls back to `trim` whenever summarization is unavailable or fails —
 * a summarizer that errors must never take the user's turn down with it.
 */
export async function compactHistory(
  messages: readonly Message[],
  opts: CompactOptions,
): Promise<CompactionResult> {
  const counter = opts.counter;
  const tokensBefore = countMessagesTokens(messages, counter);
  if (tokensBefore <= opts.limitTokens) {
    return { messages: [...messages], strategy: "none", droppedCount: 0, tokensBefore, tokensAfter: tokensBefore };
  }
  if (!opts.summarizer) return trimHistory(messages, opts.limitTokens, counter, tokensBefore);

  const keepRecent = opts.keepRecent ?? 8;
  const desiredCut = Math.max(0, messages.length - keepRecent);
  const cut = safeCutIndex(messages, desiredCut);
  const older = messages.slice(0, cut);
  const recent = messages.slice(cut);

  // Nothing old enough to be worth a summarization round-trip.
  if (older.length < 2) return trimHistory(messages, opts.limitTokens, counter, tokensBefore);

  let summary: string;
  try {
    summary = (await opts.summarizer(older, opts.signal)).trim();
  } catch {
    return trimHistory(messages, opts.limitTokens, counter, tokensBefore);
  }
  if (!summary) return trimHistory(messages, opts.limitTokens, counter, tokensBefore);

  const summaryMessage: Message = {
    id: `summary_${cut}`,
    role: "user",
    parts: [
      {
        type: "text",
        // Framed as context rather than as something the user said, so the model
        // does not answer the summary as if it were a new request.
        text: `[Earlier conversation summary — ${older.length} messages]\n${summary}`,
      },
    ],
    metadata: { superchat: "compaction-summary", replaced: older.length },
  };

  const out = [summaryMessage, ...recent];
  const tokensAfter = countMessagesTokens(out, counter);

  // Even summarized it may not fit, when the recent tail alone is huge. Trim
  // only the RECENT span and keep the summary: a plain trim walks from the
  // newest backwards, so it would drop the summary first — discarding the one
  // artifact we just paid a model call to produce.
  if (tokensAfter > opts.limitTokens) {
    const summaryTokens = countMessageTokens(summaryMessage, counter);
    // tokensAfter already accounts for summaryMessage + recent, so recent's
    // token count falls out for free instead of a second scan.
    const trimmed = trimHistory(recent, Math.max(0, opts.limitTokens - summaryTokens), counter, tokensAfter - summaryTokens);
    const messages = [summaryMessage, ...trimmed.messages];
    return {
      messages,
      strategy: "summarize",
      droppedCount: older.length + trimmed.droppedCount,
      tokensBefore,
      tokensAfter: countMessagesTokens(messages, counter),
      summary,
    };
  }

  return { messages: out, strategy: "summarize", droppedCount: older.length, tokensBefore, tokensAfter, summary };
}

/**
 * Default summarization prompt builder. Exposed so a host can reuse the exact
 * framing with its own model call.
 */
export function buildSummaryPrompt(messages: readonly Message[]): string {
  const transcript = messages
    .map((m) => {
      const text = messageText(m);
      const calls = m.parts
        .filter((p) => p.type === "tool-call")
        .map((p) => `→ called ${(p as { name: string }).name}`)
        .join(" ");
      return `${m.role}: ${text}${calls ? ` ${calls}` : ""}`.trim();
    })
    .filter((line) => line.length > line.indexOf(":") + 1)
    .join("\n");

  return [
    "Compress this conversation span into a brief the assistant can act on.",
    "Keep: decisions made, facts established, user preferences, unresolved threads, and identifiers (ids, addresses, filenames).",
    "Drop: pleasantries, restatements, and anything superseded by a later turn.",
    "Write it as terse notes, not prose. No preamble.",
    "",
    transcript,
  ].join("\n");
}
