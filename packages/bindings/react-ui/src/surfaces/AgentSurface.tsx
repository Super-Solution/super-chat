"use client";

// A surface connected to the conversation, and the card that places one in a turn.
//
// A surface exists once. The turn that created it shows it; a later turn that
// changes it shows a pointer back, because two live copies of one set of controls
// would each look like the real one.

import type { SurfaceSpec } from "@supersolutions/super-chat-core";
import { useOptionalAgentClient, useSurface } from "@supersolutions/super-chat-react";
import type { CardRendererProps } from "../renderer-registry.js";
import { SurfaceView, useSurfaceHost } from "./SurfaceView.js";
import { useLabels } from "../labels.js";

export type AgentSurfaceProps = {
  surfaceId: string;
  /** Shown until the client knows this surface. */
  fallback?: SurfaceSpec;
  /**
   * The surface as it streams in, before the client knows it. Passing it here
   * keeps one view from the first part to the finished interface, so nothing is
   * drawn twice.
   */
  streaming?: SurfaceSpec;
  className?: string;
};

/** Render a surface anywhere inside `<AgentProvider>`: inline, in a panel, on a canvas. */
export function AgentSurface({ surfaceId, fallback, streaming, className }: AgentSurfaceProps) {
  const { spec, activity, setData, press, answer } = useSurface(surfaceId);
  const current = spec ?? streaming ?? fallback;
  if (!current) return null;
  const partial = !spec && current === streaming;
  return (
    <SurfaceView
      spec={current}
      data={partial ? undefined : current.data}
      activity={partial ? undefined : activity}
      partial={partial}
      onDataChange={partial ? undefined : setData}
      onPress={partial ? undefined : press}
      onCardAnswer={partial ? undefined : answer}
      className={className}
    />
  );
}

function SurfaceReference({ spec, placedElsewhere }: { spec: SurfaceSpec; placedElsewhere: boolean }) {
  const labels = useLabels();
  const name = spec.title ?? labels.surfaceFallbackName;
  const label = spec.deleted ? labels.surfaceRemoved(name) : placedElsewhere ? labels.surfaceBeside(name) : labels.surfaceUpdated(name);
  const show = () => {
    const target = document.querySelector<HTMLElement>(`[data-surface-id="${CSS.escape(spec.surfaceId)}"]`);
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  };
  return (
    <div className="sc-surface-reference">
      <span>{label}</span>
      {spec.deleted ? null : (
        <button type="button" className="sc-btn sc-btn--ghost sc-btn--sm" onClick={show}>
          Show
        </button>
      )}
    </div>
  );
}

function ConnectedSurfaceCard({ spec, callId, partial }: { spec: SurfaceSpec; callId: string | undefined; partial: boolean }) {
  const { spec: live } = useSurface(spec.surfaceId);
  const { placement } = useSurfaceHost();
  const current = live ?? spec;
  const origin = current.originCallId ?? spec.originCallId;
  if (!partial && origin && callId && callId !== origin) return <SurfaceReference spec={current} placedElsewhere={false} />;
  if (!partial && !current.deleted && placement(current) === "elsewhere") return <SurfaceReference spec={current} placedElsewhere />;
  // The same view while the card streams and once it is final, so it is never redrawn from scratch.
  return <AgentSurface surfaceId={spec.surfaceId} {...(partial ? { streaming: spec } : { fallback: spec })} />;
}

/** The `surface` card kind. */
export function SurfaceCardView({ spec, card, partial }: CardRendererProps<SurfaceSpec>) {
  const client = useOptionalAgentClient();
  if (!client) return <SurfaceView spec={spec} partial={partial} />;
  return <ConnectedSurfaceCard spec={spec} callId={card.callId} partial={Boolean(partial)} />;
}
