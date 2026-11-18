// Bindings: how a prop reads the data model.
//
// Every form here is data and every evaluation is bounded. Resolution walks the
// SPEC once and never the values it reads, so a row that happens to contain
// `{ "$path": "/secret" }` stays a row. Data cannot promote itself into a binding.

import { getAt, parsePointer } from "./pointer.js";
import {
  SURFACE_LIMITS,
  type SurfaceAction,
  type SurfaceBinding,
  type SurfaceCondition,
  type SurfaceQuery,
  type SurfaceWhere,
} from "./types.js";

export type BindingScope = {
  data: unknown;
  /** The current row, inside a `List` template. */
  item?: unknown;
  index?: number;
};

const BINDING_KEYS = ["$path", "$item", "$template", "$query"] as const;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Exactly one `$` key and nothing else: anything looser would swallow ordinary objects. */
export function isSurfaceBinding(value: unknown): value is SurfaceBinding {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && (BINDING_KEYS as readonly string[]).includes(keys[0]!);
}

/** True when any binding of the given form appears anywhere inside `value`. */
export function usesBinding(value: unknown, key: (typeof BINDING_KEYS)[number]): boolean {
  if (Array.isArray(value)) return value.some((v) => usesBinding(v, key));
  if (!isPlainObject(value)) return false;
  if (isSurfaceBinding(value)) {
    if (key in value) return true;
    if ("$query" in value) return usesBinding(value.$query.where?.map((w) => w?.value), key);
    return key === "$item" && "$template" in value && /\{\.[^{}]*\}/.test(String(value.$template));
  }
  return Object.values(value).some((v) => usesBinding(v, key));
}

const TEMPLATE_TOKEN = /\{(\/[^{}]*|\.[^{}]*)\}/g;

const itemField = (item: unknown, field: string): unknown => {
  if (!field) return item;
  return getAt(item, field.startsWith("/") ? field : `/${field.replace(/\./g, "/")}`);
};

const printable = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "";

export function formatTemplate(template: string, scope: BindingScope): string {
  return template.replace(TEMPLATE_TOKEN, (_, token: string) =>
    printable(token.startsWith(".") ? itemField(scope.item, token.slice(1)) : getAt(scope.data, token)),
  );
}

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const sameValue = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b));

function compare(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case "eq":
      return sameValue(left, right);
    case "ne":
      return !sameValue(left, right);
    case "in":
      return Array.isArray(right) && right.some((r) => sameValue(left, r));
    case "contains":
      return String(left ?? "").toLowerCase().includes(String(right ?? "").toLowerCase());
    default: {
      const a = asNumber(left);
      const b = asNumber(right);
      if (a === undefined || b === undefined) return false;
      return op === "gt" ? a > b : op === "gte" ? a >= b : op === "lt" ? a < b : op === "lte" ? a <= b : false;
    }
  }
}

function rowField(row: unknown, field: string): unknown {
  return isPlainObject(row) && Object.prototype.hasOwnProperty.call(row, field) ? row[field] : undefined;
}

const clauseApplies = (clause: SurfaceWhere, value: unknown) => {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return clause.ignore === undefined || !sameValue(value, clause.ignore);
};

const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

function aggregate(rows: readonly unknown[], spec: NonNullable<SurfaceQuery["aggregate"]>): number {
  if (spec.op === "count") return rows.length;
  const values = rows.map((r) => asNumber(rowField(r, spec.field ?? ""))).filter((n): n is number => n !== undefined);
  if (!values.length) return 0;
  switch (spec.op) {
    case "sum":
      return tidy(values.reduce((a, b) => a + b, 0));
    case "avg":
      return tidy(values.reduce((a, b) => a + b, 0) / values.length);
    case "min":
      return values.reduce((a, b) => Math.min(a, b));
    case "max":
      return values.reduce((a, b) => Math.max(a, b));
  }
}

const order = (a: unknown, b: unknown): number => {
  const x = asNumber(a);
  const y = asNumber(b);
  if (x !== undefined && y !== undefined) return x - y;
  return String(a ?? "").localeCompare(String(b ?? ""));
};

