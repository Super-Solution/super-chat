// A minimal MCP client — Streamable HTTP only, deliberately.
//
// This is a FRONTEND framework: the MCP servers it can reach are remote HTTP
// ones. stdio transport means spawning a process, which a browser cannot do —
// hosts that want stdio servers put them behind an HTTP gateway.
//
// The client rides the same `Transport` seam the LLM adapters use, and for the
// same reason: credentials. An MCP server whose token must stay server-side is
// one more entry in `createProxyHandler`'s provider map ({ baseUrl: the MCP
// server, apiKey: its token, allowPaths: ["POST /mcp"] }) and this client runs
// over the same proxy transport, no new machinery. For unauthenticated or
// local servers, `createHttpTransport` below talks straight HTTP.

import { AgentError } from "../errors.js";
import { errorFromResponse } from "../transport/retry.js";
import { parseSSEJson } from "../transport/sse.js";
import type { Transport, TransportRequest } from "../transport/types.js";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCallResult,
  McpElicitHandler,
  McpElicitRequest,
  McpServerInfo,
  McpTool,
} from "./types.js";

export type McpClientConfig = {
  transport: Transport;
  /** Routing id in the proxy's provider map. Default "mcp". */
  provider?: string;
  /** Server-relative path of the MCP endpoint. Default "/". */
  path?: string;
  protocolVersion?: string;
  clientInfo?: { name: string; version: string };
  /**
   * Answer `elicitation/create` — the server asking the USER for structured
   * input mid-call. Without a handler, elicitations are declined (never hung).
   * `importMcpTools` bridges this onto the interactive-card suspension, so an
   * eliciting server gets the same form-card UX as a local `confirm` tool.
   */
  onElicit?: McpElicitHandler;
  /**
   * Budget for `initialize` and `tools/list`, in ms. Default 30 000. A hung server must not block
   * forever, and these calls are quick on any healthy one.
   */
  timeoutMs?: number;
  /**
   * Budget for one `tools/call`, in ms. Default 120 000. A tool may legitimately run for longer
   * than a listing, so it gets its own, larger, bound (the run-level `toolTimeoutMs` still applies
   * on top). Time spent waiting for the USER to answer an elicitation is not counted against it.
   */
  callTimeoutMs?: number;
};

const DEFAULT_PROTOCOL = "2025-06-18";

/** Bounds every request when the caller supplies no signal of its own — a hung MCP server must not block forever. */
const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

/**
 * A deadline that can be paused. The whole of one JSON-RPC call is bounded, response stream included,
 * but a person typing into an elicitation form is not the server being slow: the clock stops while
 * we wait on them and resumes with what was left.
 */
class Deadline {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private left: number;
  private startedAt = 0;

  constructor(
    ms: number,
    private readonly describe: string,
  ) {
    this.left = ms;
    this.resume();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  pause(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.left = Math.max(0, this.left - (Date.now() - this.startedAt));
  }

  resume(): void {
    if (this.timer !== undefined || this.controller.signal.aborted) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.controller.abort(new AgentError("timeout", `MCP ${this.describe} timed out.`));
    }, this.left);
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Combine signals so any one of them can abort the request. Prefers the
 * platform `AbortSignal.any` where available; falls back to a manual
 * listener-based combine for runtimes that lack it.
 */
function combineSignals(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const present = signals.filter((s): s is AbortSignal => s != null);
  if (present.length === 0) return new AbortController().signal; // never aborts
  if (present.length === 1) return present[0]!;
  if (typeof AbortSignal.any === "function") return AbortSignal.any(present);

  const controller = new AbortController();
  for (const s of present) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/** Thrown for protocol-level JSON-RPC errors (unknown method, bad params). */
export class McpRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpRpcError";
    this.code = code;
    this.data = data;
  }
}

/** More pages than any real server has; past this, pagination is treated as a loop. */
const MAX_TOOL_PAGES = 1000;

export class McpClient {
  private readonly transport: Transport;
  private readonly provider: string;
  private readonly path: string;
  private readonly protocolVersion: string;
  private readonly clientInfo: { name: string; version: string };
  private readonly onElicit: McpElicitHandler | undefined;
  private readonly timeoutMs: number;
  private readonly callTimeoutMs: number;
  private rpcId = 0;
  private sessionId: string | undefined;
  private handshake: { serverInfo: McpServerInfo; protocolVersion: string } | undefined;
  /** The in-flight `connect()` call, if any — concurrent callers await this instead of starting their own `initialize` round trip. */
  private connecting: Promise<{ serverInfo: McpServerInfo; protocolVersion: string }> | undefined;

