// `runAgent` against the shared agent-loop cases (../conformance/agent-loop.v0.json, owned by Super Protocol).
//
// Each case is a transcript: what the outside world feeds the loop (model results, tool outcomes, the person's
// answers) and what the loop must report. Here a scripted provider and scripted tools play the outside world and
// the run's EVENTS are compared. `runAgent` exposes no effects (the history is private), so the `append` and
// `run-tool` effects of the data are not checked; the order in which results reach the model is checked only as
// far as the events show it.
//
// The same data is run by the TypeScript reference machine and the Rust crate in Super Protocol. If this file
// fails after a change to `runAgent`, either the change is a bug or the shared cases must change first.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../context/builder.js";
import { AgentError } from "../errors.js";
import type { Provider, StreamEvent } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition } from "../tools/types.js";
import { runAgent } from "./run.js";
import { afterTool, consecutiveFailures, stepCountIs, tokenBudgetExceeded, userDeclined, type StopCondition } from "./stop.js";

type Obj = Record<string, any>;
const dataUrl = new URL("../conformance/agent-loop.v0.json", import.meta.url);
const file = JSON.parse(readFileSync(dataUrl, "utf8")) as { version: string; cases: Obj[] };

/** Features of the data that `runAgent` has. Everything else a case `requires` is skipped, by name. */
const FEATURES = new Set<string>([]);

