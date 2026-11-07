"use client";

// Wiring. This file is the "how do I actually use this framework" answer, and
// it is deliberately short — every subsystem is assembled here in one place.

import {
  BUILTIN_CARDS,
  CardRegistry,
  ContextBuilder,
  ANTHROPIC_OFFICIAL_PROFILE,
  OPENAI_OFFICIAL_PROFILE,
  SkillRegistry,
  ToolRegistry,
  createBuiltinTools,
  createDirectTransportForProfile,
  createKeywordRetriever,
  createLocalFileStore,
  createLocalJobStore,
  createLocalMemoryStore,
  createLocalThreadStore,
  createMemorySource,
  createOpenAICompatibleProfile,
  createOpenAIProvider,
  createProviderFromProfile,
  createProxyTransport,
  createRememberTool,
  createRestThreadStore,
  createRetrievalSource,
  type Provider,
  type ProviderProfile,
  type Transport,
  createDocumentTools,
  createEmailDraftTool,
  createLocalDocumentStore,
} from "@super-solution/super-chat-core";
import { createDemoTransport } from "./demo-transport";
import { DOMAIN_TOOLS } from "./tools";
import { LEGAL_TOOLS, MARKETING_TOOLS } from "./tools-domains";
import { SKILLS } from "./skills";

export type TransportMode = "demo" | "proxy" | "direct";
export type ProviderId = "openai" | "oneapi" | "anthropic";

export const PROVIDER_PROFILES: Record<ProviderId, ProviderProfile> = {
  openai: OPENAI_OFFICIAL_PROFILE,
  oneapi: createOpenAICompatibleProfile({
    id: "oneapi",
    label: "OpenAI-compatible / oneAPI",
    baseUrl: "https://oneapi.example.com/v1",
    capabilities: {
      backgroundJobs: false,
      resumableStreams: false,
      serverSideHistory: false,
      fileUpload: false,
    },
  }),
  anthropic: ANTHROPIC_OFFICIAL_PROFILE,
};

export const cards = new CardRegistry(BUILTIN_CARDS);
export const skills = new SkillRegistry(SKILLS, { maxMatched: 3 });
// Declared before the tool registry singleton below — populate references it.
export const memoryStore = createLocalMemoryStore("superchat:playground:memory");
export const documentStore = createLocalDocumentStore("superchat:playground:documents");

/**
 * Preset assignment. Note that `createAlert` is the only tool in `executor` —
 * a preset toggle in the UI is therefore a real capability boundary, not a
 * cosmetic filter.
 */
export function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  populateToolRegistry(registry);
  return registry;
}

function populateToolRegistry(registry: ToolRegistry): void {

  // Built-ins (visualize, updateCard, loadSkill) are always-available reads.
  registry.registerAll(createBuiltinTools({ cards, skills }), ["observer"]);

  // Memory's write half. `observer`, because remembering a stated preference
  // is a read-tier act — it changes nothing outside the conversation's memory.
  registry.register(createRememberTool(memoryStore), ["observer"]);

  // Documents. Listing and reading are observer acts; creating and editing
  // change something the user keeps, so they sit behind `executor` — and
  // editDocument additionally cannot write without an approved diff, which is a
  // second gate rather than a substitute for the first.
  //
  // Looked up by NAME rather than destructured positionally: the tier a tool
  // gets is a security decision, and binding it to an array index means adding
  // a tool at the front silently hands the wrong one the executor tier.
  const documentTools = new Map(createDocumentTools({ store: documentStore }).map((t) => [t.name, t]));
  const documentTool = (name: string) => {
    const tool = documentTools.get(name);
    if (!tool) throw new Error(`createDocumentTools no longer returns ${name}.`);
    return tool;
  };
  registry.registerAll([documentTool("listDocuments"), documentTool("readDocument")], ["observer"]);
  registry.registerAll(
    [documentTool("createDocument"), documentTool("editDocument"), documentTool("undoDocument")],
    ["executor"],
  );

  // Drafting an email is the `draft` tier by definition: it produces something
  // the user signs and sends. There is no send path here and no credential.
  registry.register(createEmailDraftTool(), ["draft", "executor"]);

  // Domain tools get NO preset: they are private by default and surface only
  // when the skill that documents them matches. A legal question should not put
  // twelve marketing tool schemas in front of the model.
  registry.registerAll(LEGAL_TOOLS);
  registry.registerAll(MARKETING_TOOLS);
  for (const tool of DOMAIN_TOOLS) {
    // `createAlert` acts on the world, so it carries a preset as well. The
    // markets skill names it, but naming only grants relevance — the executor
    // preset still has to be enabled for it to appear.
    if (tool.name === "createAlert") registry.register(tool, ["executor"]);
    else registry.register(tool);
  }
}

/**
 * THE registry — a module singleton, like `cards` and `skills` above. Every
 * panel (and the /run agent) shares this instance, so a tool imported on
 * /tools is callable on /run. A fresh-registry-per-page looks the same in a
 * table and is dead everywhere else.
 */
export const toolRegistry = buildToolRegistry();

