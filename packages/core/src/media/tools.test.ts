import { describe, expect, it, vi } from "vitest";
import type { MediaProvider } from "./types.js";
import { createGenerateImageTool } from "./tools.js";
import { resolveToolLoading } from "../tools/types.js";

describe("createGenerateImageTool", () => {
  it("keeps image bytes out of the model-facing output and puts them in a media card", async () => {
    const generateImage = vi.fn(async () => [
      {
        id: "m1",
        kind: "image" as const,
        source: { kind: "base64" as const, data: "AAAA" },
        mediaType: "image/png",
        provider: "oneapi",
        width: 1536,
        height: 1024,
        createdAt: 1,
      },
    ]);
    const provider: MediaProvider = {
      id: "oneapi",
      label: "OneAPI Images",
      capabilities: { imageGeneration: true, speechGeneration: false, transcription: false, videoGeneration: false, asyncJobs: false },
      generateImage,
    };
    const tool = createGenerateImageTool(provider, { defaultModel: "flux" });

    const result = await tool.execute!({ prompt: "A lighthouse" }, { vars: {}, callId: "c1" });

    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ prompt: "A lighthouse", model: "flux" }), { signal: undefined });
    expect(result).toMatchObject({
      output: { ok: true, assets: [{ id: "m1", kind: "image" }] },
      card: { kind: "media", items: [{ url: "data:image/png;base64,AAAA", width: 1536, height: 1024 }] },
    });
    expect(JSON.stringify((result as { output: unknown }).output)).not.toContain("AAAA");
  });

  it("derives a geometry-preserving loading hint from the call input", () => {
    const provider: MediaProvider = {
      id: "oneapi",
      label: "OneAPI Images",
      capabilities: { imageGeneration: true, speechGeneration: false, transcription: false, videoGeneration: false, asyncJobs: false },
    };
    const tool = createGenerateImageTool(provider);

    expect(resolveToolLoading(tool.loading, { prompt: "Three studies", n: 3, size: "1536x1024" })).toEqual({
      kind: "media",
      label: "Generating 3 images",
      count: 3,
      aspectRatio: "1536 / 1024",
    });
  });
});
