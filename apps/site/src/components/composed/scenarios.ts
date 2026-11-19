// Three requests, three interfaces. Each spec goes through the real createSurface
// tool and its validation. Every figure here is synthetic.

export type Scenario = {
  id: string;
  request: string;
  surfaceId: string;
  reply: string;
  spec: Record<string, unknown>;
};

const select = (id: string, label: string, path: string, options: [string, string][]) => ({
  id,
  component: "Select",
  label,
  value: { $path: path },
  options: options.map(([value, text]) => ({ value, label: text })),
});

const approvedNote = {
  id: "approved",
  component: "Text",
  variant: "caption",
  tone: "positive",
  text: { $template: "Approved under reference {/approval/reference}. Sample only, nothing was sent." },
  visibleWhen: { path: "/approval/approved" },
};

// Why did spend jump

const SPEND_LINES = [
  { vendor: "Northlight Cloud", team: "Platform", month: "Jul", amount: 42800, flagged: false },
  { vendor: "Northlight Cloud", team: "Platform", month: "Aug", amount: 46150, flagged: false },
  { vendor: "Northlight Cloud", team: "Platform", month: "Sep", amount: 61900, flagged: true },
  { vendor: "Fernway Media", team: "Growth", month: "Jul", amount: 28500, flagged: false },
  { vendor: "Fernway Media", team: "Growth", month: "Aug", amount: 33200, flagged: false },
  { vendor: "Fernway Media", team: "Growth", month: "Sep", amount: 51750, flagged: true },
  { vendor: "Alder Studio", team: "Research", month: "Jul", amount: 21000, flagged: false },
  { vendor: "Alder Studio", team: "Research", month: "Aug", amount: 21000, flagged: false },
  { vendor: "Alder Studio", team: "Research", month: "Sep", amount: 34500, flagged: true },
  { vendor: "Relay Desk", team: "Support", month: "Jul", amount: 12300, flagged: false },
  { vendor: "Relay Desk", team: "Support", month: "Aug", amount: 12300, flagged: false },
  { vendor: "Brightmoor", team: "Support", month: "Sep", amount: 16800, flagged: false },
];

const SPEND_WHERE = [
  { field: "team", value: { $path: "/team" }, ignore: "all" },
  { field: "flagged", value: { $path: "/flaggedOnly" }, ignore: false },
];
const spendTotal = { $query: { from: "/lines", where: SPEND_WHERE, aggregate: { op: "sum", field: "amount" } } };

const spend: Scenario = {
  id: "spend",
  request: "Why did September spend jump?",
  surfaceId: "spend-review",
  reply: "Three flagged lines explain the jump. Filter them here, then send the view for approval.",
  spec: {
    surfaceId: "spend-review",
    title: "Q3 spend review",
    data: { team: "all", flaggedOnly: false, lines: SPEND_LINES },
    root: "main",
    components: [
      { id: "main", component: "Stack", gap: "lg", children: ["filters", "totals", "trend", "lines", "actions", "approved"] },
      { id: "filters", component: "Grid", columns: 2, children: ["team", "flaggedOnly"] },
      select("team", "Team", "/team", [["all", "All teams"], ["Platform", "Platform"], ["Growth", "Growth"], ["Research", "Research"], ["Support", "Support"]]),
      { id: "flaggedOnly", component: "Toggle", label: "Flagged lines only", value: { $path: "/flaggedOnly" } },
      { id: "totals", component: "Grid", columns: 3, children: ["total", "count", "average"] },
      { id: "total", component: "Metric", label: "Total", format: "currency", value: spendTotal },
      { id: "count", component: "Metric", label: "Lines", format: "number", value: { $query: { from: "/lines", where: SPEND_WHERE, aggregate: { op: "count" } } } },
      { id: "average", component: "Metric", label: "Average line", format: "currency", value: { $query: { from: "/lines", where: SPEND_WHERE, aggregate: { op: "avg", field: "amount" } } } },
      {
        id: "trend",
        component: "Card",
        kind: "chart",
        spec: {
          title: "Spend by month",
          xType: "category",
          series: [{ name: "Spend", type: "bar", points: { $query: { from: "/lines", where: SPEND_WHERE, groupBy: "month", aggregate: { op: "sum", field: "amount" } } } }],
        },
      },
      {
        id: "lines",
        component: "Card",
        kind: "table",
        spec: {
          title: "Largest lines",
          columns: [
            { key: "vendor", label: "Vendor" },
            { key: "month", label: "Month" },
            { key: "amount", label: "Amount", format: "currency", align: "right" },
          ],
          rows: { $query: { from: "/lines", where: SPEND_WHERE, sortBy: "amount", sortDir: "desc", limit: 4 } },
        },
      },
      { id: "actions", component: "Stack", direction: "horizontal", gap: "sm", wrap: true, children: ["approve"] },
      {
        id: "approve",
        component: "Button",
        label: "Send for approval",
        variant: "primary",
        action: {
          type: "tool",
          tool: "requestApproval",
          args: { title: "Approve this spend review?", scopeLabel: "Team", scope: { $path: "/team" }, amountLabel: "Total in view", amount: spendTotal, format: "currency" },
          resultPath: "/approval",
        },
        disabledWhen: { path: "/approval/approved" },
      },
      approvedNote,
    ],
  },
};

