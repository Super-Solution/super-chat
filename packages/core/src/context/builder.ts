// The ContextBuilder — one deterministic pipeline, run fresh every turn.
//
// Order matters and is fixed:
//   1. run sources in parallel (identity, skills, memory, host sources)
//   2. pack layers into the system budget, pinned first, then by priority
//   3. compact history into what remains
//   4. record every decision in the trace
//
// Determinism is the point: the same inputs must produce the same request, or
// prompt caching never hits and debugging becomes archaeology.

import { lastUserText, stripUiOnlyParts } from "../content/parts.js";
import type { Message } from "../content/types.js";
import { isCardCarrier, stripCardPayload } from "../cards/types.js";
import { compactHistory, type Summarizer } from "./compaction.js";
import { createBudget, packByPriority, type TokenBudget } from "../tokens/budget.js";
import { estimateTokens, type TokenCounter } from "../tokens/estimate.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { ResolvedSkill } from "../skills/types.js";
import type { BuiltContext, ContextLayer, ContextSource, ContextTrace, TraceEntry } from "./types.js";

export type ContextBuilderOptions = {
  /** Base instructions. Always pinned — identity is not negotiable under pressure. */
  identity?: string;
  skills?: SkillRegistry;
  sources?: ContextSource[];
  budget?: TokenBudget;
  contextWindow?: number;
  maxOutputTokens?: number;
  counter?: TokenCounter;
  summarizer?: Summarizer;
  /** Verbatim turns kept at the tail when summarizing. */
  keepRecent?: number;
  /**
   * Appended to instructions when any card-capable tool is present. Tells the
   * model where cards appear so its prose reads correctly around them — without
   * this, models narrate "as you can see in the table below" above a card that
   * renders above the text.
   */
  cardPlacementNote?: string;
};

const DEFAULT_CARD_NOTE = [
  "CARD PLACEMENT: a card renders immediately where you call the tool, before any text you write afterwards.",
  "Write a one-line lead-in before the card, and your interpretation after it. Never re-list the card's contents in prose.",
].join("\n");

export class ContextBuilder {
  private readonly opts: ContextBuilderOptions;

  constructor(opts: ContextBuilderOptions = {}) {
    this.opts = opts;
  }

  /** The skill registry this builder draws from, for UI that lists or pins skills. */
  get skillRegistry(): SkillRegistry | undefined {
    return this.opts.skills;
  }

  /** The identity block, for a settings pane that lets the user read or edit it. */
  get identity(): string | undefined {
    return this.opts.identity;
  }

