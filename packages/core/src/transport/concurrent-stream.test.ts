// Concurrency test for the BFF proxy.
//
// The handler streams the upstream body straight through, which is correct —
// but "correct by inspection" is what the SSE decoder bug looked like too
// (module-level state, two streams interleaving into garbage). This drives
// several streams through ONE handler instance at once and asserts each
// consumer receives exactly its own frames, in order.

import { describe, expect, it, vi } from "vitest";
import { createProxyHandler } from "./server.js";
import { createProxyTransport } from "./proxy.js";
import { parseSSEJson } from "./sse.js";

/** An upstream that streams N labelled frames, interleaving with its peers. */
function slowUpstream(framesPerStream: number) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { label: string };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let i = 0; i < framesPerStream; i += 1) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ label: body.label, seq: i })}\n\n`));
          // Yield the microtask queue so concurrent streams genuinely interleave
          // rather than each running to completion in one synchronous burst.
          await new Promise((r) => setTimeout(r, 1));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
}

describe("createProxyHandler under concurrent streams", () => {
  const config = (fetchImpl: typeof fetch) => ({
    providers: {
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", allowPaths: ["/responses"] },
    },
    fetchImpl,
  });

  it("keeps concurrent SSE streams separate and in order through one handler", async () => {
    const FRAMES = 12;
    const upstream = slowUpstream(FRAMES);
    // ONE handler instance, as a deployed route would be.
    const handler = createProxyHandler(config(upstream as never));
    const transport = createProxyTransport({
      url: "http://app.local/api/agent",
      fetchImpl: ((input: RequestInfo, init?: RequestInit) => handler(new Request(input as string, init))) as typeof fetch,
    });

    const labels = ["alpha", "beta", "gamma", "delta"];
    const collected = await Promise.all(
      labels.map(async (label) => {
        const res = await transport.fetch({
          provider: "openai",
          path: "/responses",
          method: "POST",
          body: { label },
          stream: true,
        });
        const seen: { label: string; seq: number }[] = [];
        for await (const frame of parseSSEJson<{ label: string; seq: number }>(res.body!)) {
          seen.push(frame.data);
        }
        return { label, seen };
      }),
    );

    for (const { label, seen } of collected) {
      // No foreign frames…
      expect(seen.every((f) => f.label === label)).toBe(true);
      // …none dropped, none duplicated, and strictly in order.
      expect(seen.map((f) => f.seq)).toEqual([...Array(FRAMES).keys()]);
    }
    expect(upstream).toHaveBeenCalledTimes(labels.length);
  });

  it("isolates a failing stream from its peers", async () => {
    const upstream = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { label: string };
      if (body.label === "doomed") throw new Error("upstream connection reset");
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ label: body.label, seq: 0 })}\n\n`));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    const handler = createProxyHandler(config(upstream as never));

    const [ok, failed] = (await Promise.all(
      ["fine", "doomed"].map((label) =>
        handler(
          new Request("http://app.local/api/agent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ provider: "openai", path: "/responses", method: "POST", body: { label }, stream: true }),
          }),
        ),
      ),
    )) as [Response, Response];

    expect(ok.status).toBe(200);
    expect(failed.status).toBe(502); // the peer's failure stays the peer's
    const frames: { label: string; seq: number }[] = [];
    for await (const f of parseSSEJson<{ label: string; seq: number }>(ok.body!)) frames.push(f.data);
    expect(frames).toEqual([{ label: "fine", seq: 0 }]);
  });
});
