import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../context/builder.js";
import { userMessage } from "../content/parts.js";
import { ToolRegistry } from "../tools/registry.js";
import { executeToolCall } from "../runtime/execute-tools.js";
import { createAppActionTools, createAppStateSource, type AppStateBinding } from "./app-state.js";

const binding = <T,>(over: Partial<AppStateBinding<T>> & { id: string; read: () => T }): AppStateBinding<T> => ({
  description: "test state",
  ...over,
});

describe("createAppStateSource", () => {
  it("injects live host state as a budgeted, traced environment layer", async () => {
    let filters = { status: "open", assignee: "me" };
    const builder = new ContextBuilder({
      identity: "Test agent.",
      contextWindow: 32_000,
      sources: [createAppStateSource([binding({ id: "filters", description: "the filters on screen", read: () => filters })])],
    });

    const first = await builder.build({ messages: [userMessage("what am I looking at?")], vars: {} });
    expect(first.system).toContain("filters — the filters on screen");
    expect(first.system).toContain('"assignee": "me"');
    expect(first.trace.entries.some((e) => e.id === "app-state" && e.status === "included")).toBe(true);

    // Derived every turn: the NEXT build sees the new value, not a snapshot.
    filters = { status: "closed", assignee: "nobody" };
    const second = await builder.build({ messages: [userMessage("and now?")], vars: {} });
    expect(second.system).toContain('"status": "closed"');
    expect(second.system).not.toContain('"status": "open"');
  });

  it("honours `when` and a custom serializer", async () => {
    const builder = new ContextBuilder({
      identity: "T.",
      contextWindow: 32_000,
      sources: [
        createAppStateSource([
          binding({ id: "dialog", description: "a dialog", read: () => ({ open: false }), when: (v) => v.open }),
          binding({
            id: "rows",
            description: "selected rows",
            read: () => ({ ids: [1, 2, 3], hugePayload: "x".repeat(10_000) }),
            // A summarizer is the point: the model needs the count, not 10KB.
            serialize: (v) => `${v.ids.length} rows selected: ${v.ids.join(", ")}`,
          }),
        ]),
      ],
    });
    const context = await builder.build({ messages: [userMessage("hi there")], vars: {} });
    expect(context.system).not.toContain("dialog");
    expect(context.system).toContain("3 rows selected: 1, 2, 3");
    expect(context.system).not.toContain("xxxx");
  });

  it("skips a binding that throws rather than failing the turn", async () => {
    const builder = new ContextBuilder({
      identity: "T.",
      contextWindow: 32_000,
      sources: [
        createAppStateSource([
          binding({
            id: "gone",
            description: "an unmounted component",
            read: () => {
              throw new Error("component unmounted");
            },
          }),
          binding({ id: "fine", description: "still here", read: () => ({ ok: true }) }),
        ]),
      ],
    });
    const context = await builder.build({ messages: [userMessage("hello")], vars: {} });
    expect(context.system).toContain("still here");
    expect(context.system).not.toContain("an unmounted component");
  });

  it("contributes nothing when every binding is empty or filtered out", async () => {
    const builder = new ContextBuilder({
      identity: "T.",
      contextWindow: 32_000,
      sources: [createAppStateSource([binding({ id: "x", description: "d", read: () => null, when: () => false })])],
    });
    const context = await builder.build({ messages: [userMessage("hello")], vars: {} });
    expect(context.system).toBe("Test agent.".replace("Test agent.", "T."));
  });
});

describe("createAppActionTools", () => {
  it("produces ordinary tools that mutate host state and report the outcome", async () => {
    const app = { filter: "none" };
    const [tool] = createAppActionTools([
      {
        name: "applyFilter",
        description: "Apply a filter to the list the user is viewing.",
        inputSchema: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
        run: (input) => {
          app.filter = (input as { value: string }).value;
          return { applied: app.filter, matches: 12 };
        },
      },
    ]);

    const outcome = await executeToolCall(
      { callId: "c1", name: "applyFilter", input: { value: "open" } },
      { tools: [tool!], vars: {} },
    );
    expect(app.filter).toBe("open");
    // The model must be able to OBSERVE the result, or it repeats the action.
    expect(outcome.output).toEqual({ applied: "open", matches: 12 });
  });

  it("defaults to the write tier and honours an explicit confirm side", () => {
    const tools = createAppActionTools([
      { name: "a", description: "d", inputSchema: { type: "object" }, run: () => undefined },
      { name: "b", description: "d", inputSchema: { type: "object" }, side: "confirm", run: () => undefined },
    ]);
    expect(tools[0]!.side).toBe("write");
    expect(tools[1]!.side).toBe("confirm");
  });

  it("inherits the preset security model — registered without one, they stay private", () => {
    const tools = createAppActionTools([
      { name: "deleteDocument", description: "d", inputSchema: { type: "object" }, run: () => undefined },
    ]);
    const registry = new ToolRegistry();
    registry.registerAll(tools); // no preset — the host must grant authority explicitly
    expect(registry.resolve({ presets: ["observer", "executor"] })).toEqual([]);
    registry.registerAll(tools, ["executor"]);
    expect(registry.resolve({ presets: ["executor"] }).map((t) => t.name)).toEqual(["deleteDocument"]);
    expect(registry.resolve({ presets: ["observer"] })).toEqual([]);
  });

  it("returns {ok:true} when an action reports nothing, so silence is not read as failure", async () => {
    const [tool] = createAppActionTools([
      { name: "noop", description: "d", inputSchema: { type: "object" }, run: () => undefined },
    ]);
    const outcome = await executeToolCall({ callId: "c1", name: "noop", input: {} }, { tools: [tool!], vars: {} });
    expect(outcome.output).toEqual({ ok: true });
    expect(outcome.failure).toBeUndefined();
  });
});
