// Provider-hosted tools: declarations pass through verbatim to the matching
// adapter, and the work they do comes back visible instead of magic.

import { describe, expect, it } from "vitest";
import { buildChatRequest, buildResponsesRequest } from "./openai/map-in.js";
import { partsFromResponses } from "./openai/map-out.js";
import { buildAnthropicRequest } from "./anthropic/map-in.js";
import { partsFromAnthropic } from "./anthropic/map-out.js";
import type { NormalizedRequest } from "./types.js";
import type { ResponsesResponse } from "./openai/wire.js";
import type { AnthropicResponse } from "./anthropic/wire.js";

const req = (over: Partial<NormalizedRequest> = {}): NormalizedRequest => ({
  model: "m",
  messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "what happened today?" }] }],
  ...over,
});

const WEB_SEARCH_OPENAI = { type: "web_search_20260209", name: "web_search" };
const WEB_SEARCH_ANTHROPIC = { type: "web_search_20260209", name: "web_search", max_uses: 3 };

describe("providerTools declarations", () => {
  it("appends the matching provider's native tools verbatim (Responses)", () => {
    const out = buildResponsesRequest(
      req({
        tools: [{ name: "getPrice", description: "d", parameters: { type: "object" } }],
        providerTools: { openai: [WEB_SEARCH_OPENAI], anthropic: [WEB_SEARCH_ANTHROPIC] },
      }),
      { providerId: "openai" },
    );
    // Function tool first, native tool appended untouched — no normalization,
    // because the vendor owns this shape.
    expect(out.tools).toHaveLength(2);
    expect(out.tools?.[1]).toEqual(WEB_SEARCH_OPENAI);
  });

  it("sends native tools even with no function tools, and no tool_choice for them", () => {
    const out = buildResponsesRequest(req({ providerTools: { openai: [WEB_SEARCH_OPENAI] } }), { providerId: "openai" });
    expect(out.tools).toEqual([WEB_SEARCH_OPENAI]);
    // tool_choice steers OUR tools; a provider-hosted tool has no name we gate.
    expect(out.tool_choice).toBeUndefined();
  });

  it("ignores another provider's entry entirely", () => {
    const out = buildResponsesRequest(req({ providerTools: { anthropic: [WEB_SEARCH_ANTHROPIC] } }), {
      providerId: "openai",
    });
    expect(out.tools).toBeUndefined();
  });

  it("passes through on the Chat dialect too", () => {
    const out = buildChatRequest(req({ providerTools: { openai: [WEB_SEARCH_OPENAI] } }), { providerId: "openai" });
    expect(out.tools).toEqual([WEB_SEARCH_OPENAI]);
  });

  it("appends into Anthropic's tools array", () => {
    const out = buildAnthropicRequest(
      req({
        tools: [{ name: "getPrice", description: "d", parameters: { type: "object" } }],
        providerTools: { anthropic: [WEB_SEARCH_ANTHROPIC] },
      }),
      { providerId: "anthropic" },
    );
    expect(out.tools).toHaveLength(2);
    expect(out.tools?.[1]).toEqual(WEB_SEARCH_ANTHROPIC);
  });
});

describe("provider-hosted tool activity comes back visible", () => {
  it("surfaces a Responses web_search_call as a provider-tool artifact", () => {
    const response = {
      id: "resp_1",
      object: "response",
      created_at: 0,
      model: "m",
      status: "completed",
      output: [
        { type: "web_search_call", id: "ws_1", status: "completed" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Here is the news." }] },
      ],
    } as unknown as ResponsesResponse;

    const parts = partsFromResponses(response);
    expect(parts[0]).toEqual({
      type: "artifact",
      id: "ws_1",
      kind: "provider-tool:web_search_call",
      data: { type: "web_search_call", id: "ws_1", status: "completed" },
    });
    expect(parts[1]).toEqual({ type: "text", text: "Here is the news." });
  });

  it("surfaces an Anthropic server_tool_use block the same way", () => {
    const response = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [
        { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "news" } },
        { type: "text", text: "Here is the news." },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as AnthropicResponse;

    const parts = partsFromAnthropic(response);
    expect(parts[0]).toMatchObject({ type: "artifact", kind: "provider-tool:server_tool_use", id: "srvtoolu_1" });
    expect(parts[1]).toEqual({ type: "text", text: "Here is the news." });
  });
});
