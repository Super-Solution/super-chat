// Token budgeting.
//
// The context window is a fixed resource contended for by five claimants:
// instructions, skills, memory, history, and the model's own output. Without an
// explicit allocator whichever one grows fastest (history) silently starves the
// rest, and the first symptom is the model "forgetting" its rules on long
// threads — which reads like a prompt problem and isn't.

import { estimateTokens, MESSAGE_OVERHEAD_TOKENS, type TokenCounter } from "./estimate.js";
import type { Message } from "../content/types.js";

export type BudgetShares = {
  /** Reserved for the model's reply. Never lent out. */
  output: number;
  system: number;
  skills: number;
  memory: number;
  history: number;
  tools: number;
};

export type TokenBudget = {
  contextWindow: number;
  shares: BudgetShares;
  /** Safety margin, since estimation is approximate. */
  reservePct: number;
};

export function createBudget(contextWindow: number, opts: Partial<BudgetShares> & { reservePct?: number; maxOutputTokens?: number } = {}): TokenBudget {
  const output = opts.output ?? opts.maxOutputTokens ?? Math.min(8_000, Math.floor(contextWindow * 0.15));
  const reservePct = opts.reservePct ?? 0.05;
  const usable = Math.floor(contextWindow * (1 - reservePct)) - output;

  // Defaults chosen so that on a 128k window the fixed layers get generous room
  // and history still takes the majority — history is where the actual
  // conversation lives, and starving it to preserve skills is the wrong trade.
  return {
    contextWindow,
    reservePct,
    shares: {
      output,
      system: opts.system ?? Math.floor(usable * 0.08),
      skills: opts.skills ?? Math.floor(usable * 0.2),
      memory: opts.memory ?? Math.floor(usable * 0.07),
      tools: opts.tools ?? Math.floor(usable * 0.15),
      history: opts.history ?? Math.floor(usable * 0.5),
    },
  };
}

export const totalAllocated = (b: TokenBudget): number =>
  b.shares.system + b.shares.skills + b.shares.memory + b.shares.tools + b.shares.history;

/**
 * Fill a budget with prioritized items, greedily, highest first.
 *
 * Greedy rather than optimal (knapsack) because the ordering is meaningful:
 * skill priority encodes the author's intent about what must survive, and an
 * optimal packer would happily drop a critical high-priority skill to fit two
 * cheap ones.
 */
export function packByPriority<T>(
  items: readonly T[],
  limit: number,
  sizeOf: (item: T) => number,
): { included: T[]; dropped: { item: T; size: number }[]; used: number } {
  const included: T[] = [];
  const dropped: { item: T; size: number }[] = [];
  let used = 0;

  for (const item of items) {
    const size = sizeOf(item);
    if (used + size <= limit) {
      included.push(item);
      used += size;
    } else {
      dropped.push({ item, size });
    }
  }
  return { included, dropped, used };
}

// Per-message token counts, cached by message object identity. Persisted
// messages are never mutated in place (a new object is built for every
// change — see runtime/run.ts), so a cached count never goes stale, and a
// context build that re-walks the same history on every step (budget checks,
// compaction, the builder's own summation) does not re-count every character
// of every message it already counted last time.
//
// Keyed by object identity rather than `message.id`: compaction mints
// synthetic summary messages with a formulaic, non-unique id
// (`summary_${cut}`), so two DIFFERENT messages can share an id — an id-keyed
// cache would risk serving one message's count for another's. The counter is
// also part of the key: a caller-supplied counter and the default estimator
// must not share a cache entry.
const messageTokenCache = new WeakMap<Message, WeakMap<TokenCounter, number>>();

export function countMessageTokens(m: Message, counter: TokenCounter = estimateTokens): number {
  const cached = messageTokenCache.get(m)?.get(counter);
  if (cached !== undefined) return cached;

  let total = MESSAGE_OVERHEAD_TOKENS;
  for (const part of m.parts) {
    switch (part.type) {
      case "text":
      case "reasoning":
        total += counter(part.text);
        break;
      case "tool-call":
        total += counter(part.name) + counter(typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {})) + 8;
        break;
      case "tool-result":
        total += counter(typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? null)) + 8;
        break;
      case "image":
        // Images bill by tiles, not characters. 1105 is the low-detail flat cost
        // for a 512px tile; high detail scales with dimensions we don't know
        // here, so assume a common 2-tile image rather than guessing zero.
        total += part.detail === "low" ? 85 : 1_105;
        break;
      case "file":
        total += 2_000; // a parsed PDF page is roughly this; deliberately pessimistic
        break;
      case "audio":
        total += part.transcript ? counter(part.transcript) : 500;
        break;
      case "artifact":
        break; // stripped before send — costs nothing
    }
  }

  let byCounter = messageTokenCache.get(m);
  if (!byCounter) {
    byCounter = new WeakMap();
    messageTokenCache.set(m, byCounter);
  }
  byCounter.set(counter, total);
  return total;
}

export const countMessagesTokens = (messages: readonly Message[], counter: TokenCounter = estimateTokens): number =>
  messages.reduce((sum, m) => sum + countMessageTokens(m, counter), 0);
