"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CardRendererMap, CardRendererProps } from "@supersolutions/super-chat-ui";
import type { CardMount, CardMountContext, ChatPlugin } from "@supersolutions/super-protocol";
import { MountController } from "./controller.js";

function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Renders one plugin card by mounting the plugin's framework-neutral `CardMount` into a div. */
export function PluginCard({ mount, props }: { mount: CardMount; props: CardRendererProps }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const controller = useMemo(() => new MountController(mount, (e) => setError(e instanceof Error ? e.message : String(e))), [mount]);
  const { spec, card, partial, answered, respond } = props;
  const context = (): CardMountContext => ({
    theme: currentTheme(),
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
