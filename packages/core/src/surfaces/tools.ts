// The agent's handle on surfaces: create, patch, delete, read, and look up schemas.
//
// Descriptions stay short on purpose. These definitions ride in every request, so
// they carry the shape of the format and point at `describeSurfaceComponents` for
// the rest.

import { packByPriority } from "../tokens/budget.js";
import { estimateJsonTokens } from "../tokens/estimate.js";
import type { ToolDefinition, ToolExecutionContext } from "../tools/types.js";
import type { SurfaceCatalogue } from "./catalogue.js";
import { SurfaceLedger, surfaceCardId } from "./ledger.js";
import { applySurfaceOperations, buildSurface, previewSurface } from "./operations.js";
import { getAt } from "./pointer.js";
import { SURFACE_CARD_KIND, SURFACE_FORMAT_VERSION, SURFACE_LIMITS, type SurfaceIssue, type SurfaceSpec } from "./types.js";

export const SURFACE_TOOL_NAMES = ["createSurface", "updateSurface", "deleteSurface", "readSurface", "describeSurfaceComponents"] as const;

export const SURFACE_GUIDE = [
  "A surface is an interface you assemble from a flat list of components that reference each other by id.",
  "",
  'Shape: { "surfaceId": "overview", "title": "Overview", "data": { "region": "all", "rows": [] }, "root": "main", "components": [',
  '  { "id": "main", "component": "Stack", "children": ["region", "total"] },',
  '  { "id": "region", "component": "Select", "label": "Region", "value": { "$path": "/region" }, "options": [{ "value": "all", "label": "All" }] },',
  '  { "id": "total", "component": "Metric", "label": "Total", "format": "number", "value": { "$query": { "from": "/rows", "where": [{ "field": "region", "value": { "$path": "/region" }, "ignore": "all" }], "aggregate": { "op": "sum", "field": "amount" } } } }',
  "] }",
  "",
  "Send `data` first, then `root`, then components parents before children, so the interface can draw as it streams.",
  "",
  "Bindings work in any prop: $path reads the data model, $template interpolates ({/path}, {.rowField}), $query filters, groups and aggregates rows, and $item reads the current row inside a List.",
  "Controls write to their `value` $path, so neighbours update with no call to you. Use `visibleWhen` to show parts conditionally.",
  'Cards are blocks: { "id": "trend", "component": "Card", "kind": "chart", "spec": { ... } }. Interactive card kinds also need `bind`.',
  "",
  "Button actions are exactly: set (local state), tool (a tool you may already call; it follows the same approval rules) and event (returns to you as a new message).",
  "Never send code, HTML, CSS or script URLs. Change an existing surface with updateSurface rather than creating another. Call readSurface before acting on what the person has chosen.",
].join("\n");

const toCorrections = (issues: readonly SurfaceIssue[]) => issues.slice(0, 12);

function outcome(spec: SurfaceSpec, issues: readonly SurfaceIssue[]) {
  const card = { card: spec, cardId: surfaceCardId(spec.surfaceId) };
  const facts = { surfaceId: spec.surfaceId, revision: spec.revision, components: spec.components.length };
  if (!issues.length) return { output: { ok: true, ...facts }, ...card };
  return {
    output: { ok: false, partial: true, ...facts, corrections: toCorrections(issues), next: "The valid parts are on screen. Send the corrected parts with updateSurface." },
    failure: "invalid-input" as const,
    ...card,
  };
}

const refused = (issues: readonly SurfaceIssue[]) => ({
  output: { ok: false, rendered: false, corrections: toCorrections(issues) },
  failure: "invalid-input" as const,
});

const unavailable = (surfaceId: unknown, ledger: SurfaceLedger) => {
  const spec = typeof surfaceId === "string" ? ledger.get(surfaceId) : undefined;
  return {
    output: {
      ok: false,
      error: spec?.expired
        ? `Surface "${String(surfaceId)}" expired from saved history. Call createSurface to rebuild it.`
        : `No surface "${String(surfaceId)}".`,
      available: ledger.live().map((s) => s.surfaceId),
    },
    failure: "not-found" as const,
  };
};

