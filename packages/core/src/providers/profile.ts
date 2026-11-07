// Public provider profiles describe an endpoint without carrying its secret.
// A profile is safe to render in a picker or persist in localStorage; the API
// key stays in a Transport (direct/BYOK) or in createProxyHandler (server).

import { createDirectTransport, type DirectTransportConfig } from "../transport/direct.js";
import type { Transport } from "../transport/types.js";
import { createAnthropicProvider } from "./anthropic/adapter.js";
import { createOpenAIProvider } from "./openai/adapter.js";
import type { ModelInfo, Provider, ProviderCapabilities } from "./types.js";

export type ProviderProtocol = "openai-responses" | "openai-chat" | "anthropic-messages";

export type ProviderProfile = {
  /** Stable routing id. It must match the proxy provider key in proxy mode. */
  id: string;
  label: string;
  protocol: ProviderProtocol;
  /** Provider API root including its version prefix, without a trailing slash. */
  baseUrl: string;
  models?: ModelInfo[];
  capabilities?: Partial<ProviderCapabilities>;
};

export const OPENAI_OFFICIAL_PROFILE: ProviderProfile = {
  id: "openai",
  label: "OpenAI",
  protocol: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
};

export const ANTHROPIC_OFFICIAL_PROFILE: ProviderProfile = {
  id: "anthropic",
  label: "Anthropic",
  protocol: "anthropic-messages",
  baseUrl: "https://api.anthropic.com/v1",
};

export function createOpenAICompatibleProfile(
  profile: Omit<ProviderProfile, "protocol"> & { protocol?: "openai-chat" },
): ProviderProfile {
  return normalizeProviderProfile({ ...profile, protocol: "openai-chat" });
}

/** Normalize user-authored profile fields and reject unsafe/ambiguous roots. */
export function normalizeProviderProfile(profile: ProviderProfile): ProviderProfile {
  const id = profile.id.trim();
  const label = profile.label.trim();
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error("Provider profile id must use letters, numbers, dots, underscores, or hyphens.");
  }
  if (!label) throw new Error("Provider profile label is required.");

  let url: URL;
  try {
    url = new URL(profile.baseUrl);
  } catch {
    throw new Error("Provider profile baseUrl must be an absolute URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Provider profile baseUrl must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Provider profile baseUrl cannot contain credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Provider profile baseUrl cannot include a query or fragment.");
  }

  return {
    ...profile,
    id,
    label,
    baseUrl: url.toString().replace(/\/$/, ""),
  };
}

/** Build the wire adapter for a profile. Credentials remain in the transport. */
export function createProviderFromProfile(profileInput: ProviderProfile, transport: Transport): Provider {
  const profile = normalizeProviderProfile(profileInput);
  const common = {
    transport,
    id: profile.id,
    label: profile.label,
    ...(profile.models ? { models: profile.models } : {}),
    ...(profile.capabilities ? { capabilities: profile.capabilities } : {}),
  };

  if (profile.protocol === "anthropic-messages") return createAnthropicProvider(common);
  return createOpenAIProvider({
    ...common,
    dialect: profile.protocol === "openai-chat" ? "chat" : "responses",
  });
}

export type ProfileDirectTransportConfig = Omit<DirectTransportConfig, "baseUrl" | "authStyle">;

/** Build a BYOK/server-direct transport with the profile's URL and auth style. */
export function createDirectTransportForProfile(
  profileInput: ProviderProfile,
  config: ProfileDirectTransportConfig,
): Transport {
  const profile = normalizeProviderProfile(profileInput);
  return createDirectTransport({
    ...config,
    baseUrl: profile.baseUrl,
    ...(profile.protocol === "anthropic-messages" ? { authStyle: "x-api-key" as const } : {}),
  });
}
