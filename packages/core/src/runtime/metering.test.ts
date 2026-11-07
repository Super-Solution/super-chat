import { describe, expect, it, vi } from "vitest";
import { userMessage } from "../content/parts.js";
import { ContextBuilder } from "../context/builder.js";
import { AgentError } from "../errors.js";
import type { GenerateResult, Provider, ProviderCapabilities, StreamEvent } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";
import type { Transport } from "../transport/types.js";
import type { RunEvent, RunMode } from "./events.js";
import type { MeteringRecord } from "./metering.js";
import { runAgent, type RunConfig } from "./run.js";

const capabilities: ProviderCapabilities = {
  streaming: true,
  backgroundJobs: true,
  resumableStreams: false,
  tools: true,
  parallelToolCalls: true,
  images: false,
  files: false,
  audio: false,
  reasoning: false,
  strictJsonSchema: false,
  serverSideHistory: false,
  fileUpload: false,
};

const transport: Transport = {
  kind: "custom",
  credentialSafe: true,
  fetch: async () => new Response(null, { status: 204 }),
};

const textResult = (text: string, modelId: string, totalTokens: number): GenerateResult => ({
  parts: [{ type: "text", text }],
  finishReason: "stop",
  usage: { inputTokens: totalTokens - 2, outputTokens: 2, totalTokens },
  responseId: `response_${modelId}`,
  modelId,
});

function provider(over: Partial<Provider>): Provider {
  return {
    id: "test-provider",
    label: "Test provider",
    capabilities,
    transport,
    generate: async () => textResult("ok", "actual-default", 10),
    stream: async function* () {
      yield { type: "start", modelId: "actual-default" };
      yield { type: "finish", finishReason: "stop", usage: { totalTokens: 10 } };
    },
    ...over,
  };
}

const echo: ToolDefinition = {
  name: "echo",
  description: "Echo",
  inputSchema: { type: "object" },
  execute: () => ({ output: "done" }),
};

function config(p: Provider, mode: RunMode, over: Partial<RunConfig> = {}): RunConfig {
  return {
    provider: p,
    model: "requested-model",
    contextBuilder: new ContextBuilder({ identity: "Test", contextWindow: 8_000 }),
    tools: new ToolRegistry().register(echo, ["observer"]),
    toolResolution: { presets: ["observer"] },
    mode,
    ...over,
  };
}

async function collect(p: Provider, mode: RunMode, over: Partial<RunConfig> = {}): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of runAgent([userMessage("hello")], config(p, mode, over))) events.push(event);
  return events;
}

const records = (events: RunEvent[]) =>
  events.filter((event): event is Extract<RunEvent, { type: "metering" }> => event.type === "metering").map((e) => e.record);

