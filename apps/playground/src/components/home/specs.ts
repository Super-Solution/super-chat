// Card specs for the homepage. Synthetic data, kept short so a card reads
// at a glance inside a wall tile; the full samples live in card-samples.ts.

import type { CardSpec } from "@zzyzxlabs/super-chat-core";

const weeks = Array.from({ length: 13 }, (_, i) => `W${i + 1}`);
const signups = [150, 158, 162, 174, 170, 188, 196, 204, 212, 220, 230, 238, 246];
const activations = [132, 136, 140, 142, 146, 148, 150, 148, 144, 140, 136, 134, 130];

export const SIGNUP_STATS: CardSpec = {
  kind: "stats",
  title: "Signup funnel · last 30 days",
  items: [
    { label: "Visitors", value: 48_210, format: "number", delta: 8.2, deltaFormat: "percent" },
    { label: "Signups", value: 3_904, format: "number", delta: 3.1, deltaFormat: "percent" },
    { label: "Activated", value: 1_288, format: "number", delta: -4.6, deltaFormat: "percent" },
    { label: "Paid", value: 402, format: "number", delta: 1.9, deltaFormat: "percent" },
  ],
};

export const SIGNUP_CHART: CardSpec = {
  kind: "chart",
  title: "Signups vs activations",
  xType: "category",
  series: [
    { name: "Signups", type: "line", points: weeks.map((w, i) => [w, signups[i]!]) },
    { name: "Activations", type: "line", points: weeks.map((w, i) => [w, activations[i]!]) },
  ],
};

export const SIGNUP_FUNNEL: CardSpec = {
  kind: "funnel",
  title: "Where people drop",
  format: "number",
  stages: [
    { label: "Visited", value: 48_210 },
    { label: "Signed up", value: 3_904 },
    { label: "Activated", value: 1_288, note: "biggest drop" },
    { label: "Paid", value: 402 },
  ],
};

export const BUDGET_GAUGE: CardSpec = {
  kind: "gauge",
  title: "Budget used",
  value: 72,
  min: 0,
  max: 100,
  format: "number",
  label: "% of the $60,000 budget",
  bands: [
    { from: 0, to: 70, label: "On track", tone: "positive" },
    { from: 70, to: 85, label: "Watch", tone: "warning" },
    { from: 85, to: 100, label: "Over", tone: "negative" },
  ],
};

export const VENDOR_ROWS = [
  { vendor: "Halcyon", region: "EU", cost: 48_200 },
  { vendor: "Brightline", region: "EU", cost: 52_900 },
  { vendor: "Tessellate", region: "US + EU", cost: 39_800 },
  { vendor: "Quarry and Vale", region: "EU", cost: 61_500 },
  { vendor: "Lumen Works", region: "US", cost: 33_100 },
  { vendor: "Ostrander", region: "EU", cost: 45_750 },
  { vendor: "Pinecrest", region: "UK", cost: 57_300 },
  { vendor: "Meridian Nine", region: "US + EU", cost: 29_900 },
];

export function vendorTable(rows: number): CardSpec {
  return {
    kind: "table",
    title: "Vendor shortlist",
    columns: [
      { key: "vendor", label: "Vendor" },
      { key: "region", label: "Data region" },
      { key: "cost", label: "Annual cost", format: "currency", align: "right" },
    ],
    rows: VENDOR_ROWS.slice(0, rows),
  };
}

export const CONTRACT_KV: CardSpec = {
  kind: "keyvalue",
  title: "Contract summary",
  items: [
    { label: "Term", value: "36 months" },
    { label: "Liability cap", value: "12 months of fees" },
    { label: "Notice", value: "90 days" },
  ],
};

export const PURCHASE_CONFIRM: CardSpec = {
  kind: "confirm",
  title: "Send the purchase request?",
  summary: [
    { label: "Vendor", value: "Halcyon" },
    { label: "Amount", value: "$48,200 / year", mono: true },
  ],
  confirmLabel: "Send request",
};

export const PLAN_CHOICE: CardSpec = {
  kind: "choice",
  title: "Which plan should I price?",
  options: [
    { id: "team", label: "Team", description: "25 seats" },
    { id: "business", label: "Business", description: "100 seats" },
    { id: "enterprise", label: "Enterprise", description: "Custom" },
  ],
};

export const REQUEST_FORM: CardSpec = {
  kind: "form",
  title: "Details for the request",
  fields: [
    { name: "costCentre", label: "Cost centre", type: "text", value: "OPS-214" },
    { name: "neededBy", label: "Needed by", type: "text", placeholder: "YYYY-MM-DD" },
  ],
  submitLabel: "Submit",
};

export const RENEWAL_TIMELINE: CardSpec = {
  kind: "timeline",
  title: "Renewal",
  events: [
    { at: "2026-11-01", label: "Notice window opens" },
    { at: "2027-01-30", label: "Last day to give notice", tone: "warning" },
    { at: "2027-04-30", label: "Auto-renews for 36 months" },
  ],
};

export const LIABILITY_CITATIONS: CardSpec = {
  kind: "citations",
  title: "Sources",
  items: [
    { title: "Unfair Contract Terms Act 1977", locator: "s.2(1)" },
    { title: "Vertex MSA", locator: "cl. 7.2" },
    { title: "Playbook: caps and carve-outs" },
  ],
};

export const LIABILITY_CALLOUT: CardSpec = {
  kind: "callout",
  tone: "warning",
  title: "You can’t exclude liability entirely.",
  body: "Some heads of loss can only be capped, not removed.",
};

export const RESEARCH_PROGRESS: CardSpec = {
  kind: "progress",
  title: "Vendor review",
  steps: [
    { label: "Gather the quotes", status: "done" },
    { label: "Compare SSO and data terms", status: "active" },
    { label: "Draft the recommendation", status: "pending" },
  ],
};

export const CAP_DIFF: CardSpec = {
  kind: "diff",
  title: "Clause 7.2",
  before: "Liability is capped at fees paid.",
  after: "Liability is capped at fees paid in the twelve months before the claim.",
};
