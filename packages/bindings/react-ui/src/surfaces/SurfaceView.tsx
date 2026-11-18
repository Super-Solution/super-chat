"use client";

// The surface renderer.
//
// Everything on screen comes from a closed set of components with enumerated
// props. Text goes through React's escaping, class names are chosen here from
// validated enums, and URLs are checked again at the element that uses them. A spec
// has no way to reach innerHTML, style or an event handler.

import {
  Component,
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  SURFACE_LIMITS,
  SurfaceCatalogue,
  evaluateSurfaceCondition,
  findUnsafe,
  getAt,
  resolveSurfaceAction,
  resolveSurfaceValue,
  safeSurfaceUrl,
  sanitizeSurfaceSpec,
  setAt,
  type BindingScope,
  type Card,
  type CardAction,
  type CardValueFormat,
  type SurfaceAction,
  type SurfaceActivity,
  type SurfaceCardAnswer,
  type SurfaceComponent,
  type SurfaceCondition,
  type SurfaceIssue,
  type SurfaceSpec,
} from "@supersolutions/super-chat-core";
import { useOptionalAgentClient } from "@supersolutions/super-chat-react";
import { formatDelta, formatValue, toneClass, deltaTone } from "@supersolutions/super-chat-ui-core";
import { CardRenderer, useCardRegistry, useInteractiveKinds } from "../renderer-registry.js";

export type SurfacePlacement = "inline" | "elsewhere";

export type SurfaceCustomRendererProps = {
  component: SurfaceComponent;
  /** Props with every binding resolved. */
  props: Record<string, unknown>;
  /** Rendered children, for a component that declares slots. */
  children: ReactNode;
  /** True while the spec is still streaming: nothing may be acted on yet. */
  partial: boolean;
};
export type SurfaceCustomRenderer = ComponentType<SurfaceCustomRendererProps>;

type SurfaceHost = {
  catalogue?: SurfaceCatalogue;
  components: Record<string, SurfaceCustomRenderer>;
  placement: (spec: SurfaceSpec) => SurfacePlacement;
};

const HostContext = createContext<SurfaceHost>({ components: {}, placement: () => "inline" });
export const useSurfaceHost = () => useContext(HostContext);

export type SurfaceHostProviderProps = {
  /** Validate against this catalogue. Needed when it holds host components. */
  catalogue?: SurfaceCatalogue;
  /** Renderers for host components, by catalogue name. */
  components?: Record<string, SurfaceCustomRenderer>;
  /** Return "elsewhere" to show a surface in your own panel with `<AgentSurface>`. */
  placement?: (spec: SurfaceSpec) => SurfacePlacement;
  children: ReactNode;
};

