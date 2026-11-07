import { describe, expect, it, vi } from "vitest";
import { createDirectTransport } from "./direct.js";
import { createProxyTransport, type SerializedMultipartBody } from "./proxy.js";
import { createProxyHandler } from "./server.js";
import type { MultipartBody } from "./types.js";

const upload = (): MultipartBody => ({
  kind: "multipart",
  fields: { purpose: "user_data" },
  files: [{ field: "file", filename: "report.pdf", mediaType: "application/pdf", data: new TextEncoder().encode("%PDF-fake") }],
});

describe("direct transport multipart", () => {
  it("sends real FormData and lets fetch set the boundary", async () => {
    const doFetch = vi.fn(async () => new Response("{}"));
    const transport = createDirectTransport({ baseUrl: "https://api.openai.com/v1", apiKey: "sk", fetchImpl: doFetch as never });

    await transport.fetch({ provider: "openai", path: "/files", method: "POST", body: upload() });

    const [, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("purpose")).toBe("user_data");
    expect((form.get("file") as File).name).toBe("report.pdf");
    // An explicit content-type would be missing its boundary and break the upload.
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it("still sends JSON for ordinary bodies", async () => {
    const doFetch = vi.fn(async () => new Response("{}"));
    const transport = createDirectTransport({ baseUrl: "https://x", apiKey: "sk", fetchImpl: doFetch as never });
    await transport.fetch({ provider: "openai", path: "/responses", method: "POST", body: { model: "m" } });

    const [, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe('{"model":"m"}');
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
});

describe("proxy transport multipart", () => {
  it("base64-encodes bytes into the JSON envelope", async () => {
    const doFetch = vi.fn(async () => new Response("{}"));
    const transport = createProxyTransport({ url: "/api/agent", fetchImpl: doFetch as never });

    await transport.fetch({ provider: "openai", path: "/files", method: "POST", body: upload() });

    const [, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    const envelope = JSON.parse(init.body as string) as { body: SerializedMultipartBody };
    expect(envelope.body.kind).toBe("multipart");
    expect(envelope.body.files[0]?.data).toBe(Buffer.from("%PDF-fake").toString("base64"));
    expect(envelope.body.files[0]?.filename).toBe("report.pdf");
  });
});

describe("proxy handler multipart", () => {
  const handlerConfig = (fetchImpl: typeof fetch) => ({
    providers: {
      openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", allowPaths: ["POST /files"] },
    },
    fetchImpl,
  });

  it("decodes the envelope and forwards FormData upstream", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ id: "file_1" })));
    const handler = createProxyHandler(handlerConfig(upstream as never));
    // Full contract test: client-side transport → envelope → server half.
    const transport = createProxyTransport({
      url: "http://app.local/api/agent",
      fetchImpl: ((input: RequestInfo, init?: RequestInit) => handler(new Request(input as string, init))) as typeof fetch,
    });

    const res = await transport.fetch({ provider: "openai", path: "/files", method: "POST", body: upload() });
    expect(res.status).toBe(200);

    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/files");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("purpose")).toBe("user_data");
    const file = form.get("file") as File;
    expect(file.name).toBe("report.pdf");
    expect(await file.text()).toBe("%PDF-fake");
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer sk-test");
  });

  it("rejects invalid base64 instead of forwarding garbage", async () => {
    const upstream = vi.fn(async () => new Response("{}"));
    const handler = createProxyHandler(handlerConfig(upstream as never));
    const res = await handler(
      new Request("http://app.local/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "openai",
          path: "/files",
          method: "POST",
          body: { kind: "multipart", fields: {}, files: [{ field: "file", filename: "x", data: "!!not-base64!!" }] },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
