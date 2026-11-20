import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CardRegistry, BUILTIN_CARDS, ToolRegistry, executeToolCall, type ToolDefinition } from "@supersolutions/super-chat-core";
import { EDITOR_CARD_KIND, editorCardKind, type CardMountHandle, type ChatPlugin } from "@supersolutions/super-protocol";
import { MountController, PluginCardFallback, PluginInstallError, installChatPlugin, pluginRenderers } from "./index.js";

const manifest = {
  manifestVersion: 0 as const,
  name: "@supersolutions/super-editor-chat-plugin",
  version: "0.1.0",
  license: "GPL-3.0-or-later",
  capabilities: [{ id: "editor.document", surface: "card" as const, cardKind: EDITOR_CARD_KIND }],
};
const handle = (): CardMountHandle & { update: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> } => ({ update: vi.fn(), destroy: vi.fn() });
const plugin = (mount = () => handle()): ChatPlugin => ({ manifest, cardKinds: [editorCardKind], mounts: { [EDITOR_CARD_KIND]: mount } });
const container = {} as HTMLElement;
const ctx = { theme: "light" as const };

describe("installChatPlugin", () => {
  it("registers the plugin's card kinds and validates through the registry", () => {
    const registry = new CardRegistry(BUILTIN_CARDS);
    installChatPlugin(registry, plugin());
    expect(registry.has(EDITOR_CARD_KIND)).toBe(true);
    expect(registry.validate({ kind: EDITOR_CARD_KIND, service: { baseUrl: "https://e.example.com", documentId: "d" } })).toEqual({ ok: true });
    expect(registry.validate({ kind: EDITOR_CARD_KIND }).ok).toBe(false);
    expect(registry.describe()).toContain(EDITOR_CARD_KIND);
  });
  it("refuses a plugin whose manifest is not fully implemented", () => {
    const registry = new CardRegistry(BUILTIN_CARDS);
    expect(() => installChatPlugin(registry, { manifest })).toThrow(PluginInstallError);
    expect(registry.has(EDITOR_CARD_KIND)).toBe(false);
  });
  it("never replaces an existing kind", () => {
    const registry = new CardRegistry(BUILTIN_CARDS);
    installChatPlugin(registry, plugin());
    expect(() => installChatPlugin(registry, plugin())).toThrow(/already registered/);
    const hijack: ChatPlugin = { manifest: { ...manifest, capabilities: [{ id: "x.table", surface: "card", cardKind: "table" }] }, cardKinds: [{ ...editorCardKind, kind: "table" }], mounts: { table: () => handle() } };
    expect(() => installChatPlugin(registry, hijack)).toThrow(/"table" is already registered/);
  });
});

describe("MountController", () => {
  it("mounts once, forwards updates and destroys exactly once", () => {
    const h = handle();
    const mount = vi.fn(() => h);
    const c = new MountController(mount);
    c.attach(container, { a: 1 }, ctx);
    c.update({ a: 2 }, { theme: "dark" });
    c.detach();
    c.detach();
    expect(mount).toHaveBeenCalledOnce();
    expect(h.update).toHaveBeenCalledWith({ a: 2 }, { theme: "dark" });
    expect(h.destroy).toHaveBeenCalledOnce();
    expect(c.attached).toBe(false);
  });
  it("destroys the previous mount when re-attached", () => {
    const handles: ReturnType<typeof handle>[] = [];
    const c = new MountController(() => { const h = handle(); handles.push(h); return h; });
    c.attach(container, {}, ctx);
    c.attach(container, {}, ctx);
    expect(handles[0]!.destroy).toHaveBeenCalledOnce();
    expect(handles[1]!.destroy).not.toHaveBeenCalled();
  });
  it("contains errors from mount, update and destroy", () => {
    const errors: unknown[] = [];
    const bad = new MountController(() => { throw new Error("mount"); }, (e) => errors.push(e));
    bad.attach(container, {}, ctx);
    bad.update({}, ctx);
    const h = handle();
    h.update.mockImplementation(() => { throw new Error("update"); });
    h.destroy.mockImplementation(() => { throw new Error("destroy"); });
    const c = new MountController(() => h, (e) => errors.push(e));
    c.attach(container, {}, ctx);
    c.update({}, ctx);
    c.detach();
    expect(errors.map((e) => (e as Error).message)).toEqual(["mount", "update", "destroy"]);
  });
});

