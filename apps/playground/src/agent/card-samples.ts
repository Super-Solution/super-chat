// One sample per card kind, drawn from deliberately different fields.
//
// The mix is the message: if every example were financial, a developer skimming
// the catalogue would conclude the kit is for finance. `comparison` shows a
// vendor decision, `checklist` a compliance review, `citations` legal authority,
// `funnel` a hiring pipeline, `tree` a document outline.

import type { CardSpec } from "@super-solution/super-chat-core";

const day = 86_400_000;
const now = Date.UTC(2026, 7, 3);

const trend = Array.from({ length: 24 }, (_, i) => [now - (23 - i) * day, 100 + Math.sin(i / 3) * 12 + i * 1.4] as [number, number]);

export const CARD_SAMPLES: Record<string, CardSpec> = {
  table: {
    kind: "table",
    title: "Open support tickets",
    columns: [
      { key: "id", label: "Ticket", pill: true },
      { key: "subject", label: "Subject" },
      { key: "priority", label: "Priority" },
      { key: "age", label: "Age", format: "duration", align: "right" },
    ],
    rows: [
      { id: "SUP-1041", subject: "Login loop on SSO", priority: "High", age: 190_000 },
      { id: "SUP-1038", subject: "Export missing columns", priority: "Normal", age: 5_400_000 },
      { id: "SUP-1022", subject: "Billing address won't save", priority: "Low", age: 86_400_000 },
    ],
    sortBy: "age",
    sortDir: "desc",
  },

  stats: {
    kind: "stats",
    title: "This quarter",
    items: [
      { label: "Active users", value: 18_420, format: "number", delta: 6.4, deltaFormat: "percent" },
      { label: "Churn", value: 2.1, format: "percent", delta: -0.4, deltaFormat: "percent" },
      { label: "NPS", value: 46, format: "number", hint: "n=1,204" },
      { label: "Median resolution", value: 7_800_000, format: "duration" },
    ],
  },

  comparison: {
    kind: "comparison",
    title: "Vendor shortlist",
    options: [
      { id: "a", label: "Northwind", note: "incumbent" },
      { id: "b", label: "Vertex", note: "recommended", highlight: true },
      { id: "c", label: "Basis", note: "low cost" },
    ],
    criteria: [
      { label: "Annual cost", values: { a: "$84k", b: "$61k", c: "$28k" }, weight: "high" },
      { label: "SSO included", values: { a: false, b: true, c: false }, weight: "high" },
      { label: "Data residency (EU)", values: { a: true, b: true, c: false }, detail: "Required by the DPA" },
      { label: "Migration effort", values: { a: "none", b: "3 weeks", c: "6 weeks" } },
      { label: "Support SLA", values: { a: "4h", b: "8h", c: null } },
      { label: "Exit clause", values: { a: false, b: true, c: true } },
    ],
  },

  keyvalue: {
    kind: "keyvalue",
    title: "Master services agreement",
    items: [
      { label: "Counterparty", value: "Vertex Systems Ltd" },
      { label: "Effective", value: now - 40 * day, format: "datetime" },
      { label: "Initial term", value: "24 months" },
      { label: "Liability cap", value: "12 months' fees", tone: "positive" },
      { label: "Governing law", value: "England & Wales" },
      { label: "Reference", value: "MSA-2026-0417", mono: true },
    ],
  },

  tree: {
    kind: "tree",
    title: "Agreement structure",
    nodes: [
      {
        label: "1. Definitions",
        children: [{ label: "1.1 Interpretation" }, { label: "1.2 Defined terms", detail: "41 terms" }],
      },
      {
        label: "8. Liability",
        tone: "warning",
        detail: "flagged in review",
        children: [
          { label: "8.1 Mutual cap", tone: "positive" },
          { label: "8.2 Supplier carve-outs", tone: "negative", detail: "unlimited exposure" },
          { label: "8.3 Consequential loss" },
        ],
      },
      { label: "11. Data protection", children: [{ label: "11.4 Breach notification", tone: "warning", detail: "no fixed window" }] },
    ],
  },

  chart: {
    kind: "chart",
    title: "Weekly signups by channel",
    variant: "series",
    xType: "time",
    yLabel: "signups",
    series: [
      { name: "Organic", type: "line", points: trend },
      { name: "Paid", type: "line", points: trend.map(([t, v]) => [t, v * 0.62 + 6] as [number, number]) },
      { name: "Referral", type: "area", points: trend.map(([t, v]) => [t, v * 0.28] as [number, number]) },
    ],
    annotations: [{ type: "hline", value: 100, label: "target", tone: "info" }],
  },

  funnel: {
    kind: "funnel",
    title: "Hiring pipeline — Q3",
    format: "number",
    stages: [
      { label: "Applications", value: 1_840 },
      { label: "Screened", value: 412, note: "CV review" },
      { label: "Phone screen", value: 168 },
      { label: "On-site", value: 54 },
      { label: "Offer", value: 12 },
      { label: "Accepted", value: 9 },
    ],
  },

  gauge: {
    kind: "gauge",
    title: "Contract risk",
    value: 62,
    min: 0,
    max: 100,
    label: "Negotiate before signing",
    bands: [
      { from: 0, to: 30, label: "Acceptable", tone: "positive" },
      { from: 30, to: 60, label: "Negotiate", tone: "warning" },
      { from: 60, to: 100, label: "Do not sign", tone: "negative" },
    ],
  },

  timeline: {
    kind: "timeline",
    title: "Incident 2026-0731",
    events: [
      { at: now - 3 * day, label: "Elevated error rate detected", tone: "warning" },
      { at: now - 3 * day + 900_000, label: "Paged on-call", detail: "ack in 4m" },
      { at: now - 3 * day + 3_600_000, label: "Root cause identified", detail: "connection pool exhaustion" },
      { at: now - 3 * day + 5_400_000, label: "Mitigated", tone: "positive" },
      { at: now - 2 * day, label: "Post-mortem published", tone: "info" },
    ],
  },

  progress: {
    kind: "progress",
    title: "Market entry research",
    steps: [
      { label: "Size the addressable market", status: "done", detail: "3 sources reconciled" },
      { label: "Map the regulatory surface", status: "done" },
      { label: "Interview 5 prospective buyers", status: "active", detail: "2 of 5 complete" },
      { label: "Draft the go/no-go memo", status: "pending" },
    ],
  },

  checklist: {
    kind: "checklist",
    title: "GDPR readiness",
    items: [
      { label: "Lawful basis documented for each purpose", status: "done", group: "Governance" },
      { label: "Records of processing maintained (Art. 30)", status: "done", group: "Governance" },
      { label: "DPA signed with every sub-processor", status: "blocked", detail: "Two missing.", group: "Vendors" },
      { label: "Transfer mechanism for non-EEA processing", status: "blocked", detail: "Outdated SCC set.", group: "Vendors" },
      { label: "Breach notification within 72 hours", status: "todo", detail: "Process exists, not written down.", group: "Operations" },
      { label: "DSAR workflow with a 30-day clock", status: "done", group: "Operations" },
      { label: "DPIA for high-risk processing", status: "na", detail: "None in scope.", group: "Operations" },
    ],
  },

  markdown: {
    kind: "markdown",
    title: "Recommendation",
    body: "## Summary\n\nMove to **Vertex**. The migration costs three weeks, and it closes the two gaps that matter: SSO on every seat and an exit clause.\n\n- Annual saving: `$23k`\n- Residual risk: no SOC 2 until Q1\n- Decision needed by the 14th",
  },

  document: {
    kind: "document",
    docId: "doc_vendor_review",
    title: "Vendor review",
    revision: 3,
    markdown: [
      "# Vendor review",
      "",
      "Two shortlisted suppliers, scored against the criteria agreed in March.",
      "",
      "## Findings",
      "",
      "The **cheaper** option fails the SSO requirement outright. Closing that gap",
      "later costs more than the difference in list price, so it is not a saving.",
      "",
      "- Coverage: 18 of 22 requirements met",
      "- Blocking gap: no SSO on non-admin seats",
      "- Exit clause: 90 days, uncapped",
      "",
      "## Recommendation",
      "",
      "Proceed with the second supplier and hold 10% of year one against the",
      "outstanding audit.",
      "",
      "```",
      "renewal_date = 2027-03-01",
      "notice_period = 90d",
      "```",
    ].join("\n"),
  },

  editreview: {
    kind: "editreview",
    docId: "doc_vendor_review",
    title: "Vendor review",
    revision: 3,
    summary: "Name the supplier, and soften the recommendation to match the audit caveat.",
    hunks: [
      {
        index: 0,
        block: 3,
        removed: ["The **cheaper** option fails the SSO requirement outright."],
        added: ["Supplier A fails the SSO requirement outright."],
      },
      {
        index: 1,
        block: 7,
        removed: ["Proceed with the second supplier and hold 10% of year one against the", "outstanding audit."],
        added: [
          "Proceed with Supplier B, subject to the audit closing, and hold 10% of",
          "year one against it.",
        ],
      },
    ],
  },

  email: {
    kind: "email",
    to: ["counsel@example.com"],
    cc: ["procurement@example.com"],
    subject: "Vendor review — redline for your read",
    body: [
      "Hi,",
      "",
      "Attached is the vendor review with the SSO gap called out and the",
      "recommendation caveated on the audit. Two things worth your eye:",
      "",
      "1. The exit clause is 90 days, uncapped.",
      "2. We are holding 10% of year one.",
      "",
      "Thanks",
    ].join("\n"),
  },

  callout: {
    kind: "callout",
    tone: "warning",
    title: "Not legal advice",
    body: "This review flags commercial risk in the drafting. It is not legal advice and does not replace review by a qualified lawyer in the governing jurisdiction.",
  },

  citations: {
    kind: "citations",
    title: "Authority relied on",
    items: [
      {
        title: "Photo Production Ltd v Securicor Transport Ltd",
        source: "House of Lords",
        date: "1980",
        locator: "[1980] AC 827",
        snippet: "A clearly worded exclusion clause may exclude liability even for a fundamental breach, where that is the parties' true bargain.",
        relevance: "high",
      },
      {
        title: "Unfair Contract Terms Act 1977",
        source: "UK statute",
        date: "1977",
        locator: "s.3(2)(a)",
        snippet: "Against a party dealing on the other's written standard terms, an exclusion is effective only so far as it satisfies the requirement of reasonableness.",
        relevance: "high",
      },
      {
        title: "Regulation (EU) 2016/679",
        source: "EU regulation",
        date: "2016",
        locator: "Art. 33(1)",
        snippet: "The controller shall notify the supervisory authority without undue delay and, where feasible, not later than 72 hours after having become aware of it.",
        relevance: "medium",
      },
    ],
  },

  code: {
    kind: "code",
    title: "Usage",
    language: "ts",
    filename: "agent.ts",
    code: `const provider = createOpenAIProvider({\n  transport: createProxyTransport({ url: "/api/agent" }),\n  dialect: "responses",\n});\n\nfor await (const event of runAgent(messages, config)) {\n  render(event);\n}`,
  },

  diff: {
    kind: "diff",
    title: "Clause 8.2 — proposed redline",
    before:
      "The Supplier's liability under this Agreement shall be unlimited\nin respect of any breach of its obligations.",
    after:
      "The Supplier's liability under this Agreement shall not exceed\nthe total fees paid in the twelve (12) months preceding the claim,\nsave in respect of death, personal injury or fraud.",
  },

  media: {
    kind: "media",
    title: "Creative variants",
    layout: "grid",
    items: [
      {
        url: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#3a6df0"/><text x="160" y="98" font-family="sans-serif" font-size="20" fill="white" text-anchor="middle">Variant A</text></svg>'),
        caption: "Variant A — 2.4% CTR",
      },
      {
        url: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#17864b"/><text x="160" y="98" font-family="sans-serif" font-size="20" fill="white" text-anchor="middle">Variant B</text></svg>'),
        caption: "Variant B — 3.9% CTR",
      },
    ],
  },

  choice: {
    kind: "choice",
    title: "Which policy did you mean?",
    prompt: "Three documents match “retention”.",
    options: [
      { id: "a", label: "Data Retention Policy", description: "v4 · approved Mar 2026", meta: [{ label: "Pages", value: 11 }] },
      { id: "b", label: "Employee Retention Plan", description: "HR · draft", meta: [{ label: "Pages", value: 6 }] },
      { id: "c", label: "Records Retention Schedule", description: "Superseded", disabled: true, disabledReason: "Replaced by v4" },
    ],
  },

  form: {
    kind: "form",
    title: "Draft the notice",
    description: "Values are validated before the letter is generated.",
    fields: [
      { name: "counterparty", label: "Counterparty", type: "text", required: true, value: "Vertex Systems Ltd" },
      { name: "days", label: "Notice period", type: "number", min: 0, max: 180, step: 1, value: 60, suffix: "days" },
      { name: "reason", label: "Ground", type: "select", options: [{ value: "convenience", label: "Convenience" }, { value: "cause", label: "Material breach" }], value: "convenience" },
      { name: "cc", label: "Copy legal", type: "boolean", value: true },
      { name: "notes", label: "Notes", type: "textarea", placeholder: "Optional" },
    ],
    submitLabel: "Generate notice",
  },

  confirm: {
    kind: "confirm",
    title: "Send the termination notice",
    description: "This dispatches the letter to the counterparty's notice address on record.",
    summary: [
      { label: "Recipient", value: "Vertex Systems Ltd" },
      { label: "Effective", value: "60 days from today" },
      { label: "Ground", value: "Convenience", tone: "neutral" },
      { label: "Reference", value: "MSA-2026-0417", mono: true },
    ],
    confirmLabel: "Send notice",
    danger: true,
  },
};
