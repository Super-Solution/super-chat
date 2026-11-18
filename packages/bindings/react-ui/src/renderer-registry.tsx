"use client";

// The renderer half of the card system.
//
// `CardRenderer` looks a kind up in this registry. The unknown-kind path is a
// readable fallback, never a silent drop — a card that renders as raw JSON is a
// bug you can see, whereas a card that vanishes is a bug you find in a support
// ticket three weeks later.

import {
  Component,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { BUILTIN_CARDS, CardRegistry, SURFACE_CARD_KIND, type Card, type CardAction, type CardSpec, type ToolLoadingHint } from "@supersolutions/super-chat-core";
import { useOptionalAgentClient } from "@supersolutions/super-chat-react";

export type CardRendererProps<S extends CardSpec = CardSpec> = {
  spec: S;
  card: Card;
  /** Present for interactive cards; absent means the card is read-only. */
  respond?: (action: Omit<CardAction, "at">) => void;
  /** True once the card has been answered — controls disable it. */
  answered?: boolean;
  /**
   * The spec is still streaming in: valid, but more is coming. Renderers
   * should hide what would act on the incomplete data (copy, download, sort)
   * and show the rest as it lands. Never set for an interactive card.
   */
  partial?: boolean;
};

/** What a host that names no registry gets: the built-in kinds. */
const DEFAULT_REGISTRY = new CardRegistry(BUILTIN_CARDS);
const BUILTIN_INTERACTIVE: ReadonlySet<string> = new Set(BUILTIN_CARDS.filter((c) => c.interactive).map((c) => c.kind));

const CardRegistryContext = createContext<CardRegistry | null>(null);

/** The registry in force: the nearest provider's, then the client's, then the built-ins. */
export function useCardRegistry(): CardRegistry {
  const provided = useContext(CardRegistryContext);
  const client = useOptionalAgentClient();
  return provided ?? client?.getConfig().cards ?? DEFAULT_REGISTRY;
}

/**
 * Whether a kind asks the user something, as its registration says, so a plugin's
 * interactive kind behaves like a built-in one. Built-in kinds count even under a
 * registry that omits them: a partial spec must never put a half-received question
 * in front of the user, whichever registry a host happened to pass.
 */
export function useInteractiveKinds(): (kind: string | undefined) => boolean {
  const registry = useCardRegistry();
  return useMemo(() => (kind) => Boolean(kind) && (BUILTIN_INTERACTIVE.has(kind!) || registry.isInteractive(kind!)), [registry]);
}

export type CardRendererMap = Record<string, ComponentType<CardRendererProps<never>>>;

const RendererContext = createContext<CardRendererMap>({});

export function CardRendererProvider({
  renderers,
  registry,
  children,
}: {
  renderers: CardRendererMap;
  /** The registry these kinds were registered in. Defaults to the client's. */
  registry?: CardRegistry;
  children: ReactNode;
}) {
  const inherited = useContext(RendererContext);
  const value = useMemo(() => ({ ...inherited, ...renderers }), [inherited, renderers]);
  const tree = <RendererContext.Provider value={value}>{children}</RendererContext.Provider>;
  return registry ? <CardRegistryContext.Provider value={registry}>{tree}</CardRegistryContext.Provider> : tree;
}

export function useCardRenderers(): CardRendererMap {
  return useContext(RendererContext);
}

/**
 * Isolates a render failure to one card.
 *
 * A malformed payload, a degenerate chart, a card component that throws — any
 * of them would otherwise blank the whole thread. Here the rest of the
 * conversation keeps rendering and the failure is stated inline.
 */
export class CardBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean; message?: string }> {
  override state = { failed: false, message: undefined as string | undefined };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="sc-card sc-card--error" role="alert">
          <strong>{this.props.label ?? "This card"} couldn’t render.</strong>
          {this.state.message ? <div className="sc-muted sc-mono">{this.state.message}</div> : null}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Placeholder for a card whose data has not arrived.
 *
 * Deliberately delayed: a skeleton that appears for 80ms and vanishes is worse
 * than no skeleton at all, so it waits before showing itself. Hosts render this
 * directly — a card with no spec yet has no kind to dispatch on.
 */
export type CardSkeletonProps = {
  lines?: number;
  hint?: ToolLoadingHint;
  /** Primarily useful in a component catalogue; live output should keep the anti-flicker default. */
  delayMs?: number;
};

export function CardSkeleton({ lines = 2, hint, delayMs = 200 }: CardSkeletonProps) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  if (!show) return null;
  const kind = hint?.kind ?? "generic";
  const label = hint?.label ?? "Preparing result";
  const count = Math.max(1, Math.min(10, hint?.count ?? 1));
  const bodyLines = kind === "document" ? Math.max(lines, 4) : lines;
  const style = hint?.aspectRatio
    ? ({ "--sc-skeleton-ratio": hint.aspectRatio } as CSSProperties)
    : undefined;