describe("pluginRenderers", () => {
  it("creates a renderer per mounted card kind that renders a mount container", () => {
    const renderers = pluginRenderers([plugin()]);
    expect(Object.keys(renderers)).toEqual([EDITOR_CARD_KIND]);
    const Renderer = renderers[EDITOR_CARD_KIND]! as unknown as ComponentType<Record<string, unknown>>;
    const spec = { kind: EDITOR_CARD_KIND, service: { baseUrl: "https://e.example.com", documentId: "d" } };
    const html = renderToString(createElement(Renderer, { spec, card: { id: "c", spec } }));
    expect(html).toContain('class="sc-plugin-card"');
  });
  it("still accepts a plain plugin list, and takes an error handler", () => {
    const onCardError = vi.fn();
    const renderers = pluginRenderers([plugin()], { onCardError });
    expect(Object.keys(renderers)).toEqual([EDITOR_CARD_KIND]);
  });
});

describe("PluginCardFallback", () => {
  it("shows the card's own text description, never the error", () => {
    const html = renderToString(
      createElement(PluginCardFallback, { spec: { kind: "super.plot", title: "Weekly signups", alt: "Signups rose from 120 to 310 over six weeks." } }),
    );
    expect(html).toContain("Weekly signups");
    expect(html).toContain("Signups rose from 120 to 310 over six weeks.");
    expect(html).not.toContain("sc-card--error");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/Error|mount|spec\./);
  });
  it("says the card is missing when there is no description", () => {
    expect(renderToString(createElement(PluginCardFallback, { spec: { kind: "x.card", alt: "  " } }))).toContain("This card couldn’t load.");
    expect(renderToString(createElement(PluginCardFallback, { spec: { kind: "x.card", title: "Map" } }))).toContain("“Map” couldn’t load.");
  });
});

