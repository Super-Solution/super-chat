"use client";

// The Surface panel's agent. The transport is scripted and everything above it is
// real: the adapter, the run loop, validation, the tools, approvals and metering.
// The figures are synthetic.

import { AgentClient } from "@supersolutions/super-chat-client";
import {
  BUILTIN_CARDS,
  CardRegistry,
  ContextBuilder,
  SkillRegistry,
  SurfaceCatalogue,
  ToolRegistry,
  createLoadSkillTool,
  createLocalThreadStore,
  createOpenAIProvider,
  createSurfaceContextSource,
  createSurfaceSkill,
  createSurfaceTools,
  type MeteringRecord,
  type ToolDefinition,
} from "@supersolutions/super-chat-core";
import { createDemoTransport, type DemoScript } from "./demo-transport";

export const SURFACE_DEMO_THREAD = "surface-demo";
export const SURFACE_ID = "spend";

type Line = { id: string; team: string; category: string; month: string; vendor: string; amount: number; flagged: boolean };

const LINES: Line[] = [
  { id: "L-101", team: "Platform", category: "Infrastructure", month: "Jul", vendor: "Northlight Cloud", amount: 42800, flagged: false },
  { id: "L-102", team: "Platform", category: "Infrastructure", month: "Aug", vendor: "Northlight Cloud", amount: 46150, flagged: false },
  { id: "L-103", team: "Platform", category: "Infrastructure", month: "Sep", vendor: "Northlight Cloud", amount: 61900, flagged: true },
  { id: "L-104", team: "Platform", category: "Software", month: "Jul", vendor: "Tessera Logs", amount: 9400, flagged: false },
  { id: "L-105", team: "Platform", category: "Software", month: "Sep", vendor: "Tessera Logs", amount: 9400, flagged: false },
  { id: "L-106", team: "Growth", category: "Advertising", month: "Jul", vendor: "Fernway Media", amount: 28500, flagged: false },
  { id: "L-107", team: "Growth", category: "Advertising", month: "Aug", vendor: "Fernway Media", amount: 33200, flagged: false },
  { id: "L-108", team: "Growth", category: "Advertising", month: "Sep", vendor: "Fernway Media", amount: 51750, flagged: true },
  { id: "L-109", team: "Growth", category: "Events", month: "Aug", vendor: "Harbour Hall", amount: 18600, flagged: false },
  { id: "L-110", team: "Growth", category: "Software", month: "Sep", vendor: "Plumb Analytics", amount: 7200, flagged: false },
  { id: "L-111", team: "Research", category: "Contractors", month: "Jul", vendor: "Alder Studio", amount: 21000, flagged: false },
  { id: "L-112", team: "Research", category: "Contractors", month: "Aug", vendor: "Alder Studio", amount: 21000, flagged: false },
  { id: "L-113", team: "Research", category: "Contractors", month: "Sep", vendor: "Alder Studio", amount: 34500, flagged: true },
  { id: "L-114", team: "Research", category: "Software", month: "Aug", vendor: "Quillon Labs", amount: 5600, flagged: false },
  { id: "L-115", team: "Support", category: "Software", month: "Jul", vendor: "Relay Desk", amount: 12300, flagged: false },
  { id: "L-116", team: "Support", category: "Software", month: "Aug", vendor: "Relay Desk", amount: 12300, flagged: false },
  { id: "L-117", team: "Support", category: "Contractors", month: "Sep", vendor: "Brightmoor", amount: 16800, flagged: false },
  { id: "L-118", team: "Support", category: "Events", month: "Sep", vendor: "Harbour Hall", amount: 6400, flagged: false },
];

/** The one filter every bound component shares. */
const WHERE = [
  { field: "team", value: { $path: "/team" }, ignore: "all" },
  { field: "amount", op: "gte", value: { $path: "/minAmount" } },
  { field: "flagged", value: { $path: "/flaggedOnly" }, ignore: false },
];
const sumOf = { $query: { from: "/lines", where: WHERE, aggregate: { op: "sum", field: "amount" } } };

