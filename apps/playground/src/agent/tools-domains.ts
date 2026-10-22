// Legal and marketing demo tools.
//
// Same shape as the market tools, deliberately: a domain tool is just a schema,
// an executor, and a card. Nothing about the framework changes between fields —
// which is the thing this file exists to demonstrate.

import { withCard, type ToolDefinition } from "@super-solution/super-chat-core";

// ── Legal ───────────────────────────────────────────────────────────────────

const CLAUSE_FINDINGS = [
  { section: "Liability", label: "Unlimited liability for the supplier", status: "blocked" as const, detail: "Clause 8.2 caps the customer but not the supplier. Standard is a mutual cap at 12 months' fees." },
  { section: "Liability", label: "Consequential loss excluded both ways", status: "done" as const },
  { section: "Term & termination", label: "No termination for convenience", status: "todo" as const, detail: "Clause 3 only allows termination for cause. A 60-day notice right is normal here." },
  { section: "Term & termination", label: "Auto-renewal with 90-day notice", status: "blocked" as const, detail: "Clause 3.4 renews for 24 months unless cancelled 90 days out. Unusually long." },
  { section: "Data", label: "Sub-processor list is closed", status: "done" as const },
  { section: "Data", label: "No breach notification window", status: "blocked" as const, detail: "Clause 11 requires notice 'promptly'. GDPR Art. 33 expects 72 hours — make it explicit." },
  { section: "IP", label: "Customer retains input data ownership", status: "done" as const },
  { section: "IP", label: "Feedback licence is perpetual and irrevocable", status: "todo" as const, detail: "Common, but worth narrowing to anonymised feedback." },
];

export const reviewContract: ToolDefinition = {
  name: "reviewContract",
  side: "read",
  description:
    "Review an agreement and return clause-level findings with severity, plus an overall risk score. Render the findings as a `checklist` grouped by section and the score as a `gauge`.",
  inputSchema: {
    type: "object",
    required: ["document"],
    properties: {
      document: { type: "string", description: "Name or identifier of the agreement." },
      focus: { type: "string", description: "Optional area to concentrate on, e.g. 'liability'." },
    },
    additionalProperties: false,
  },
  execute(input, ctx) {
    const { document, focus } = (input ?? {}) as { document?: string; focus?: string };
    const items = focus
      ? CLAUSE_FINDINGS.filter((f) => f.section.toLowerCase().includes(focus.toLowerCase()) || f.label.toLowerCase().includes(focus.toLowerCase()))
      : CLAUSE_FINDINGS;
    if (!items.length) {
      return { output: { error: `No findings for focus "${focus}".`, sections: [...new Set(CLAUSE_FINDINGS.map((f) => f.section))] }, failure: "not-found" as const };
    }

    const blockers = items.filter((f) => f.status === "blocked").length;
    const score = Math.min(100, blockers * 22 + items.filter((f) => f.status === "todo").length * 8);

    ctx.emitCard?.({
      kind: "gauge",
      title: "Overall risk",
      value: score,
      min: 0,
      max: 100,
      bands: [
        { from: 0, to: 30, label: "Acceptable", tone: "positive" },
        { from: 30, to: 60, label: "Negotiate", tone: "warning" },
        { from: 60, to: 100, label: "Do not sign", tone: "negative" },
      ],
    });

    return {
      output: withCard(
        {
          document: document ?? "agreement",
          findings: items.length,
          blockers,
          riskScore: score,
          summary: items.filter((f) => f.status === "blocked").map((f) => f.label),
        },
        {
          kind: "checklist",
          title: `Review — ${document ?? "agreement"}`,
          items: items.map((f) => ({ label: f.label, status: f.status, detail: f.detail, group: f.section })),
        },
      ),
    };
  },
};

const FRAMEWORKS: Record<string, { label: string; requirements: { label: string; status: "done" | "todo" | "blocked" | "na"; detail?: string }[] }> = {
  gdpr: {
    label: "GDPR",
    requirements: [
      { label: "Lawful basis documented for each purpose", status: "done" },
      { label: "Records of processing (Art. 30) maintained", status: "done" },
      { label: "DPA signed with every sub-processor", status: "blocked", detail: "Two sub-processors in the current list have no DPA on file." },
      { label: "Breach notification within 72 hours", status: "todo", detail: "Process exists but is not written down or tested." },
      { label: "DSAR workflow with a 30-day clock", status: "done" },
      { label: "Transfer mechanism for non-EEA processing", status: "blocked", detail: "One US sub-processor relies on an outdated SCC set." },
      { label: "DPIA for high-risk processing", status: "na", detail: "No high-risk processing identified in scope." },
    ],
  },
  soc2: {
    label: "SOC 2 Type II",
    requirements: [
      { label: "Access reviews performed quarterly", status: "done" },
      { label: "Change management tickets linked to deploys", status: "todo", detail: "Linked for 78% of deploys in the sample period." },
      { label: "Vendor risk assessments on file", status: "blocked" },
      { label: "Incident response plan tested annually", status: "done" },
      { label: "Encryption at rest and in transit", status: "done" },
    ],
  },
};

