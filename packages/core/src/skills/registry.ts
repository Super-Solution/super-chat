// The skill registry: one store, three delivery modes, plus the tool surface
// that makes `manual` skills reachable by the model.

import { estimateTokens } from "../tokens/estimate.js";
import { matchSkills } from "./match.js";
import type { ResolvedSkill, Skill, SkillContext, SkillMatch, SkillSection } from "./types.js";

export type SkillMatcher = (skills: readonly Skill[], query: string) => SkillMatch[];

export type SkillRegistryOptions = {
  /** Swap in embeddings/BM25 without touching the rest of the pipeline. */
  matcher?: SkillMatcher;
  /** Max `matched`-mode skills injected per turn. Guards against a query that hits everything. */
  maxMatched?: number;
  threshold?: number;
};

/** Render a skill (or just its matched sections) to the text that goes in context. */
export async function renderSkill(
  skill: Skill,
  ctx: SkillContext,
  sections?: SkillSection[],
): Promise<string> {
  const body = typeof skill.body === "function" ? await skill.body(ctx) : skill.body;
  const chosen = sections?.length ? sections : skill.sections ?? [];

  const parts = [`## ${skill.name}`, body.trim()];
  for (const section of chosen) {
    parts.push(`### ${section.name}`, section.body.trim());
  }
  if (skill.resources?.length) {
    parts.push(
      "Resources:",
      skill.resources.map((r) => `- ${r.name}${r.description ? ` — ${r.description}` : ""}: ${r.uri}`).join("\n"),
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private readonly matcher: SkillMatcher;
  private readonly maxMatched: number;
  private readonly threshold: number;
  /** Cached `manualIndex()` render; invalidated by `register`/`unregister`. */
  private manualIndexCache: string | undefined;

  constructor(skills: readonly Skill[] = [], options: SkillRegistryOptions = {}) {
    this.threshold = options.threshold ?? 1.5;
    this.matcher = options.matcher ?? ((s, q) => matchSkills(s, q, this.threshold));
    this.maxMatched = options.maxMatched ?? 3;
    for (const s of skills) this.register(s);
  }

  register(skill: Skill): this {
    this.skills.set(skill.id, skill);
    this.manualIndexCache = undefined;
    return this;
  }

  unregister(id: string): this {
    this.skills.delete(id);
    this.manualIndexCache = undefined;
    return this;
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  match(query: string): SkillMatch[] {
    return this.matcher(this.list(), query);
  }

  /**
   * The skills that should be *pushed* into this turn's context: every `always`
   * skill, plus the top-scoring `matched` ones.
   *
   * `manual` skills are excluded by design — they are pulled by the model via
   * `loadSkill`, and pushing them would defeat the point of having the mode.
   */
  async resolveForTurn(ctx: SkillContext, opts: { forceIds?: string[] } = {}): Promise<ResolvedSkill[]> {
    const forced = new Set(opts.forceIds ?? []);
    // Computed once and fed to the matcher directly (rather than through
    // `this.match`, which would call `this.list()` again) — one array
    // allocation per turn instead of two.
    const list = this.list();
    const always = list.filter((s) => s.mode === "always" || forced.has(s.id));
    const matched = this.matcher(list, ctx.query)
      .filter((m) => m.skill.mode === "matched" && !forced.has(m.skill.id))
      .slice(0, this.maxMatched);

    const out: ResolvedSkill[] = [];
    for (const skill of always) {
      const text = await renderSkill(skill, ctx);
      out.push({
        id: skill.id,
        name: skill.name,
        text,
        tokens: estimateTokens(text),
        // Sort key: `always` outranks any matched score so it survives packing.
        score: 1_000 + (skill.priority ?? 0),
        mode: skill.mode,
        tools: skill.tools ?? [],
      });
    }
    for (const m of matched) {
      const text = await renderSkill(m.skill, ctx, m.sections);
      out.push({
        id: m.skill.id,
        name: m.skill.name,
        text,
        tokens: estimateTokens(text),
        score: m.score,
        mode: m.skill.mode,
        tools: m.skill.tools ?? [],
      });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /**
   * One-line index of the skills the model may load on demand. Cheap enough to
   * include every turn — this is the "menu" half of progressive disclosure.
   */
  manualIndex(): string {
    if (this.manualIndexCache !== undefined) return this.manualIndexCache;
    const manual = this.list().filter((s) => s.mode === "manual");
    const lines = manual.map((s) => `- ${s.id}: ${s.description}`);
    const index = !manual.length
      ? ""
      : ["Loadable skills — call `loadSkill` with an id before acting in these areas:", ...lines].join("\n");
    this.manualIndexCache = index;
    return index;
  }

  /** Everything a `loadSkill` call should return for `id`. */
  async load(id: string, ctx: SkillContext): Promise<{ found: boolean; text: string; tools: string[] }> {
    const skill = this.skills.get(id);
    if (!skill) {
      const near = this.list()
        .map((s) => s.id)
        .filter((sid) => sid.includes(id) || id.includes(sid));
      return {
        found: false,
        // Return a suggestion, not just a failure: a model that gets "unknown
        // id" retries the same id, while one that gets alternatives recovers.
        text: near.length
          ? `No skill "${id}". Did you mean: ${near.join(", ")}?`
          : `No skill "${id}". Available: ${this.list().map((s) => s.id).join(", ") || "(none)"}`,
        tools: [],
      };
    }
    return { found: true, text: await renderSkill(skill, ctx), tools: skill.tools ?? [] };
  }
}