const missingCredentialTransport = (): Transport => ({
  kind: "custom",
  credentialSafe: true,
  async fetch() {
    return new Response(JSON.stringify({ error: { message: "Enter an API key before sending a BYOK request." } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  },
});

export function buildTransport(mode: TransportMode, profile: ProviderProfile = PROVIDER_PROFILES.openai, apiKey?: string): Transport {
  // Demo replaces only the network. The adapter, runtime, tools, cards and
  // context builder above it are the real ones. (The demo script speaks the
  // OpenAI Responses shape, so demo mode always pairs with the OpenAI adapter.)
  if (mode === "demo") return createDemoTransport();
  if (mode === "direct") {
    if (!apiKey) return missingCredentialTransport();
    return createDirectTransportForProfile(profile, {
      apiKey,
      // Named to make the trade-off explicit: this ships the key to the client.
      dangerouslyAllowBrowser: true,
    });
  }
  return createProxyTransport({ url: "/api/agent" });
}

export function buildProvider(
  transport: Transport,
  mode: TransportMode = "proxy",
  profile: ProviderProfile = PROVIDER_PROFILES.openai,
): Provider {
  // Demo gets its OWN provider id: providerFile refs are stamped with the id
  // that minted them, so a fake `file_demo_N` attached in demo mode degrades
  // to a readable placeholder when the thread is replayed against real
  // OpenAI, instead of 400ing the thread forever.
  if (mode === "demo") return createOpenAIProvider({ transport, dialect: "responses", id: "demo" });
  return createProviderFromProfile(profile, transport);
}

/**
 * Reference docs for the retrieval demo — the framework's own concepts, which
 * keeps the corpus domain-neutral (retrieval must not smuggle industry
 * vocabulary into every agent built on the kit).
 */
const RETRIEVAL_DOCS = [
  {
    id: "contexts",
    title: "How context assembly works",
    source: "superchat docs",
    text: [
      "Context is derived, never accumulated. Every turn rebuilds the request from named sources under a token budget, and the trace records why each layer was included, truncated or dropped.",
      "Skills are prompt modules matched per message. A matched skill contributes instructions and may unlock the tools it documents — relevance, not authority.",
    ].join("\n\n"),
  },
  {
    id: "presets",
    title: "Presets and tool authority",
    source: "superchat docs",
    text: [
      "Presets are explicit allowlists. A newly registered tool is invisible until someone puts it in one, and deny is applied last so a kill switch cannot be re-granted.",
      "A skill naming a tool grants relevance only; a tool that belongs to a preset still requires that preset to be enabled. This is what stops any skill from handing out the executor tier.",
    ].join("\n\n"),
  },
  {
    id: "cards",
    title: "Cards and visual answers",
    source: "superchat docs",
    text: [
      "Cards are validated visual answers: the model picks a kind, the registry validates the spec, and the renderer registry guarantees every kind that can be emitted has somewhere to render.",
      "Interactive cards suspend the run until the user answers; actionable cards are never collapsed, because a hidden form is an unreachable form.",
    ].join("\n\n"),
  },
];

export function buildContextBuilder(contextWindow = 128_000): ContextBuilder {
  return new ContextBuilder({
    skills,
    contextWindow,
    maxOutputTokens: 4_000,
    keepRecent: 8,
    sources: [
      // Cross-thread memory (read half; the `remember` tool is the write half).
      createMemorySource(memoryStore),
      // Retrieval: lexical reference impl over the docs above — ask about
      // presets or context assembly and watch the layer appear in the trace.
      createRetrievalSource(createKeywordRetriever(RETRIEVAL_DOCS), { limit: 3 }),
    ],
    identity: [
      "You are the superchat demo agent.",
      "Today is 3 August 2026. All market data comes from a synthetic demo feed — say so if the user asks whether it is real.",
    ].join("\n"),
  });
}

export const jobStore = createLocalJobStore("superchat:playground:jobs");
export const fileStore = createLocalFileStore("superchat:playground:files");
export type ThreadBackend = "local" | "server";

const localThreads = createLocalThreadStore("superchat:playground:threads");
const serverThreads = createRestThreadStore({
  url: "/api/threads",
  // Surfacing the failure beats a silently un-saved thread; a real host would
  // report this to its telemetry instead of the console.
  onError: (e, op) => console.warn(`[threads] ${op} failed`, e),
});

/** Same `ThreadStore` interface either way — which is the point of the seam. */
export const threadStores: Record<ThreadBackend, typeof localThreads> = {
  local: localThreads,
  server: serverThreads,
};

/** Default backend; the /run panel can switch at runtime. */
export const threadStore = localThreads;

/**
 * Provider-hosted web search, per vendor. These are the vendors' own tool
 * declarations — no executor, no preset, no registry entry: the provider runs
 * the search inside its own response. Presets gate what OUR executors may do,
 * so a host that wants to gate this gates it here, at configuration time.
 */
export const WEB_SEARCH_TOOLS: Partial<Record<ProviderId, ({ type: string } & Record<string, unknown>)[]>> = {
  openai: [{ type: "web_search_20260209", name: "web_search" }],
  anthropic: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
};

export const MODELS: Record<ProviderId, string[]> = {
  openai: ["gpt-5.2", "gpt-5.2-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"],
  oneapi: ["gpt-4o-mini"],
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
};
