// OpenAI-compatible image generation. This deliberately uses Transport, so the
// same implementation works against official OpenAI, oneAPI, or a server proxy.

import { nextId } from "../content/parts.js";
import { errorFromResponse } from "../transport/retry.js";
import type { Transport } from "../transport/types.js";
import type { GeneratedMedia, ImageGenerationRequest, MediaProvider } from "./types.js";

type ImageGenerationResponse = {
  created?: number;
  data?: { url?: string; b64_json?: string; revised_prompt?: string }[];
};

const dimensionsFromSize = (size?: string): { width: number; height: number } | undefined => {
  const match = /^(\d+)x(\d+)$/i.exec(size?.trim() ?? "");
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
};

export type OpenAIImageProviderConfig = {
  transport: Transport;
  /** Must match the provider key registered by createProxyHandler. */
  id?: string;
  label?: string;
  defaultModel?: string;
};

export function createOpenAIImageProvider(config: OpenAIImageProviderConfig): MediaProvider {
  const id = config.id ?? "openai";
  return {
    id,
    label: config.label ?? "OpenAI Images",
    capabilities: {
      imageGeneration: true,
      speechGeneration: false,
      transcription: false,
      videoGeneration: false,
      asyncJobs: false,
    },
    async generateImage(req: ImageGenerationRequest, opts): Promise<GeneratedMedia[]> {
      const prompt = req.prompt.trim();
      if (!prompt) throw new Error("Image generation prompt is required.");
      const body = {
        ...req.providerOptions,
        prompt,
        ...(req.model ?? config.defaultModel ? { model: req.model ?? config.defaultModel } : {}),
        ...(req.n != null ? { n: req.n } : {}),
        ...(req.size ? { size: req.size } : {}),
        ...(req.quality ? { quality: req.quality } : {}),
        ...(req.style ? { style: req.style } : {}),
        ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
      };
      const res = await config.transport.fetch({
        provider: id,
        path: "/images/generations",
        method: "POST",
        body,
        headers: opts?.headers,
        signal: opts?.signal,
      });
      if (!res.ok) throw await errorFromResponse(res, id);
      const json = (await res.json()) as ImageGenerationResponse;
      if (!json.data?.length) throw new Error(`Provider "${id}" returned no generated images.`);
      const createdAt = (json.created ?? Math.floor(Date.now() / 1000)) * 1000;
      const dimensions = dimensionsFromSize(req.size);
      return json.data.map((item) => {
        if (!item.url && !item.b64_json) throw new Error(`Provider "${id}" returned an image without url or b64_json.`);
        return {
          id: nextId("media"),
          kind: "image" as const,
          source: item.url ? { kind: "url" as const, url: item.url } : { kind: "base64" as const, data: item.b64_json! },
          mediaType: "image/png",
          provider: id,
          ...(req.model ?? config.defaultModel ? { model: req.model ?? config.defaultModel } : {}),
          ...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {}),
          ...(dimensions ?? {}),
          createdAt,
        };
      });
    },
  };
}
