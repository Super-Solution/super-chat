"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CardRendererMap, CardRendererProps } from "@supersolutions/super-chat-ui";
import type { CardMount, CardMountContext, ChatPlugin } from "@supersolutions/super-protocol";
import { MountController } from "./controller.js";
import type { HostCardContext, HostTheme, ThemeToken } from "./protocol-next.js";

function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const TOKEN_SOURCES: readonly (readonly [ThemeToken, string])[] = [
  ["background", "--sc-bg"],
  ["surface", "--sc-surface"],
  ["surface-raised", "--sc-surface-2"],
  ["border", "--sc-border"],
  ["text", "--sc-text"],
  ["text-muted", "--sc-text-muted"],
  ["accent", "--sc-accent"],
  ["accent-contrast", "--sc-accent-contrast"],
  ["positive", "--sc-positive"],
  ["negative", "--sc-negative"],
  ["warning", "--sc-warning"],
  ["info", "--sc-info"],
  ["font-sans", "--sc-sans"],
  ["font-mono", "--sc-mono"],
  ["radius", "--sc-radius"],
];

/** The Super Chat theme where `element` sits, in the shared token names plugins understand. */
export function readChatTheme(element: Element): HostTheme {
  const style = getComputedStyle(element);
  const tokens: HostTheme["tokens"] = {};
  for (const [token, variable] of TOKEN_SOURCES) {
    const value = style.getPropertyValue(variable).trim();
    if (value) tokens[token] = value;
  }
  return { mode: currentTheme(), tokens };
}

/** Calls `onChange` when the page switches theme, by attribute or by system preference. */
function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

/** Renders one plugin card by mounting the plugin's framework-neutral `CardMount` into a div. */
export function PluginCard({ mount, props }: { mount: CardMount; props: CardRendererProps }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const controller = useMemo(() => new MountController(mount, (e) => setError(e instanceof Error ? e.message : String(e))), [mount]);
  const { spec, card, partial, answered, respond } = props;
  const context = (): CardMountContext => ({
    theme: currentTheme(),
    ...(ref.current ? ({ hostTheme: readChatTheme(ref.current) } satisfies Partial<HostCardContext>) : {}),
    ...(partial ? { partial: true } : {}),
    ...(respond && !answered
      ? { respond: (action) => respond({ ...action, kind: spec.kind, cardId: card.id, ...(card.callId ? { callId: card.callId } : {}) }) }
      : {}),
  });

  useEffect(() => {
    if (ref.current) controller.attach(ref.current, spec, context());
    return () => controller.detach();
    // The mount is created once per controller; later changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  useEffect(() => {
    controller.update(spec, context());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, spec, partial, answered]);

  const latest = useRef(context);
  latest.current = context;
  useEffect(() => watchTheme(() => controller.update(spec, latest.current())), [controller, spec]);

  if (error) {
    return (
      <div className="sc-card sc-card--error" role="alert">
        <strong>This card couldn’t render.</strong>
        <div className="sc-muted sc-mono">{error}</div>
      </div>
    );
  }
  return <div ref={ref} className="sc-plugin-card" />;
}

/** Builds the renderer map for `CardRendererProvider` from the plugins' card mounts. */
export function pluginRenderers(plugins: readonly ChatPlugin[]): CardRendererMap {
  const map: CardRendererMap = {};
  for (const plugin of plugins) {
    for (const [kind, mount] of Object.entries(plugin.mounts ?? {})) {
      const Renderer = (props: CardRendererProps) => <PluginCard mount={mount} props={props} />;
      Renderer.displayName = `PluginCard(${kind})`;
      map[kind] = Renderer as CardRendererMap[string];
    }
  }
  return map;
}
