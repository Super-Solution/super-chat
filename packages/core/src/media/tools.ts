import type { MediaCard } from "../cards/types.js";
import type { ToolDefinition } from "../tools/types.js";
import { generatedMediaUrl, type ImageGenerationRequest, type MediaProvider } from "./types.js";

export type GenerateImageToolOptions = {
  name?: string;
  /** Used when the model does not explicitly select one. */
  defaultModel?: string;
};

/**
 * Expose a MediaProvider to an agent without teaching the chat Provider any
 * image-generation wire format. The compact output goes back to the model;
 * the binary/URL payload stays in a media card for the user.
 */
export function createGenerateImageTool(provider: MediaProvider, options: GenerateImageToolOptions = {}): ToolDefinition {
  return {
    name: options.name ?? "generateImage",
    side: "write",
    strict: true,
    description: "Generate one or more images from a prompt and show them to the user.",
    loading: (input) => {
      const request = (input ?? {}) as Partial<ImageGenerationRequest>;
      const count = Math.max(1, Math.min(10, Number.isFinite(request.n) ? Math.round(request.n!) : 1));
      const size = /^(\d+)x(\d+)$/i.exec(request.size?.trim() ?? "");
      return {
        kind: "media",
        label: count === 1 ? "Generating image" : `Generating ${count} images`,
        count,
        ...(size ? { aspectRatio: `${Number(size[1])} / ${Number(size[2])}` } : {}),
      };
    },
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", description: "A concrete visual description of the image to generate." },
        model: { type: "string" },
        n: { type: "integer", minimum: 1, maximum: 10 },
        size: { type: "string", description: "Provider-supported size, for example 1024x1024." },
        quality: { type: "string" },
        style: { type: "string" },
      },
      additionalProperties: false,
    },
    async execute(input, ctx) {
      if (!provider.generateImage || !provider.capabilities.imageGeneration) {
        return { output: { ok: false, error: `Provider "${provider.id}" cannot generate images.` }, failure: "execution-error" as const };
      }
      const request = (input ?? {}) as ImageGenerationRequest;
      if (!request.prompt?.trim()) {
        return { output: { ok: false, error: "`prompt` is required." }, failure: "invalid-input" as const };
      }
      const assets = await provider.generateImage(
        { ...request, ...(request.model || !options.defaultModel ? {} : { model: options.defaultModel }) },
        { signal: ctx.signal },
      );
      const items = assets.flatMap((asset) => {
        const url = generatedMediaUrl(asset);
        return url
          ? [{
              url,
              mediaType: asset.mediaType,
              alt: asset.revisedPrompt ?? request.prompt,
              caption: asset.revisedPrompt,
              ...(asset.width ? { width: asset.width } : {}),
              ...(asset.height ? { height: asset.height } : {}),
              ...(asset.durationMs ? { durationMs: asset.durationMs } : {}),
            }]
          : [];
      });
      const card: MediaCard | undefined = items.length
        ? { kind: "media", title: assets.length === 1 ? "Generated image" : "Generated images", layout: assets.length === 1 ? "single" : "grid", items }
        : undefined;
      return {
        output: {
          ok: true,
          provider: provider.id,
          count: assets.length,
          assets: assets.map((asset) => ({
            id: asset.id,
            kind: asset.kind,
            mediaType: asset.mediaType,
            ...(asset.model ? { model: asset.model } : {}),
            ...(asset.revisedPrompt ? { revisedPrompt: asset.revisedPrompt } : {}),
          })),
        },
        ...(card ? { card } : {}),
      };
    },
  };
}