describe("plugin tools", () => {
  const tool = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: `Runs ${name}`, inputSchema: { type: "object" }, run: vi.fn(async () => ({ ran: name })), ...extra });
  const withTools = (tools: ReturnType<typeof tool>[], declared = tools.map((t) => t.name)): ChatPlugin =>
    ({
      manifest: { ...manifest, capabilities: [manifest.capabilities[0]!, ...declared.map((n, i) => ({ id: `x.tool-${i}`, surface: "tool" as const, toolName: n }))] },
      cardKinds: [editorCardKind],
      mounts: { [EDITOR_CARD_KIND]: () => handle() },
      tools,
    }) as unknown as ChatPlugin;
  const install = (plugin: ChatPlugin) => {
    const tools = new ToolRegistry();
    return { tools, report: installChatPlugin(new CardRegistry(BUILTIN_CARDS), plugin, { tools }) };
  };
  const run = (def: ToolDefinition, requestCard?: (spec: unknown) => Promise<unknown>) =>
    executeToolCall({ callId: "c1", name: def.name, input: { a: 1 } }, { tools: [def], vars: {}, ...(requestCard ? { requestCard: (_id: string, spec: unknown) => requestCard(spec) } : {}) } as never);

  it("puts each authority only in the presets that allow it", () => {
    const { tools, report } = install(withTools([tool("r", { authority: "read" }), tool("d", { authority: "draft" }), tool("a", { authority: "act" })]));
    expect(report.tools).toEqual(["r", "d", "a"]);
    expect(report.refusedTools).toEqual([]);
    expect(tools.namesInPreset("observer")).toEqual(["r"]);
    expect(tools.namesInPreset("draft")).toEqual(["d", "r"]);
    expect(tools.namesInPreset("executor")).toEqual(["a", "d", "r"]);
    expect(tools.get("r")?.side).toBe("read");
    expect(tools.get("a")?.side).toBe("write");
  });

  it.each([
    ["no authority", {}, "undeclared-authority"],
    ["an unknown authority", { authority: "admin" }, "undeclared-authority"],
    ["an inherited property name", { authority: "toString" }, "undeclared-authority"],
    ["a non-string authority", { authority: 1 }, "undeclared-authority"],
    ["a non-boolean confirm", { authority: "read", confirm: "yes" }, "invalid-confirm"],
    ["a non-object schema", { authority: "read", inputSchema: { type: "string" } }, "invalid-schema"],
  ])("keeps a tool with %s out of every preset", (_label, extra, reason) => {
    const { tools, report } = install(withTools([tool("t", extra)]));
    expect(report.refusedTools).toEqual([{ name: "t", reason }]);
    expect(tools.has("t")).toBe(false);
    expect(tools.resolve({ presets: ["observer", "draft", "executor"], allow: ["t"] })).toEqual([]);
  });

  it("refuses a tool the manifest does not declare, and an invalid name", () => {
    expect(install(withTools([tool("t", { authority: "read" })], [])).report.refusedTools).toEqual([{ name: "t", reason: "not-in-manifest" }]);
    expect(install(withTools([tool("a b", { authority: "read" })])).report.refusedTools).toEqual([{ name: "a b", reason: "invalid-name" }]);
  });

  it("installs cards but no tools when no tool registry is given", () => {
    const cards = new CardRegistry(BUILTIN_CARDS);
    const report = installChatPlugin(cards, withTools([tool("t", { authority: "read" })]));
    expect(cards.has(EDITOR_CARD_KIND)).toBe(true);
    expect(report.tools).toEqual([]);
    expect(report.refusedTools).toEqual([{ name: "t", reason: "no-tool-registry" }]);
  });

  it("never replaces a tool, and a collision installs nothing", () => {
    const tools = new ToolRegistry();
    const existing = { name: "t", description: "host", inputSchema: { type: "object" } } as ToolDefinition;
    tools.register(existing, ["observer"]);
    const cards = new CardRegistry(BUILTIN_CARDS);
    expect(() => installChatPlugin(cards, withTools([tool("t", { authority: "read" })]), { tools })).toThrow(/tool "t" is already registered/);
    expect(tools.get("t")).toBe(existing);
    expect(cards.has(EDITOR_CARD_KIND)).toBe(false);
  });

  it("runs a tool and passes the abort signal without claiming confirmation", async () => {
    const t = tool("r", { authority: "read" });
    const { tools } = install(withTools([t]));
    expect((await run(tools.get("r")!)).output).toEqual({ ran: "r" });
    expect(t.run.mock.calls[0]).toEqual([{ a: 1 }, {}]);
  });

  it("reports a tool that throws as a failed call", async () => {
    const { tools } = install(withTools([tool("r", { authority: "read", run: async () => { throw new Error("no chart"); } })]));
    const outcome = await run(tools.get("r")!);
    expect(outcome.failure).toBe("execution-error");
    expect(outcome.output).toMatchObject({ error: "no chart" });
  });

  describe("confirm", () => {
    const setup = () => {
      const t = tool("a", { authority: "act", confirm: true });
      return { t, def: install(withTools([t])).tools.get("a")! };
    };
    it("asks first and tells the plugin the user agreed", async () => {
      const { t, def } = setup();
      const ask = vi.fn(async () => ({ confirmed: true }));
      expect(def.side).toBe("confirm");
      expect((await run(def, ask)).output).toEqual({ ran: "a" });
      // Once: the plugin host asks, and the runtime's own check must not ask again.
      expect(ask).toHaveBeenCalledOnce();
      expect((ask.mock.calls[0] as unknown[])[0]).toMatchObject({ kind: "confirm", title: "Allow a?" });
      expect(t.run.mock.calls[0]).toEqual([{ a: 1 }, { confirmed: true }]);
    });
    it.each([
      ["declines", { cancelled: true, reason: "The user declined." }],
      ["answers without agreeing", { confirmed: false }],
      ["answers nothing", undefined],
      ["answers with a truthy non-boolean", { confirmed: "true" }],
    ])("does not run when the user %s", async (_label, answer) => {
      const { t, def } = setup();
      const outcome = await run(def, async () => answer);
      expect(outcome.failure).toBe("denied");
      expect(t.run).not.toHaveBeenCalled();
    });
    it("does not run when the host cannot ask", async () => {
      const { t, def } = setup();
      expect((await run(def)).failure).toBe("denied");
      expect(t.run).not.toHaveBeenCalled();
    });
  });

  it("reports the surfaces this host does not render", () => {
    const plugin = withTools([]);
    plugin.manifest.capabilities.push({ id: "x.side", surface: "panel" }, { id: "x.board", surface: "canvas" });
    expect(install(plugin).report.unsupportedSurfaces).toEqual([{ id: "x.side", surface: "panel" }, { id: "x.board", surface: "canvas" }]);
  });
});
