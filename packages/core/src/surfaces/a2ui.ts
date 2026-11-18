// One-way export to A2UI v0.9.1 messages (a2ui.org), with no runtime dependency.
//
// The formats share their structure: a flat list, ids for children, JSON Pointers
// for data. Components with a basic-catalogue counterpart are renamed to it; the
// rest keep their names and rely on this catalogue id, as A2UI's custom catalogues
// allow. `$query`, `set` and `tool` have no A2UI equivalent and travel as namespaced
// function calls and events that a receiving client would have to implement.

import { isSurfaceBinding } from "./bindings.js";
import type { SurfaceAction, SurfaceComponent, SurfaceSpec } from "./types.js";

export const A2UI_VERSION = "v0.9.1" as const;
export const SURFACE_A2UI_CATALOG_ID = "urn:supersolutions:super-chat:surface-catalog:v1" as const;

export type A2uiMessage =
  | { version: typeof A2UI_VERSION; createSurface: { surfaceId: string; catalogId: string; sendDataModel: boolean } }
  | { version: typeof A2UI_VERSION; updateComponents: { surfaceId: string; components: Record<string, unknown>[] } }
  | { version: typeof A2UI_VERSION; updateDataModel: { surfaceId: string; path: string; value: unknown } }
  | { version: typeof A2UI_VERSION; deleteSurface: { surfaceId: string } };

const toDynamic = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(toDynamic);
  if (typeof value !== "object" || value === null) return value;
  if (isSurfaceBinding(value)) {
    if ("$path" in value) return { path: value.$path };
    if ("$item" in value) return { path: value.$item };
    if ("$template" in value) {
      return { call: "formatString", args: { value: value.$template.replace(/\{(\/[^{}]*)\}/g, "$${$1}").replace(/\{\.([^{}]*)\}/g, "$${$1}") } };
    }
    return { call: "superchat.query", args: toDynamic(value.$query) };
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toDynamic(v)]));
};

const toAction = (action: SurfaceAction): unknown => {
  switch (action.type) {
    case "event":
      return { event: { name: action.name, ...(action.context ? { context: toDynamic(action.context) } : {}) } };
    case "set":
      return { functionCall: { call: "superchat.set", args: { updates: toDynamic(action.updates) } } };
    case "tool":
      return { event: { name: "superchat.tool", context: toDynamic({ tool: action.tool, args: action.args ?? {}, resultPath: action.resultPath }) } };
  }
};

const TEXT_VARIANTS: Record<string, string> = { title: "h2", heading: "h4", body: "body", caption: "caption", label: "caption", code: "body" };

function toComponents(component: SurfaceComponent, rename: (id: string) => string): Record<string, unknown>[] {
  const { id, component: name, visibleWhen: _visibleWhen, ...rest } = component;
  const base = { id: rename(id) };
  const props = toDynamic(rest) as Record<string, unknown>;
  const children = Array.isArray(rest["children"]) ? (rest["children"] as string[]).map(rename) : undefined;

  switch (name) {
    case "Stack":
      return [{ ...base, component: rest["direction"] === "horizontal" ? "Row" : "Column", children, ...(rest["justify"] ? { justify: rest["justify"] === "between" ? "spaceBetween" : rest["justify"] } : {}), ...(rest["align"] ? { align: rest["align"] } : {}) }];
    case "Text":
      return [{ ...base, component: "Text", text: props["text"], ...(typeof rest["variant"] === "string" ? { variant: TEXT_VARIANTS[rest["variant"]] } : {}) }];
    case "Image":
      return [{ ...base, component: "Image", url: props["src"] }];
    case "Divider":
      return [{ ...base, component: "Divider" }];
    case "Tabs":
      return [{ ...base, component: "Tabs", tabs: (rest["tabs"] as { label: string; child: string }[]).map((t) => ({ title: t.label, child: rename(t.child) })) }];
    case "List": {
      const items = rest["items"];
      const path = isSurfaceBinding(items) && "$path" in items ? items.$path : undefined;
      return path
        ? [{ ...base, component: "List", children: { path, componentId: rename(rest["child"] as string) } }]
        : [{ ...base, component: name, ...props, child: rename(rest["child"] as string) }];
    }
    case "Field":
      return [{ ...base, component: rest["type"] === "date" ? "DateTimeInput" : "TextField", label: props["label"], value: props["value"] }];
    case "Select":
      return [{ ...base, component: "ChoicePicker", label: props["label"], value: props["value"], options: props["options"], variant: "mutuallyExclusive" }];
    case "Toggle":
      return [{ ...base, component: "CheckBox", label: props["label"], value: props["value"] }];
    case "Slider":
      return [{ ...base, component: "Slider", label: props["label"], value: props["value"], min: props["min"], max: props["max"] }];
    case "Button": {
      const labelId = rename(`${id}__label`);
      return [
        { ...base, component: "Button", child: labelId, variant: rest["variant"] === "primary" ? "primary" : "borderless", action: toAction(rest["action"] as SurfaceAction) },
        { id: labelId, component: "Text", text: props["label"] },
      ];
    }
    default:
      return [{ ...base, component: name, ...props, ...(children ? { children } : {}) }];
  }
}

/** The messages that would recreate this surface in an A2UI client. */
export function toA2uiMessages(spec: SurfaceSpec): A2uiMessage[] {
  const { surfaceId } = spec;
  if (spec.deleted) return [{ version: A2UI_VERSION, deleteSurface: { surfaceId } }];
  // A2UI requires the top component to be called "root".
  const rename = (id: string) => (id === spec.root ? "root" : id === "root" ? `${spec.root}__swapped` : id);
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: SURFACE_A2UI_CATALOG_ID, sendDataModel: true } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components: spec.components.flatMap((c) => toComponents(c, rename)) } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: "/", value: spec.data } },
  ];
}
