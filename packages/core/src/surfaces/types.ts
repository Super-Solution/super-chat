// Surfaces: an interface the agent assembles, instead of one card it picks.
//
// A card answers "which presentation fits this result". A surface answers "what
// does the person need in order to work with this": a filter next to the chart
// it filters, a total that follows both, a button that asks the agent to look
// again. Cards stay what they were and become blocks inside it.
//
// The format has four properties, each there for a reason:
//
//  1. FLAT. Components are a list that reference each other by id, so a surface
//     can stream one complete entry at a time and be patched without resending
//     the tree. (The same shape A2UI and json-render arrived at.)
//
//  2. DATA, NOT CODE. Everything the model writes is JSON from a closed
//     vocabulary. There is no expression language, no script, no HTML and no
//     CSS. `$query` filters and groups rows declaratively, and that is as far as
//     computation goes.
//
//  3. LOCAL BY DEFAULT. Each surface owns a data model. Controls write to it and
//     neighbours read from it, so narrowing a filter costs no model call.
//
//  4. CLOSED ACTIONS. A button can change local state, call a tool the current
//     presets already allow, or send the agent an event. Nothing else exists to
//     be asked for.

import type { CardAction } from "../cards/types.js";

export const SURFACE_CARD_KIND = "surface" as const;
export const SURFACE_FORMAT_VERSION = 1 as const;

/** Hard ceilings. A model that exceeds one receives a correction, never a frozen tab. */
export const SURFACE_LIMITS = {
  components: 200,
  depth: 16,
  dataChars: 64_000,
  specChars: 200_000,
  surfaces: 24,
  listItems: 200,
  queryRows: 2_000,
  actionUpdates: 8,
  tabs: 12,
} as const;

/** Read a value from the data model by JSON Pointer: `{ "$path": "/filters/region" }`. */
export type SurfacePathBinding = { $path: string };
/** Inside a `List` template, read a field of the current row. `""` is the row itself. */
export type SurfaceItemBinding = { $item: string };
/** Interpolate values into a string: `{ "$template": "Spend in {/region}" }`, `{.name}` for a row field. */
export type SurfaceTemplateBinding = { $template: string };
/** Filter, group and aggregate an array in the data model. */
export type SurfaceQueryBinding = { $query: SurfaceQuery };

export type SurfaceBinding =
  | SurfacePathBinding
  | SurfaceItemBinding
  | SurfaceTemplateBinding
  | SurfaceQueryBinding;

export type SurfaceWhereOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";

export type SurfaceWhere = {
  field: string;
  op?: SurfaceWhereOp;
  value: unknown;
  /** Skip this clause when the value equals this, so an "All" option needs no special case. */
  ignore?: string | number | boolean;
};

export type SurfaceAggregateOp = "count" | "sum" | "avg" | "min" | "max";

export type SurfaceQuery = {
  /** JSON Pointer to an array of rows. */
  from: string;
  where?: SurfaceWhere[];
  groupBy?: string;
  aggregate?: { op: SurfaceAggregateOp; field?: string };
  /** A row field; after `groupBy`, `key` or `value`. */
  sortBy?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  /** Return one field of each row instead of the row. */
  select?: string;
  /** Grouped results: `[key, value]` pairs (default, chart-ready) or `{ key, value }` rows. */
  shape?: "points" | "rows";
};

export type SurfaceConditionOp = "truthy" | "falsy" | "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";

/** A declarative test over the data model, for `visibleWhen` and `disabledWhen`. */
export type SurfaceCondition = {
  path: string;
  op?: SurfaceConditionOp;
  value?: unknown;
};

/** The whole action vocabulary. Adding a member here is a security decision. */
export type SurfaceAction =
  | { type: "set"; updates: { path: string; value: unknown }[] }
  | { type: "tool"; tool: string; args?: Record<string, unknown>; resultPath?: string }
  | { type: "event"; name: string; context?: Record<string, unknown> };

export type SurfaceComponent = {
  id: string;
  component: string;
  visibleWhen?: SurfaceCondition;
  [prop: string]: unknown;
};

export type SurfaceIssueCode =
  | "invalid-shape"
  | "duplicate-id"
  | "unknown-component"
  | "invalid-prop"
  | "invalid-binding"
  | "invalid-action"
  | "tool-not-allowed"
  | "unsafe-content"
  | "invalid-card"
  | "invalid-data"
  | "missing-root"
  | "missing-child"
  | "cycle"
  | "too-deep"
  | "limit-exceeded"
  | "not-found"
  | "expired"
  | "stale-revision";

/** One thing wrong, written for the model that has to fix it. */
export type SurfaceIssue = {
  code: SurfaceIssueCode;
  message: string;
  /** What to send instead. */
  fix: string;
  componentId?: string;
  path?: string;
};

/**
 * The current state of a surface. Travels as a card spec, which is how it uses
 * the thread, history-shedding and renderer seams cards already have.
 */
export type SurfaceSpec = {
  kind: typeof SURFACE_CARD_KIND;
  version: typeof SURFACE_FORMAT_VERSION;
  surfaceId: string;
  title?: string;
  root: string;
  components: SurfaceComponent[];
  data: Record<string, unknown>;
  /** Bumped by every agent update and every local edit. */
  revision: number;
  /** The call that created it: where it lives in the transcript. */
  originCallId?: string;
  /** Parts that could not be accepted. The person sees a fallback in their place. */
  issues?: SurfaceIssue[];
  /** Removed by the agent. */
  deleted?: boolean;
  /** The payload was shed from saved history. */
  expired?: boolean;
};

/** Patches for an existing surface, applied in order and validated before rendering. */
export type SurfaceOperation =
  | { op: "upsertComponents"; components: unknown[] }
  | { op: "removeComponents"; ids: string[] }
  | { op: "setRoot"; root: string }
  | { op: "setTitle"; title: string }
  | { op: "setData"; path: string; value: unknown }
  | { op: "removeData"; path: string };

export type SurfaceActivityState = "queued" | "running" | "done" | "failed" | "refused" | "cancelled";

/** What became of the last thing the person pressed. A press with no visible result reads as broken. */
export type SurfaceActivity = {
  componentId: string;
  state: SurfaceActivityState;
  message?: string;
  at: number;
};

/** Recorded on the user message an action produces, so the transcript can show it as an action. */
export type SurfaceEventRecord = {
  surfaceId: string;
  componentId: string;
  title?: string;
  label?: string;
  type: "event" | "tool";
  name: string;
  context?: Record<string, unknown>;
};

export const SURFACE_EVENT_METADATA_KEY = "surfaceEvent" as const;

/** How an interactive card answered inside a surface. Stored at the card's `bind` path. */
export type SurfaceCardAnswer = Pick<CardAction, "type" | "value" | "at">;
