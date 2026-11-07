import type { Transport, TransportRequest } from "@super-solution/super-chat-core";

type JsonRpc = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Record<string, unknown> };

const TOOLS = [
  { name: "word_count", description: "Count words, characters and sentences in text.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "slugify", description: "Turn a title into a URL-safe slug.", inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  { name: "current_time", description: "Return the current UTC time.", inputSchema: { type: "object", properties: {} } },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function callTool(name: string, args: Record<string, unknown>) {
  if (name === "word_count") {
    const text = String(args.text ?? "");
    return { content: [{ type: "text", text: JSON.stringify({ words: text.trim() ? text.trim().split(/\s+/).length : 0, characters: text.length }) }] };
  }
  if (name === "slugify") {
    const slug = String(args.title ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");
    return { content: [{ type: "text", text: slug }] };
  }
  if (name === "current_time") return { content: [{ type: "text", text: new Date().toISOString() }] };
  return { content: [{ type: "text", text: `Unknown tool \"${name}\".` }], isError: true };
}

/** A Streamable-HTTP-shaped MCP server implemented entirely in the browser. */
export function createDemoMcpTransport(): Transport {
  return {
    kind: "custom",
    credentialSafe: true,
    async fetch(request: TransportRequest): Promise<Response> {
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      const rpc = (request.body ?? {}) as JsonRpc;
      const reply = (result: unknown) => json({ jsonrpc: "2.0", id: rpc.id ?? null, result });

      switch (rpc.method) {
        case "initialize":
          return json({ jsonrpc: "2.0", id: rpc.id ?? null, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "playground-utils", version: "1.0.0" } } });
        case "notifications/initialized":
          return new Response(null, { status: 202 });
        case "tools/list": {
          const cursor = Number(rpc.params?.cursor ?? 0);
          const page = TOOLS.slice(cursor, cursor + 2);
          const nextCursor = cursor + 2 < TOOLS.length ? String(cursor + 2) : undefined;
          return reply({ tools: page, ...(nextCursor ? { nextCursor } : {}) });
        }
        case "tools/call":
          return reply(callTool(String(rpc.params?.name ?? ""), (rpc.params?.arguments ?? {}) as Record<string, unknown>));
        default:
          return json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32601, message: "Method not found" } }, 400);
      }
    },
  };
}
