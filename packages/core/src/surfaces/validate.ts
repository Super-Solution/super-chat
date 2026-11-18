// Validation: the only road from model output to a rendered component.
//
// Every failure is reported per component, in words the model can act on, and the
// rest of the surface survives it. One bad chart should cost one correction, not
// the whole interface.

import { checkSchema } from "./schema-check.js";
import { bindingProblems, isSurfaceBinding, resolveSurfaceValue, usesBinding } from "./bindings.js";
import type { SurfaceCatalogue, SurfaceComponentDefinition } from "./catalogue.js";
import { parsePointer } from "./pointer.js";
import { findUnsafe } from "./safety.js";
import {
  SURFACE_CARD_KIND,
  SURFACE_LIMITS,
  type SurfaceAction,
  type SurfaceBinding,
  type SurfaceComponent,
  type SurfaceIssue,
} from "./types.js";

export type SurfaceValidationContext = {
  catalogue: SurfaceCatalogue;
  data: Record<string, unknown>;
  /** Tools an action may call. Omitted means "checked at dispatch only". */
  actionTools?: readonly string[];
  /** Leave cards whose spec has bindings to the render that resolves them. */
  deferBoundCards?: boolean;
};

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
export const isSurfaceId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const RESERVED = new Set(["id", "component", "visibleWhen"]);

function collectBindings(value: unknown, out: SurfaceBinding[] = []): SurfaceBinding[] {
  if (Array.isArray(value)) for (const v of value) collectBindings(v, out);
  else if (isSurfaceBinding(value)) {
    out.push(value);
    if ("$query" in value && isObject(value.$query) && Array.isArray(value.$query.where)) {
      for (const clause of value.$query.where) collectBindings(isObject(clause) ? clause["value"] : undefined, out);
    }
  } else if (isObject(value)) for (const v of Object.values(value)) collectBindings(v, out);
  return out;
}

function bindingIssues(value: unknown, componentId: string): SurfaceIssue[] {
  return collectBindings(value).flatMap((binding) =>
    bindingProblems(binding).map((message) => ({
      code: "invalid-binding" as const,
      componentId,
      message,
      fix: 'Use { "$path": "/a/b" }, { "$template": "Text {/a}" }, { "$query": { "from": "/rows" } }, or { "$item": "field" } inside a List.',
    })),
  );
}

export function validateSurfaceAction(action: unknown, componentId: string, ctx: SurfaceValidationContext): SurfaceIssue[] {
  const bad = (message: string, fix: string, code: SurfaceIssue["code"] = "invalid-action"): SurfaceIssue[] => [
    { code, componentId, path: "/action", message, fix },
  ];
  const closed = 'Use { "type": "set", "updates": [...] }, { "type": "tool", "tool": "name", "args": {} } or { "type": "event", "name": "name" }.';
  if (!isObject(action)) return bad("action must be an object.", closed);

  const onlyKeys = (allowed: string[]) => {
    const extra = Object.keys(action).filter((k) => !allowed.includes(k));
    return extra.length ? bad(`action has no "${extra[0]}". Actions cannot carry code or URLs.`, `Allowed keys: ${allowed.join(", ")}.`) : [];
  };

  const typed = action as SurfaceAction;
  switch (typed.type) {
    case "set": {
      const extra = onlyKeys(["type", "updates"]);
      if (extra.length) return extra;
      if (!Array.isArray(typed.updates) || !typed.updates.length || typed.updates.length > SURFACE_LIMITS.actionUpdates) {
        return bad(`set needs 1 to ${SURFACE_LIMITS.actionUpdates} updates.`, 'Send "updates": [{ "path": "/a", "value": 1 }].');
      }
      for (const update of typed.updates) {
        if (!isObject(update) || !parsePointer(update.path)) return bad("Each update needs a JSON Pointer `path`.", 'Send { "path": "/a", "value": 1 }.');
      }
      return bindingIssues(typed.updates, componentId);
    }
    case "tool": {
      const extra = onlyKeys(["type", "tool", "args", "resultPath"]);
      if (extra.length) return extra;
      if (typeof typed.tool !== "string" || !typed.tool) return bad("A tool action needs a `tool` name.", 'Send { "type": "tool", "tool": "name" }.');
      if (typed.args !== undefined && !isObject(typed.args)) return bad("Tool `args` must be an object.", "Send args as an object of literals or bindings.");
      if (typed.resultPath !== undefined && !parsePointer(typed.resultPath)) return bad("`resultPath` must be a JSON Pointer.", 'Send "resultPath": "/result".');
      if (ctx.actionTools && !ctx.actionTools.includes(typed.tool)) {
        return bad(
          `Tool "${typed.tool}" is not available to this surface.`,
          ctx.actionTools.length ? `Available: ${ctx.actionTools.slice(0, 24).join(", ")}.` : 'No tools are available; use an "event" action instead.',
          "tool-not-allowed",
        );
      }
      return bindingIssues(typed.args, componentId);
    }
    case "event": {
      const extra = onlyKeys(["type", "name", "context"]);
      if (extra.length) return extra;
      if (!isSurfaceId(typed.name)) return bad("An event needs a short `name`.", 'Send { "type": "event", "name": "apply" }.');
      if (typed.context !== undefined && !isObject(typed.context)) return bad("Event `context` must be an object.", "Send context as an object of literals or bindings.");
      return bindingIssues(typed.context, componentId);
    }
    default:
      return bad(`Unknown action type ${JSON.stringify((action as { type?: unknown }).type)}.`, closed);
  }
}