export const checkCompliance: ToolDefinition = {
  name: "checkCompliance",
  side: "read",
  description:
    "Check a named framework's requirements and their current status. Render as a `checklist`; put unresolved items in a `callout`.",
  inputSchema: {
    type: "object",
    required: ["framework"],
    properties: { framework: { type: "string", description: "e.g. gdpr, soc2" } },
    additionalProperties: false,
  },
  execute(input) {
    const { framework } = (input ?? {}) as { framework?: string };
    const key = String(framework).toLowerCase().replace(/[^a-z0-9]/g, "");
    const found = FRAMEWORKS[key];
    if (!found) {
      return { output: { error: `Unknown framework "${framework}".`, known: Object.keys(FRAMEWORKS) }, failure: "not-found" as const };
    }
    const open = found.requirements.filter((r) => r.status === "blocked" || r.status === "todo");
    return {
      output: withCard(
        { framework: found.label, total: found.requirements.length, open: open.length, openItems: open.map((r) => r.label) },
        { kind: "checklist", title: `${found.label} readiness`, items: found.requirements },
      ),
    };
  },
};

const PRECEDENTS = [
  {
    title: "Photo Production Ltd v Securicor Transport Ltd",
    source: "House of Lords",
    date: "1980",
    locator: "[1980] AC 827",
    snippet: "A clearly worded exclusion clause may exclude liability even for a fundamental breach, where that is the parties' true bargain.",
    relevance: "high" as const,
  },
  {
    title: "Unfair Contract Terms Act 1977, s.3",
    source: "UK statute",
    date: "1977",
    locator: "s.3(2)(a)",
    snippet: "Against a party dealing on the other's written standard terms, an exclusion is effective only so far as it satisfies the requirement of reasonableness.",
    relevance: "high" as const,
  },
  {
    title: "Regulation (EU) 2016/679 (GDPR)",
    source: "EU regulation",
    date: "2016",
    locator: "Art. 33(1)",
    snippet: "The controller shall notify the supervisory authority without undue delay and, where feasible, not later than 72 hours after having become aware of it.",
    relevance: "medium" as const,
  },
];

export const findPrecedent: ToolDefinition = {
  name: "findPrecedent",
  side: "read",
  description:
    "Find authority supporting or limiting a legal position. ALWAYS render the result as a `citations` card — an unsourced legal claim is worse than no answer.",
  inputSchema: {
    type: "object",
    required: ["question"],
    properties: { question: { type: "string" } },
    additionalProperties: false,
  },
  execute(input) {
    const { question = "" } = (input ?? {}) as { question?: string };
    const q = question.toLowerCase();
    const hits = PRECEDENTS.filter(
      (p) =>
        (/liabilit|exclusion|cap|indemn/.test(q) && /Photo|Unfair/.test(p.title)) ||
        (/breach|notif|gdpr|data|72/.test(q) && /GDPR/.test(p.title)),
    );
    const items = hits.length ? hits : PRECEDENTS;
    return {
      output: withCard(
        { matched: hits.length, authorities: items.map((i) => `${i.title} ${i.locator}`) },
        { kind: "citations", title: "Authority relied on", items },
      ),
    };
  },
};

// ── Marketing ───────────────────────────────────────────────────────────────

