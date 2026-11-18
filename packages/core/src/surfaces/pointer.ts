// JSON Pointer (RFC 6901) over a surface's data model.
//
// Paths come from a model, so this is also a security boundary. Walking
// `__proto__` or `constructor` would let a spec write to Object.prototype for
// the whole page; such a pointer does not parse. Writes are structural: the
// previous state is never mutated, which is what lets a renderer compare by
// identity.

import { SURFACE_LIMITS } from "./types.js";

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export const isForbiddenKey = (key: string): boolean => FORBIDDEN_SEGMENTS.has(key);

/** Segments of a pointer, or `undefined` when it is malformed or unsafe. `""` and `"/"` are the root. */
export function parsePointer(pointer: unknown): string[] | undefined {
  if (typeof pointer !== "string") return undefined;
  if (pointer === "" || pointer === "/") return [];
  if (!pointer.startsWith("/")) return undefined;
  const segments = pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (segments.length > SURFACE_LIMITS.depth) return undefined;
  if (segments.some((s) => s === "" || FORBIDDEN_SEGMENTS.has(s))) return undefined;
  return segments;
}

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] => typeof v === "object" && v !== null;
const isIndex = (s: string) => /^(0|[1-9]\d*)$/.test(s);

/** Own properties only: a binding must never read something off a prototype. */
function child(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return isIndex(key) ? value[Number(key)] : undefined;
  if (!isContainer(value)) return undefined;
  return Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

export function getAt(data: unknown, pointer: string): unknown {
  const segments = parsePointer(pointer);
  if (!segments) return undefined;
  let current = data;
  for (const segment of segments) current = child(current, segment);
  return current;
}

function writeAt(node: unknown, segments: string[], index: number, value: unknown): unknown {
  if (index === segments.length) return value;
  const key = segments[index]!;
  if (Array.isArray(node)) {
    const at = key === "-" ? node.length : isIndex(key) ? Number(key) : -1;
    if (at < 0 || at > node.length) throw new RangeError(key);
    const next = [...node];
    next[at] = writeAt(node[at], segments, index + 1, value);
    return next;
  }
  const base = isContainer(node) ? (node as Record<string, unknown>) : {};
  return { ...base, [key]: writeAt(child(base, key), segments, index + 1, value) };
}

/** A new data model with `value` at `pointer`, or `undefined` when the pointer cannot be written. */
export function setAt(data: Record<string, unknown>, pointer: string, value: unknown): Record<string, unknown> | undefined {
  const segments = parsePointer(pointer);
  if (!segments) return undefined;
  if (!segments.length) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }
  try {
    return writeAt(data, segments, 0, value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** A new data model without the value at `pointer`. Removing what is not there changes nothing. */
export function removeAt(data: Record<string, unknown>, pointer: string): Record<string, unknown> | undefined {
  const segments = parsePointer(pointer);
  if (!segments?.length) return undefined;
  const parentPath = segments.slice(0, -1);
  const key = segments[segments.length - 1]!;
  let parent: unknown = data;
  for (const segment of parentPath) parent = child(parent, segment);
  if (!isContainer(parent)) return data;
  const without: unknown = Array.isArray(parent)
    ? parent.filter((_, i) => String(i) !== key)
    : Object.fromEntries(Object.entries(parent).filter(([k]) => k !== key));
  if (!parentPath.length) return without as Record<string, unknown>;
  return writeAt(data, parentPath, 0, without) as Record<string, unknown>;
}
