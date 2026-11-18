// A small JSON Schema checker, for the subset the surface catalogue uses.
//
// Core carries no validation dependency (see providers/types.ts), and what a
// surface needs from one is modest: walk a schema, and say what was wrong in a
// sentence a model can act on.

import type { JSONSchema } from "../providers/types.js";

export type SchemaProblem = { path: string; message: string; expected?: string };

export type SchemaCheckOptions = {
  /** A value this returns true for is checked elsewhere, unless its schema is `x-static`. */
  isDynamic?: (value: unknown) => boolean;
  maxProblems?: number;
};

const typeOf = (v: unknown): string => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
};

const matchesType = (value: unknown, type: string): boolean => {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeOf(value) === type;
};

const quote = (values: readonly unknown[]) => values.map((v) => JSON.stringify(v)).join(", ");

export function checkSchema(schema: JSONSchema, value: unknown, path = "", opts: SchemaCheckOptions = {}): SchemaProblem[] {
  const out: SchemaProblem[] = [];
  const max = opts.maxProblems ?? 6;

  const walk = (s: JSONSchema, v: unknown, at: string): void => {
    if (out.length >= max) return;
    if (opts.isDynamic?.(v) && s["x-static"] !== true) return;
    const label = at || "value";

    const anyOf = s["anyOf"];
    if (Array.isArray(anyOf)) {
      const passes = (anyOf as JSONSchema[]).some((option) => checkSchema(option, v, at, opts).length === 0);
      if (!passes) out.push({ path: at, message: `${label} does not match any allowed form.`, expected: s.description });
      return;
    }
    if (s.const !== undefined && v !== s.const) {
      out.push({ path: at, message: `${label} must be ${JSON.stringify(s.const)}.` });
      return;
    }
    if (s.enum && !s.enum.includes(v)) {
      out.push({ path: at, message: `${label} is ${JSON.stringify(v)}.`, expected: `One of: ${quote(s.enum)}` });
      return;
    }
    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => matchesType(v, t))) {
        out.push({ path: at, message: `${label} must be ${types.join(" or ")}, got ${typeOf(v)}.` });
        return;
      }
    }
    if (typeof v === "number") {
      if (s.minimum != null && v < s.minimum) out.push({ path: at, message: `${label} must be at least ${s.minimum}.` });
      if (s.maximum != null && v > s.maximum) out.push({ path: at, message: `${label} must be at most ${s.maximum}.` });
    }
    if (typeof v === "string") {
      const min = s["minLength"];
      const maxLength = s["maxLength"];
      if (typeof min === "number" && v.length < min) out.push({ path: at, message: `${label} must not be empty.` });
      if (typeof maxLength === "number" && v.length > maxLength) {
        out.push({ path: at, message: `${label} is longer than ${maxLength} characters.` });
      }
    }
    if (Array.isArray(v)) {
      const minItems = s["minItems"];
      const maxItems = s["maxItems"];
      if (typeof minItems === "number" && v.length < minItems) out.push({ path: at, message: `${label} needs at least ${minItems} item(s).` });
      if (typeof maxItems === "number" && v.length > maxItems) out.push({ path: at, message: `${label} allows at most ${maxItems} item(s).` });
      if (s.items && !Array.isArray(s.items)) {
        const items = s.items;
        v.forEach((item, i) => walk(items, item, `${at}/${i}`));
      }
    }
    if (typeOf(v) === "object") {
      const record = v as Record<string, unknown>;
      for (const key of s.required ?? []) {
        if (record[key] === undefined) out.push({ path: `${at}/${key}`, message: `${at ? `${at}/` : ""}${key} is required.` });
      }
      const properties = s.properties ?? {};
      for (const [key, item] of Object.entries(record)) {
        const propSchema = properties[key];
        if (propSchema) walk(propSchema, item, `${at}/${key}`);
        else if (s.additionalProperties === false) {
          out.push({
            path: `${at}/${key}`,
            message: `Unknown prop "${key}".`,
            expected: `Allowed: ${Object.keys(properties).join(", ") || "(none)"}`,
          });
        } else if (typeof s.additionalProperties === "object") walk(s.additionalProperties, item, `${at}/${key}`);
      }
    }
  };

  walk(schema, value, path);
  return out.slice(0, max);
}