const CREATE_SURFACE = {
  surfaceId: SURFACE_ID,
  title: "Q3 spend explorer",
  data: { team: "all", minAmount: 0, flaggedOnly: false, view: "trend", lines: LINES },
  root: "main",
  components: [
    { id: "main", component: "Stack", gap: "lg", children: ["filters", "totals", "views", "actions", "approved"] },
    { id: "filters", component: "Grid", columns: 3, children: ["team", "minAmount", "flaggedOnly"] },
    {
      id: "team",
      component: "Select",
      label: "Team",
      value: { $path: "/team" },
      options: [
        { value: "all", label: "All teams" },
        { value: "Platform", label: "Platform" },
        { value: "Growth", label: "Growth" },
        { value: "Research", label: "Research" },
        { value: "Support", label: "Support" },
      ],
    },
    { id: "minAmount", component: "Slider", label: "Smallest line", value: { $path: "/minAmount" }, min: 0, max: 60000, step: 2500, format: "currency" },
    { id: "flaggedOnly", component: "Toggle", label: "Flagged lines only", value: { $path: "/flaggedOnly" } },
    { id: "totals", component: "Grid", columns: 3, children: ["total", "count", "average"] },
    { id: "total", component: "Metric", label: "Total", format: "currency", value: sumOf },
    { id: "count", component: "Metric", label: "Lines", format: "number", value: { $query: { from: "/lines", where: WHERE, aggregate: { op: "count" } } } },
    { id: "average", component: "Metric", label: "Average line", format: "currency", value: { $query: { from: "/lines", where: WHERE, aggregate: { op: "avg", field: "amount" } } } },
    {
      id: "views",
      component: "Tabs",
      label: "Spend views",
      value: { $path: "/view" },
      tabs: [
        { id: "trend", label: "By month", child: "trend" },
        { id: "lines", label: "Lines", child: "table" },
      ],
    },
    {
      id: "trend",
      component: "Card",
      kind: "chart",
      spec: {
        title: "Spend by month",
        xType: "category",
        series: [{ name: "Spend", type: "bar", points: { $query: { from: "/lines", where: WHERE, groupBy: "month", aggregate: { op: "sum", field: "amount" } } } }],
      },
    },
    {
      id: "table",
      component: "Card",
      kind: "table",
      spec: {
        columns: [
          { key: "vendor", label: "Vendor" },
          { key: "team", label: "Team" },
          { key: "month", label: "Month" },
          { key: "amount", label: "Amount", format: "currency", align: "right" },
        ],
        rows: { $query: { from: "/lines", where: WHERE, sortBy: "amount", sortDir: "desc" } },
      },
    },
    { id: "actions", component: "Stack", direction: "horizontal", gap: "sm", wrap: true, children: ["review", "approve", "reset"] },
    {
      id: "review",
      component: "Button",
      label: "Ask for a review",
      variant: "primary",
      action: { type: "event", name: "review", context: { team: { $path: "/team" }, minAmount: { $path: "/minAmount" }, flaggedOnly: { $path: "/flaggedOnly" }, total: sumOf } },
    },
    {
      id: "approve",
      component: "Button",
      label: "Approve this view",
      action: { type: "tool", tool: "approveSpend", args: { team: { $path: "/team" }, total: sumOf }, resultPath: "/approval" },
      disabledWhen: { path: "/approval/approved" },
    },
    {
      id: "reset",
      component: "Button",
      label: "Reset filters",
      variant: "ghost",
      action: { type: "set", updates: [{ path: "/team", value: "all" }, { path: "/minAmount", value: 0 }, { path: "/flaggedOnly", value: false }] },
    },
    {
      id: "approved",
      component: "Text",
      variant: "caption",
      tone: "positive",
      text: { $template: "Approved under reference {/approval/reference}." },
      visibleWhen: { path: "/approval/approved" },
    },
  ],
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type ReadOutput = { data?: { team?: string; minAmount?: number; flaggedOnly?: boolean; lines?: Line[] } };

function selection(outputs: unknown[]) {
  const data = (outputs[0] as ReadOutput | undefined)?.data ?? {};
  const team = data.team ?? "all";
  const rows = (data.lines ?? []).filter(
    (l) => (team === "all" || l.team === team) && l.amount >= (data.minAmount ?? 0) && (!data.flaggedOnly || l.flagged),
  );
  const largest = [...rows].sort((a, b) => b.amount - a.amount)[0];
  const total = rows.reduce((sum, l) => sum + l.amount, 0);
  return { scope: team === "all" ? "all teams" : team, rows, largest, total };
}

const SCRIPTS: DemoScript[] = [
  {
    match: /sending event "review"/,
    steps: [
      { kind: "tool", name: "readSurface", args: { surfaceId: SURFACE_ID }, lead: "Reading what you have selected." },
      (outputs) => {
        const { scope, rows, largest, total } = selection(outputs);
        const body = largest
          ? `${largest.vendor} is the largest line at ${money(largest.amount)}, ${Math.round((largest.amount / total) * 100)}% of the ${money(total)} in view.`
          : "Nothing matches these filters, so there is nothing to review yet.";
        return {
          kind: "tool",
          name: "updateSurface",
          args: {
            surfaceId: SURFACE_ID,
            operations: [
              { op: "upsertComponents", components: [
                { id: "finding", component: "Card", kind: "callout", spec: { tone: largest?.flagged ? "warning" : "info", title: `Review of ${scope}: ${rows.length} lines`, body } },
                { id: "main", component: "Stack", gap: "lg", children: ["filters", "totals", "finding", "views", "actions", "approved"] },
              ] },
            ],
          },
        };
      },
      (outputs) => {
        const { scope, largest } = selection(outputs);
        return {
          kind: "text",
          text: largest
            ? `I added the finding above the chart. For ${scope}, start with ${largest.vendor}${largest.flagged ? ", which is already flagged" : ""}.`
            : "Those filters leave nothing to review. Widen them and ask again.",
        };
      },
    ],
  },
  {
    match: /breakdown|categor/i,
    steps: [
      {
        kind: "tool",
        name: "updateSurface",
        lead: "Adding that as a third view.",
        args: {
          surfaceId: SURFACE_ID,
          operations: [
            { op: "setData", path: "/view", value: "category" },
            { op: "upsertComponents", components: [
              {
                id: "category",
                component: "Card",
                kind: "chart",
                spec: {
                  title: "Spend by category",
                  xType: "category",
                  series: [{ name: "Spend", type: "bar", points: { $query: { from: "/lines", where: WHERE, groupBy: "category", aggregate: { op: "sum", field: "amount" }, sortBy: "value", sortDir: "desc" } } }],
                },
              },
              {
                id: "views",
                component: "Tabs",
                label: "Spend views",
                value: { $path: "/view" },
                tabs: [
                  { id: "trend", label: "By month", child: "trend" },
                  { id: "category", label: "By category", child: "category" },
                  { id: "lines", label: "Lines", child: "table" },
                ],
              },
            ] },
          ],
        },
      },
      { kind: "text", text: "The new tab follows the same filters as everything else on the surface." },
    ],
  },
  {
    match: /spend|explorer|budget|expense|build/i,
    steps: [
      { kind: "tool", name: "describeSurfaceComponents", args: { components: ["Select", "Slider", "Metric", "Tabs", "Card:chart"] }, lead: "You will want to slice this yourself, so I am building a working view instead of a report." },
      { kind: "tool", name: "createSurface", args: CREATE_SURFACE },
      { kind: "text", text: "The filters, totals, chart and table share one data model, so they stay in step without coming back to me. Press **Ask for a review** when you have narrowed it down." },
    ],
  },
];

const FALLBACK: DemoScript["steps"] = [
  { kind: "text", text: "This panel is scripted. Ask me to build a spend explorer, then ask for a category breakdown." },
];

/** A consequential tool, so the panel shows a button going through the normal approval. */
const approveSpend: ToolDefinition = {
  name: "approveSpend",
  side: "confirm",
  description: "Record approval of the spend currently in view.",
  inputSchema: {
    type: "object",
    required: ["team", "total"],
    properties: { team: { type: "string" }, total: { type: "number" } },
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const { team, total } = input as { team: string; total: number };
    const answer = (await ctx.requestCard?.({
      kind: "confirm",
      title: "Approve this spend?",
      description: "Demo only. Nothing leaves this page.",
      summary: [
        { label: "Scope", value: team === "all" ? "All teams" : team },
        { label: "Total", value: money(total) },
      ],
      confirmLabel: "Approve",
    })) as { cancelled?: boolean } | undefined;
    if (!answer || answer.cancelled) return { output: { approved: false, reason: "The user declined." }, failure: "denied" as const };
    return { output: { approved: true, reference: `APR-${Math.round(total).toString(36).toUpperCase()}` } };
  },
};

export type SurfaceDemoStats = { modelCalls: number; meteredActions: number };

export type SurfaceDemo = {
  client: AgentClient;
  catalogue: SurfaceCatalogue;
  cards: CardRegistry;
  stats: () => SurfaceDemoStats;
  subscribe: (listener: () => void) => () => void;
};

export function createSurfaceDemo(): SurfaceDemo {
  let snapshot: SurfaceDemoStats = { modelCalls: 0, meteredActions: 0 };
  const listeners = new Set<() => void>();
  const bump = (patch: Partial<SurfaceDemoStats>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  const cards = new CardRegistry(BUILTIN_CARDS);
  const catalogue = new SurfaceCatalogue({ cards });
  const skills = new SkillRegistry([createSurfaceSkill(catalogue)]);
  const tools = new ToolRegistry();
  tools.registerAll([...createSurfaceTools({ catalogue }), createLoadSkillTool(skills), approveSpend], ["surface-demo"]);

  const transport = createDemoTransport({
    latencyMs: 260,
    argPaceMs: 5,
    scripts: SCRIPTS,
    fallback: FALLBACK,
    onModelCall: () => bump({ modelCalls: snapshot.modelCalls + 1 }),
  });

  const client = new AgentClient({
    provider: createOpenAIProvider({ transport, dialect: "responses", id: "demo" }),
    model: "scripted-demo",
    contextBuilder: new ContextBuilder({
      identity: "You build working interfaces for the person you are helping. All figures in this panel are synthetic.",
      skills,
      sources: [createSurfaceContextSource()],
      contextWindow: 64_000,
    }),
    tools,
    toolResolution: { presets: ["surface-demo"] },
    mode: "stream",
    maxSteps: 6,
    threadId: SURFACE_DEMO_THREAD,
    threadStore: createLocalThreadStore("superchat:playground:surfaces"),
    cards,
    surfaceCatalogue: catalogue,
    meter: {
      record(record: MeteringRecord) {
        if (record.metadata?.["trigger"] === "surface-action") bump({ meteredActions: snapshot.meteredActions + 1 });
      },
    },
  });

  return {
    client,
    catalogue,
    cards,
    stats: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