export function SurfaceHostProvider({ catalogue, components, placement, children }: SurfaceHostProviderProps) {
  const value = useMemo<SurfaceHost>(
    () => ({ catalogue, components: components ?? {}, placement: placement ?? (() => "inline") }),
    [catalogue, components, placement],
  );
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

/** The catalogue in force: the host's, then the client's, then one over the card registry. */
export function useSurfaceCatalogue(): SurfaceCatalogue {
  const host = useSurfaceHost();
  const client = useOptionalAgentClient();
  const cards = useCardRegistry();
  return useMemo(
    () => host.catalogue ?? client?.getConfig().surfaceCatalogue ?? new SurfaceCatalogue({ cards }),
    [host.catalogue, client, cards],
  );
}

/** Contains a render failure and recovers when the thing it guards changes. */
class SurfaceBoundary extends Component<{ resetKey: unknown; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidUpdate(previous: { resetKey: unknown }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render() {
    return this.state.failed ? <Fallback message="This part stopped working." /> : this.props.children;
  }
}

function Fallback({ message }: { message?: string }) {
  return (
    <div className="sc-surface-fallback" role="note">
      <span className="sc-surface-fallback__title">This part couldn’t be shown.</span>
      {message ? <span className="sc-muted">{message}</span> : null}
    </div>
  );
}

const Pending = () => <div className="sc-surface-pending" aria-hidden />;

type SurfaceContextValue = {
  surfaceId: string;
  byId: ReadonlyMap<string, SurfaceComponent>;
  issues: ReadonlyMap<string, SurfaceIssue>;
  data: Record<string, unknown>;
  partial: boolean;
  activity?: SurfaceActivity;
  write: (path: string, value: unknown) => void;
  press: (componentId: string, scope: { item?: unknown; index?: number }) => void;
  answer: (componentId: string, answer: Omit<SurfaceCardAnswer, "at">) => void;
};

const SurfaceContext = createContext<SurfaceContextValue | null>(null);
const useSurfaceContext = () => useContext(SurfaceContext)!;

type NodeProps = { component: SurfaceComponent; props: Record<string, unknown>; scope: BindingScope; trail: readonly string[] };

const gapClass = (gap: unknown) => ` sc-surface-gap--${typeof gap === "string" ? gap : "md"}`;
const asText = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const boundPath = (component: SurfaceComponent) => (component["value"] as { $path?: string } | undefined)?.$path;

function Children({ ids, scope, trail }: { ids: unknown; scope: BindingScope; trail: readonly string[] }) {
  if (!Array.isArray(ids)) return null;
  return (
    <>
      {ids.map((id: string) => (
        <SurfaceNode key={id} id={id} scope={scope} trail={trail} />
      ))}
    </>
  );
}

function Stack({ component, props, scope, trail }: NodeProps) {
  const horizontal = props["direction"] === "horizontal";
  const className = [
    "sc-surface-stack",
    horizontal ? "sc-surface-stack--row" : "",
    props["wrap"] === true ? "sc-surface-stack--wrap" : "",
    typeof props["align"] === "string" ? `sc-surface-align--${props["align"]}` : "",
    typeof props["justify"] === "string" ? `sc-surface-justify--${props["justify"]}` : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={`${className}${gapClass(props["gap"])}`}>
      <Children ids={component["children"]} scope={scope} trail={trail} />
    </div>
  );
}

function Grid({ component, props, scope, trail }: NodeProps) {
  const columns = typeof props["columns"] === "number" ? Math.min(4, Math.max(1, props["columns"])) : 2;
  return (
    <div className={`sc-surface-grid sc-surface-grid--${columns}${gapClass(props["gap"])}`}>
      <Children ids={component["children"]} scope={scope} trail={trail} />
    </div>
  );
}

function Section({ component, props, scope, trail }: NodeProps) {
  const headingId = useId();
  const title = asText(props["title"]);
  const description = asText(props["description"]);
  return (
    <section className={`sc-surface-section${toneClass(props["tone"] as string)}`} aria-labelledby={title ? headingId : undefined}>
      {title ? <h3 id={headingId} className="sc-surface-section__title">{title}</h3> : null}
      {description ? <p className="sc-surface-section__description">{description}</p> : null}
      <div className="sc-surface-stack sc-surface-gap--md">
        <Children ids={component["children"]} scope={scope} trail={trail} />
      </div>
    </section>
  );
}

function Tabs({ component, props, scope, trail }: NodeProps) {
  const ctx = useSurfaceContext();
  const baseId = useId();
  const tabs = (component["tabs"] as { id: string; label: string; child: string }[]).slice(0, SURFACE_LIMITS.tabs);
  const path = boundPath(component);
  const [local, setLocal] = useState(tabs[0]?.id);
  const requested = path ? asText(getAt(ctx.data, path)) : local;
  const active = tabs.some((t) => t.id === requested) ? requested : tabs[0]?.id;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string) => {
    if (path) ctx.write(path, id);
    else setLocal(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : -1;
    if (next < 0) return;
    event.preventDefault();
    const tab = tabs[next]!;
    select(tab.id);
    refs.current.get(tab.id)?.focus();
  };

  const current = tabs.find((t) => t.id === active);
  return (
    <div className="sc-surface-tabs">
      <div className="sc-surface-tabs__list" role="tablist" aria-label={asText(props["label"]) || undefined}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${index}`}
            aria-selected={tab.id === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab.id === active ? 0 : -1}
            className={`sc-surface-tabs__tab${tab.id === active ? " sc-surface-tabs__tab--on" : ""}`}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${Math.max(0, tabs.findIndex((t) => t.id === active))}`}
        tabIndex={0}
        className="sc-surface-tabs__panel"
      >
        {current ? <SurfaceNode id={current.child} scope={scope} trail={trail} /> : null}
      </div>
    </div>
  );
}

function List({ component, props, scope, trail }: NodeProps) {
  const rows = Array.isArray(props["items"]) ? props["items"].slice(0, SURFACE_LIMITS.listItems) : [];
  if (!rows.length) {
    const empty = asText(props["emptyText"]);
    return empty ? <p className="sc-surface-text sc-surface-text--caption">{empty}</p> : null;
  }
  return (
    <ul className={`sc-surface-list${gapClass(props["gap"])}`}>
      {rows.map((item, index) => (
        <li key={index}>
          <SurfaceNode id={component["child"] as string} scope={{ data: scope.data, item, index }} trail={trail} />
        </li>
      ))}
    </ul>
  );
}

const Divider = () => <hr className="sc-surface-divider" />;

function Text({ props }: NodeProps) {
  const variant = typeof props["variant"] === "string" ? props["variant"] : "body";
  const className = `sc-surface-text sc-surface-text--${variant}${toneClass(props["tone"] as string)}`;
  const value = asText(props["text"]);
  if (variant === "title") return <h2 className={className}>{value}</h2>;
  if (variant === "heading") return <h3 className={className}>{value}</h3>;
  if (variant === "code") return <code className={className}>{value}</code>;
  return <p className={className}>{value}</p>;
}

function Metric({ props }: NodeProps) {
  const format = props["format"] as CardValueFormat | undefined;
  const delta = typeof props["delta"] === "number" ? props["delta"] : undefined;
  return (
    <div className="sc-surface-metric">
      <span className="sc-surface-metric__label">{asText(props["label"])}</span>
      <span className={`sc-surface-metric__value${toneClass(props["tone"] as string)}`}>{formatValue(props["value"], format)}</span>
      {delta !== undefined ? (
        <span className={`sc-surface-metric__delta${toneClass(deltaTone(delta))}`}>{formatDelta(delta, props["deltaFormat"] as CardValueFormat | undefined)}</span>
      ) : null}
      {asText(props["hint"]) ? <span className="sc-surface-metric__hint">{asText(props["hint"])}</span> : null}
    </div>
  );
}

function Badge({ props }: NodeProps) {
  const tone = typeof props["tone"] === "string" && props["tone"] !== "neutral" ? ` sc-pill--${props["tone"]}` : "";
  return <span className={`sc-pill${tone}`}>{asText(props["text"])}</span>;
}

function ImageNode({ props }: NodeProps) {
  const src = safeSurfaceUrl(props["src"], "image");
  if (!src) return <Fallback message="The image address isn’t allowed." />;
  const caption = asText(props["caption"]);
  return (
    <figure className="sc-surface-figure">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={asText(props["alt"])} loading="lazy" referrerPolicy="no-referrer" />
      {caption ? <figcaption className="sc-surface-text sc-surface-text--caption">{caption}</figcaption> : null}
    </figure>
  );
}

function LinkNode({ props }: NodeProps) {
  const href = safeSurfaceUrl(props["href"], "link");
  const label = asText(props["text"]);
  if (!href) return <span className="sc-surface-text">{label}</span>;
  return <a className="sc-surface-link" href={href} target="_blank" rel="noopener noreferrer nofollow">{label}</a>;
}

function FieldShell({ id, label, helper, children }: { id: string; label: string; helper?: string; children: ReactNode }) {
  return (
    <div className="sc-field sc-surface-field">
      <label className="sc-field__label" htmlFor={id}>{label}</label>
      {children}
      {helper ? <span id={`${id}-help`} className="sc-surface-text sc-surface-text--caption">{helper}</span> : null}
    </div>
  );
}

function Field({ component, props }: NodeProps) {
  const ctx = useSurfaceContext();
  const id = useId();
  const path = boundPath(component)!;
  const type = typeof props["type"] === "string" ? props["type"] : "text";
  const stored = getAt(ctx.data, path);
  // A half-typed number ("1.") has no numeric value yet. Writing it back on every
  // keystroke would erase what the person is in the middle of typing.
  const [draft, setDraft] = useState<string | null>(null);
  const helper = asText(props["helper"]);
  const shared = {
    id,
    className: "sc-input",
    disabled: ctx.partial,
    placeholder: asText(props["placeholder"]) || undefined,
    "aria-describedby": helper ? `${id}-help` : undefined,
  };
  return (
    <FieldShell id={id} label={asText(props["label"])} helper={helper}>
      {type === "textarea" ? (
        <textarea {...shared} rows={3} value={asText(stored)} onChange={(e) => ctx.write(path, e.target.value)} />
      ) : type === "number" ? (
        <input
          {...shared}
          type="number"
          inputMode="decimal"
          min={props["min"] as number | undefined}
          max={props["max"] as number | undefined}
          step={props["step"] as number | undefined}
          value={draft ?? asText(stored)}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (raw === "") ctx.write(path, null);
            else if (Number.isFinite(Number(raw))) ctx.write(path, Number(raw));
          }}
          onBlur={() => setDraft(null)}
        />
      ) : (
        <input {...shared} type={type === "date" ? "date" : "text"} value={asText(stored)} onChange={(e) => ctx.write(path, e.target.value)} />
      )}
    </FieldShell>
  );
}

