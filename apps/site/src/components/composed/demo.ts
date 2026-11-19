"use client";

// The public demo's agent. The transport is scripted; the adapter, run loop, surface
// validation, tool executor and approval above it are the real ones.

import { AgentClient } from "@supersolutions/super-chat-client";
import {
  BUILTIN_CARDS,
  CardRegistry,
  ContextBuilder,
  SkillRegistry,
  SurfaceCatalogue,
  ToolRegistry,
  createLoadSkillTool,
  createOpenAIProvider,
  createSurfaceContextSource,
  createSurfaceSkill,
  createSurfaceTools,
  type ToolDefinition,
} from "@supersolutions/super-chat-core";
import { createDemoTransport, type DemoScript } from "@/agent/demo-transport";
import { SCENARIOS } from "./scenarios";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SCRIPTS: DemoScript[] = SCENARIOS.map((scenario) => ({
  match: new RegExp(escapeRegExp(scenario.request)),
  steps: [
    { kind: "tool", name: "createSurface", args: scenario.spec },
    { kind: "text", text: scenario.reply },
  ],
}));

const FALLBACK: DemoScript["steps"] = [
  { kind: "text", text: "This preview answers the sample requests shown here. Pick one and I will build its interface." },
];

const formatAmount = (amount: number, format: string) =>
  format === "currency" ? `$${Math.round(amount).toLocaleString("en-US")}` : Math.round(amount).toLocaleString("en-US");

const scopeName = (scope: string) => (scope === "all" ? "All" : scope);

/** Consequential, so the run stops here until the person answers. */
const requestApproval: ToolDefinition = {
  name: "requestApproval",
  side: "confirm",
  confirmation: "tool",
  description: "Ask the person to approve the selection currently in view.",
  inputSchema: {
    type: "object",
    required: ["title", "scopeLabel", "scope", "amountLabel", "amount", "format"],
    properties: {
      title: { type: "string" },
      scopeLabel: { type: "string" },
      scope: { type: "string" },
      amountLabel: { type: "string" },
      amount: { type: "number" },
      format: { type: "string" },
    },
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const { title, scopeLabel, scope, amountLabel, amount, format } = input as Record<string, string> & { amount: number };
    const answer = (await ctx.requestCard?.({
      kind: "confirm",
      title,
      description: "Sample data. Nothing leaves this page.",
      summary: [
        { label: scopeLabel, value: scopeName(scope) },
        { label: amountLabel, value: formatAmount(amount, format), mono: true },
      ],
      confirmLabel: "Approve",
      cancelLabel: "Not yet",
    })) as { cancelled?: boolean } | undefined;
    if (!answer || answer.cancelled) return { output: { approved: false, reason: "The person declined." }, failure: "denied" as const };
    return { output: { approved: true, reference: `APR-${Math.round(amount).toString(36).toUpperCase()}` } };
  },
};

export type ComposedDemo = {
  client: AgentClient;
  catalogue: SurfaceCatalogue;
  cards: CardRegistry;
  modelCalls: () => number;
  subscribe: (listener: () => void) => () => void;
};

export function createComposedDemo(): ComposedDemo {
  const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let calls = 0;
  const listeners = new Set<() => void>();

  const cards = new CardRegistry(BUILTIN_CARDS);
  const catalogue = new SurfaceCatalogue({ cards });
  const skills = new SkillRegistry([createSurfaceSkill(catalogue)]);
  const tools = new ToolRegistry();
  tools.registerAll([...createSurfaceTools({ catalogue }), createLoadSkillTool(skills), requestApproval], ["composed-demo"]);

  const transport = createDemoTransport({
    latencyMs: instant ? 0 : 320,
    argPaceMs: instant ? 0 : 10,
    scripts: SCRIPTS,
    fallback: FALLBACK,
    onModelCall: () => {
      calls += 1;
      listeners.forEach((listener) => listener());
    },
  });

  const client = new AgentClient({
    provider: createOpenAIProvider({ transport, dialect: "responses", id: "demo" }),
    model: "scripted-demo",
    contextBuilder: new ContextBuilder({
      identity: "You build working interfaces for the person you are helping. All figures here are synthetic.",
      skills,
      sources: [createSurfaceContextSource()],
      contextWindow: 64_000,
    }),
    tools,
    toolResolution: { presets: ["composed-demo"] },
    mode: "stream",
    maxSteps: 4,
    cards,
    surfaceCatalogue: catalogue,
  });

  return {
    client,
    catalogue,
    cards,
    modelCalls: () => calls,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
