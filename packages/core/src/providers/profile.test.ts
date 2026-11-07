import { describe, expect, it, vi } from "vitest";
import type { Transport } from "../transport/types.js";
import {
  createOpenAICompatibleProfile,
  createProviderFromProfile,
  normalizeProviderProfile,
} from "./profile.js";

const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("provider profiles", () => {
  it("normalizes a custom OpenAI-compatible profile", () => {
    expect(
      createOpenAICompatibleProfile({ id: " oneapi ", label: " OneAPI ", baseUrl: "https://relay.example/v1/" }),
    ).toMatchObject({ id: "oneapi", label: "OneAPI", protocol: "openai-chat", baseUrl: "https://relay.example/v1" });
  });

  it("rejects non-http endpoint roots", () => {
    expect(() =>
      normalizeProviderProfile({ id: "bad", label: "Bad", protocol: "openai-chat", baseUrl: "file:///etc/passwd" }),
    ).toThrow(/http or https/);
    expect(() =>
      normalizeProviderProfile({ id: "bad", label: "Bad", protocol: "openai-chat", baseUrl: "https://secret@example.com/v1" }),
    ).toThrow(/cannot contain credentials/);
  });

  it("routes compatible profiles through chat completions using the profile id", async () => {
    const fetch = vi.fn(async () => response({ id: "r1", model: "relay-model", choices: [{ message: { content: "ok" } }] }));
    const transport: Transport = { kind: "custom", credentialSafe: true, fetch };
    const profile = createOpenAICompatibleProfile({ id: "oneapi", label: "OneAPI", baseUrl: "https://relay.example/v1" });
    const provider = createProviderFromProfile(profile, transport);

    const result = await provider.generate({ model: "relay-model", messages: [] });

    expect(result.parts).toEqual([{ type: "text", text: "ok" }]);
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ provider: "oneapi", path: "/chat/completions" }));
    expect(provider.capabilities.backgroundJobs).toBe(false);
  });
});