const stopFrom = (c: Obj): StopCondition => {
  switch (c.kind) {
    case "stepCountIs": return stepCountIs(c.n);
    case "afterTool": return afterTool(...c.names);
    case "tokenBudgetExceeded": return tokenBudgetExceeded(c.maxTotal);
    case "consecutiveFailures": return consecutiveFailures(c.n);
    case "userDeclined": return userDeclined;
    default: throw new Error(`unknown stop condition ${c.kind}`);
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function replay(c: Obj): Promise<Obj[]> {
  const inputs: Obj[] = c.steps.map((s: Obj) => s.in);
  const models = inputs.filter((i) => i.kind === "model-result" || i.kind === "model-error");
  const controller = new AbortController();

  // Tool behaviour, from the script: completion order = script order, a failure is a throw, a cancel aborts first.
  const outcomes = new Map<string, { rank: number; input: Obj; abortFirst: boolean }>();
  inputs.forEach((inp, idx) => {
    if (inp.kind === "tool-outcome") outcomes.set(inp.callId, { rank: outcomes.size, input: inp, abortFirst: inputs[idx - 1]?.kind === "cancel" });
  });
  const actions = new Map<string, Obj>(inputs.filter((i) => i.kind === "user-action").map((i) => [i.callId, i.action]));

  const exec = async (_input: unknown, ctx: { callId: string }) => {
    const o = outcomes.get(ctx.callId);
    if (!o) throw new Error(`script has no outcome for ${ctx.callId}`);
    await sleep(o.rank * 15);
    const { output, failure } = o.input;
    if (o.abortFirst) controller.abort();
    if (failure === "execution-error") throw new Error(output.error);
    if (failure === "denied" && output.kind === "cancelled") throw new AgentError("cancelled", output.error);
    return failure ? { output, failure } : { output };
  };

  const defs: ToolDefinition[] = c.config.tools.map((t: Obj) => ({
    name: t.name,
    description: `Scripted tool ${t.name}.`,
    inputSchema: { type: "object", properties: {} },
    side: t.side,
    execute: exec,
  }));

  let modelCall = 0;
  const provider: Provider = {
    id: "script",
    label: "script",
    capabilities: { streaming: true, backgroundJobs: false, resumableStreams: false, tools: true, parallelToolCalls: true, images: false, files: false, audio: false, reasoning: false, strictJsonSchema: false, serverSideHistory: false, fileUpload: false },
    transport: { kind: "custom", credentialSafe: true, fetch: async () => { throw new Error("no network"); } } as never,
    generate: async () => { throw new Error("sync not used"); },
    async *stream(): AsyncGenerator<StreamEvent> {
      const m = models[modelCall++];
      if (!m) throw new Error("script ran out of model results");
      if (m.kind === "model-error") throw new AgentError(m.error.kind, m.error.message);
      yield { type: "start", modelId: "script-1" };
      for (const p of m.parts) {
        if (p.type === "text") yield { type: "text-delta", delta: p.text };
        else {
          yield { type: "tool-call-start", callId: p.callId, name: p.name };
          yield { type: "tool-call-end", callId: p.callId, name: p.name, input: p.input, ...(p.repaired ? { repaired: true } : {}) };
        }
      }
      yield { type: "usage", usage: m.usage };
      yield { type: "finish", finishReason: m.finishReason, usage: m.usage };
    },
  };

  const registry = new ToolRegistry().registerAll(defs, ["observer"]);
  const events: Obj[] = [];
  for await (const e of runAgent([], {
    provider,
    model: "script-1",
    contextBuilder: new ContextBuilder({ identity: "test", contextWindow: 32_000 }),
    tools: registry,
    toolResolution: { presets: ["observer"] },
    mode: "stream",
    ...(c.config.maxSteps ? { maxSteps: c.config.maxSteps } : {}),
    ...(c.config.stopWhen ? { stopWhen: c.config.stopWhen.map(stopFrom) } : {}),
    ...(c.config.interactive
      ? { onUserDecision: async (callId: string) => ({ cardId: `approval:${callId}`, callId, kind: "confirm", at: 0, ...actions.get(callId) }) as never }
      : {}),
    signal: controller.signal,
  })) events.push(e as Obj);
  return normalize(events);
}

/** Drop what the data leaves to the host, and put the rest in the data's shape. */
function normalize(events: Obj[]): Obj[] {
  const calls = new Map<string, Obj>();
  const out: Obj[] = [];
  for (const raw of events) {
    const e = JSON.parse(JSON.stringify(raw)) as Obj; // the wire view: undefined keys gone, AgentError flattened
    if (e.type === "context-built" || e.type === "metering" || e.type === "tool-call-input-delta") continue;
    if (e.type === "run-start" || e.type === "run-finish") e.runId = "run_1";
    if (e.type === "tool-call") calls.set(e.callId, e);
    if (e.type === "tool-result") e.ms = 0;
    if (e.type === "awaiting-user") {
      const call = calls.get(e.callId)!;
      e.card = { id: `approval:${e.callId}`, callId: e.callId, spec: { kind: e.card.spec.kind, tool: call.name, input: call.input } };
    }
    if (e.type === "user-responded") e.action = { type: e.action.type, ...(e.action.value !== undefined ? { value: e.action.value } : {}) };
    // JSON.stringify drops an Error's message, and runAgent words the step limit in English: the data has a kind and a notice.
    if (e.type === "error") e.error = { kind: raw.error.kind, message: raw.error.message };
    if (e.type === "message") {
      const m = /Reached the (\d+)-step limit/.exec(e.parts[0]?.text ?? "");
      if (m) e.parts = [{ type: "notice", code: "step-limit", steps: Number(m[1]) }];
    }
    out.push(e);
  }
  return out;
}

/** The whole-stream rules of super-protocol's docs/RUN-EVENTS.md, as code. Returns the problems found. */
function checkStream(events: Obj[]): string[] {
  const problems: string[] = [];
  if (events[0]?.type !== "run-start") problems.push("first event must be run-start");
  const finishes = events.filter((e) => e.type === "run-finish");
  if (finishes.length !== 1) problems.push(`exactly one run-finish expected, got ${finishes.length}`);
  if (events.at(-1)?.type !== "run-finish") problems.push("run-finish must be the last event");
  let expectedStep = 0;
  const called = new Set<string>();
  const resulted = new Set<string>();
  let open = 0;
  for (const e of events) {
    if (e.type === "step-start") {
      if (e.step !== expectedStep) problems.push(`step-start ${e.step}, expected ${expectedStep}`);
      expectedStep += 1;
      if (open !== 0) problems.push("a step-start came before all tool-results of the step before it");
    } else if (e.type === "tool-call") {
      called.add(e.callId);
      open += 1;
    } else if (e.type === "tool-result") {
      if (!called.has(e.callId)) problems.push(`tool-result for ${e.callId} before its tool-call`);
      if (resulted.has(e.callId)) problems.push(`second tool-result for ${e.callId}`);
      resulted.add(e.callId);
      open -= 1;
    }
  }
  if (open !== 0) problems.push(`${open} tool-call(s) without a tool-result`);
  return problems;
}

describe("runAgent against the shared agent-loop cases", () => {
  it("reads the version this file was written against", () => {
    expect(file.version).toBe("agent-loop.v0");
    expect(file.cases.length).toBeGreaterThanOrEqual(30);
  });

  for (const c of file.cases) {
    const missing = ((c.requires ?? []) as string[]).filter((f) => !FEATURES.has(f));
    // A refused input is a property of the machine's API, not of runAgent.
    const machineOnly = c.steps.some((s: Obj) => s.reject);
    const run = missing.length || machineOnly ? it.skip : it;
    run(`${c.name}${missing.length ? ` (needs ${missing.join(", ")})` : machineOnly ? " (machine API only)" : ""}`, async () => {
      // `ms` is how long a tool took on a real clock: the data echoes it, so only its presence is compared.
      const expected = c.steps.flatMap((s: Obj) => s.events).map((e: Obj) => (e.type === "tool-result" ? { ...e, ms: 0 } : e));
      const actual = await replay(c);
      expect(checkStream(actual)).toEqual([]);
      expect(actual).toEqual(expected);
    });
  }

  // The copy in this repository must be the file Super Protocol owns. Set SUPER_PROTOCOL_DIR to check it.
  const protocolDir = process.env.SUPER_PROTOCOL_DIR;
  it.skipIf(!protocolDir || !existsSync(`${protocolDir}/conformance/agent-loop.v0.json`))("is the same file as Super Protocol's", () => {
    expect(readFileSync(dataUrl, "utf8")).toBe(readFileSync(`${protocolDir}/conformance/agent-loop.v0.json`, "utf8"));
  });
});