function Select({ component, props }: NodeProps) {
  const ctx = useSurfaceContext();
  const id = useId();
  const path = boundPath(component)!;
  const options = (Array.isArray(props["options"]) ? props["options"] : []) as { value: string | number | boolean; label: string }[];
  const stored = getAt(ctx.data, path);
  const index = options.findIndex((o) => String(o.value) === String(stored));
  const helper = asText(props["helper"]);
  return (
    <FieldShell id={id} label={asText(props["label"])} helper={helper}>
      <select
        id={id}
        className="sc-input"
        disabled={ctx.partial}
        value={index < 0 ? "" : String(index)}
        aria-describedby={helper ? `${id}-help` : undefined}
        // By position, so a numeric or boolean option is written back as what it was.
        onChange={(e) => {
          const option = options[Number(e.target.value)];
          if (option) ctx.write(path, option.value);
        }}
      >
        {index < 0 ? <option value="" disabled>Choose…</option> : null}
        {options.map((option, i) => (
          <option key={i} value={String(i)}>{asText(option.label)}</option>
        ))}
      </select>
    </FieldShell>
  );
}

function Toggle({ component, props }: NodeProps) {
  const ctx = useSurfaceContext();
  const id = useId();
  const path = boundPath(component)!;
  const on = getAt(ctx.data, path) === true;
  const helper = asText(props["helper"]);
  return (
    <div className="sc-surface-toggle">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="sc-surface-toggle__input"
        checked={on}
        disabled={ctx.partial}
        aria-describedby={helper ? `${id}-help` : undefined}
        onChange={(e) => ctx.write(path, e.target.checked)}
      />
      <label htmlFor={id} className="sc-surface-toggle__label">{asText(props["label"])}</label>
      {helper ? <span id={`${id}-help`} className="sc-surface-text sc-surface-text--caption sc-surface-toggle__help">{helper}</span> : null}
    </div>
  );
}