export const getFunnel: ToolDefinition = {
  name: "getFunnel",
  side: "read",
  description: "Conversion funnel for a period. Render as a `funnel` card and name the worst step.",
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", description: "e.g. 'last 30 days'. Defaults to the last 30 days." },
      segment: { type: "string", description: "Optional audience segment." },
    },
    additionalProperties: false,
  },
  execute(input) {
    const { period = "last 30 days", segment } = (input ?? {}) as { period?: string; segment?: string };
    const scale = segment ? 0.31 : 1;
    const stages = [
      { label: "Visitors", value: Math.round(48_200 * scale) },
      { label: "Signed up", value: Math.round(6_140 * scale), note: "email or SSO" },
      { label: "Activated", value: Math.round(2_390 * scale), note: "completed setup" },
      { label: "Retained (D7)", value: Math.round(1_180 * scale) },
      { label: "Paid", value: Math.round(312 * scale) },
    ];

    const worst = stages
      .slice(1)
      .map((s, i) => ({ label: s.label, rate: (s.value / stages[i]!.value) * 100 }))
      .sort((a, b) => a.rate - b.rate)[0]!;

    return {
      output: withCard(
        {
          period,
          segment: segment ?? "all",
          overallConversion: Number(((stages.at(-1)!.value / stages[0]!.value) * 100).toFixed(2)),
          worstStep: { step: worst.label, rate: Number(worst.rate.toFixed(1)) },
        },
        { kind: "funnel", title: `Conversion — ${period}${segment ? ` · ${segment}` : ""}`, stages, format: "number" },
      ),
    };
  },
};

const CHANNELS = [
  { channel: "Organic search", visits: 18_400, signups: 2_610, cac: 0, ctr: 4.2 },
  { channel: "Paid search", visits: 12_900, signups: 1_480, cac: 68, ctr: 2.1 },
  { channel: "Social", visits: 9_800, signups: 640, cac: 91, ctr: 1.1 },
  { channel: "Email", visits: 4_300, signups: 980, cac: 12, ctr: 9.4 },
  { channel: "Referral", visits: 2_800, signups: 430, cac: 24, ctr: 6.8 },
];

export const getCampaign: ToolDefinition = {
  name: "getCampaign",
  side: "read",
  description: "Channel performance for a period. Render as a `table`; lead with the rate, not the total.",
  inputSchema: {
    type: "object",
    properties: { period: { type: "string" } },
    additionalProperties: false,
  },
  execute(input) {
    const { period = "last 30 days" } = (input ?? {}) as { period?: string };
    const rows = CHANNELS.map((c) => ({
      ...c,
      conversion: Number(((c.signups / c.visits) * 100).toFixed(2)),
    }));
    return {
      output: withCard(
        { period, rows },
        {
          kind: "table",
          title: `Channels — ${period}`,
          columns: [
            { key: "channel", label: "Channel", pill: true },
            { key: "visits", label: "Visits", format: "number", align: "right" },
            { key: "signups", label: "Signups", format: "number", align: "right" },
            { key: "conversion", label: "Conversion", format: "percent", align: "right" },
            { key: "cac", label: "CAC", format: "currency", align: "right" },
          ],
          rows,
          sortBy: "conversion",
          sortDir: "desc",
        },
      ),
    };
  },
};

export const compareCompetitors: ToolDefinition = {
  name: "compareCompetitors",
  side: "read",
  description: "Positioning matrix against named competitors. Render as a `comparison` card and highlight the recommendation.",
  inputSchema: {
    type: "object",
    properties: { against: { type: "array", items: { type: "string" } } },
    additionalProperties: false,
  },
  execute() {
    return {
      output: withCard(
        { compared: ["us", "northwind", "acme"] },
        {
          kind: "comparison",
          title: "Positioning",
          options: [
            { id: "us", label: "Us", note: "current", highlight: true },
            { id: "northwind", label: "Northwind", note: "market leader" },
            { id: "acme", label: "Acme", note: "low-cost" },
          ],
          criteria: [
            { label: "Entry price", values: { us: "$29/mo", northwind: "$89/mo", acme: "$9/mo" }, weight: "high" },
            { label: "Self-serve onboarding", values: { us: true, northwind: false, acme: true } },
            { label: "SSO on every plan", values: { us: true, northwind: false, acme: false }, weight: "high", detail: "Northwind gates SSO behind Enterprise" },
            { label: "Published API", values: { us: true, northwind: true, acme: false } },
            { label: "SOC 2", values: { us: false, northwind: true, acme: false }, detail: "Our gap — in progress" },
            { label: "Time to first value", values: { us: "8 min", northwind: "2 days", acme: "12 min" }, weight: "high" },
            { label: "Support SLA", values: { us: "24h", northwind: "4h", acme: null } },
          ],
        },
      ),
    };
  },
};

export const LEGAL_TOOLS = [reviewContract, checkCompliance, findPrecedent];
export const MARKETING_TOOLS = [getFunnel, getCampaign, compareCompetitors];
