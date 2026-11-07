// Retrieval seam.
//
// The framework's position: retrieval is a CONTEXT SOURCE, not a vector
// database. `Retriever` is one method a host backs with whatever it already
// runs (pgvector, Elasticsearch, a SaaS RAG API); `createRetrievalSource()`
// runs it against the turn's query and injects the hits as a numbered
// evidence layer — under the same token budget, recorded in the same trace,
// with reference markers the model can cite via the `citations` card. That
// closes the loop the card system left open: a citations renderer with no way
// to produce citations.
//
// `createKeywordRetriever()` is the zero-dependency reference implementation —
// honest lexical overlap scoring for demos and tests, not a semantic index.

import { tokenize } from "../skills/match.js";
import { estimateTokens } from "../tokens/estimate.js";
import type { ContextSource } from "../context/types.js";

export type RetrievedChunk = {
  id: string;
  text: string;
  /** Where this came from — shown to the user in citations. */
  source?: string;
  title?: string;
  uri?: string;
  /** Higher is better; used only for ordering, scale is the retriever's. */
  score?: number;
};

export type Retriever = {
  retrieve(query: string, opts?: { limit?: number; signal?: AbortSignal; vars?: Record<string, unknown> }): Promise<RetrievedChunk[]>;
};

export type RetrievalSourceOptions = {
  id?: string;
  /** Max chunks injected per turn. */
  limit?: number;
  /** Budget-pressure priority; memory is 500. */
  priority?: number;
  /** Skip retrieval entirely for queries shorter than this (greetings). */
  minQueryLength?: number;
};

/** Plug a retriever into context assembly as a cited-evidence layer. */
export function createRetrievalSource(retriever: Retriever, opts: RetrievalSourceOptions = {}): ContextSource {
  return {
    id: opts.id ?? "retrieval",
    async run({ query, vars, signal }) {
      if (query.trim().length < (opts.minQueryLength ?? 8)) return {};
      const chunks = (await retriever.retrieve(query, { limit: opts.limit ?? 5, signal, vars })).slice(
        0,
        opts.limit ?? 5,
      );
      if (!chunks.length) return {};

      const text = [
        "Reference material retrieved for this question. Ground your answer in it when relevant:",
        ...chunks.map(
          (c, i) =>
            `[${i + 1}] ${c.title ?? c.id}${c.source ? ` (${c.source})` : ""}\n${c.text.trim()}`,
        ),
        "When your answer draws on a reference, cite it — use the `citations` card via the visualize tool, quoting the passage you relied on, so the reader can check the work.",
      ].join("\n\n");

      return {
        layers: [
          {
            id: opts.id ?? "retrieval",
            kind: "custom",
            text,
            tokens: estimateTokens(text),
            priority: opts.priority ?? 400,
          },
        ],
      };
    },
  };
}

export type RetrievalDoc = { id: string; text: string; title?: string; source?: string; uri?: string };

/**
 * Zero-dependency lexical retriever: paragraphs scored by token overlap with
 * the query (CJK-safe via the skills tokenizer). The reference implementation
 * a host swaps for a real index — and enough for a playground to demonstrate
 * the whole retrieve → inject → cite loop honestly.
 */
export function createKeywordRetriever(docs: readonly RetrievalDoc[]): Retriever {
  type Chunk = RetrievedChunk & { terms: Set<string>; idx: number };
  const chunks: Chunk[] = docs
    .flatMap((doc) =>
      doc.text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((paragraph, i) => ({
          id: `${doc.id}#${i}`,
          text: paragraph,
          ...(doc.title ? { title: doc.title } : {}),
          ...(doc.source ? { source: doc.source } : {}),
          ...(doc.uri ? { uri: doc.uri } : {}),
          terms: new Set(tokenize(paragraph)),
        })),
    )
    // `idx` records original corpus order so candidate gathering below (which
    // visits chunks per query term, not in corpus order) can restore it before
    // scoring — ties must break the same way the old full scan did.
    .map((c, idx) => ({ ...c, idx }));

  // term → chunks containing it, built once so a query only touches chunks
  // sharing at least one query term instead of rescanning the whole corpus.
  const invertedIndex = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    for (const term of chunk.terms) {
      const bucket = invertedIndex.get(term);
      if (bucket) bucket.push(chunk);
      else invertedIndex.set(term, [chunk]);
    }
  }

  return {
    async retrieve(query, opts = {}) {
      const queryTerms = tokenize(query);
      if (!queryTerms.length) return [];

      const seen = new Set<Chunk>();
      const candidates: Chunk[] = [];
      for (const term of queryTerms) {
        for (const chunk of invertedIndex.get(term) ?? []) {
          if (!seen.has(chunk)) {
            seen.add(chunk);
            candidates.push(chunk);
          }
        }
      }
      candidates.sort((a, b) => a.idx - b.idx);

      const scored = candidates
        .map((c) => {
          const hits = queryTerms.filter((t) => c.terms.has(t)).length;
          return { chunk: c, score: hits / Math.sqrt(c.terms.size || 1) };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.limit ?? 5);
      return scored.map(({ chunk, score }) => {
        const { terms: _terms, idx: _idx, ...rest } = chunk;
        return { ...rest, score };
      });
    },
  };
}