// Which renewals need a decision

const CONTRACTS = [
  { vendor: "Tessera Logs", owner: "Platform", days: 12, seats: 40, annual: 28400 },
  { vendor: "Quillon Labs", owner: "Research", days: 21, seats: 12, annual: 16800 },
  { vendor: "Relay Desk", owner: "Support", days: 34, seats: 65, annual: 46200 },
  { vendor: "Plumb Analytics", owner: "Growth", days: 48, seats: 18, annual: 21600 },
  { vendor: "Harbour Hall", owner: "Growth", days: 66, seats: 8, annual: 9400 },
  { vendor: "Northlight Cloud", owner: "Platform", days: 81, seats: 120, annual: 142000 },
];

const RENEWAL_WHERE = [
  { field: "owner", value: { $path: "/owner" }, ignore: "all" },
  { field: "days", op: "lte", value: { $path: "/within" } },
];
const renewalTotal = { $query: { from: "/contracts", where: RENEWAL_WHERE, aggregate: { op: "sum", field: "annual" } } };

const renewals: Scenario = {
  id: "renewals",
  request: "Which renewals need a decision this quarter?",
  surfaceId: "renewal-desk",
  reply: "Narrow the window to what you can decide today. The approval follows your selection.",
  spec: {
    surfaceId: "renewal-desk",
    title: "Renewals to decide",
    data: { owner: "all", within: 60, contracts: CONTRACTS },
    root: "main",
    components: [
      { id: "main", component: "Stack", gap: "lg", children: ["note", "filters", "totals", "table", "actions", "approved"] },
      { id: "note", component: "Text", variant: "caption", text: "Contracts renew automatically unless someone decides first." },
      { id: "filters", component: "Grid", columns: 2, children: ["owner", "within"] },
      select("owner", "Owner", "/owner", [["all", "All owners"], ["Platform", "Platform"], ["Growth", "Growth"], ["Research", "Research"], ["Support", "Support"]]),
      { id: "within", component: "Slider", label: "Renews within (days)", value: { $path: "/within" }, min: 15, max: 90, step: 15, format: "number" },
      { id: "totals", component: "Grid", columns: 2, children: ["value", "contracts"] },
      { id: "value", component: "Metric", label: "Annual value", format: "currency", value: renewalTotal },
      { id: "contracts", component: "Metric", label: "Contracts", format: "number", value: { $query: { from: "/contracts", where: RENEWAL_WHERE, aggregate: { op: "count" } } } },
      {
        id: "table",
        component: "Card",
        kind: "table",
        spec: {
          columns: [
            { key: "vendor", label: "Vendor" },
            { key: "days", label: "Days left", format: "number", align: "right" },
            { key: "annual", label: "Annual", format: "currency", align: "right" },
          ],
          rows: { $query: { from: "/contracts", where: RENEWAL_WHERE, sortBy: "days", sortDir: "asc" } },
        },
      },
      { id: "actions", component: "Stack", direction: "horizontal", gap: "sm", wrap: true, children: ["approve"] },
      {
        id: "approve",
        component: "Button",
        label: "Approve these renewals",
        variant: "primary",
        action: {
          type: "tool",
          tool: "requestApproval",
          args: { title: "Renew the contracts in view?", scopeLabel: "Owner", scope: { $path: "/owner" }, amountLabel: "Annual value", amount: renewalTotal, format: "currency" },
          resultPath: "/approval",
        },
        disabledWhen: { path: "/approval/approved" },
      },
      approvedNote,
    ],
  },
};

