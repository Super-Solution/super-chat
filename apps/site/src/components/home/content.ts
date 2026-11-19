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

export const CREATE_APP = "npx create-super-app@latest my-agent";
export const INSTALL_ALL = "pnpm add @supersolutions/super-chat-core @supersolutions/super-chat-react @supersolutions/super-chat-ui";
