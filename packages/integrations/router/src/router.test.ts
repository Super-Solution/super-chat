import { describe, expect, it } from "vitest";
import { AgentError, type Message, type NormalizedRequest, type StreamEvent } from "@supersolutions/super-chat-core";
import { GatewayError, type InferenceGateway, type InferenceRequest, type StreamEvent as RouterEvent } from "@supersolutions/super-protocol";
import { createSuperRouterGateway, createSuperRouterProvider } from "./index.js";

const user = (text: string): Message => ({ id: "m", role: "user", parts: [{ type: "text", text }] });
const req = (over: Partial<NormalizedRequest> = {}): NormalizedRequest => ({ model: "support-chat", messages: [user("hi")], ...over });

function sse(frames: [string, object][]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const [event, data] of frames) c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("createSuperRouterGateway", () => {
  it("posts the invocation with auth and an idempotency key, and returns the result", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const gateway = createSuperRouterGateway({
      baseUrl: "https://router.example.com/",
      apiKey: "sr_key",
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return Response.json({ id: "r1", execution_status: "succeeded", billing_status: "settled", output: { role: "assistant", content: "Hello" }, usage: { status: "confirmed" } });
      }) as typeof fetch,
    });
    const result = await gateway.infer({ service: "s", customer_id: "c", messages: [{ role: "user", content: "hi" }], max_output_tokens: 64 }, "key-1");
    expect(result.output?.content).toBe("Hello");
    const { url, init } = seen[0]!;
    expect(url).toBe("https://router.example.com/v1/inferences");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sr_key");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(init.body as string)).toEqual({ service: "s", customer_id: "c", input: { messages: [{ role: "user", content: "hi" }] }, limits: { max_output_tokens: 64 }, stream: false });
  });

  it("follows a 303 replay to the stored request", async () => {
    const calls: string[] = [];
    const gateway = createSuperRouterGateway({
      baseUrl: "https://r.test",
      apiKey: "k",
      fetch: (async (url: string) => {
        calls.push(url);
        if (url.endsWith("/v1/inferences")) return new Response(null, { status: 303, headers: { Location: "/v1/requests/req_9" } });
        return Response.json({ id: "req_9", execution_status: "succeeded", billing_status: "settled", output: { role: "assistant", content: "stored" }, usage: { status: "confirmed" } });
      }) as typeof fetch,
    });
    expect((await gateway.infer({ service: "s", customer_id: "c", messages: [] }, "k")).output?.content).toBe("stored");
    expect(calls[1]).toBe("https://r.test/v1/requests/req_9");
  });

  it("streams events, and reports a replayed key as a replay event", async () => {
    const ok = createSuperRouterGateway({
      baseUrl: "https://r.test",
      apiKey: "k",
      fetch: (async () => sse([["output.delta", { request_id: "r", sequence: 1, text: "Hi" }], ["request.completed", { request_id: "r", sequence: 2, execution_status: "succeeded", billing_status: "settled" }]])) as typeof fetch,
    });
    const types: string[] = [];
    for await (const e of ok.stream({ service: "s", customer_id: "c", messages: [] }, "k")) types.push(e.type);
    expect(types).toEqual(["output.delta", "request.completed"]);

    const replay = createSuperRouterGateway({ baseUrl: "https://r.test", apiKey: "k", fetch: (async () => new Response(null, { status: 303, headers: { Location: "/v1/requests/req_1" } })) as typeof fetch });
    const out: RouterEvent[] = [];
    for await (const e of replay.stream({ service: "s", customer_id: "c", messages: [] }, "k")) out.push(e);
    expect(out).toEqual([{ type: "request.replayed", request_id: "req_1", sequence: 0 }]);
  });

  it("turns error bodies and network failures into GatewayError", async () => {
    const denied = createSuperRouterGateway({ baseUrl: "https://r.test", apiKey: "k", fetch: (async () => Response.json({ error: { code: "insufficient_funds", request_id: "rq" } }, { status: 402 })) as typeof fetch });
    await expect(denied.infer({ service: "s", customer_id: "c", messages: [] }, "k")).rejects.toMatchObject({ code: "insufficient_funds", status: 402, requestId: "rq" });
    const down = createSuperRouterGateway({ baseUrl: "https://r.test", apiKey: "k", fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    await expect(down.infer({ service: "s", customer_id: "c", messages: [] }, "k")).rejects.toMatchObject({ code: "network_error" });
  });
});

