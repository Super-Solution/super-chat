// Skill matching. Deliberately lexical — no embeddings, no network call.
//
// Retrieval that requires an API round-trip before the *first* token of the real
// request is a latency tax on every turn, and for a curated skill set (tens, not
// millions) alias scoring is both faster and more predictable. A host that wants
// semantic retrieval implements `SkillRegistry`'s matcher hook instead; this is
// the default, not the only option.

import type { Skill, SkillMatch, SkillSection } from "./types.js";

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "to", "of", "in", "on", "for", "with", "at", "by",
  "is", "are", "was", "were", "be", "been", "do", "does", "did", "can", "could", "would", "should",
  "i", "me", "my", "you", "your", "it", "its", "this", "that", "what", "how", "please", "help",
]);

export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    // Keep CJK runs as single tokens; they carry meaning without spaces.
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Aliases/tags/names are registered once and matched against on every query
// thereafter, so their tokenization is cached rather than redone per call.
// Unbounded by design: the keys are the distinct alias/tag/name strings a
// process ever sees, which for a curated skill set is tens, not millions.
const aliasTokenCache = new Map<string, string[]>();
function tokenizeAlias(a: string): string[] {
  let tokens = aliasTokenCache.get(a);
  if (!tokens) {
    tokens = tokenize(a);
    aliasTokenCache.set(a, tokens);
  }
  return tokens;
}

/**
 * Score one alias against the query.
 *
 * Both containment directions are checked on purpose: a query "add liquidity to
 * the SUI pool" should hit the alias "add liquidity" (alias ⊂ query), and a
 * query "clmm" should hit the alias "clmm liquidity" (query ⊂ alias). Only one
 * direction and half the natural phrasings miss.
 */
function scoreAlias(alias: string, query: string, queryTokens: Set<string>): number {
  const a = alias.toLowerCase().trim();
  if (!a) return 0;
  if (a === query) return 6;
  if (queryTokens.has(a)) return 4;
  if (query.includes(a)) return 3;
  if (a.includes(query) && query.length >= 3) return 2;
  // Partial token overlap for multi-word aliases: "provide liquidity" vs "liquidity".
  const aliasTokens = tokenizeAlias(a);
  if (aliasTokens.length > 1) {
    const hits = aliasTokens.filter((t) => queryTokens.has(t)).length;
    if (hits) return 1.5 * (hits / aliasTokens.length);
  }
  return 0;
}

export function scoreSkill(skill: Skill, query: string): { score: number; reason: string; sections: SkillSection[] } {
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0, reason: "empty query", sections: [] };
  const queryTokens = new Set(tokenize(q));

  let score = 0;
  const reasons: string[] = [];

  const nameScore = scoreAlias(skill.name, q, queryTokens);
  if (nameScore) {
    score += nameScore * 1.2;
    reasons.push(`name:${nameScore.toFixed(1)}`);
  }
  if (scoreAlias(skill.id, q, queryTokens)) {
    score += 4;
    reasons.push("id");
  }

  let bestAlias = 0;
  for (const alias of skill.aliases ?? []) bestAlias = Math.max(bestAlias, scoreAlias(alias, q, queryTokens));
  if (bestAlias) {
    score += bestAlias;
    reasons.push(`alias:${bestAlias.toFixed(1)}`);
  }

  let tagHits = 0;
  for (const tag of skill.tags ?? []) if (scoreAlias(tag, q, queryTokens)) tagHits += 1;
  if (tagHits) {
    score += Math.min(tagHits, 3) * 1.2;
    reasons.push(`tags:${tagHits}`);
  }

  // Sections matched independently so a long skill can contribute just the
  // relevant part rather than its whole body.
  const sections: SkillSection[] = [];
  for (const section of skill.sections ?? []) {
    const secScore = Math.max(
      scoreAlias(section.id, q, queryTokens),
      scoreAlias(section.name, q, queryTokens),
      ...(section.aliases ?? []).map((a) => scoreAlias(a, q, queryTokens)),
    );
    if (secScore >= 1.5) {
      sections.push(section);
      score += secScore * 0.6;
    }
  }
  if (sections.length) reasons.push(`sections:${sections.length}`);

  score += skill.priority ?? 0;

  return { score, reason: reasons.join(" ") || "no match", sections };
}

/** Rank skills by relevance. `threshold` filters noise; sorting is stable by id for determinism. */
export function matchSkills(skills: readonly Skill[], query: string, threshold = 1.5): SkillMatch[] {
  return skills
    .map((skill) => {
      const { score, reason, sections } = scoreSkill(skill, query);
      return { skill, score, reason, sections };
    })
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));
}
