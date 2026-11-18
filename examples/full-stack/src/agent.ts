import { AgentClient } from "@supersolutions/super-chat-client";
import { BUILTIN_CARDS, CardRegistry, ContextBuilder, ToolRegistry, createBuiltinTools } from "@supersolutions/super-chat-core";
import { installChatPlugin } from "@supersolutions/super-chat-plugin";
import { createSuperRouterGateway, createSuperRouterProvider } from "@supersolutions/super-chat-router";
import { createChartChatPlugin } from "@supersolutions/super-chart-chat-plugin";
import { createEditorChatPlugin } from "@supersolutions/super-editor-chat-plugin";

export type Preset = "observer" | "draft" | "executor";

// 1. Plugins bring cards and tools. Authority decides which presets offer each tool.
export const plugins = [createChartChatPlugin(), createEditorChatPlugin()];
const cards = new CardRegistry(BUILTIN_CARDS);
const tools = new ToolRegistry();
export const installReports = plugins.map((plugin) => installChatPlugin(cards, plugin, { tools }));
tools.registerAll(createBuiltinTools({ cards }), ["observer", "draft", "executor"]);

// 2. Super Router serves the model. The browser talks to this app's server, which holds the key.
const gateway = createSuperRouterGateway({ baseUrl: "/api/router", apiKey: "held-by-the-server" });
const provider = createSuperRouterProvider({ gateway, customerId: "customer_demo", defaultMaxOutputTokens: 4096 });

// 3. The agent.
export const createClient = (preset: Preset) =>
  new AgentClient({
    provider,
    model: "reference-agent",
    contextBuilder: new ContextBuilder({ contextWindow: 128_000, maxOutputTokens: 4096, identity: "You are the reference agent." }),
    tools,
    toolResolution: { presets: [preset] },
    maxSteps: 10,
  });
