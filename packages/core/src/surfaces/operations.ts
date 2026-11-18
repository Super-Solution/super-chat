// Building and patching surfaces. Pure functions: spec in, spec and corrections out.

import type { SurfaceCatalogue } from "./catalogue.js";
import { removeAt, setAt } from "./pointer.js";
import { findUnsafe } from "./safety.js";
import {
  SURFACE_CARD_KIND,
  SURFACE_FORMAT_VERSION,
  SURFACE_LIMITS,
  type SurfaceComponent,
  type SurfaceIssue,
  type SurfaceOperation,
  type SurfaceSpec,
} from "./types.js";
import {
  isSurfaceId,
  validateSurfaceComponent,
  validateSurfaceComponents,
  validateSurfaceGraph,
  type SurfaceValidationContext,
} from "./validate.js";

export type SurfaceBuildContext = {
  catalogue: SurfaceCatalogue;
  actionTools?: readonly string[];
};

/** `spec` is absent when nothing could be rendered at all. `issues` is what the model must correct. */
export type SurfaceBuildResult = { spec?: SurfaceSpec; issues: SurfaceIssue[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fatal = (issue: SurfaceIssue): SurfaceBuildResult => ({ issues: [issue] });

function dataIssue(data: unknown): SurfaceIssue | undefined {
  const unsafe = findUnsafe(data);
  if (unsafe) {
    return { code: "unsafe-content", path: unsafe.path, message: `data${unsafe.path} ${unsafe.reason}.`, fix: "Store plain values and http(s) URLs only." };
  }
  if (JSON.stringify(data).length > SURFACE_LIMITS.dataChars) {
    return { code: "limit-exceeded", path: "/data", message: `data is larger than ${SURFACE_LIMITS.dataChars} characters.`, fix: "Send a summary or fewer rows." };
  }
  return undefined;
}

const tooMany = (count: number): SurfaceIssue => ({
  code: "limit-exceeded",
  message: `A surface may hold ${SURFACE_LIMITS.components} components; this has ${count}.`,
  fix: "Use a List template instead of repeating components.",
});

/** Issues that belong in the spec: parts the person sees a fallback for. */
function persistentIssues(components: readonly SurfaceComponent[], issues: readonly SurfaceIssue[]): SurfaceIssue[] {
  const present = new Set(components.map((c) => c.id));
  return issues.filter((i) => !i.componentId || !present.has(i.componentId) || i.code === "missing-child" || i.code === "cycle" || i.code === "too-deep" || i.code === "invalid-binding");
}

/** Validate a complete surface from `createSurface` arguments. */
export function buildSurface(
  input: unknown,
  ctx: SurfaceBuildContext,
  opts: { revision?: number; originCallId?: string } = {},
): SurfaceBuildResult {
  if (!isObject(input)) return fatal({ code: "invalid-shape", message: "Surface must be an object.", fix: "Send surfaceId, root and components." });
  const { surfaceId, root, components, data, title } = input;
  if (!isSurfaceId(surfaceId)) return fatal({ code: "invalid-shape", path: "/surfaceId", message: "surfaceId is missing or invalid.", fix: 'Send a short id such as "overview".' });
  if (!isSurfaceId(root)) return fatal({ code: "missing-root", path: "/root", message: "root must be the id of a component.", fix: 'Send "root": "main" and a component with that id.' });
  if (!Array.isArray(components) || !components.length) return fatal({ code: "invalid-shape", path: "/components", message: "components must be a non-empty array.", fix: 'Send [{ "id": "main", "component": "Stack", "children": [] }].' });
  if (components.length > SURFACE_LIMITS.components) return fatal(tooMany(components.length));
  if (data !== undefined && !isObject(data)) return fatal({ code: "invalid-data", path: "/data", message: "data must be an object.", fix: 'Send "data": { "filters": {} }.' });
  const model = (data ?? {}) as Record<string, unknown>;
  const bad = dataIssue(model);
  if (bad) return fatal(bad);
  if (JSON.stringify(components).length > SURFACE_LIMITS.specChars) {
    return fatal({ code: "limit-exceeded", path: "/components", message: `components exceed ${SURFACE_LIMITS.specChars} characters.`, fix: "Move repeated content into data and use a List." });
  }

  const validation: SurfaceValidationContext = { catalogue: ctx.catalogue, data: model, actionTools: ctx.actionTools };
  const checked = validateSurfaceComponents(components, validation);
  const rejected = new Set(checked.issues.flatMap((i) => (i.componentId ? [i.componentId] : [])));
  const graph = validateSurfaceGraph(root, checked.components, ctx.catalogue, rejected);
  const issues = [...checked.issues, ...graph];
  const kept = persistentIssues(checked.components, issues);

  return {
    issues,
    spec: {
      kind: SURFACE_CARD_KIND,
      version: SURFACE_FORMAT_VERSION,
      surfaceId,
      ...(typeof title === "string" && title ? { title } : {}),
      root,
      components: checked.components,
      data: model,
      revision: opts.revision ?? 1,
      ...(opts.originCallId ? { originCallId: opts.originCallId } : {}),
      ...(kept.length ? { issues: kept } : {}),
    },
  };
}

/**
 * Apply patches to a surface.
 *
 * Data operations land first, whatever order they were sent in: a component is
 * validated against the data it binds to, and a model naturally writes the new
 * chart before the rows it reads. A rejected upsert keeps the previous version
 * of that component on screen.
 */
export function applySurfaceOperations(spec: SurfaceSpec, operations: unknown, ctx: SurfaceBuildContext): SurfaceBuildResult {
  if (!Array.isArray(operations) || !operations.length) {
    return fatal({ code: "invalid-shape", path: "/operations", message: "operations must be a non-empty array.", fix: 'Send [{ "op": "setData", "path": "/a", "value": 1 }].' });
  }

  const issues: SurfaceIssue[] = [];
  let data = spec.data;
  const ops = operations as SurfaceOperation[];

  for (const op of ops) {
    if (!isObject(op)) continue;
    if (op.op === "setData") {
      const unsafe = findUnsafe(op.value);
      const next = unsafe ? undefined : setAt(data, op.path, op.value);
      if (next) data = next;
      else issues.push({ code: unsafe ? "unsafe-content" : "invalid-data", path: op.path, message: unsafe ? `The value ${unsafe.path} ${unsafe.reason}.` : `Cannot write to ${JSON.stringify(op.path)}.`, fix: 'Use a JSON Pointer such as "/filters/region" with a plain value.' });
    } else if (op.op === "removeData") {
      const next = removeAt(data, op.path);
      if (next) data = next;
      else issues.push({ code: "invalid-data", path: op.path, message: `Cannot remove ${JSON.stringify(op.path)}.`, fix: 'Use a JSON Pointer such as "/filters/region".' });
    }
  }
  const bad = dataIssue(data);
  if (bad) return fatal(bad);

  const validation: SurfaceValidationContext = { catalogue: ctx.catalogue, data, actionTools: ctx.actionTools };
  const byId = new Map(spec.components.map((c) => [c.id, c]));
  const rejected = new Set((spec.issues ?? []).flatMap((i) => (i.componentId && !byId.has(i.componentId) ? [i.componentId] : [])));
  const carried = new Map<string, SurfaceIssue[]>();
  for (const issue of spec.issues ?? []) {
    if (issue.componentId && rejected.has(issue.componentId)) carried.set(issue.componentId, [...(carried.get(issue.componentId) ?? []), issue]);
  }
  let root = spec.root;
  let title = spec.title;

  for (const op of ops) {
    if (!isObject(op)) {
      issues.push({ code: "invalid-shape", message: "Each operation must be an object.", fix: "Send { op, ... }." });
      continue;
    }
    switch (op.op) {
      case "setData":
      case "removeData":
        break;
      case "upsertComponents": {
        if (!Array.isArray(op.components)) {
          issues.push({ code: "invalid-shape", path: "/components", message: "upsertComponents needs a `components` array.", fix: "Send the changed components in full." });
          break;
        }
        for (const raw of op.components) {
          const found = validateSurfaceComponent(raw, validation);
          const id = isObject(raw) && typeof raw["id"] === "string" ? raw["id"] : undefined;
          if (found.length) {
            issues.push(...found);
            if (id && !byId.has(id)) {
              rejected.add(id);
              carried.set(id, found);
            }
            continue;
          }
          const component = raw as SurfaceComponent;
          byId.set(component.id, component);
          rejected.delete(component.id);
          carried.delete(component.id);
        }
        break;
      }
      case "removeComponents": {
        const ids = new Set(Array.isArray(op.ids) ? op.ids : []);
        for (const id of ids) {
          byId.delete(id);
          rejected.delete(id);
          carried.delete(id);
        }
        // Dropping a child from its parent's list is unambiguous, so it is done
        // here rather than bounced back as a dangling reference.
        for (const [id, component] of byId) {
          const children = component["children"];
          if (Array.isArray(children) && children.some((c) => ids.has(c as string))) {
            byId.set(id, { ...component, children: children.filter((c) => !ids.has(c as string)) });
          }
        }
        break;
      }
      case "setRoot":
        if (isSurfaceId(op.root)) root = op.root;
        else issues.push({ code: "missing-root", path: "/root", message: "setRoot needs a component id.", fix: 'Send { "op": "setRoot", "root": "main" }.' });
        break;
      case "setTitle":
        if (typeof op.title === "string") title = op.title;
        else issues.push({ code: "invalid-shape", path: "/title", message: "setTitle needs a string `title`.", fix: 'Send { "op": "setTitle", "title": "Overview" }.' });
        break;
      default:
        issues.push({
          code: "invalid-shape",
          message: `Unknown operation ${JSON.stringify((op as { op?: unknown }).op)}.`,
          fix: "Use upsertComponents, removeComponents, setRoot, setTitle, setData or removeData.",
        });
    }
  }

  const components = [...byId.values()];
  if (components.length > SURFACE_LIMITS.components) return fatal(tooMany(components.length));

  const graph = validateSurfaceGraph(root, components, ctx.catalogue, rejected);
  issues.push(...graph);
  const kept = [...[...carried.values()].flat(), ...graph];
  const { issues: _previous, title: _title, ...rest } = spec;

  return {
    issues,
    spec: {
      ...rest,
      ...(title ? { title } : {}),
      root,
      components,
      data,
      revision: spec.revision + 1,
      ...(kept.length ? { issues: kept } : {}),
    },
  };
}

/**
 * A surface from arguments still streaming in: every complete, valid component so
 * far. The last entry is usually half-written, so a failure here is not an error,
 * only something that has not arrived.
 */
export function previewSurface(partial: unknown, catalogue: SurfaceCatalogue): SurfaceSpec | undefined {
  if (!isObject(partial)) return undefined;
  const { surfaceId, root, components, data, title } = partial;
  if (!isSurfaceId(surfaceId) || !isSurfaceId(root) || !Array.isArray(components)) return undefined;
  const model = isObject(data) && !findUnsafe(data) ? data : {};
  const validation: SurfaceValidationContext = { catalogue, data: model };
  const seen = new Set<string>();
  const valid: SurfaceComponent[] = [];
  for (const raw of components.slice(0, SURFACE_LIMITS.components)) {
    if (validateSurfaceComponent(raw, validation).length) continue;
    const component = raw as SurfaceComponent;
    if (seen.has(component.id)) continue;
    seen.add(component.id);
    valid.push(component);
  }
  if (!valid.length) return undefined;
  return {
    kind: SURFACE_CARD_KIND,
    version: SURFACE_FORMAT_VERSION,
    surfaceId,
    ...(typeof title === "string" && title ? { title } : {}),
    root,
    components: valid,
    data: model,
    revision: 0,
  };
}

/**
 * Re-validate a spec at the renderer. A thread can be edited in storage and a
 * catalogue can shrink between sessions, so what was valid when written is not
 * trusted when read. Whether a bound card is valid depends on the data of the
 * moment, so that one check is left to the render that resolves it.
 */
export function sanitizeSurfaceSpec(spec: SurfaceSpec, catalogue: SurfaceCatalogue): SurfaceSpec {
  const components = Array.isArray(spec.components) ? spec.components.slice(0, SURFACE_LIMITS.components) : [];
  const data = isObject(spec.data) && !findUnsafe(spec.data) ? spec.data : {};
  const checked = validateSurfaceComponents(components, { catalogue, data, deferBoundCards: true });
  const rejected = new Set(checked.issues.flatMap((i) => (i.componentId ? [i.componentId] : [])));
  const root = typeof spec.root === "string" ? spec.root : "";
  const graph = validateSurfaceGraph(root, checked.components, catalogue, rejected);
  const previous = (spec.issues ?? []).filter((i) => i?.componentId && !checked.components.some((c) => c.id === i.componentId));
  const issues = [...checked.issues, ...graph, ...previous];
  const { issues: _old, ...rest } = spec;
  return { ...rest, root, components: checked.components, data, ...(issues.length ? { issues } : {}) };
}
