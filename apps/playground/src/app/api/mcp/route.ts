// A mock MCP server, so the /tools panel can demonstrate import against real
// HTTP with no external dependency and no key. It speaks the same slice of the
// protocol McpClient does: initialize, notifications/initialized, tools/list
// (paginated, to exercise the cursor loop), tools/call.
//
// The three tools are deliberately domain-neutral — text stats, slug
// generation, clock — because tool descriptions are model-facing vocabulary,
// and industry nouns here would skew every agent built on the kit.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRpc = { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, unknown> };

const TOOLS = [
  {
    name: "word_count",
    description: "Count the words, characters and sentences in a piece of text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The text to analyze." } },
      required: ["text"],
    },
  },
  {
    name: "slugify",
    description: "Turn a title into a URL-safe slug.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string", description: "The title to convert." } },
      required: ["title"],
    },
  },
  {
    name: "current_time",
    description: "The current date and time, in UTC.",
    inputSchema: { type: "object", properties: {} },
  },
];

/** tools/list is paginated (2 + 1) so the client's cursor loop is exercised for real. */
const PAGE_SIZE = 2;

function callTool(name: string, args: Record<string, unknown>): { content: unknown[]; isError?: boolean } {
  switch (name) {
    case "word_count": {
      const text = String(args["text"] ?? "");
      const stats = {
        words: text.trim() ? text.trim().split(/\s+/).length : 0,
        characters: text.length,
        sentences: (text.match(/[.!?]+(\s|$)/g) ?? []).length,
      };
      return { content: [{ type: "text", text: JSON.stringify(stats) }] };
    }
    case "slugify": {
      const slug = String(args["title"] ?? "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_]+/g, "-");
      return { content: [{ type: "text", text: slug }] };
    }
    case "current_time":
      return { content: [{ type: "text", text: new Date().toISOString() }] };
    default:
      return { content: [{ type: "text", text: `Unknown tool "${name}".` }], isError: true };
  }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

export async function POST(request: Request): Promise<Response> {
  let rpc: JsonRpc;
  try {
    rpc = (await request.json()) as JsonRpc;
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const reply = (result: unknown) => json({ jsonrpc: "2.0", id: rpc.id ?? null, result });

  switch (rpc.method) {
    case "initialize":
      return json(
        {
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          result: {
            protocolVersion: (rpc.params?.["protocolVersion"] as string) ?? "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "playground-utils", version: "1.0.0" },
          },
        },
        { headers: { "content-type": "application/json", "mcp-session-id": `mcp_${Date.now().toString(36)}` } },
      );

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "tools/list": {
      const cursor = Number(rpc.params?.["cursor"] ?? 0);
      const page = TOOLS.slice(cursor, cursor + PAGE_SIZE);
      const next = cursor + PAGE_SIZE < TOOLS.length ? String(cursor + PAGE_SIZE) : undefined;
      return reply({ tools: page, ...(next ? { nextCursor: next } : {}) });
    }

    case "tools/call": {
      const name = String(rpc.params?.["name"] ?? "");
      const args = (rpc.params?.["arguments"] ?? {}) as Record<string, unknown>;
      return reply(callTool(name, args));
    }

    default:
      return json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
  }
}

export async function DELETE(): Promise<Response> {
  return new Response(null, { status: 204 });
}