describe("provider-neutral metering", () => {
  it("emits idempotent step records plus one non-billable run summary", async () => {
    let call = 0;
    const p = provider({
      generate: async () => {
        call += 1;
        if (call === 1) {
          return {
            parts: [{ type: "tool-call", callId: "call_1", name: "echo", input: {}, status: "pending" }],
            finishReason: "tool-calls",
            usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
            responseId: "response_1",
            modelId: "actual-a",
          };
        }
        return textResult("done", "actual-b", 20);
      },
    });
    const delivered: MeteringRecord[] = [];
    const events = await collect(p, "sync", {
      meter: { record: (record) => { delivered.push(record); } },
      meteringMetadata: { tenantId: "tenant-1" },
    });
    const metering = records(events);

    expect(metering).toEqual(delivered);
    expect(metering.map((record) => record.scope)).toEqual(["step", "step", "run"]);
    expect(new Set(metering.map((record) => record.id)).size).toBe(3);
    expect(metering[0]).toMatchObject({
      step: 0,
      provider: "test-provider",
      requestedModel: "requested-model",
      reportedModel: "actual-a",
      status: "completed",
      source: "provider",
      metadata: { tenantId: "tenant-1" },
    });
    expect(metering[1]).toMatchObject({ step: 1, reportedModel: "actual-b" });
    expect(metering[2]).toMatchObject({
      scope: "run",
      steps: 2,
      usage: { inputTokens: 26, outputTokens: 4, totalTokens: 30 },
      reportedModels: ["actual-a", "actual-b"],
    });
    expect(events.at(-1)).toMatchObject({ type: "run-finish", steps: 2 });
  });

  it("captures the actual model and final usage from a stream exactly once", async () => {
    const p = provider({
      stream: async function* (): AsyncGenerator<StreamEvent> {
        yield { type: "start", responseId: "stream_1", modelId: "actual-stream" };
        yield { type: "text-delta", delta: "hello" };
        yield { type: "usage", usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 } };
        yield { type: "finish", finishReason: "stop", responseId: "stream_1" };
      },
    });
    const metering = records(await collect(p, "stream"));

    expect(metering).toHaveLength(2);
    expect(metering[0]).toMatchObject({
      scope: "step",
      reportedModel: "actual-stream",
      responseId: "stream_1",
      usage: { totalTokens: 5 },
      status: "completed",
    });
    expect(metering[1]).toMatchObject({ scope: "run", usage: { totalTokens: 5 }, steps: 1 });
  });

  it("meters a background result using its reported model", async () => {
    const result = textResult("background", "actual-background", 7);
    const p = provider({
      startJob: async () => ({
        provider: "test-provider",
        id: "job_1",
        model: "accepted-model",
        createdAt: Date.now(),
      }),
      pollJob: async (handle) => ({ handle, status: "completed", result }),
    });
    const metering = records(await collect(p, "background"));

    expect(metering[0]).toMatchObject({
      scope: "step",
      reportedModel: "actual-background",
      responseId: "response_actual-background",
      usage: { totalTokens: 7 },
    });
    expect(metering[1]).toMatchObject({ scope: "run", status: "completed", steps: 1 });
  });

  it("emits terminal failed and cancelled records even when usage is unavailable", async () => {
    const failed = records(
      await collect(
        provider({ generate: async () => { throw new AgentError("network", "offline"); } }),
        "sync",
      ),
    );
    expect(failed).toHaveLength(2);
    expect(failed[0]).toMatchObject({ scope: "step", step: 0, status: "failed", source: "unavailable" });
    expect(failed[1]).toMatchObject({ scope: "run", status: "failed", finishReason: "error", steps: 1 });

    const cancelled = records(
      await collect(
        provider({ generate: async () => { throw new AgentError("cancelled", "stopped"); } }),
        "sync",
      ),
    );
    expect(cancelled[0]).toMatchObject({ scope: "step", status: "cancelled" });
    expect(cancelled[1]).toMatchObject({ scope: "run", status: "cancelled", finishReason: "cancelled" });
  });

  it("keeps partial stream usage when the step later fails", async () => {
    const p = provider({
      stream: async function* (): AsyncGenerator<StreamEvent> {
        yield { type: "start", responseId: "partial_1", modelId: "actual-stream" };
        yield { type: "usage", usage: { inputTokens: 9, outputTokens: 1, totalTokens: 10 } };
        yield { type: "error", error: new AgentError("network", "stream dropped") };
      },
    });
    const metering = records(await collect(p, "stream"));

    expect(metering[0]).toMatchObject({
      scope: "step",
      status: "failed",
      source: "provider",
      reportedModel: "actual-stream",
      usage: { totalTokens: 10 },
    });
    expect(metering[1]).toMatchObject({ scope: "run", status: "failed", usage: { totalTokens: 10 } });
  });

  it("maps a provider-cancelled background job to cancelled metering", async () => {
    const p = provider({
      startJob: async () => ({ provider: "test-provider", id: "job_cancel", model: "accepted-model", createdAt: 0 }),
      pollJob: async (handle) => ({ handle, status: "cancelled" }),
    });
    const metering = records(await collect(p, "background"));

    expect(metering[0]).toMatchObject({ scope: "step", status: "cancelled", responseId: "job_cancel" });
    expect(metering[1]).toMatchObject({ scope: "run", status: "cancelled", finishReason: "cancelled" });
  });

  it("keeps sink failures from changing the run", async () => {
    const onError = vi.fn();
    const events = await collect(provider({}), "sync", {
      meter: {
        record: async () => { throw new Error("sink unavailable"); },
        onError,
      },
    });

    expect(onError).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({ type: "run-finish", finishReason: "stop" });
    expect(events.some((event) => event.type === "error")).toBe(false);
  });
});
