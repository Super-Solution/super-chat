import { describe, expect, it } from "vitest";
import type { Transport, TransportRequest } from "../transport/types.js";
import { McpClient } from "./client.js";
import type { JsonRpcRequest } from "./types.js";

type Scripted = (rpc: JsonRpcRequest, req: TransportRequest) => Response | { result: unknown };

/** A transport that answers JSON-RPC by method, recording every request. */
function mcpTransport(handlers: Record<string, Scripted>, opts: { sessionId?: string } = {}) {
  const sent: { rpc: JsonRpcRequest; req: TransportRequest }[] = [];
  const transport: Transport = {
    kind: "custom",
    credentialSafe: true,
    async fetch(req: TransportRequest): Promise<Response> {
      if (req.method === "DELETE") return new Response(null, { status: 204 });
      const rpc = req.body as JsonRpcRequest;
      sent.push({ rpc, req });
      const handler = handlers[rpc.method];
      if (!handler) return new Response(null, { status: 202 });
      const out = handler(rpc, req);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, result: out.result }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          ...(rpc.method === "initialize" && opts.sessionId ? { "mcp-session-id": opts.sessionId } : {}),
        },
      });
    },
  };
  return { transport, sent };
}

const initHandler: Scripted = () => ({
  result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "test-server", version: "1.0.0" } },
});