const fakeGateway = (events: RouterEvent[], captured: InferenceRequest[] = []): InferenceGateway => ({
  async infer(request) {
    captured.push(request);
    return { id: "r", execution_status: "succeeded", billing_status: "settled", output: { role: "assistant", content: "Hello" }, usage: { status: "confirmed", meters: { input: 10, cached: 4, cache_write: 0, output: 5 } } };
  },
  async *stream(request) {
    captured.push(request);
    yield* events;
  },
});

describe("createSuperRouterProvider", () => {
  it("generates text, maps usage, and uses the model as the service id", async () => {
    const captured: InferenceRequest[] = [];
    const provider = createSuperRouterProvider({ gateway: fakeGateway([], captured), customerId: "cust" });
    const result = await provider.generate(req({ system: "Be brief.", maxOutputTokens: 99999 }));
    expect(result.parts).toEqual([{ type: "text", text: "Hello" }]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ inputTokens: 14, outputTokens: 5, totalTokens: 19, cachedInputTokens: 4 });
    expect(captured[0]).toMatchObject({ service: "support-chat", customer_id: "cust", max_output_tokens: 8192, messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] });
  });

  it("warns about dropped non-text parts and ignored tools", async () => {
    const provider = createSuperRouterProvider({ gateway: fakeGateway([]), customerId: "c" });
    const withImage: Message = { id: "m", role: "user", parts: [{ type: "text", text: "look" }, { type: "image", source: { kind: "url", url: "https://x/y.png" } }] };
    const result = await provider.generate(req({ messages: [withImage], tools: [{ name: "t", description: "d", parameters: {} }] }));
    expect(result.warnings).toHaveLength(2);
  });

  it("refuses a request with no text to send", async () => {
    const provider = createSuperRouterProvider({ gateway: fakeGateway([]), customerId: "c" });
    await expect(provider.generate(req({ messages: [] }))).rejects.toMatchObject({ kind: "invalid-request" });
  });

  it("streams normalized events", async () => {
    const events: RouterEvent[] = [
      { type: "request.started", request_id: "r", sequence: 1, service_version: 1 },
      { type: "output.delta", request_id: "r", sequence: 2, text: "Hel" },
      { type: "output.delta", request_id: "r", sequence: 3, text: "lo" },
      { type: "request.completed", request_id: "r", sequence: 4, execution_status: "succeeded", billing_status: "settled" },
    ];
    const provider = createSuperRouterProvider({ gateway: fakeGateway(events), customerId: "c" });
    const out: StreamEvent[] = [];
    for await (const e of provider.stream(req())) out.push(e);
    expect(out.map((e) => e.type)).toEqual(["start", "text-delta", "text-delta", "finish"]);
    expect(out.at(-1)).toMatchObject({ type: "finish", finishReason: "stop" });
  });

  it("refuses to pass a stored request without output off as an answer", async () => {
    const gateway: InferenceGateway = { infer: async () => ({ id: "r0", execution_status: "succeeded", billing_status: "settled", usage: { status: "confirmed" } }), stream: async function* () {} };
    await expect(createSuperRouterProvider({ gateway, customerId: "c" }).generate(req())).rejects.toMatchObject({ kind: "invalid-request" });
  });

  it("maps a failed request to an error finish and gateway errors to AgentError kinds", async () => {
    const failed: RouterEvent[] = [{ type: "request.failed", request_id: "r", sequence: 1, execution_status: "failed", error: { code: "upstream_failed" } }];
    const out: StreamEvent[] = [];
    for await (const e of createSuperRouterProvider({ gateway: fakeGateway(failed), customerId: "c" }).stream(req())) out.push(e);
    // A failure reaches the run as an error carrying the router's code and request id, not as a bare finish.
    expect(out.at(-1)).toMatchObject({ type: "error", error: { message: "upstream_failed (request r)" } });
    expect(out.some((e) => e.type === "finish")).toBe(false);

    const make = (status: number, code = "x"): InferenceGateway => ({ infer: async () => { throw new GatewayError(code, status); }, stream: async function* () { throw new GatewayError(code, status); } });
    const kind = async (status: number) => createSuperRouterProvider({ gateway: make(status), customerId: "c" }).generate(req()).catch((e: AgentError) => e.kind);
    expect(await kind(401)).toBe("auth");
    expect(await kind(429)).toBe("rate-limit");
    expect(await kind(503)).toBe("overloaded");
    expect(await kind(402)).toBe("invalid-request");
    const events: StreamEvent[] = [];
    for await (const e of createSuperRouterProvider({ gateway: make(401), customerId: "c" }).stream(req())) events.push(e);
    expect(events[0]).toMatchObject({ type: "error" });
  });

  it("does not silently treat a replayed key as a fresh answer", async () => {
    const replay: RouterEvent[] = [{ type: "request.replayed", request_id: "r0", sequence: 0 }];
    const out: StreamEvent[] = [];
    for await (const e of createSuperRouterProvider({ gateway: fakeGateway(replay), customerId: "c" }).stream(req())) out.push(e);
    expect(out.at(-1)).toMatchObject({ type: "error" });
  });

  it("reports a stream that ends with no terminal event as an interruption", async () => {
    const cut: RouterEvent[] = [
      { type: "request.started", request_id: "r", sequence: 1, service_version: 1 },
      { type: "output.delta", request_id: "r", sequence: 2, text: "Half an ans" },
    ];
    const out: StreamEvent[] = [];
    for await (const e of createSuperRouterProvider({ gateway: fakeGateway(cut), customerId: "c" }).stream(req())) out.push(e);
    expect(out.map((e) => e.type)).toEqual(["start", "text-delta", "error"]);
    expect(out.at(-1)).toMatchObject({ error: { kind: "network", retryable: true } });
  });

  it("maps a cancelled failure to a cancelled finish, not an error", async () => {
    const cancelled: RouterEvent[] = [{ type: "request.failed", request_id: "r", sequence: 1, execution_status: "cancelled" }];
    const out: StreamEvent[] = [];
    for await (const e of createSuperRouterProvider({ gateway: fakeGateway(cancelled), customerId: "c" }).stream(req())) out.push(e);
    expect(out.at(-1)).toMatchObject({ type: "finish", finishReason: "cancelled" });
  });

  it("passes the call's abort signal through to the gateway, for generate and for the stored-request read", async () => {
    const ctl = new AbortController();
    let seen: AbortSignal | undefined;
    const gateway: InferenceGateway = {
      infer: async (_r, _k, signal) => {
        seen = signal;
        return { id: "r", execution_status: "succeeded", billing_status: "settled", output: { role: "assistant", content: "ok" }, usage: { status: "confirmed" } };
      },
      stream: async function* () {},
    };
    await createSuperRouterProvider({ gateway, customerId: "c" }).generate(req(), { signal: ctl.signal });
    expect(seen).toBe(ctl.signal);

    const signals: (AbortSignal | null | undefined)[] = [];
    const http = createSuperRouterGateway({
      baseUrl: "https://r.test",
      apiKey: "k",
      fetch: (async (url: string, init: RequestInit) => {
        signals.push(init.signal);
        if (url.endsWith("/v1/inferences")) return new Response(null, { status: 303, headers: { Location: "/v1/requests/req_9" } });
        return Response.json({ id: "req_9", execution_status: "succeeded", billing_status: "settled", output: { role: "assistant", content: "stored" }, usage: { status: "confirmed" } });
      }) as typeof fetch,
    });
    await http.infer({ service: "s", customer_id: "c", messages: [] }, "k", ctl.signal);
    expect(signals).toEqual([ctl.signal, ctl.signal]);
  });
});