  constructor(config: McpClientConfig) {
    this.transport = config.transport;
    this.provider = config.provider ?? "mcp";
    this.path = config.path ?? "/";
    this.protocolVersion = config.protocolVersion ?? DEFAULT_PROTOCOL;
    this.clientInfo = config.clientInfo ?? { name: "superchat", version: "0.1.0" };
    this.onElicit = config.onElicit;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.callTimeoutMs = config.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  }

  /**
   * Idempotent: a second call returns the cached handshake. Concurrent calls
   * while the first is still in flight share that same call rather than each
   * firing their own `initialize` round trip.
   */
  async connect(): Promise<{ serverInfo: McpServerInfo; protocolVersion: string }> {
    if (this.handshake) return this.handshake;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<{ serverInfo: McpServerInfo; protocolVersion: string }> {
    const result = (await this.rpc("initialize", {
      protocolVersion: this.protocolVersion,
      // Declaring elicitation is what permits the server to ask; without a
      // handler we keep the capability undeclared and decline defensively.
      capabilities: this.onElicit ? { elicitation: {} } : {},
      clientInfo: this.clientInfo,
    })) as { protocolVersion?: string; serverInfo?: McpServerInfo };

    // Fire the initialized notification; a server may 202 it with no body.
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });

    this.handshake = {
      serverInfo: result.serverInfo ?? { name: "unknown" },
      protocolVersion: result.protocolVersion ?? this.protocolVersion,
    };
    return this.handshake;
  }

  /** All tools, following `nextCursor` pagination to exhaustion. */
  async listTools(opts: { signal?: AbortSignal } = {}): Promise<McpTool[]> {
    await this.ensureConnected();
    const tools: McpTool[] = [];
    // A server that keeps handing back the same cursor (or never stops paginating) would otherwise
    // loop here for ever, growing `tools` without bound.
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = (await this.rpc("tools/list", cursor ? { cursor } : {}, opts)) as {
        tools?: McpTool[];
        nextCursor?: string;
      };
      if (Array.isArray(page.tools)) tools.push(...page.tools);
      cursor = typeof page.nextCursor === "string" && page.nextCursor !== "" ? page.nextCursor : undefined;
      if (cursor !== undefined) {
        if (seen.has(cursor) || seen.size >= MAX_TOOL_PAGES) {
          throw new McpRpcError(-32603, "tools/list pagination does not terminate (repeated cursor or too many pages)");
        }
        seen.add(cursor);
      }
    } while (cursor);
    return tools;
  }

  /**
   * Call a tool. A JSON-RPC error comes back as a failed `McpCallResult`
   * rather than a throw — tool errors are for the model to read, and an
   * exception here would abort the whole agent turn instead of one step.
   */
  async callTool(
    name: string,
    args: unknown,
    opts: { signal?: AbortSignal; onElicit?: McpElicitHandler } = {},
  ): Promise<McpCallResult> {
    await this.ensureConnected();
    try {
      const result = (await this.rpc("tools/call", { name, arguments: args ?? {} }, opts)) as McpCallResult;
      return { ...result, content: result.content ?? [] };
    } catch (e) {
      if (e instanceof McpRpcError) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
      throw e;
    }
  }

  /** Best-effort session teardown; servers may not support DELETE. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.transport.fetch(this.request("DELETE"));
    } catch {
      // The session expires server-side regardless.
    }
    this.sessionId = undefined;
    this.handshake = undefined;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.handshake) await this.connect();
  }

  private request(method: TransportRequest["method"], body?: unknown): TransportRequest {
    return {
      provider: this.provider,
      path: this.path,
      method,
      ...(body !== undefined ? { body } : {}),
      headers: {
        // Streamable HTTP: a POST response may be JSON or an SSE stream.
        accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
    };
  }

  private async post(body: JsonRpcRequest, signal?: AbortSignal, bounded = true): Promise<Response> {
    // Every call gets bounded, even when the caller supplies its own signal — a
    // caller's signal is typically for run-level cancellation, not a guarantee the
    // server will ever respond. `rpc()` brings its own (pausable) deadline.
    const combined = combineSignals([signal, bounded ? AbortSignal.timeout(this.timeoutMs) : undefined]);
    const res = await this.transport.fetch({ ...this.request("POST", body), signal: combined });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (!res.ok) throw await errorFromResponse(res, this.provider);
    return res;
  }

  private async rpc(
    method: string,
    params: unknown,
    opts: { signal?: AbortSignal; onElicit?: McpElicitHandler } = {},
  ): Promise<unknown> {
    this.rpcId += 1;
    const id = this.rpcId;
    const deadline = new Deadline(method === "tools/call" ? this.callTimeoutMs : this.timeoutMs, `"${method}"`);
    try {
      return await this.exchange(id, method, params, opts, deadline);
    } finally {
      deadline.dispose();
    }
  }

  private async exchange(
    id: number,
    method: string,
    params: unknown,
    opts: { signal?: AbortSignal; onElicit?: McpElicitHandler },
    deadline: Deadline,
  ): Promise<unknown> {
    const signal = combineSignals([opts.signal, deadline.signal]);
    const res = await this.post({ jsonrpc: "2.0", id, method, params }, signal, false);

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      if (!res.body) throw new AgentError("network", "MCP response had no body to stream.", { provider: this.provider });
      // The stream carries our response, server notifications, AND possibly
      // server-initiated REQUESTS (elicitation). Answer those inline — the
      // final tool result cannot arrive until the elicitation is settled, so
      // awaiting here is the correct ordering, not a stall.
      for await (const frame of parseSSEJson<JsonRpcResponse & JsonRpcRequest>(res.body)) {
        const msg = frame.data;
        if (!msg) continue;
        if (typeof msg.method === "string" && msg.id != null) {
          deadline.pause(); // waiting on the user is not the server being slow
          try {
            await this.answerServerRequest(msg as JsonRpcRequest & { id: number | string }, opts.onElicit, signal);
          } finally {
            deadline.resume();
          }
          continue;
        }
        if (msg.id === id) return this.settle(msg as JsonRpcResponse);
      }
      throw new AgentError("network", `MCP stream ended without a response to "${method}".`, { provider: this.provider });
    }

    return this.settle((await res.json()) as JsonRpcResponse);
  }

  /** Answer a server-initiated request (elicitation); unknown methods get a JSON-RPC error. */
  private async answerServerRequest(
    request: JsonRpcRequest & { id: number | string },
    override: McpElicitHandler | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    if (request.method === "elicitation/create") {
      const handler = override ?? this.onElicit;
      let result: unknown;
      try {
        result = handler ? await handler((request.params ?? { message: "" }) as McpElicitRequest) : { action: "decline" };
      } catch {
        result = { action: "cancel" }; // the user's card was dismissed / the run aborted
      }
      await this.post({ jsonrpc: "2.0", id: request.id, result } as unknown as JsonRpcRequest, signal).catch(() => {});
      return;
    }
    await this.post(
      {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not supported: ${request.method}` },
      } as unknown as JsonRpcRequest,
      signal,
    ).catch(() => {});
  }

  private settle(response: JsonRpcResponse): unknown {
    if (response.error) throw new McpRpcError(response.error.code, response.error.message, response.error.data);
    return response.result;
  }
}

/**
 * Credential-free direct HTTP transport for MCP servers that need no key (a
 * local dev server, the playground's mock route). Anything with a token that
 * must stay secret belongs behind `createProxyHandler` instead.
 */
export function createHttpTransport(opts: {
  baseUrl: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Transport {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

  return {
    kind: "custom",
    credentialSafe: !isBrowser || !opts.headers,
    async fetch(req: TransportRequest): Promise<Response> {
      // `baseUrl` may be relative ("/api/mcp") in a browser host.
      const full = `${opts.baseUrl.replace(/\/$/, "")}${req.path === "/" ? "" : req.path}` || opts.baseUrl;
      const url = new URL(full, isBrowser ? window.location.origin : undefined);
      for (const [k, v] of Object.entries(req.query ?? {})) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
      return doFetch(url.toString(), {
        method: req.method,
        headers: {
          ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
          ...opts.headers,
          ...req.headers,
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: req.signal,
      });
    },
  };
}
