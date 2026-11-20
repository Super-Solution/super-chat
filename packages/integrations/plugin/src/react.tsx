"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CardRendererMap, CardRendererProps } from "@supersolutions/super-chat-ui";
import type { CardMount, CardMountContext, ChatPlugin, HostTheme, ThemeToken } from "@supersolutions/super-protocol";
import { MountController } from "./controller.js";
import { registerCardRefTarget } from "./refs.js";

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

/** Called when a plugin card fails to mount, update or unmount. */
export type PluginCardErrorHandler = (error: unknown, card: { kind: string; cardId: string }) => void;

const logCardError: PluginCardErrorHandler = (error, card) => {
  console.error(`[super-chat] Plugin card "${card.kind}" (${card.cardId}) failed to render.`, error);
};

const textField = (spec: unknown, key: "alt" | "title"): string | undefined => {
  const value = spec && typeof spec === "object" ? (spec as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

/**
 * What the reader sees when a plugin card cannot render. The error itself goes to the
 * developer through `onCardError`; the reader gets the card's own `alt` text when the spec
 * has one (`super.plot` requires it), never a stack trace or a validator message.
 */
export function PluginCardFallback({ spec }: { spec: unknown }) {
  const alt = textField(spec, "alt");
  const title = textField(spec, "title");
  if (alt) {
    return (
      <figure className="sc-card sc-card--fallback">
        {title ? <figcaption className="sc-card__title">{title}</figcaption> : null}
        <p className="sc-card__alt">{alt}</p>
        <p className="sc-muted sc-card__footnote">Shown as text because this card couldn’t load.</p>
      </figure>
    );
  }
  return (
    <div className="sc-card sc-card--fallback" role="note">
      <strong>{title ? `“${title}” couldn’t load.` : "This card couldn’t load."}</strong>
    </div>
  );
}

/** Renders one plugin card by mounting the plugin's framework-neutral `CardMount` into a div. */
export function PluginCard({ mount, props, onCardError = logCardError }: { mount: CardMount; props: CardRendererProps; onCardError?: PluginCardErrorHandler }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Read on error, so the controller can live as long as the mount.
  const report = useRef({ onCardError, kind: String(props.spec.kind), cardId: props.card.id });
  report.current = { onCardError, kind: String(props.spec.kind), cardId: props.card.id };
  const controller = useMemo(
    () =>
      new MountController(mount, (error) => {
        setFailed(true);
        const { onCardError: handle, kind, cardId } = report.current;
        handle(error, { kind, cardId });
      }),
    [mount],
  );
  const { spec, card, partial, answered, respond } = props;
  // A reference names a card by its spec's `id`, or failing that the envelope's.
  const specId = (spec as { id?: unknown }).id;
  const refId = typeof specId === "string" ? specId : "";
  const context = (): CardMountContext => ({
    theme: currentTheme(),
    ...(ref.current ? ({ hostTheme: readChatTheme(ref.current) } satisfies Partial<CardMountContext>) : {}),
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

  useEffect(() => registerCardRefTarget([refId, card.id], controller), [controller, refId, card.id]);

  useEffect(() => {
    controller.update(spec, context());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, spec, partial, answered]);

  const latest = useRef(context);
  latest.current = context;
  useEffect(() => watchTheme(() => controller.update(spec, latest.current())), [controller, spec]);

  if (failed) return <PluginCardFallback spec={spec} />;
  return <div ref={ref} className="sc-plugin-card" />;
}

export type PluginRenderersOptions = {
  /** Receives every plugin card failure. Defaults to `console.error`; readers never see the error. */
  onCardError?: PluginCardErrorHandler;
};

/** Builds the renderer map for `CardRendererProvider` from the plugins' card mounts. */
export function pluginRenderers(plugins: readonly ChatPlugin[], options: PluginRenderersOptions = {}): CardRendererMap {
  const map: CardRendererMap = {};
  for (const plugin of plugins) {
    for (const [kind, mount] of Object.entries(plugin.mounts ?? {})) {
      const Renderer = (props: CardRendererProps) => <PluginCard mount={mount} props={props} {...(options.onCardError ? { onCardError: options.onCardError } : {})} />;
      Renderer.displayName = `PluginCard(${kind})`;
      map[kind] = Renderer as CardRendererMap[string];
    }
  }
  return map;
}
