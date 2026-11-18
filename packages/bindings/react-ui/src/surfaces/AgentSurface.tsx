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

export type AgentSurfaceProps = {
  surfaceId: string;
  /** Shown until the client knows this surface. */
  fallback?: SurfaceSpec;
  className?: string;
};

/** Render a surface anywhere inside `<AgentProvider>`: inline, in a panel, on a canvas. */
export function AgentSurface({ surfaceId, fallback, className }: AgentSurfaceProps) {
  const { spec, activity, setData, press, answer } = useSurface(surfaceId);
  const current = spec ?? fallback;
  if (!current) return null;
  return (
    <SurfaceView
      spec={current}
      data={current.data}
      activity={activity}
      onDataChange={setData}
      onPress={press}
      onCardAnswer={answer}
      className={className}
    />
  );
}

function SurfaceReference({ spec, placedElsewhere }: { spec: SurfaceSpec; placedElsewhere: boolean }) {
  const name = spec.title ?? "the interface";
  const label = spec.deleted ? `Removed ${name}` : placedElsewhere ? `${name} is open beside the conversation` : `Updated ${name}`;
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

function ConnectedSurfaceCard({ spec, callId }: { spec: SurfaceSpec; callId: string | undefined }) {
  const { spec: live } = useSurface(spec.surfaceId);
  const { placement } = useSurfaceHost();
  const current = live ?? spec;
  const origin = current.originCallId ?? spec.originCallId;
  if (origin && callId && callId !== origin) return <SurfaceReference spec={current} placedElsewhere={false} />;
  if (!current.deleted && placement(current) === "elsewhere") return <SurfaceReference spec={current} placedElsewhere />;
  return <AgentSurface surfaceId={spec.surfaceId} fallback={spec} />;
}

/** The `surface` card kind. */
export function SurfaceCardView({ spec, card, partial }: CardRendererProps<SurfaceSpec>) {
  const client = useOptionalAgentClient();
  if (partial || !client) return <SurfaceView spec={spec} partial={partial} />;
  return <ConnectedSurfaceCard spec={spec} callId={card.callId} />;
}