function validateCard(raw: SurfaceComponent, ctx: SurfaceValidationContext): SurfaceIssue[] {
  const id = raw.id;
  const kind = raw["kind"];
  const registry = ctx.catalogue.cards;
  const available = ctx.catalogue.cardKinds().map((k) => k.kind);
  if (typeof kind !== "string" || kind === SURFACE_CARD_KIND || !registry?.has(kind)) {
    return [{ code: "invalid-card", componentId: id, path: "/kind", message: `Unknown card kind ${JSON.stringify(kind)}.`, fix: `One of: ${available.join(", ") || "(no card registry)"}.` }];
  }
  const spec = raw["spec"];
  if (!isObject(spec)) return [{ code: "invalid-card", componentId: id, path: "/spec", message: "Card `spec` must be an object.", fix: "Send the card body as `spec`." }];

  const issues = bindingIssues(spec, id);
  if (registry.isInteractive(kind) && !parsePointer(raw["bind"])) {
    issues.push({
      code: "invalid-card",
      componentId: id,
      path: "/bind",
      message: `Interactive card "${kind}" needs \`bind\`, the place its answer is stored.`,
      fix: 'Add "bind": "/answers/decision".',
    });
  }
  if (raw["action"] !== undefined) issues.push(...validateSurfaceAction(raw["action"], id, ctx));
  if (issues.length) return issues;

  // Rows from a List do not exist yet, so a template card is checked when it renders.
  if (usesBinding(spec, "$item")) return [];
  if (ctx.deferBoundCards && (usesBinding(spec, "$path") || usesBinding(spec, "$query") || usesBinding(spec, "$template"))) return [];
  const verdict = registry.validate({ ...(resolveSurfaceValue(spec, { data: ctx.data }) as Record<string, unknown>), kind });
  return verdict.ok
    ? []
    : [{ code: "invalid-card", componentId: id, path: "/spec", message: verdict.error, fix: verdict.expected ?? `Call describeSurfaceComponents for ${"`"}Card:${kind}${"`"}.` }];
}

/** Everything wrong with one component, judged alone. */
export function validateSurfaceComponent(raw: unknown, ctx: SurfaceValidationContext): SurfaceIssue[] {
  if (!isObject(raw)) return [{ code: "invalid-shape", message: "Each component must be an object.", fix: 'Send { "id": "a", "component": "Text", "text": "Hello" }.' }];
  const id = raw["id"];
  if (!isSurfaceId(id)) return [{ code: "invalid-shape", message: `Component id ${JSON.stringify(id)} is invalid.`, fix: "Use 1 to 64 letters, digits, or . _ : -" }];
  const component = raw as SurfaceComponent;
  const name = component.component;
  const def: SurfaceComponentDefinition | undefined = typeof name === "string" ? ctx.catalogue.get(name) : undefined;
  if (!def) {
    return [{
      code: "unknown-component",
      componentId: id,
      path: "/component",
      message: `Unknown component ${JSON.stringify(name)}.`,
      fix: `One of: ${ctx.catalogue.names().filter((n) => !n.startsWith("Card:")).join(", ")}. Cards use "component": "Card" with a "kind".`,
    }];
  }

  const isCard = def.name === "Card";
  const unsafe = findUnsafe(raw, { markup: !isCard && def.category !== "custom" });
  if (unsafe) {
    return [{ code: "unsafe-content", componentId: id, path: unsafe.path, message: `${unsafe.path || "The component"} ${unsafe.reason}.`, fix: "Send plain text and http(s) URLs only. Surfaces cannot carry script, HTML or CSS." }];
  }

  const props = Object.fromEntries(Object.entries(raw).filter(([k]) => !RESERVED.has(k)));
  const issues: SurfaceIssue[] = checkSchema(def.props, props, "", { isDynamic: isSurfaceBinding }).map((p) => ({
    code: "invalid-prop" as const,
    componentId: id,
    path: p.path,
    message: `${def.name}: ${p.message}`,
    fix: p.expected ?? `Call describeSurfaceComponents for ${def.name}.`,
  }));

  if (raw["visibleWhen"] !== undefined) {
    const condition = raw["visibleWhen"];
    if (!isObject(condition) || !parsePointer(condition["path"])) {
      issues.push({ code: "invalid-binding", componentId: id, path: "/visibleWhen", message: "visibleWhen needs a JSON Pointer `path`.", fix: 'Send { "path": "/showDetails" }.' });
    }
  }
  if (issues.length) return issues;

  if (isCard) return validateCard(component, ctx);

  const out = bindingIssues(props, id);
  for (const key of ["value"] as const) {
    const bound = props[key];
    if (def.category === "input" && isObject(bound) && !parsePointer(bound["$path"])) {
      out.push({ code: "invalid-binding", componentId: id, path: `/${key}`, message: `${def.name}.value must be a writable $path.`, fix: 'Send "value": { "$path": "/filters/region" }.' });
    }
  }
  if (props["action"] !== undefined) out.push(...validateSurfaceAction(props["action"], id, ctx));
  if (props["disabledWhen"] !== undefined && !parsePointer((props["disabledWhen"] as { path?: unknown }).path)) {
    out.push({ code: "invalid-binding", componentId: id, path: "/disabledWhen", message: "disabledWhen needs a JSON Pointer `path`.", fix: 'Send { "path": "/busy" }.' });
  }
  return out;
}