/** Run a declarative query. Bad input yields an empty result, never a throw in a render. */
export function runSurfaceQuery(query: SurfaceQuery, scope: BindingScope): unknown {
  const source = getAt(scope.data, query.from);
  let rows: unknown[] = Array.isArray(source) ? source.slice(0, SURFACE_LIMITS.queryRows) : [];

  for (const clause of query.where ?? []) {
    const value = resolveSurfaceValue(clause.value, scope);
    if (!clauseApplies(clause, value)) continue;
    rows = rows.filter((row) => compare(rowField(row, clause.field), clause.op ?? "eq", value));
  }

  const direction = query.sortDir === "desc" ? -1 : 1;
  const limit = (list: unknown[]) => (typeof query.limit === "number" && query.limit >= 0 ? list.slice(0, query.limit) : list);

  if (query.groupBy) {
    const groups = new Map<string, unknown[]>();
    for (const row of rows) {
      const key = printable(rowField(row, query.groupBy));
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    let pairs = [...groups].map(([key, bucket]) => ({ key, value: aggregate(bucket, query.aggregate ?? { op: "count" }) }));
    if (query.sortBy === "key" || query.sortBy === "value") {
      const by = query.sortBy;
      pairs = [...pairs].sort((a, b) => order(a[by], b[by]) * direction);
    }
    const limited = limit(pairs) as typeof pairs;
    return query.shape === "rows" ? limited : limited.map((p) => [p.key, p.value]);
  }

  if (query.aggregate) return aggregate(rows, query.aggregate);

  if (query.sortBy) {
    const by = query.sortBy;
    rows = [...rows].sort((a, b) => order(rowField(a, by), rowField(b, by)) * direction);
  }
  rows = limit(rows);
  return query.select ? rows.map((r) => rowField(r, query.select!)) : rows;
}

/** Replace every binding inside a spec value with what it currently reads. */
export function resolveSurfaceValue(value: unknown, scope: BindingScope, depth = 0): unknown {
  if (depth > SURFACE_LIMITS.depth * 2) return undefined;
  if (Array.isArray(value)) return value.map((v) => resolveSurfaceValue(v, scope, depth + 1));
  if (!isPlainObject(value)) return value;
  if (isSurfaceBinding(value)) {
    if ("$path" in value) return getAt(scope.data, value.$path);
    if ("$item" in value) return itemField(scope.item, value.$item);
    if ("$template" in value) return formatTemplate(value.$template, scope);
    return runSurfaceQuery(value.$query, scope);
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = resolveSurfaceValue(item, scope, depth + 1);
  return out;
}

export function evaluateSurfaceCondition(condition: SurfaceCondition | undefined, scope: BindingScope): boolean {
  if (!condition) return true;
  const current = getAt(scope.data, condition.path);
  const op = condition.op ?? (condition.value === undefined ? "truthy" : "eq");
  if (op === "truthy") return Boolean(current) && !(Array.isArray(current) && current.length === 0);
  if (op === "falsy") return !current || (Array.isArray(current) && current.length === 0);
  return compare(current, op, condition.value);
}

/** An action with its bindings read at the moment the person pressed. */
export function resolveSurfaceAction(action: SurfaceAction, scope: BindingScope): SurfaceAction {
  switch (action.type) {
    case "set":
      return { type: "set", updates: action.updates.map((u) => ({ path: u.path, value: resolveSurfaceValue(u.value, scope) })) };
    case "tool":
      return { ...action, args: resolveSurfaceValue(action.args ?? {}, scope) as Record<string, unknown> };
    case "event":
      return { ...action, context: resolveSurfaceValue(action.context ?? {}, scope) as Record<string, unknown> };
  }
}

/** Problems with one binding, as sentences. Empty means it is usable. */
export function bindingProblems(binding: SurfaceBinding): string[] {
  if ("$path" in binding) {
    return parsePointer(binding.$path) ? [] : [`$path ${JSON.stringify(binding.$path)} is not a JSON Pointer such as "/filters/region".`];
  }
  if ("$item" in binding) {
    return typeof binding.$item === "string" ? [] : ["$item must be a field name of the current row."];
  }
  if ("$template" in binding) return typeof binding.$template === "string" ? [] : ["$template must be a string."];

  const query = binding.$query as SurfaceQuery | undefined;
  if (!isPlainObject(query)) return ["$query must be an object with a `from` pointer."];
  const out: string[] = [];
  if (!parsePointer(query.from)) out.push(`$query.from ${JSON.stringify(query.from)} is not a JSON Pointer to an array.`);
  const allowed = new Set(["from", "where", "groupBy", "aggregate", "sortBy", "sortDir", "limit", "select", "shape"]);
  for (const key of Object.keys(query)) if (!allowed.has(key)) out.push(`$query has no "${key}". Allowed: ${[...allowed].join(", ")}.`);
  if (query.where !== undefined && !Array.isArray(query.where)) out.push("$query.where must be an array of { field, op, value }.");
  for (const clause of Array.isArray(query.where) ? query.where : []) {
    if (!isPlainObject(clause) || typeof clause.field !== "string") out.push("Each $query.where clause needs a string `field`.");
    else if (clause.op !== undefined && !["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"].includes(clause.op)) {
      out.push(`$query.where op "${String(clause.op)}" is not one of eq, ne, gt, gte, lt, lte, in, contains.`);
    }
  }
  if (query.aggregate !== undefined) {
    const ops = ["count", "sum", "avg", "min", "max"];
    if (!isPlainObject(query.aggregate) || !ops.includes(String(query.aggregate.op))) out.push(`$query.aggregate.op must be one of ${ops.join(", ")}.`);
    else if (query.aggregate.op !== "count" && typeof query.aggregate.field !== "string") out.push(`$query.aggregate "${query.aggregate.op}" needs a \`field\`.`);
  }
  if (query.sortDir !== undefined && query.sortDir !== "asc" && query.sortDir !== "desc") out.push('$query.sortDir must be "asc" or "desc".');
  if (query.shape !== undefined && query.shape !== "points" && query.shape !== "rows") out.push('$query.shape must be "points" or "rows".');
  return out;
}
