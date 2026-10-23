// Demo skills across three unrelated domains.
//
// Three domains rather than one on purpose: the point of a skill registry is
// that ONE agent covers several fields and only pays for the one the message is
// about. A single-domain demo hides that entirely — and worse, it makes the
// framework look like it was built for that domain.

import type { Skill } from "@super-solution/super-chat-core";

export const SKILLS: Skill[] = [
  {
    id: "conduct",
    name: "How you work",
    description: "Always-on operating rules.",
    mode: "always",
    priority: 10,
    body: [
      "You are a research assistant. You work across whatever field the question is in.",
      "",
      "- Prefer showing over telling. If a result compares things, trends over time, has more than three fields, or asks the user to choose, render a card.",
      "- Never invent facts or figures. Everything you show must come from a tool result.",
      "- When several candidates fit what was asked, render a `choice` card instead of picking for them.",
      "- Cite what you relied on when the answer rests on specific sources.",
      "- Keep prose short. The card carries the data; your text carries the meaning.",
      "- Say plainly when something is outside what you checked.",
    ].join("\n"),
  },

  {
    id: "legal",
    name: "Contract & compliance review",
    description: "Reviewing agreements, clauses, obligations and regulatory requirements.",
    mode: "matched",
    aliases: ["contract", "clause", "agreement", "legal", "liability", "indemnity", "gdpr", "compliance", "terms", "nda", "合約", "條款", "法律"],
    tags: ["law", "risk", "policy"],
    tools: ["reviewContract", "checkCompliance", "findPrecedent"],
    body: [
      "Route contract and compliance work like this:",
      "",
      "1. `reviewContract` for a specific agreement — it returns clause-level findings with severity. Render as `checklist` grouped by section, and a `gauge` for overall risk.",
      "2. `checkCompliance` for 'are we allowed to' questions against a named framework. Render the requirement list as `checklist`, and put anything unresolved in a `callout` with tone `warning`.",
      "3. `findPrecedent` when the answer rests on authority. ALWAYS follow it with a `citations` card — an unsourced legal claim is worse than no answer.",
      "4. Comparing two agreements or two clause options → `comparison`.",
      "",
      "End every substantive legal answer with a `callout` (tone: note) stating this is not legal advice and a qualified lawyer should review it.",
    ].join("\n"),
    sections: [
      {
        id: "redline",
        name: "Redlines and edits",
        aliases: ["redline", "markup", "revise", "amend", "edit clause", "修改"],
        body: "When proposing wording changes, render a `diff` card with the original as `before` and your proposal as `after`. Explain the risk each change addresses — never present a redline without its reason.",
      },
    ],
  },

  {
    id: "marketing",
    name: "Marketing & growth analysis",
    description: "Campaigns, funnels, positioning, audience and channel performance.",
    mode: "matched",
    aliases: [
      "campaign", "marketing", "funnel", "conversion", "audience", "channel", "growth",
      "ctr", "cac", "positioning", "competitor", "competitors", "signup", "retention",
      // People ask "how do we compare against X" far more often than they say
      // "positioning" — match the phrasing, not the jargon.
      "compare against", "stack up", "rivals", "market share",
      "行銷", "轉換", "受眾", "競品",
    ],
    tags: ["growth", "analytics", "content"],
    tools: ["getCampaign", "getFunnel", "compareCompetitors"],
    body: [
      "Route marketing questions like this:",
      "",
      "1. `getFunnel` for anything about drop-off or conversion. Render a `funnel` card — it computes step conversion for you. Name the single worst step in your text.",
      "2. `getCampaign` for channel or campaign performance. Several channels over time → `chart`; one period across channels → `table`.",
      "3. `compareCompetitors` for positioning. Render a `comparison` card and mark the recommended option with `highlight`.",
      "",
      "Rates beat totals. A channel with 40 conversions from 100 visits beats one with 200 from 40,000 — lead with the rate.",
      "Never attribute a change to a cause the data cannot separate; say what you cannot distinguish.",
    ].join("\n"),
  },

  {
    id: "markets",
    name: "Market analysis",
    description: "Prices, instruments and market trends.",
    mode: "matched",
    aliases: ["price", "market", "ticker", "stock", "crypto", "trend", "行情", "價格"],
    tags: ["finance"],
    // `createAlert` is named here, but naming only grants relevance — it also
    // carries the `executor` preset, which must be enabled independently.
    tools: ["getQuote", "getHistory", "listInstruments", "compareInstruments", "createAlert"],
    body: [
      "1. Resolve the instrument first. If the term is ambiguous, call `listInstruments` and render a `choice` card — never guess a ticker.",
      "2. A single figure → `getQuote`, render `stats`.",
      "3. Movement over time → `getHistory`, render a `chart` (variant `candlestick` for price action).",
      "4. Several instruments → `compareInstruments`, one `table` beats several stat cards.",
      "",
      "Always state the period. A percentage with no timeframe is meaningless.",
    ].join("\n"),
  },

  {
    id: "deep-research",
    name: "Deep research",
    description: "Long multi-step investigations that should run in the background.",
    // Manual: the model sees only this one-line description until it decides it
    // needs the method, then pulls the body with `loadSkill`.
    mode: "manual",
    body: [
      "Deep research method:",
      "",
      "1. Restate the question as three sub-questions. Show them as a `progress` card with all steps pending.",
      "2. Work each one, calling `updateCard` to move its step to active, then done.",
      "3. Finish with a `markdown` card holding the synthesis and a `citations` card holding every source you actually used.",
      "4. If a sub-question could not be answered, say so in a `callout` rather than papering over it.",
      "",
      "Run this in background mode — it is long enough that a dropped connection would lose the work.",
    ].join("\n"),
  },
];
