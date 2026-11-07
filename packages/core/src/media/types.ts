import type { MediaSource } from "../content/types.js";
import type { CallOptions } from "../providers/types.js";

export type GeneratedMediaKind = "image" | "audio" | "video";

export type GeneratedMedia = {
  id: string;
  kind: GeneratedMediaKind;
  source: MediaSource;
  mediaType: string;
  provider: string;
  model?: string;
  revisedPrompt?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  createdAt: number;
};

export type MediaProviderCapabilities = {
  imageGeneration: boolean;
  speechGeneration: boolean;
  transcription: boolean;
  videoGeneration: boolean;
  asyncJobs: boolean;
};

export type ImageGenerationRequest = {
  prompt: string;
  model?: string;
  n?: number;
  size?: string;
  quality?: string;
  style?: string;
  /** OpenAI-compatible response representation. Defaults to provider behavior. */
  responseFormat?: "url" | "b64_json";
  /** Escape hatch for endpoint-specific fields; normalized fields above win. */
  providerOptions?: Record<string, unknown>;
};

export type SpeechGenerationRequest = {
  input: string;
  model?: string;
  voice?: string;
  format?: string;
  providerOptions?: Record<string, unknown>;
};

export type TranscriptionRequest = {
  data: Blob | ArrayBuffer | Uint8Array;
  filename: string;
  mediaType?: string;
  model?: string;
  providerOptions?: Record<string, unknown>;
};

export type Transcript = { text: string; language?: string; durationMs?: number; raw?: unknown };

export type VideoGenerationRequest = {
  prompt: string;
  model?: string;
  image?: MediaSource;
  durationSeconds?: number;
  providerOptions?: Record<string, unknown>;
};

export type MediaJobHandle = { provider: string; id: string; kind: GeneratedMediaKind; createdAt: number };
export type MediaJobSnapshot = {
  handle: MediaJobHandle;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: GeneratedMedia[];
  error?: { message: string; code?: string };
};

export type MediaProvider = {
  readonly id: string;
  readonly label: string;
  readonly capabilities: MediaProviderCapabilities;
  generateImage?(req: ImageGenerationRequest, opts?: CallOptions): Promise<GeneratedMedia[]>;
  generateSpeech?(req: SpeechGenerationRequest, opts?: CallOptions): Promise<GeneratedMedia>;
  transcribe?(req: TranscriptionRequest, opts?: CallOptions): Promise<Transcript>;
  startVideoJob?(req: VideoGenerationRequest, opts?: CallOptions): Promise<MediaJobHandle>;
  pollMediaJob?(handle: MediaJobHandle, opts?: CallOptions): Promise<MediaJobSnapshot>;
  cancelMediaJob?(handle: MediaJobHandle, opts?: CallOptions): Promise<MediaJobSnapshot>;
};

/** Resolve an asset for HTML renderers without losing its MIME type. */
export function generatedMediaUrl(asset: GeneratedMedia): string | null {
  if (asset.source.kind === "url") return asset.source.url;
  if (asset.source.kind === "base64") return `data:${asset.mediaType};base64,${asset.source.data}`;
  return null;
}