  async build(input: {
    messages: readonly Message[];
    vars?: Record<string, unknown>;
    /** Skills to force in regardless of matching (a user pinning one in the UI). */
    forceSkillIds?: string[];
    /** Tool names available before skill unlocks. */
    baseTools?: string[];
    signal?: AbortSignal;
  }): Promise<BuiltContext> {
    const counter = this.opts.counter ?? estimateTokens;
    const budget =
      this.opts.budget ??
      createBudget(this.opts.contextWindow ?? 128_000, { maxOutputTokens: this.opts.maxOutputTokens });

    const entries: TraceEntry[] = [];
    const warnings: string[] = [];
    const vars = input.vars ?? {};
    const query = lastUserText(input.messages);

    const layers: ContextLayer[] = [];
    const unlockedTools = new Set<string>(input.baseTools ?? []);
    let skills: ResolvedSkill[] = [];

    // ── 1. identity ─────────────────────────────────────────────────────────
    if (this.opts.identity?.trim()) {
      const text = this.opts.identity.trim();
      layers.push({ id: "identity", kind: "identity", text, tokens: counter(text), pinned: true, priority: 1_000 });
    }

    // ── 2. skills ───────────────────────────────────────────────────────────
    if (this.opts.skills) {
      const started = Date.now();
      try {
        skills = await this.opts.skills.resolveForTurn({ query, vars }, { forceIds: input.forceSkillIds });
        for (const s of skills) {
          layers.push({
            id: `skill:${s.id}`,
            kind: "skills",
            text: s.text,
            tokens: s.tokens,
            // `always` skills are pinned; matched ones compete for budget.
            pinned: s.mode === "always",
            priority: s.score,
          });
          for (const t of s.tools) unlockedTools.add(t);
        }
        entries.push({
          id: "skills",
          kind: "skills",
          status: "included",
          tokens: skills.reduce((n, s) => n + s.tokens, 0),
          detail: skills.length ? skills.map((s) => `${s.id}(${s.mode})`).join(", ") : "none matched",
          ms: Date.now() - started,
        });
      } catch (e) {
        entries.push({
          id: "skills",
          kind: "skills",
          status: "failed",
          tokens: 0,
          detail: e instanceof Error ? e.message : String(e),
        });
        warnings.push("Skill resolution failed; continuing without skills.");
      }

      const index = this.opts.skills.manualIndex();
      if (index) {
        layers.push({ id: "skill-index", kind: "skill-index", text: index, tokens: counter(index), pinned: true, priority: 900 });
      }
    }

    // ── 3. host sources, in parallel ────────────────────────────────────────
    const sources = this.opts.sources ?? [];
    if (sources.length) {
      const results = await Promise.allSettled(
        sources.map(async (s) => {
          const started = Date.now();
          const out = await s.run({ messages: input.messages, query, vars, signal: input.signal });
          return { id: s.id, out, ms: Date.now() - started };
        }),
      );
      for (const [i, r] of results.entries()) {
        const sourceId = sources[i]!.id;
        if (r.status === "rejected") {
          // A failed source degrades the turn; it must not kill it. Memory
          // retrieval timing out should cost context, not the conversation.
          entries.push({
            id: sourceId,
            kind: "source",
            status: "failed",
            tokens: 0,
            detail: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
          warnings.push(`Context source "${sourceId}" failed.`);
          continue;
        }
        const { out, ms } = r.value;
        for (const layer of out.layers ?? []) layers.push(layer);
        for (const t of out.tools ?? []) unlockedTools.add(t);
        entries.push({
          id: sourceId,
          kind: "source",
          status: "included",
          tokens: (out.layers ?? []).reduce((n, l) => n + l.tokens, 0),
          ms,
        });
      }
    }

    // ── 4. card placement contract ──────────────────────────────────────────
    if (unlockedTools.has("visualize")) {
      const note = this.opts.cardPlacementNote ?? DEFAULT_CARD_NOTE;
      layers.push({ id: "card-contract", kind: "custom", text: note, tokens: counter(note), pinned: true, priority: 850 });
    }

    // ── 5. pack the system block ────────────────────────────────────────────
    // Pinned layers are placed first and unconditionally; if they alone exceed
    // the share we warn rather than silently dropping an identity or a safety
    // rule, because dropping those is never the right automatic answer.
    const pinned = layers.filter((l) => l.pinned).sort((a, b) => b.priority - a.priority);
    const optional = layers.filter((l) => !l.pinned).sort((a, b) => b.priority - a.priority);
    const pinnedTokens = pinned.reduce((n, l) => n + l.tokens, 0);

    if (pinnedTokens > budget.shares.system + budget.shares.skills) {
      warnings.push(
        `Pinned context (${pinnedTokens} tok) exceeds its budget (${budget.shares.system + budget.shares.skills} tok). ` +
          "Shorten always-on skills or raise the system share.",
      );
    }

    const optionalLimit = Math.max(0, budget.shares.system + budget.shares.skills - pinnedTokens);
    const packed = packByPriority(optional, optionalLimit, (l) => l.tokens);
    for (const dropped of packed.dropped) {
      entries.push({
        id: dropped.item.id,
        kind: dropped.item.kind,
        status: "dropped",
        tokens: 0,
        originalTokens: dropped.size,
        detail: `no room in the ${optionalLimit} tok optional share`,
      });
      // A dropped skill must not leave its tools unlocked — the model would see
      // tools it has no instructions for.
      if (dropped.item.id.startsWith("skill:")) {
        const skillId = dropped.item.id.slice("skill:".length);
        const skill = skills.find((s) => s.id === skillId);
        for (const t of skill?.tools ?? []) unlockedTools.delete(t);
        skills = skills.filter((s) => s.id !== skillId);
      }
    }

    const included = [...pinned, ...packed.included];
    for (const layer of packed.included) {
      entries.push({ id: layer.id, kind: layer.kind, status: "included", tokens: layer.tokens });
    }

    const system = included.map((l) => l.text.trim()).filter(Boolean).join("\n\n");
    // Sum of the layers' own precomputed token counts, rather than re-tokenizing
    // the joined string. This slightly undercounts the "\n\n" join separators,
    // but that's a handful of tokens against an already-approximate counter
    // (see tokens/estimate.ts) — not worth a second full-text scan to close.
    const systemTokens = included.reduce((n, l) => n + l.tokens, 0);

    // ── 6. history ──────────────────────────────────────────────────────────
    // Sanitize first: strip UI-only parts and shrink card payloads. A card spec
    // can be tens of KB of chart points, and the model already saw the summary
    // in the tool's `output` — re-sending the pixels is pure waste.
    const sanitized = input.messages
      .filter((m) => m.role !== "system")
      .map(stripUiOnlyParts)
      .map(stripCardPayloads);

    const historyLimit = Math.max(1_000, budget.shares.history);
    const compaction = await compactHistory(sanitized, {
      limitTokens: historyLimit,
      keepRecent: this.opts.keepRecent ?? 8,
      summarizer: this.opts.summarizer,
      counter,
      signal: input.signal,
    });

    if (compaction.strategy !== "none") {
      entries.push({
        id: "history",
        kind: "history",
        status: compaction.strategy === "summarize" ? "compacted" : "truncated",
        tokens: compaction.tokensAfter,
        originalTokens: compaction.tokensBefore,
        detail: `${compaction.strategy}: dropped ${compaction.droppedCount} message(s)`,
      });
    } else {
      entries.push({ id: "history", kind: "history", status: "included", tokens: compaction.tokensAfter });
    }

    // compaction.tokensAfter is already an exact count of compaction.messages —
    // computed inside compactHistory/trimHistory with this same counter — so
    // reuse it instead of scanning the history a second time.
    const historyTokens = compaction.tokensAfter;
    const toolNames = [...unlockedTools].sort();
    const total = systemTokens + historyTokens;

    const trace: ContextTrace = {
      entries,
      budget,
      totals: { system: systemTokens, history: historyTokens, tools: 0, total },
      headroom: budget.contextWindow - total - budget.shares.output,
      warnings,
    };

    if (trace.headroom < 0) {
      warnings.push(`Context overflows its window by ~${-trace.headroom} tokens. The provider may reject this request.`);
    }

    return { system, messages: compaction.messages, toolNames, trace, skills };
  }
}

/** Apply `stripCardPayload` to every tool result in a persisted message. */
function stripCardPayloads(m: Message): Message {
  let changed = false;
  const parts = m.parts.map((p) => {
    if (p.type !== "tool-result" || !isCardCarrier(p.output)) return p;
    changed = true;
    return { ...p, output: stripCardPayload(p.output) };
  });
  return changed ? { ...m, parts } : m;
}
