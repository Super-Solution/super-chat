// Agent cards — the agent's visual vocabulary.
//
// A card is a structured tool output that the host renders as UI instead of as
// JSON. Two ways one gets produced:
//   • a DOMAIN tool attaches a card to its result ("here are the pools I found"), or
//   • the agent calls the generic `visualize` tool and CHOOSES a presentation.
// The second is what makes the agent visually flexible rather than limited to
// whatever cards someone hard-coded.
//
// Three design rules, each learned from a real failure mode:
//
//  1. Validator and renderer are registered TOGETHER (registry.ts). In a
//     hand-maintained dispatch chain, adding a payload parser and forgetting the
//     render branch degrades the card to a bare "ran ✓" chip — silently, in
//     production, and only for that one card.
//
//  2. Interactive cards are never collapsible. A card that asks for a decision
//     (confirm, pick, fill) is part of the conversation's control flow; hiding
//     it inside a "3 steps completed" accordion makes it unreachable, which
//     reads to the user as the agent hanging.
//
//  3. Cards carry their own `expired` state. Card payloads are large and often
//     trimmed out of persisted history; a reloaded thread must say "this result
//     expired, ask again" rather than rendering an empty shell.

export type CardTone = "neutral" | "positive" | "negative" | "warning" | "info";

export type CardValueFormat = "text" | "number" | "currency" | "percent" | "bytes" | "duration" | "datetime" | "code";

// ── Built-in card specs ─────────────────────────────────────────────────────

export type TableColumn = {
  key: string;
  label: string;
  format?: CardValueFormat;
  align?: "left" | "right" | "center";
  /** Render this column's cell as an emphasis/status pill. */
  pill?: boolean;
};

export type TableCard = {
  kind: "table";
  title?: string;
  caption?: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  /** Column key to sort by on first render. */
  sortBy?: string;
  sortDir?: "asc" | "desc";
};

export type StatItem = {
  label: string;
  value: string | number;
  format?: CardValueFormat;
  /** Signed change vs a prior period; drives colour and arrow. */
  delta?: number;
  deltaFormat?: CardValueFormat;
  hint?: string;
  tone?: CardTone;
};

export type StatsCard = {
  kind: "stats";
  title?: string;
  items: StatItem[];
};

export type ChartSeries = {
  name: string;
  /** `[x, y]` pairs; x is a number, a timestamp, or a category label. */
  points: [string | number, number][];
  type?: "line" | "area" | "bar" | "scatter";
  color?: string;
  /** Plot against a secondary axis — volume under price, for instance. */
  axis?: "left" | "right";
};

export type ChartAnnotation = {
  type: "hline" | "vline" | "band" | "marker";
  value: string | number;
  /** Second bound, for `band`. */
  to?: string | number;
  label?: string;
  tone?: CardTone;
};

export type ChartCard = {
  kind: "chart";
  title?: string;
  /** OHLC candles are their own shape; series charts use `series`. */
  variant?: "series" | "candlestick";
  xLabel?: string;
  yLabel?: string;
  xType?: "time" | "number" | "category";
  series?: ChartSeries[];
  candles?: { t: string | number; o: number; h: number; l: number; c: number; v?: number }[];
  annotations?: ChartAnnotation[];
  stacked?: boolean;
};

export type TimelineCard = {
  kind: "timeline";
  title?: string;
  events: {
    at: string | number;
    label: string;
    detail?: string;
    tone?: CardTone;
  }[];
};

export type KeyValueCard = {
  kind: "keyvalue";
  title?: string;
  items: { label: string; value: string | number; format?: CardValueFormat; tone?: CardTone; mono?: boolean }[];
};

export type ProgressStep = {
  label: string;
  status: "pending" | "active" | "done" | "failed" | "skipped";
  detail?: string;
};

export type ProgressCard = {
  kind: "progress";
  title?: string;
  steps: ProgressStep[];
  /** 0–1. Omit for indeterminate. */
  fraction?: number;
};

export type MediaCard = {
  kind: "media";
  title?: string;
  items: {
    url: string;
    alt?: string;
    caption?: string;
    mediaType?: string;
    /** Known intrinsic geometry keeps generated media from shifting on decode. */
    width?: number;
    height?: number;
    durationMs?: number;
  }[];
  layout?: "grid" | "single";
};

export type MarkdownCard = { kind: "markdown"; title?: string; body: string };

