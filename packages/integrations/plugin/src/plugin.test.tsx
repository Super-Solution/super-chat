import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CardRegistry, BUILTIN_CARDS } from "@supersolutions/super-chat-core";
import { EDITOR_CARD_KIND, editorCardKind, type CardMountHandle, type ChatPlugin } from "@supersolutions/super-protocol";
import { MountController, PluginInstallError, installChatPlugin, pluginRenderers } from "./index.js";

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
});