function Slider({ component, props }: NodeProps) {
  const ctx = useSurfaceContext();
  const id = useId();
  const path = boundPath(component)!;
  const min = Number(props["min"]);
  const max = Number(props["max"]);
  const stored = Number(getAt(ctx.data, path));
  const value = Number.isFinite(stored) ? stored : min;
  const shown = formatValue(value, (props["format"] as CardValueFormat | undefined) ?? "number");
  return (
    <div className="sc-field sc-surface-field">
      <div className="sc-surface-slider__head">
        <label className="sc-field__label" htmlFor={id}>{asText(props["label"])}</label>
        <output htmlFor={id} className="sc-surface-slider__value">{shown}</output>
      </div>
      <input
        id={id}
        type="range"
        className="sc-surface-slider"
        min={min}
        max={max}
        step={props["step"] as number | undefined}
        value={value}
        disabled={ctx.partial}
        aria-valuetext={shown}
        onChange={(e) => ctx.write(path, Number(e.target.value))}
      />
    </div>
  );
}

const BUTTON_VARIANTS: Record<string, string> = { primary: " sc-btn--primary", ghost: " sc-btn--ghost", danger: " sc-btn--danger" };

function Button({ component, props, scope }: NodeProps) {
  const ctx = useSurfaceContext();
  const mine = ctx.activity?.componentId === component.id ? ctx.activity.state : undefined;
  const busy = mine === "running" || mine === "queued";
  const blocked = component["disabledWhen"] ? evaluateSurfaceCondition(component["disabledWhen"] as SurfaceCondition, scope) : false;
  return (
    <button
      type="button"
      className={`sc-btn sc-surface-button${BUTTON_VARIANTS[asText(props["variant"])] ?? ""}`}
      disabled={ctx.partial || busy || blocked}
      aria-busy={busy || undefined}
      onClick={() => ctx.press(component.id, { item: scope.item, index: scope.index })}
    >
      {busy ? <span className="sc-spinner" aria-hidden /> : null}
      {asText(props["label"])}
    </button>
  );
}