/**
 * A document artifact — long-form Markdown the agent authored and the user
 * reads in a previewer rather than inline in the transcript.
 *
 * `docId` is the stable handle every later turn addresses: the body here is for
 * display only, and stripCardPayload removes it from what the model sees after
 * the turn that produced it. A model that wants to re-read the document calls
 * the read tool with this id — which is the point, because a document large
 * enough to deserve a previewer is too large to re-send every turn.
 *
 * `revision` is the optimistic-concurrency token. An edit carrying a stale one
 * is refused rather than applied to text that has since moved.
 */
export type DocumentCard = {
  kind: "document";
  docId: string;
  title: string;
  markdown: string;
  revision: number;
};

/**
 * A matrix of options against criteria.
 *
 * The most domain-portable card there is: legal clause-vs-clause, vendor
 * selection, pricing tiers, candidate evaluation, feature comparison. Boolean
 * values render as ✓/✗, so "does it have X" tables need no encoding by the model.
 */
export type ComparisonCard = {
  kind: "comparison";
  title?: string;
  /** The things being compared — these become columns. */
  options: { id: string; label: string; note?: string; highlight?: boolean }[];
  /** The dimensions they are compared on — these become rows. */
  criteria: {
    label: string;
    /** Keyed by option id. `true`/`false` render as ✓/✗; `null` renders as “—”. */
    values: Record<string, string | number | boolean | null>;
    detail?: string;
    weight?: "low" | "normal" | "high";
  }[];
};

/** Items with a state. Compliance reviews, launch readiness, QA passes, audits. */
export type ChecklistCard = {
  kind: "checklist";
  title?: string;
  items: {
    label: string;
    status: "done" | "todo" | "blocked" | "na";
    detail?: string;
    /** Optional heading to group consecutive items under. */
    group?: string;
  }[];
};

/** A single highlighted note. Disclaimers, caveats, prerequisites, warnings. */
export type CalloutCard = {
  kind: "callout";
  tone: "info" | "warning" | "danger" | "success" | "note";
  title?: string;
  body: string;
};

/**
 * Sources behind a claim.
 *
 * Domain-agnostic and unusually important for agents specifically: it is the
 * card that lets a reader check the work rather than trust the summary.
 */
export type CitationsCard = {
  kind: "citations";
  title?: string;
  items: {
    title: string;
    /** Publication, court, statute, dataset, site — whatever the source is. */
    source?: string;
    url?: string;
    date?: string | number;
    /** The specific passage relied on. */
    snippet?: string;
    locator?: string;
    relevance?: "high" | "medium" | "low";
  }[];
};

/** Staged drop-off. Conversion funnels, hiring pipelines, case attrition, intake flows. */
export type FunnelCard = {
  kind: "funnel";
  title?: string;
  stages: { label: string; value: number; note?: string }[];
  format?: CardValueFormat;
};

/** One value against a scale, with optional named bands. Scores, risk levels, sentiment. */
export type GaugeCard = {
  kind: "gauge";
  title?: string;
  value: number;
  min?: number;
  max?: number;
  label?: string;
  bands?: { from: number; to: number; label: string; tone?: CardTone }[];
  format?: CardValueFormat;
};

export type TreeNode = {
  label: string;
  detail?: string;
  tone?: CardTone;
  children?: TreeNode[];
};

/** Nested structure. Document outlines, org charts, taxonomies, decision trees. */
export type TreeCard = {
  kind: "tree";
  title?: string;
  nodes: TreeNode[];
};

export type CodeCard = { kind: "code"; title?: string; language?: string; code: string; filename?: string };

export type DiffCard = {
  kind: "diff";
  title?: string;
  before: string;
  after: string;
  language?: string;
};

// ── Interactive card specs ──────────────────────────────────────────────────
// These produce a CardAction when the user responds, which the runtime feeds
// back as the tool's result — that is the human-in-the-loop seam.

export type ChoiceCard = {
  kind: "choice";
  title?: string;
  prompt?: string;
  multiple?: boolean;
  options: {
    id: string;
    label: string;
    description?: string;
    /** Small facts shown on the option row: APR, TVL, price. */
    meta?: { label: string; value: string | number; format?: CardValueFormat }[];
    imageUrl?: string;
    disabled?: boolean;
    disabledReason?: string;
  }[];
};

export type FormField =
  | { name: string; label: string; type: "text" | "textarea"; placeholder?: string; required?: boolean; value?: string }
  | { name: string; label: string; type: "number"; min?: number; max?: number; step?: number; required?: boolean; value?: number; suffix?: string }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; value?: string }
  | { name: string; label: string; type: "boolean"; value?: boolean };

export type FormCard = {
  kind: "form";
  title?: string;
  description?: string;
  fields: FormField[];
  submitLabel?: string;
};

