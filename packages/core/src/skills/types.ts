// Skills: retrievable operating knowledge, not prompts.
//
// The distinction that makes this worth a subsystem: a system prompt is one
// blob that every turn pays for, whereas a skill is a *unit* with a trigger, a
// cost, and a delivery mode. Three modes, and picking the right one per skill is
// the whole game:
//
//   always  — injected every turn. For rules that must never be missed
//             (safety boundaries, output format, identity). Costs tokens on
//             every request, so keep these short.
//   matched — injected only when the user's message scores against its
//             aliases/tags. For domain playbooks: the trading playbook costs
//             nothing on a "hello".
//   manual  — never injected; exposed to the model as a `loadSkill` tool it can
//             call when it decides it needs one. Progressive disclosure: the
//             model sees a one-line index and pulls the body on demand.
//
// A skill can also declare `tools`, which lets loading a skill unlock the tools
// it describes — so the model isn't shown twenty DeFi tools until it is
// actually doing DeFi.

export type SkillMode = "always" | "matched" | "manual";

/** A sub-topic within a skill, matched and loaded independently. */
export type SkillSection = {
  id: string;
  name: string;
  aliases?: string[];
  body: string;
};

export type SkillContext = {
  /** The text being matched against — usually the latest user message. */
  query: string;
  /** Host-supplied values (user id, network, locale) for dynamic bodies. */
  vars?: Record<string, unknown>;
};

export type Skill = {
  id: string;
  name: string;
  /** One line. This is what the model sees in the skill index for manual skills. */
  description: string;
  mode: SkillMode;
  /** Trigger words. Matched case-insensitively against the query, both directions. */
  aliases?: string[];
  tags?: string[];
  /** Higher wins when the token budget forces a choice. Default 0. */
  priority?: number;
  /** Body, or a function for context-dependent bodies (e.g. injecting the user's balances). */
  body: string | ((ctx: SkillContext) => string | Promise<string>);
  sections?: SkillSection[];
  /** Tool names this skill unlocks when loaded. */
  tools?: string[];
  /** Pointers the model can be told about without paying for their content. */
  resources?: { name: string; description?: string; uri: string }[];
};

export type SkillMatch = {
  skill: Skill;
  score: number;
  /** Which sections matched, when the query was section-specific. */
  sections: SkillSection[];
  reason: string;
};

/** A skill rendered to text, ready to be placed in a context layer. */
export type ResolvedSkill = {
  id: string;
  name: string;
  text: string;
  tokens: number;
  score: number;
  mode: SkillMode;
  tools: string[];
};