export type SurfaceToolsOptions = { catalogue: SurfaceCatalogue };

export function createSurfaceTools(options: SurfaceToolsOptions): ToolDefinition[] {
  const { catalogue } = options;
  // Used only when a tool runs outside runAgent, which supplies the real ledger.
  const standalone = new SurfaceLedger();
  const ledgerOf = (ctx: ToolExecutionContext) => ctx.surfaces ?? standalone;

  const createSurface: ToolDefinition = {
    name: "createSurface",
    side: "read",
    description:
      "Assemble an interactive interface from a flat component list: layout, text, metrics, inputs, buttons and any card. " +
      "Use it when the person will explore, filter, compare or act, rather than just read. " +
      "Call describeSurfaceComponents first for the format and each component's props.",
    inputSchema: {
      type: "object",
      required: ["surfaceId", "root", "components"],
      properties: {
        surfaceId: { type: "string", description: "Stable id for later updates." },
        title: { type: "string" },
        data: { type: "object", description: "Initial state that components bind to.", additionalProperties: true },
        root: { type: "string", description: "Id of the top component." },
        components: {
          type: "array",
          items: { type: "object", required: ["id", "component"], additionalProperties: true },
        },
      },
      additionalProperties: false,
    },
    loading: { kind: "generic", label: "Building the interface" },
    partialCard: (input) => previewSurface(input, catalogue),
    execute(input, ctx) {
      const ledger = ledgerOf(ctx);
      const surfaceId = (input as { surfaceId?: unknown } | null)?.surfaceId;
      const prior = typeof surfaceId === "string" ? ledger.get(surfaceId) : undefined;
      const replacing = prior && !prior.deleted && !prior.expired ? prior : undefined;
      if (!replacing && ledger.live().length >= SURFACE_LIMITS.surfaces) {
        return refused([{ code: "limit-exceeded", message: `A thread may hold ${SURFACE_LIMITS.surfaces} surfaces.`, fix: "Update or delete an existing surface." }]);
      }
      const built = buildSurface(input, { catalogue, actionTools: ctx.surfaceActionTools }, {
        revision: (prior?.revision ?? 0) + 1,
        originCallId: replacing?.originCallId ?? ctx.callId,
      });
      if (!built.spec) return refused(built.issues);
      ledger.put(built.spec);
      return outcome(built.spec, built.issues);
    },
  };

  const updateSurface: ToolDefinition = {
    name: "updateSurface",
    side: "read",
    description:
      "Patch a surface in place. Operations: upsertComponents { components }, removeComponents { ids }, setRoot { root }, setTitle { title }, setData { path, value }, removeData { path }.",
    inputSchema: {
      type: "object",
      required: ["surfaceId", "operations"],
      properties: {
        surfaceId: { type: "string" },
        operations: { type: "array", items: { type: "object", required: ["op"], additionalProperties: true } },
        expectedRevision: { type: "number", description: "Refuse the patch if the surface has changed since this revision." },
      },
      additionalProperties: false,
    },
    execute(input, ctx) {
      const ledger = ledgerOf(ctx);
      const { surfaceId, operations, expectedRevision } = (input ?? {}) as { surfaceId?: string; operations?: unknown; expectedRevision?: number };
      const current = surfaceId ? ledger.get(surfaceId) : undefined;
      if (!current || current.deleted || current.expired) return unavailable(surfaceId, ledger);
      if (expectedRevision != null && expectedRevision !== current.revision) {
        return refused([{
          code: "stale-revision",
          message: `The surface is at revision ${current.revision}, not ${expectedRevision}. The person may have changed it.`,
          fix: "Call readSurface, then patch against the current revision.",
        }]);
      }
      const built = applySurfaceOperations(current, operations, { catalogue, actionTools: ctx.surfaceActionTools });
      if (!built.spec) return refused(built.issues);
      ledger.put(built.spec);
      return outcome(built.spec, built.issues);
    },
  };

  const deleteSurface: ToolDefinition = {
    name: "deleteSurface",
    side: "read",
    description: "Remove a surface from the conversation.",
    inputSchema: {
      type: "object",
      required: ["surfaceId"],
      properties: { surfaceId: { type: "string" } },
      additionalProperties: false,
    },
    execute(input, ctx) {
      const ledger = ledgerOf(ctx);
      const { surfaceId } = (input ?? {}) as { surfaceId?: string };
      const current = surfaceId ? ledger.get(surfaceId) : undefined;
      if (!current || current.deleted) return unavailable(surfaceId, ledger);
      const tombstone: SurfaceSpec = {
        kind: SURFACE_CARD_KIND,
        version: SURFACE_FORMAT_VERSION,
        surfaceId: current.surfaceId,
        ...(current.title ? { title: current.title } : {}),
        root: "",
        components: [],
        data: {},
        revision: current.revision + 1,
        ...(current.originCallId ? { originCallId: current.originCallId } : {}),
        deleted: true,
      };
      ledger.put(tombstone);
      return { output: { ok: true, surfaceId: current.surfaceId, deleted: true }, card: tombstone, cardId: surfaceCardId(current.surfaceId) };
    },
  };

  const readSurface: ToolDefinition = {
    name: "readSurface",
    side: "read",
    description: "Read a surface's current state, including what the person has changed. Omit surfaceId to list surfaces.",
    inputSchema: {
      type: "object",
      properties: {
        surfaceId: { type: "string" },
        paths: { type: "array", items: { type: "string" }, description: "JSON Pointers to read instead of the whole data model." },
      },
      additionalProperties: false,
    },
    execute(input, ctx) {
      const ledger = ledgerOf(ctx);
      const { surfaceId, paths } = (input ?? {}) as { surfaceId?: string; paths?: string[] };
      if (!surfaceId) {
        return { output: { ok: true, surfaces: ledger.live().map((s) => ({ surfaceId: s.surfaceId, title: s.title, revision: s.revision })) } };
      }
      const spec = ledger.get(surfaceId);
      if (!spec || spec.deleted || spec.expired) return unavailable(surfaceId, ledger);
      return {
        output: {
          ok: true,
          surfaceId,
          ...(spec.title ? { title: spec.title } : {}),
          revision: spec.revision,
          root: spec.root,
          components: spec.components.map((c) => ({ id: c.id, component: c.component })),
          ...(Array.isArray(paths) ? { values: Object.fromEntries(paths.map((p) => [p, getAt(spec.data, p)])) } : { data: spec.data }),
          ...(spec.issues?.length ? { issues: toCorrections(spec.issues) } : {}),
        },
      };
    },
  };

  const describeSurfaceComponents: ToolDefinition = {
    name: "describeSurfaceComponents",
    side: "read",
    description: "Look up the surface format. No arguments returns the guide and component index; `components` returns those schemas, such as [\"Select\", \"Card:chart\"].",
    inputSchema: {
      type: "object",
      properties: {
        components: { type: "array", items: { type: "string" } },
        maxTokens: { type: "number", description: "Budget for the returned schemas. Default 1500." },
      },
      additionalProperties: false,
    },
    execute(input) {
      const { components, maxTokens } = (input ?? {}) as { components?: string[]; maxTokens?: number };
      if (!Array.isArray(components) || !components.length) {
        return { output: { ok: true, guide: SURFACE_GUIDE, index: catalogue.index() } };
      }
      const known = components.flatMap((name) => {
        const schema = catalogue.schemaOf(name);
        return schema ? [schema] : [];
      });
      const unknown = components.filter((name) => !catalogue.schemaOf(name));
      const budget = Math.max(200, Math.min(maxTokens ?? 1_500, 6_000));
      const packed = packByPriority(known, budget, estimateJsonTokens);
      return {
        output: {
          ok: true,
          schemas: packed.included,
          ...(packed.dropped.length ? { omitted: packed.dropped.map((d) => d.item.name), next: "Request the omitted components in another call." } : {}),
          ...(unknown.length ? { unknown, available: catalogue.names() } : {}),
        },
      };
    },
  };

  return [createSurface, updateSurface, deleteSurface, readSurface, describeSurfaceComponents];
}
