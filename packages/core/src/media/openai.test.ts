import { describe, expect, it, vi } from "vitest";
import type { Transport } from "../transport/types.js";
import { createOpenAIImageProvider } from "./openai.js";

describe("createOpenAIImageProvider", () => {
  it("generates URL and base64 assets through the configured provider route", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          created: 1_700_000_000,
          data: [{ url: "https://cdn.example/a.png", revised_prompt: "A calmer sea" }, { b64_json: "AAAA" }],
        }),
        { status: 200 },
      ),
    );
    const transport: Transport = { kind: "custom", credentialSafe: true, fetch };
    const provider = createOpenAIImageProvider({ transport, id: "oneapi", defaultModel: "flux" });

    const assets = await provider.generateImage!({ prompt: "  a calm sea  ", size: "1024x1024" });

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "oneapi",
        path: "/images/generations",
        body: expect.objectContaining({ prompt: "a calm sea", model: "flux", size: "1024x1024" }),
      }),
    );
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({ kind: "image", width: 1024, height: 1024, source: { kind: "url", url: "https://cdn.example/a.png" } });
    expect(assets[1]).toMatchObject({ kind: "image", source: { kind: "base64", data: "AAAA" } });
  });
});