/** Split a component list into what may render and what must be corrected. */
export function validateSurfaceComponents(raw: readonly unknown[], ctx: SurfaceValidationContext): { components: SurfaceComponent[]; issues: SurfaceIssue[] } {
  const components: SurfaceComponent[] = [];
  const issues: SurfaceIssue[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const found = validateSurfaceComponent(entry, ctx);
    if (found.length) {
      issues.push(...found);
      continue;
    }
    const component = entry as SurfaceComponent;
    if (seen.has(component.id)) {
      issues.push({ code: "duplicate-id", componentId: component.id, message: `Component id "${component.id}" is used twice.`, fix: "Give every component its own id." });
      continue;
    }
    seen.add(component.id);
    components.push(component);
  }
  return { components, issues };
}

/**
 * Whole-graph checks: a root that exists, children that exist, no cycles, bounded
 * depth, and `$item` only where a row is in scope.
 */
export function validateSurfaceGraph(
  root: string,
  components: readonly SurfaceComponent[],
  catalogue: SurfaceCatalogue,
  rejected: ReadonlySet<string> = new Set(),
): SurfaceIssue[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const issues: SurfaceIssue[] = [];
  if (!byId.has(root)) {
    if (!rejected.has(root)) issues.push({ code: "missing-root", componentId: root, message: `Root "${root}" is not in the component list.`, fix: "Add a component with that id, or set `root` to one that exists." });
    return issues;
  }

  const slotsOf = (c: SurfaceComponent) => {
    try {
      return catalogue.get(c.component)?.slots?.(c) ?? [];
    } catch {
      return [];
    }
  };
  const templatesOf = (c: SurfaceComponent) => {
    try {
      return catalogue.get(c.component)?.templateSlots?.(c) ?? [];
    } catch {
      return [];
    }
  };

  const reported = new Set<string>();
  const once = (key: string, issue: SurfaceIssue) => {
    if (reported.has(key)) return;
    reported.add(key);
    issues.push(issue);
  };

  const visit = (id: string, trail: string[], inTemplate: boolean): void => {
    const component = byId.get(id);
    if (!component) return;
    if (trail.includes(id)) {
      once(`cycle:${id}`, { code: "cycle", componentId: id, message: `Component "${id}" contains itself.`, fix: "Remove the reference that loops back." });
      return;
    }
    if (trail.length >= SURFACE_LIMITS.depth) {
      once(`depth:${id}`, { code: "too-deep", componentId: id, message: `Nesting is deeper than ${SURFACE_LIMITS.depth} levels.`, fix: "Flatten the layout." });
      return;
    }
    if (!inTemplate && usesBinding(component, "$item")) {
      once(`item:${id}`, { code: "invalid-binding", componentId: id, message: `"${id}" reads $item outside a List template.`, fix: "Use $path here, or move it under a List's `child`." });
    }
    const templates = templatesOf(component);
    for (const child of slotsOf(component)) {
      if (!byId.has(child)) {
        if (!rejected.has(child)) once(`missing:${child}`, { code: "missing-child", componentId: id, message: `"${id}" references "${child}", which does not exist.`, fix: `Add a component with id "${child}" or remove the reference.` });
        continue;
      }
      visit(child, [...trail, id], inTemplate || templates.includes(child));
    }
  };

  visit(root, [], false);
  return issues;
}
