import type { CardSpec } from "@supersolutions/super-chat-core";

export type Scene = {
  question: string;
  working: string;
  kind: string;
  ask: CardSpec;
  yes: string;
  no: string;
};

// All figures on the homepage are sample data. The footer says so.
export const SCENES: Scene[] = [
  {
    question: "Which vendor should we choose?",
    working: "Comparing three quotes",
    kind: "comparison",
    ask: {
      kind: "confirm",
      title: "Send the Vertex approval to Finance?",
      summary: [
        { label: "Vendor", value: "Vertex" },
        { label: "Annual cost", value: "$61k", mono: true },
      ],
      confirmLabel: "Send request",
      cancelLabel: "Not yet",
    },
    yes: "Sent to Finance.",
    no: "Kept as a draft. Nothing was sent.",
  },
  {
    question: "Where are candidates dropping out?",
    working: "Reading the hiring pipeline",
    kind: "funnel",
    ask: {
      kind: "confirm",
      title: "Book a review of the on-site stage?",
      summary: [
        { label: "Phone screens", value: "168", mono: true },
        { label: "On-site interviews", value: "54", mono: true },
      ],
      confirmLabel: "Book review",
      cancelLabel: "Not yet",
    },
    yes: "Review booked.",
    no: "Nothing was booked.",
  },
  {
    question: "Which support tickets are aging?",
    working: "Checking open tickets",
    kind: "table",
    ask: {
      kind: "confirm",
      title: "Escalate the oldest ticket?",
      summary: [
        { label: "Ticket", value: "SUP-1022", mono: true },
        { label: "Subject", value: "Billing address won't save" },
      ],
      confirmLabel: "Escalate",
      cancelLabel: "Not yet",
    },
    yes: "Escalated to on-call.",
    no: "The ticket stays in the queue.",
  },
];

export const OUTCOMES = [
  {
    id: "valid",
    label: "Valid spec",
    spec: {
      kind: "stats",
      title: "Vendor quotes",
      items: [
        { label: "Lowest annual cost", value: 28000, format: "currency" },
        { label: "Quotes compared", value: 3, format: "number" },
      ],
    } as CardSpec,
    expired: false,
    result: "The spec passes validation, then your renderer draws it.",
  },
  {
    id: "unknown",
    label: "Unknown kind",
    spec: { kind: "sankey", nodes: [] } as unknown as CardSpec,
    expired: false,
    result: "A kind with no renderer shows a labelled fallback, so an answer never disappears.",
  },
  {
    id: "expired",
    label: "Trimmed history",
    spec: { kind: "table" } as CardSpec,
    expired: true,
    result: "A card trimmed from saved history says so instead of rendering an empty shell.",
  },
];

export const ASKS = [
  { id: "choice", label: "Choice", text: "Pick one option from a short list." },
  { id: "form", label: "Form", text: "Fill in several values at once." },
  { id: "confirm", label: "Approval", text: "Approve an action before the agent takes it." },
  { id: "editreview", label: "Redline", text: "Accept or reject proposed document edits." },
];

export const PROXY_CODE = `import { createProxyHandler } from "@supersolutions/super-chat-server";

export const POST = createProxyHandler({
  providers: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: () => process.env.OPENAI_API_KEY!,
      allowPaths: ["/responses", "/chat/completions"],
    },
  },
  authorize: (req) => checkSession(req),
});`;

export const TOKEN_BUDGET = 4000;
export const TRACE = [
  { id: "system:identity", status: "Included", tokens: 180, color: "var(--trace-1)" },
  { id: "skill:contracts", status: "Included", tokens: 214, color: "var(--trace-2)" },
  { id: "memory:preferences", status: "Included", tokens: 96, color: "var(--trace-3)" },
  { id: "retrieval:msa-7.2", status: "Trimmed to fit", tokens: 1120, color: "var(--trace-4)" },
  { id: "history:recent", status: "Included", tokens: 1640, color: "var(--trace-5)" },
];

export const PACKAGES = [
  { name: "super-chat-core", description: "The provider-neutral engine. It runs without React." },
  { name: "super-chat-client", description: "Threads and run control for any front end." },
  { name: "super-chat-server", description: "The proxy route that keeps your keys on your server." },
  { name: "super-chat-react", description: "Hooks, thread state and card actions." },
  { name: "super-chat-ui", description: "Card renderers, chat parts and the context inspector." },
];

export const INSTALL_UI = "pnpm add @supersolutions/super-chat-ui";
export const INSTALL_ALL = "pnpm add @supersolutions/super-chat-core @supersolutions/super-chat-react @supersolutions/super-chat-ui";
