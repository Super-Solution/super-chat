import { describe, expect, it, vi } from "vitest";
import { createProxyHandler, pathMatches } from "./server.js";
import { createProxyTransport } from "./proxy.js";

const envelope = (over: Record<string, unknown> = {}) =>
  new Request("http://app.local/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "openai", path: "/responses", method: "POST", body: {}, ...over }),
  });

const okUpstream = () => vi.fn(async () => new Response(JSON.stringify({ id: "resp_1" }), { status: 200 }));

describe("pathMatches", () => {
  it("anchors both ends so a prefix cannot sneak through", () => {
    expect(pathMatches("/responses", "/responses")).toBe(true);
    // Without anchoring, "/responses" would match "/responses-admin".
    expect(pathMatches("/responses", "/responses-admin")).toBe(false);
    expect(pathMatches("/responses", "/v1/responses")).toBe(false);
  });

  it("matches one segment with * and the rest with **", () => {
    expect(pathMatches("/responses/*", "/responses/resp_1")).toBe(true);
    expect(pathMatches("/responses/*", "/responses/resp_1/cancel")).toBe(false);
    expect(pathMatches("/responses/*/cancel", "/responses/resp_1/cancel")).toBe(true);
    expect(pathMatches("/files/**", "/files/a/b/c")).toBe(true);
  });
});

describe("createProxyHandler", () => {
  const config = (fetchImpl: typeof fetch) => ({
    providers: {
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", allowPaths: ["/responses", "/responses/*", "/responses/*/cancel"] },
    },
    fetchImpl,
  });

  it("forwards an allowed path with the key attached", async () => {
    const upstream = okUpstream();
    const res = await createProxyHandler(config(upstream as never))(envelope());

    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer sk-test");
  });

  it("refuses a path the operator never allowlisted", async () => {
    // Without this, the route is an open relay for the operator's API key.
    const upstream = okUpstream();
    const res = await createProxyHandler(config(upstream as never))(envelope({ path: "/fine_tuning/jobs" }));

    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a traversal that would escape the allowlist", async () => {
    const upstream = okUpstream();
    const res = await createProxyHandler(config(upstream as never))(envelope({ path: "/responses/../fine_tuning/jobs" }));

    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied Authorization header", async () => {
    // The client must never be able to substitute its own credential.
    const upstream = okUpstream();
    const req = new Request("http://app.local/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-attacker" },
      body: JSON.stringify({ provider: "openai", path: "/responses", method: "POST", body: {} }),
    });
    await createProxyHandler(config(upstream as never))(req);

    const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer sk-test");
  });

  it("rejects an unknown provider", async () => {
    const res = await createProxyHandler(config(okUpstream() as never))(envelope({ provider: "anthropic" }));
    expect(res.status).toBe(404);
  });

  it("runs the host authorize hook before forwarding", async () => {
    const upstream = okUpstream();
    const res = await createProxyHandler({ ...config(upstream as never), authorize: () => false })(envelope());

    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("appends query params for job polling", async () => {
    const upstream = okUpstream();
    await createProxyHandler(config(upstream as never))(
      envelope({ path: "/responses/resp_1", method: "GET", query: { stream: true, starting_after: 12 } }),
    );

    const [url] = upstream.mock.calls[0] as unknown as [string];
    expect(url).toContain("/responses/resp_1?");
    expect(url).toContain("starting_after=12");
  });

  it("scopes an allowlist entry to its method prefix", async () => {
    // "POST /files" is an upload; a bare "/files" would also open GET /files,
    // which lists every file on the account.
    const upstream = okUpstream();
    const cfg = {
      providers: { openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", allowPaths: ["POST /files"] } },
      fetchImpl: upstream as never,
    };
    const post = await createProxyHandler(cfg)(envelope({ path: "/files" }));
    expect(post.status).toBe(200);
    const get = await createProxyHandler(cfg)(envelope({ path: "/files", method: "GET" }));
    expect(get.status).toBe(403);
  });

  it("matches any method for an entry without a prefix", async () => {
    const upstream = okUpstream();
    const res = await createProxyHandler(config(upstream as never))(envelope({ path: "/responses/resp_1", method: "GET" }));
    expect(res.status).toBe(200);
  });

  it("forwards sanitized envelope headers and passes mcp-session-id back", async () => {
    const upstream = vi.fn(
      async () => new Response("{}", { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sess_9" } }),
    );
    const res = await createProxyHandler(config(upstream as never))(
      envelope({
        headers: {
          "Mcp-Session-Id": "sess_9",
          "OpenAI-Beta": "assistants=v2",
          // None of these may reach upstream — the credential is the operator's.
          authorization: "Bearer sk-attacker",
          cookie: "session=stolen",
          host: "evil.example",
        },
      }),
    );

    const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["mcp-session-id"]).toBe("sess_9");
    expect(headers["openai-beta"]).toBe("assistants=v2");
    expect(headers["authorization"]).toBe("Bearer sk-test");
    expect(headers["cookie"]).toBeUndefined();
    expect(headers["host"]).toBeUndefined();
    // …and the session id assigned upstream is visible to the client.
    expect(res.headers.get("mcp-session-id")).toBe("sess_9");
  });

  it("omits the authorization header entirely for a keyless provider", async () => {
    // An MCP server with no bearer auth must not receive "Bearer ".
    const upstream = okUpstream();
    await createProxyHandler({
      providers: { mcp: { baseUrl: "http://mcp.local", apiKey: "", allowPaths: ["POST /"] } },
      fetchImpl: upstream as never,
    })(envelope({ provider: "mcp", path: "/" }));

    const [, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["authorization"]).toBeUndefined();
  });

  it("attaches a server-held session as a named cookie", async () => {
    // Not every upstream takes a bearer token. An internal service that only
    // knows session cookies is reachable the same way, with the session held
    // server-side like any other credential.
    const upstream = okUpstream();
    await createProxyHandler({
      providers: {
        intranet: {
          baseUrl: "https://intranet.example",
          apiKey: "server-session",
          authStyle: "cookie",
          cookieName: "session",
          allowPaths: ["GET /api/records/*/document"],
        },
      },
      fetchImpl: upstream as never,
    })(envelope({ provider: "intranet", path: "/api/records/rec-1/document", method: "GET" }));

    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://intranet.example/api/records/rec-1/document");
    expect((init.headers as Record<string, string>).cookie).toBe("session=server-session");
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("round-trips a request built by ProxyTransport", async () => {
    // The two halves must agree on the envelope shape; this is the contract test.
    const upstream = okUpstream();
    const handler = createProxyHandler(config(upstream as never));
    const transport = createProxyTransport({
      url: "http://app.local/api/agent",
      fetchImpl: ((input: RequestInfo, init?: RequestInit) => handler(new Request(input as string, init))) as typeof fetch,
    });

    const res = await transport.fetch({ provider: "openai", path: "/responses/resp_9/cancel", method: "POST", body: { a: 1 } });
    expect(res.status).toBe(200);
    const [url] = upstream.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.openai.com/v1/responses/resp_9/cancel");
  });
});
