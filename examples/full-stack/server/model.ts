import { randomUUID } from "node:crypto";
import { ProviderError, type Invocation, type Offering, type Provider } from "@supersolutions/super-router-contracts";
import { createDocument } from "@supersolutions/super-editor-core";

// A scripted stand-in for a language model, so the example runs without an API key. It goes through the real router,
// provider, tool loop, plugins and cards. All market data here is generated.
const DOCUMENT_ID = "demo-report";

function demoBars() {
  const day = 86_400_000;
  const start = Date.UTC(2026, 0, 1);
  let close = 100;
  return Array.from({ length: 90 }, (_, i) => {
    const open = close;
    close = Math.round((open + Math.sin(i / 6) * 2.4 + Math.cos(i / 2.5) * 0.9) * 100) / 100;
    const high = Math.round((Math.max(open, close) + 0.8) * 100) / 100;
    const low = Math.round((Math.min(open, close) - 0.8) * 100) / 100;
    return { timestamp: start + i * day, open, high, low, close, volume: 1000 + (i % 7) * 120 };
  });
}

type Step = { tool: string; input: () => Record<string, unknown> };

const STEPS: Step[] = [
  {
    tool: "visualize",
    input: () => ({
      kind: "super-chart.chart",
      spec: {
        kind: "super-chart.chart",
        id: "demo-chart",
        title: "DEMO (generated data)",
        symbol: { ticker: "DEMO", name: "Generated demo series", pricePrecision: 2 },
        period: { multiplier: 1, timespan: "day", text: "1D" },
        height: 360,
        bars: demoBars(),
      },
    }),
  },
  { tool: "chart_state", input: () => ({ chartId: "demo-chart" }) },
  {
    tool: "chart_annotate",
    input: () => ({
      chartId: "demo-chart",
      annotations: [{ key: "level", kind: "level", anchors: [{ time: Date.UTC(2026, 0, 20), price: 104 }], text: "Level marked by the agent", tone: "accent" }],
    }),
  },
  {
    tool: "visualize",
    input: () => ({
      kind: "super-editor.document",
      spec: { kind: "super-editor.document", mode: "edit", document: createDocument({ id: DOCUMENT_ID, title: "Demo report" }) },
    }),
  },
  { tool: "editor_insert_blocks", input: () => ({ documentId: DOCUMENT_ID, markdown: "## Notes\n\nThis paragraph was added by the agent through the guarded edit path." }) },
  { tool: "editor_set_title", input: () => ({ documentId: DOCUMENT_ID, title: "Demo report, reviewed" }) },
];

/** The next step whose tool is on offer. A preset that withholds a tool skips that step. */
function nextStep(input: Invocation): Step | undefined {
  const offered = new Set(input.input.tools?.map((t) => t.name));
  const lastUser = input.input.messages.findLastIndex((m) => m.role === "user");
  const inTurn = input.input.messages.slice(lastUser).filter((m) => m.role === "tool").length;
  return STEPS.filter((step) => offered.has(step.tool))[inTurn];
}

export class ScriptedModel implements Provider {
  capabilities = { tools: true, images: true };

  async *invoke(input: Invocation, _offering: Offering, signal: AbortSignal) {
    if (signal.aborted) throw new ProviderError(false, false);
    const usage = { input: 200, cached: 0, cache_write: 0, output: 40 };
    const step = nextStep(input);
    if (step) {
      const json = JSON.stringify(step.input());
      const id = "call_" + randomUUID().replaceAll("-", "");
      yield { type: "delta" as const, text: `Calling ${step.tool}.\n\n` };
      yield { type: "tool_call" as const, index: 0, id, name: step.tool, arguments_delta: "" };
      for (let at = 0; at < json.length; at += 2048) yield { type: "tool_call" as const, index: 0, arguments_delta: json.slice(at, at + 2048) };
    } else {
      yield { type: "delta" as const, text: "Done. Every step above ran through Super Router and the tools this preset allows." };
    }
    yield { type: "usage" as const, usage, upstream_id: randomUUID() };
    yield { type: "done" as const };
  }
}