// Which tickets should be escalated

const TICKETS = [
  { id: "SUP-1022", subject: "Billing address won't save", queue: "Billing", hours: 52, breached: true },
  { id: "SUP-1031", subject: "Export stops at 10,000 rows", queue: "Data", hours: 41, breached: true },
  { id: "SUP-1040", subject: "Invite link expired early", queue: "Access", hours: 30, breached: true },
  { id: "SUP-1044", subject: "Invoice shows the wrong tax", queue: "Billing", hours: 19, breached: false },
  { id: "SUP-1047", subject: "SSO loop after password reset", queue: "Access", hours: 14, breached: false },
  { id: "SUP-1052", subject: "Dashboard total differs from export", queue: "Data", hours: 9, breached: false },
  { id: "SUP-1055", subject: "Refund not visible to customer", queue: "Billing", hours: 6, breached: false },
];

const TICKET_WHERE = [
  { field: "queue", value: { $path: "/queue" }, ignore: "all" },
  { field: "breached", value: { $path: "/breachedOnly" }, ignore: false },
];
const ticketCount = { $query: { from: "/tickets", where: TICKET_WHERE, aggregate: { op: "count" } } };

const tickets: Scenario = {
  id: "tickets",
  request: "Which support tickets should we escalate?",
  surfaceId: "ticket-triage",
  reply: "Three tickets are past their target. Pick a queue and I'll wait for your go-ahead.",
  spec: {
    surfaceId: "ticket-triage",
    title: "Ticket triage",
    data: { queue: "all", breachedOnly: true, view: "list", tickets: TICKETS },
    root: "main",
    components: [
      { id: "main", component: "Stack", gap: "lg", children: ["filters", "totals", "views", "actions", "approved"] },
      { id: "filters", component: "Grid", columns: 2, children: ["queue", "breachedOnly"] },
      select("queue", "Queue", "/queue", [["all", "All queues"], ["Billing", "Billing"], ["Data", "Data"], ["Access", "Access"]]),
      { id: "breachedOnly", component: "Toggle", label: "Past target only", value: { $path: "/breachedOnly" } },
      { id: "totals", component: "Grid", columns: 2, children: ["open", "oldest"] },
      { id: "open", component: "Metric", label: "Tickets in view", format: "number", value: ticketCount },
      { id: "oldest", component: "Metric", label: "Oldest (hours)", format: "number", value: { $query: { from: "/tickets", where: TICKET_WHERE, aggregate: { op: "max", field: "hours" } } } },
      {
        id: "views",
        component: "Tabs",
        label: "Ticket views",
        value: { $path: "/view" },
        tabs: [
          { id: "list", label: "Tickets", child: "table" },
          { id: "queues", label: "By queue", child: "byQueue" },
        ],
      },
      {
        id: "table",
        component: "Card",
        kind: "table",
        spec: {
          columns: [
            { key: "id", label: "Ticket" },
            { key: "subject", label: "Subject" },
            { key: "hours", label: "Hours open", format: "number", align: "right" },
          ],
          rows: { $query: { from: "/tickets", where: TICKET_WHERE, sortBy: "hours", sortDir: "desc" } },
        },
      },
      {
        id: "byQueue",
        component: "Card",
        kind: "chart",
        spec: {
          title: "Tickets by queue",
          xType: "category",
          series: [{ name: "Tickets", type: "bar", points: { $query: { from: "/tickets", where: TICKET_WHERE, groupBy: "queue", aggregate: { op: "count" } } } }],
        },
      },
      { id: "actions", component: "Stack", direction: "horizontal", gap: "sm", wrap: true, children: ["approve"] },
      {
        id: "approve",
        component: "Button",
        label: "Escalate to on-call",
        variant: "primary",
        action: {
          type: "tool",
          tool: "requestApproval",
          args: { title: "Escalate these tickets to on-call?", scopeLabel: "Queue", scope: { $path: "/queue" }, amountLabel: "Tickets", amount: ticketCount, format: "number" },
          resultPath: "/approval",
        },
        disabledWhen: { path: "/approval/approved" },
      },
      approvedNote,
    ],
  },
};

export const SCENARIOS: Scenario[] = [spend, renewals, tickets];