export type ConfirmCard = {
  kind: "confirm";
  title: string;
  /** The consequential summary — what will actually happen. */
  summary: { label: string; value: string | number; tone?: CardTone; mono?: boolean }[];
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm control as destructive. */
  danger?: boolean;
};

export type BuiltinCard =
  | TableCard
  | StatsCard
  | ChartCard
  | TimelineCard
  | KeyValueCard
  | ProgressCard
  | MediaCard
  | MarkdownCard
  | DocumentCard
  | EditReviewCard
  | EmailCard
  | CodeCard
  | DiffCard
  | ComparisonCard
  | ChecklistCard
  | CalloutCard
  | CitationsCard
  | FunnelCard
  | GaugeCard
  | TreeCard
  | ChoiceCard
  | FormCard
  | ConfirmCard;

export type BuiltinCardKind = BuiltinCard["kind"];

/**
 * The approval surface for a proposed document edit.
 *
 * Interactive, because in in-chat editing the diff IS the approval: there is no
 * other moment at which the user gets to see what is about to happen. Hunks are
 * accepted individually rather than all-or-nothing — partial acceptance is what
 * makes the exchange read as collaboration instead of take-it-or-leave-it, and
 * an edit is already the smallest independently applicable unit because it
 * carries its own anchor.
 */
export type EditReviewCard = {
  kind: "editreview";
  docId: string;
  title: string;
  /** Revision the edits were computed against; a stale one is refused. */
  revision: number;
  /** One line on why, in the model's words. */
  summary?: string;
  hunks: {
    index: number;
    block: number;
    removed: string[];
    added: string[];
  }[];
};

/**
 * A drafted email, before it is anyone's outbox.
 *
 * Always a draft the user completes — which is exactly the `draft` preset tier
 * ("produces something the USER must approve/sign. No side effects"). The
 * framework never holds a mail credential, for the same reason a Transport
 * never holds an API key.
 *
 * Editable but not interactive: nothing waits on it. The run does not suspend,
 * because the model asked no question — it produced a thing.
 */
export type EmailCard = {
  kind: "email";
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Plain text. Markdown here would be a lie: mailto cannot carry it. */
  body: string;
};

/** A host-registered card is any `{kind}` object; built-ins are the typed subset. */
export type CardSpec = BuiltinCard | ({ kind: string } & Record<string, unknown>);

/** Envelope attached to a tool result, or returned by `visualize`. */
export type Card = {
  id: string;
  spec: CardSpec;
  /** Set when the payload was dropped from persisted history. */
  expired?: boolean;
  /** Tool call this card belongs to, for correlating an action back. */
  callId?: string;
  /**
   * What the user answered, once they have.
   *
   * Lives on the card rather than in the renderer's local state because the card
   * is re-mounted from history when the turn commits — state does not survive
   * that, and a renderer left guessing shows the wrong answer.
   */
  action?: CardAction;
};

/** What the user did with an interactive card. Becomes the tool result. */
export type CardAction = {
  cardId: string;
  callId?: string;
  kind: string;
  type: "submit" | "select" | "confirm" | "cancel" | "dismiss";
  /** Selected option ids, form values, or nothing for confirm/cancel. */
  value?: unknown;
  at: number;
};

/** Marker key used to recognise a card inside an arbitrary tool output. */
export const CARD_KEY = "$card" as const;

export type CardCarrier = { [CARD_KEY]: Card } & Record<string, unknown>;

export function isCardCarrier(value: unknown): value is CardCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    CARD_KEY in value &&
    typeof (value as Record<string, unknown>)[CARD_KEY] === "object"
  );
}

/** Attach a card to a tool result without disturbing the data the model reads. */
export function withCard<T extends Record<string, unknown>>(data: T, spec: CardSpec, id?: string): T & CardCarrier {
  return { ...data, [CARD_KEY]: { id: id ?? `card_${Math.random().toString(36).slice(2, 10)}`, spec } };
}

/**
 * Remove a card payload from a tool output, leaving a note in its place.
 *
 * The card is for the user's eyes; the model gets the surrounding data. Sending
 * both is double billing — and a chart spec with 2,000 points is the single
 * largest thing a tool result can carry. Applied in two places, which must stay
 * consistent: within a running turn (before each provider call) and when a
 * persisted thread is rebuilt into context.
 */
export function stripCardPayload(output: unknown): unknown {
  if (!isCardCarrier(output)) return output;
  const { [CARD_KEY]: card, ...rest } = output as Record<string, unknown>;
  const kind = (card as { spec?: { kind?: string } })?.spec?.kind ?? "card";
  return { ...rest, rendered: `[${kind} card shown to the user]` };
}