describe("McpClient", () => {
  it("performs the initialize handshake and sends the initialized notification", async () => {
    const { transport, sent } = mcpTransport({ initialize: initHandler });
    const client = new McpClient({ transport });

    const { serverInfo, protocolVersion } = await client.connect();
    expect(serverInfo).toEqual({ name: "test-server", version: "1.0.0" });
    expect(protocolVersion).toBe("2025-06-18");

    expect(sent[0]?.rpc).toMatchObject({
      jsonrpc: "2.0",
      method: "initialize",
      params: { protocolVersion: "2025-06-18", clientInfo: { name: "superchat" } },
    });
    expect(sent[1]?.rpc).toMatchObject({ method: "notifications/initialized" });
    expect(sent[1]?.rpc.id).toBeUndefined();

    // Idempotent: a second connect does not re-handshake.
    await client.connect();
    expect(sent.filter((s) => s.rpc.method === "initialize")).toHaveLength(1);
  });

  it("dedupes concurrent connects into a single in-flight initialize", async () => {
    const { transport, sent } = mcpTransport({ initialize: initHandler });
    const client = new McpClient({ transport });

    // Three callers racing before the first handshake resolves must share it,
    // not each fire their own `initialize` round trip.
    const [a, b, c] = await Promise.all([client.connect(), client.connect(), client.connect()]);
    expect(sent.filter((s) => s.rpc.method === "initialize")).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("captures the session id from initialize and echoes it on later requests", async () => {
    const { transport, sent } = mcpTransport(
      { initialize: initHandler, "tools/list": () => ({ result: { tools: [] } }) },
      { sessionId: "sess_42" },
    );
    const client = new McpClient({ transport });
    await client.listTools();

    const listReq = sent.find((s) => s.rpc.method === "tools/list")!;
    expect(listReq.req.headers?.["mcp-session-id"]).toBe("sess_42");
    // The very first request cannot carry a session yet.
    expect(sent[0]?.req.headers?.["mcp-session-id"]).toBeUndefined();
  });

  it("follows tools/list cursor pagination to exhaustion", async () => {
    const pages: Record<string, unknown> = {
      start: { tools: [{ name: "a", inputSchema: { type: "object" } }], nextCursor: "p2" },
      p2: { tools: [{ name: "b", inputSchema: { type: "object" } }] },
    };
    const { transport } = mcpTransport({
      initialize: initHandler,
      "tools/list": (rpc) => ({ result: pages[((rpc.params as { cursor?: string }) ?? {}).cursor ?? "start"] }),
    });
    const client = new McpClient({ transport });
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("parses an SSE-framed response, ignoring notifications and other ids", async () => {
    const { transport } = mcpTransport({
      initialize: initHandler,
      "tools/call": (rpc) => {
        const frames = [
          `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}`,
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: "from sse" }] } })}`,
        ].join("\n\n");
        return new Response(`${frames}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    const client = new McpClient({ transport });
    const result = await client.callTool("x", {});
    expect(result.content).toEqual([{ type: "text", text: "from sse" }]);
  });

  it("returns a JSON-RPC error from tools/call as a failed result, not a throw", async () => {
    const { transport } = mcpTransport({
      initialize: initHandler,
      "tools/call": (rpc) =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32602, message: "Unknown tool: nope" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });
    const client = new McpClient({ transport });
    const result = await client.callTool("nope", {});
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Unknown tool: nope" }]);
  });

  it("answers a mid-call elicitation and then receives the tool result", async () => {
    // tools/call responds with SSE: first an elicitation REQUEST, then — after
    // the client posts its answer — the final tool result.
    let elicitAnswer: unknown;
    const transport: Transport = {
      kind: "custom",
      credentialSafe: true,
      async fetch(req: TransportRequest): Promise<Response> {
        const rpc = req.body as JsonRpcRequest & { result?: unknown };
        if (rpc.method === "initialize") {
          // The client must DECLARE elicitation before a server may ask.
          expect((rpc.params as { capabilities: Record<string, unknown> }).capabilities).toHaveProperty("elicitation");
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { serverInfo: { name: "s" }, protocolVersion: "2025-06-18" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (rpc.method === "tools/call") {
          const frames = [
            `data: ${JSON.stringify({
              jsonrpc: "2.0",
              id: "srv_1",
              method: "elicitation/create",
              params: {
                message: "Which region?",
                requestedSchema: { type: "object", properties: { region: { type: "string" } }, required: ["region"] },
              },
            })}`,
            `data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: "deployed" }] } })}`,
          ].join("\n\n");
          return new Response(`${frames}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        if (rpc.method === undefined && "result" in rpc) {
          elicitAnswer = rpc.result; // the client's answer to srv_1
          return new Response(null, { status: 202 });
        }
        return new Response(null, { status: 202 });
      },
    };

    const client = new McpClient({
      transport,
      onElicit: async (params) => {
        expect(params.message).toBe("Which region?");
        return { action: "accept", content: { region: "eu-west" } };
      },
    });

    const result = await client.callTool("deploy", {});
    expect(result.content).toEqual([{ type: "text", text: "deployed" }]);
    expect(elicitAnswer).toEqual({ action: "accept", content: { region: "eu-west" } });
  });

  it("declines an elicitation when no handler is configured — never hangs", async () => {
    let declined: unknown;
    const transport: Transport = {
      kind: "custom",
      credentialSafe: true,
      async fetch(req: TransportRequest): Promise<Response> {
        const rpc = req.body as JsonRpcRequest & { result?: unknown };
        if (rpc.method === "initialize") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { serverInfo: { name: "s" } } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (rpc.method === "tools/call") {
          const frames = [
            `data: ${JSON.stringify({ jsonrpc: "2.0", id: "srv_1", method: "elicitation/create", params: { message: "?" } })}`,
            `data: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { content: [], isError: true } })}`,
          ].join("\n\n");
          return new Response(`${frames}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        if (rpc.method === undefined && "result" in rpc) declined = rpc.result;
        return new Response(null, { status: 202 });
      },
    };
    const client = new McpClient({ transport });
    await client.callTool("x", {});
    expect(declined).toEqual({ action: "decline" });
  });

  it("propagates the abort signal to the transport", async () => {
    let seenSignal: AbortSignal | undefined;
    const { transport } = mcpTransport({
      initialize: initHandler,
      "tools/call": (_rpc, req) => {
        seenSignal = req.signal;
        return { result: { content: [] } };
      },
    });
    const client = new McpClient({ transport });
    const controller = new AbortController();
    await client.callTool("x", {}, { signal: controller.signal });
    // The client combines the caller's signal with its own default timeout
    // (so a hung server can't block forever), so the transport doesn't see
    // the exact same object — but aborting the caller's signal must still
    // abort the one the transport was given.
    expect(seenSignal).toBeDefined();
    expect(seenSignal?.aborted).toBe(false);
    controller.abort();
    expect(seenSignal?.aborted).toBe(true);
  });
});