function CardNode({ component, scope }: NodeProps) {
  const ctx = useSurfaceContext();
  const registry = useCardRegistry();
  const isInteractive = useInteractiveKinds();
  const kind = component["kind"] as string;
  const resolved = resolveSurfaceValue(component["spec"], scope) as Record<string, unknown>;
  // Bindings build a new object on every render. Keyed by content, so a chart
  // only redraws when what it shows has changed.
  const content = JSON.stringify(resolved);
  const spec = useMemo(() => ({ ...resolved, kind }), [content, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const verdict = useMemo(() => registry.validate(spec), [registry, spec]);

  const bind = component["bind"] as string | undefined;
  const stored = bind ? (getAt(ctx.data, bind) as SurfaceCardAnswer | undefined) : undefined;
  const cardId = `${ctx.surfaceId}:${component.id}:${scope.index ?? 0}`;
  const card = useMemo<Card>(
    () => ({
      id: cardId,
      spec,
      ...(stored ? { action: { cardId, kind, type: stored.type, value: stored.value, at: stored.at } as CardAction } : {}),
    }),
    [cardId, spec, kind, stored],
  );

  if (!verdict.ok) return ctx.partial ? <Pending /> : <Fallback message={verdict.error} />;
  if (isInteractive(kind) && !ctx.partial) {
    return (
      <CardRenderer
        card={card}
        answered={Boolean(stored)}
        respond={(action) => ctx.answer(component.id, { type: action.type, value: action.value })}
      />
    );
  }
  return <CardRenderer card={card} partial={ctx.partial} />;
}

const RENDERERS: Record<string, ComponentType<NodeProps>> = {
  Stack,
  Grid,
  Section,
  Tabs,
  List,
  Divider,
  Text,
  Metric,
  Badge,
  Image: ImageNode,
  Link: LinkNode,
  Field,
  Select,
  Toggle,
  Slider,
  Button,
  Card: CardNode,
};

/** Structure is walked, never resolved: these are ids, actions and write targets. */
const STRUCTURAL = new Set(["id", "component", "children", "child", "tabs", "action", "disabledWhen", "visibleWhen", "value", "spec"]);
const INPUTS = new Set(["Field", "Select", "Toggle", "Slider", "Tabs"]);

function resolveProps(component: SurfaceComponent, scope: BindingScope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(component)) {
    if (STRUCTURAL.has(key) && !(key === "value" && !INPUTS.has(component.component))) continue;
    out[key] = resolveSurfaceValue(value, scope);
  }
  return out;
}

function SurfaceNode({ id, scope, trail }: { id: string; scope: BindingScope; trail: readonly string[] }) {
  const ctx = useSurfaceContext();
  const { components: custom } = useSurfaceHost();
  const component = ctx.byId.get(id);
  if (!component) return ctx.partial ? <Pending /> : <Fallback message={ctx.issues.get(id)?.message} />;
  // Validation refuses cycles. This holds even if a stored spec slipped past it.
  if (trail.includes(id) || trail.length >= SURFACE_LIMITS.depth) return <Fallback />;
  if (component.visibleWhen && !evaluateSurfaceCondition(component.visibleWhen, scope)) return null;

  const nextTrail = [...trail, id];
  const props = resolveProps(component, scope);
  const Renderer = RENDERERS[component.component];
  const Custom = custom[component.component];
  return (
    <SurfaceBoundary resetKey={component}>
      {Renderer ? (
        <Renderer component={component} props={props} scope={scope} trail={nextTrail} />
      ) : Custom ? (
        <Custom component={component} props={props} partial={ctx.partial}>
          <Children ids={component["children"]} scope={scope} trail={nextTrail} />
        </Custom>
      ) : (
        <Fallback message={`No renderer is registered for ${component.component}.`} />
      )}
    </SurfaceBoundary>
  );
}

const STATUS_TONES: Partial<Record<SurfaceActivity["state"], string>> = { failed: " sc-tone--negative", refused: " sc-tone--negative" };

export type SurfaceViewProps = {
  spec: SurfaceSpec;
  /** Controlled data model. Omit and the view keeps its own. */
  data?: Record<string, unknown>;
  activity?: SurfaceActivity;
  /** The spec is still streaming: show it, but let nothing be acted on. */
  partial?: boolean;
  onDataChange?: (path: string, value: unknown) => void;
  /** Handle a press yourself. Without it, `set` runs locally and the rest go to `onAction`. */
  onPress?: (componentId: string, scope: { item?: unknown; index?: number }) => void;
  /** A `tool` or `event` action, with its bindings read, for a host running without a client. */
  onAction?: (action: Exclude<SurfaceAction, { type: "set" }>, componentId: string) => void;
  onCardAnswer?: (componentId: string, answer: Omit<SurfaceCardAnswer, "at">) => void;
  className?: string;
};

export function SurfaceView({ spec, data, activity, partial = false, onDataChange, onPress, onAction, onCardAnswer, className }: SurfaceViewProps) {
  const catalogue = useSurfaceCatalogue();
  // Validated again here: this spec may have come out of storage.
  // Not keyed on data: a keystroke changes the values, never what may be rendered.
  const clean = useMemo(() => sanitizeSurfaceSpec(spec, catalogue), [spec.components, spec.root, spec.issues, catalogue]); // eslint-disable-line react-hooks/exhaustive-deps
  const [local, setLocal] = useState(clean.data);
  useEffect(() => setLocal(findUnsafe(spec.data) ? {} : spec.data), [spec.data]);
  const current = data ?? local;

  const value = useMemo<SurfaceContextValue>(() => {
    const byId = new Map(clean.components.map((c) => [c.id, c]));
    const issues = new Map((clean.issues ?? []).flatMap((i) => (i.componentId ? [[i.componentId, i] as const] : [])));
    const write = (path: string, next: unknown) => {
      if (onDataChange) onDataChange(path, next);
      else setLocal((previous) => setAt(previous, path, next) ?? previous);
    };
    const press = (componentId: string, scope: { item?: unknown; index?: number }) => {
      if (onPress) return onPress(componentId, scope);
      const action = byId.get(componentId)?.["action"] as SurfaceAction | undefined;
      if (!action) return;
      const resolved = resolveSurfaceAction(action, { data: current, ...scope });
      if (resolved.type === "set") for (const update of resolved.updates) write(update.path, update.value);
      else onAction?.(resolved, componentId);
    };
    const answer = (componentId: string, next: Omit<SurfaceCardAnswer, "at">) => {
      if (onCardAnswer) return onCardAnswer(componentId, next);
      const bind = byId.get(componentId)?.["bind"];
      if (typeof bind === "string") write(bind, { ...next, at: Date.now() });
    };
    return { surfaceId: clean.surfaceId, byId, issues, data: current, partial, activity, write, press, answer };
  }, [clean, current, partial, activity, onDataChange, onPress, onAction, onCardAnswer]);

  if (spec.deleted) return <div className="sc-card sc-card--muted"><div className="sc-muted">{spec.title ? `“${spec.title}” was removed.` : "This interface was removed."}</div></div>;
  if (spec.expired) return <div className="sc-card sc-card--muted"><div className="sc-muted">This interface expired from saved history. Ask the agent to rebuild it.</div></div>;

  const rootScope: BindingScope = { data: current };
  const status = activity?.message;
  return (
    <div
      className={`sc-surface${className ? ` ${className}` : ""}`}
      data-surface-id={clean.surfaceId}
      role="group"
      aria-label={clean.title ?? "Interface from the agent"}
      aria-busy={partial || undefined}
      tabIndex={-1}
    >
      <SurfaceContext.Provider value={value}>
        <div className="sc-surface__body">
          {clean.title ? <div className="sc-surface__title">{clean.title}</div> : null}
          <SurfaceBoundary resetKey={clean}>
            <SurfaceNode id={clean.root} scope={rootScope} trail={[]} />
          </SurfaceBoundary>
          <div className={`sc-surface__status${activity ? STATUS_TONES[activity.state] ?? "" : ""}`} role="status" aria-live="polite">
            {status ?? ""}
          </div>
        </div>
      </SurfaceContext.Provider>
    </div>
  );
}
