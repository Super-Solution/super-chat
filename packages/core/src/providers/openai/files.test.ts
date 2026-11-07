import { describe, expect, it, vi } from "vitest";
import type { Transport, TransportRequest } from "../../transport/types.js";
import { createOpenAIProvider } from "./adapter.js";

const mockTransport = (respond: (req: TransportRequest) => Response) => {
  const calls: TransportRequest[] = [];
  const transport: Transport = {
    kind: "custom",
    credentialSafe: true,
    fetch: vi.fn(async (req: TransportRequest) => {
      calls.push(req);
      return respond(req);
    }),
  };
  return { transport, calls };
};

const fileResponse = () =>
  new Response(JSON.stringify({ id: "file_abc", object: "file", bytes: 9, created_at: 1_700_000_000, filename: "report.pdf" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("uploadFile", () => {
  it("POSTs a multipart body to /files with purpose user_data", async () => {
    const { transport, calls } = mockTransport(fileResponse);
    const provider = createOpenAIProvider({ transport });

    const ref = await provider.uploadFile!({ data: new TextEncoder().encode("%PDF-fake"), filename: "report.pdf", mediaType: "application/pdf" });

    expect(calls[0]).toMatchObject({ path: "/files", method: "POST" });
    const body = calls[0]?.body as { kind: string; fields: Record<string, string>; files: { field: string; filename: string }[] };
    expect(body.kind).toBe("multipart");
    expect(body.fields).toEqual({ purpose: "user_data" });
    expect(body.files[0]).toMatchObject({ field: "file", filename: "report.pdf", mediaType: "application/pdf" });

    expect(ref).toEqual({
      kind: "providerFile",
      id: "file_abc",
      provider: "openai",
      filename: "report.pdf",
      sizeBytes: 9,
      createdAt: 1_700_000_000_000,
    });
  });

  it("stamps the ref with the CONFIGURED provider id, not a hardcoded one", async () => {
    const { transport } = mockTransport(fileResponse);
    const provider = createOpenAIProvider({ transport, id: "groq", capabilities: { fileUpload: true } });

    const ref = await provider.uploadFile!({ data: new Uint8Array([1]), filename: "x" });
    // The ref must drop into a file() part and pass that same adapter's
    // assertOwnFile check — a "openai"-stamped ref from a groq instance would
    // be refused by its own builder.
    expect(ref.provider).toBe("groq");
  });

  it("accepts Blob and ArrayBuffer data", async () => {
    const { transport, calls } = mockTransport(fileResponse);
    const provider = createOpenAIProvider({ transport });

    await provider.uploadFile!({ data: new Blob(["ab"]), filename: "a.txt" });
    await provider.uploadFile!({ data: new TextEncoder().encode("cd").buffer as ArrayBuffer, filename: "b.txt" });

    const bytes = (i: number) => (calls[i]?.body as { files: { data: Uint8Array }[] }).files[0]!.data;
    expect(new TextDecoder().decode(bytes(0))).toBe("ab");
    expect(new TextDecoder().decode(bytes(1))).toBe("cd");
  });

  it("refuses to upload when the capability is off", async () => {
    const { transport } = mockTransport(fileResponse);
    // Chat dialect: most OpenAI-compatible routers have no /files endpoint.
    const provider = createOpenAIProvider({ transport, dialect: "chat" });
    await expect(provider.uploadFile!({ data: new Uint8Array([1]), filename: "x" })).rejects.toThrow(/file upload/);
  });
});

describe("deleteFile", () => {
  it("DELETEs the id, url-encoded", async () => {
    const { transport, calls } = mockTransport(() => new Response(JSON.stringify({ deleted: true })));
    const provider = createOpenAIProvider({ transport });

    await provider.deleteFile!("file abc");
    expect(calls[0]).toMatchObject({ path: "/files/file%20abc", method: "DELETE" });
  });
});