  return (
    <div className={`sc-card sc-skeleton sc-skeleton--${kind}`} style={style} role="status" aria-busy="true" aria-live="polite">
      <div className="sc-skeleton__label">
        <span className="sc-spinner" aria-hidden />
        <span>{label}…</span>
      </div>
      {kind === "media" ? (
        <div className={`sc-skeleton__media${count === 1 ? " sc-skeleton__media--single" : ""}`} aria-hidden>
          {Array.from({ length: count }, (_, i) => <div key={i} className="sc-skeleton__surface sc-skeleton__mediaitem" />)}
        </div>
      ) : kind === "chart" ? (
        <div className="sc-skeleton__surface sc-skeleton__chart" aria-hidden>
          <span style={{ height: "34%" }} /><span style={{ height: "62%" }} /><span style={{ height: "48%" }} /><span style={{ height: "78%" }} /><span style={{ height: "57%" }} />
        </div>
      ) : kind === "table" ? (
        <div className="sc-skeleton__table" aria-hidden>
          {Array.from({ length: 4 }, (_, row) => (
            <div key={row} className="sc-skeleton__tablerow">
              <span className="sc-skeleton__surface" />
              <span className="sc-skeleton__surface" />
              <span className="sc-skeleton__surface" />
            </div>
          ))}
        </div>
      ) : (
        <div className="sc-skeleton__body" aria-hidden>
          <div className="sc-skeleton__bar sc-skeleton__bar--title" />
          {Array.from({ length: bodyLines }, (_, i) => (
            <div key={i} className="sc-skeleton__bar" style={i === bodyLines - 1 ? { width: "72%" } : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CardRenderer({
  card,
  respond,
  answered,
  partial,
}: {
  card: Card;
  respond?: CardRendererProps["respond"];
  answered?: boolean;
  partial?: boolean;
}) {
  const renderers = useCardRenderers();
  const isInteractive = useInteractiveKinds();
  const kind = (card.spec as { kind?: string }).kind ?? "unknown";

  if (partial && isInteractive(kind)) return null;

  if (card.expired) {
    // Large card payloads are trimmed out of persisted history. Say so — an
    // empty shell reads as a broken app.
    return (
      <div className="sc-card sc-card--muted">
        <div className="sc-muted">
          {kind === SURFACE_CARD_KIND
            ? "This interface expired from saved history. Ask the agent to rebuild it."
            : `This ${kind} result expired from saved history. Ask again to refresh it.`}
        </div>
      </div>
    );
  }

  const Renderer = renderers[kind];
  if (!Renderer) {
    // The raw-JSON fallback is for a finished card; a half-received one stays
    // a skeleton's business.
    if (partial) return null;
    return (
      <div className="sc-card sc-card--muted">
        <div className="sc-card__head">
          <span className="sc-pill sc-pill--warning">unrendered</span>
          <span className="sc-muted">No renderer registered for card kind “{kind}”.</span>
        </div>
        <pre className="sc-pre">{JSON.stringify(card.spec, null, 2)}</pre>
      </div>
    );
  }

  if (partial) {
    // No `respond`: nothing on a card that is still arriving may be acted on.
    return (
      <CardBoundary label={`The ${kind} card`}>
        <Renderer spec={card.spec as never} card={card} partial />
      </CardBoundary>
    );
  }

  return (
    <CardBoundary label={`The ${kind} card`}>
      <Renderer spec={card.spec as never} card={card} respond={respond} answered={answered} />
    </CardBoundary>
  );
}
