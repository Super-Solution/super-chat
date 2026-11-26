// The built-in surface vocabulary: layout, display, input and one action control.
//
// Names follow A2UI's basic catalogue where a counterpart exists. Every prop is
// enumerated and `additionalProperties` is false, which is what makes "no style,
// no className, no onClick" a property of the format rather than a filter on it.

import type { JSONSchema } from "../providers/types.js";
import type { SurfaceComponentDefinition } from "./catalogue.js";

const TONES = ["neutral", "positive", "negative", "warning", "info"];
const FORMATS = ["text", "number", "currency", "percent", "bytes", "duration", "datetime", "code"];
const GAPS = ["none", "xs", "sm", "md", "lg"];

/** Structural props are never bindings: the graph must be knowable before any data arrives. */
const fixed = (schema: JSONSchema): JSONSchema => ({ ...schema, "x-static": true });
const childIds: JSONSchema = /* @__PURE__ */ fixed({ type: "array", items: { type: "string" }, description: "Component ids, in display order." });
const childId = (description: string): JSONSchema => fixed({ type: "string", description });

/** A control's value must be a `$path`: it has to know where to write. */
const boundValue: JSONSchema = {
  type: "object",
  required: ["$path"],
  properties: { $path: { type: "string" } },
  additionalProperties: false,
  description: 'Two-way binding, e.g. { "$path": "/filters/region" }.',
  "x-static": true,
};

export const CONDITION_SCHEMA: JSONSchema = /* @__PURE__ */ fixed({
  type: "object",
  required: ["path"],
  properties: {
    path: { type: "string" },
    op: { type: "string", enum: ["truthy", "falsy", "eq", "ne", "gt", "gte", "lt", "lte", "in"] },
    value: {},
  },
  additionalProperties: false,
});

export const ACTION_SCHEMA: JSONSchema = /* @__PURE__ */ fixed({
  type: "object",
  required: ["type"],
  description:
    'One of { "type": "set", "updates": [{ "path", "value" }] }, { "type": "tool", "tool", "args", "resultPath" }, { "type": "event", "name", "context" }.',
});

const props = (properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const text = (description?: string): JSONSchema => ({ type: "string", ...(description ? { description } : {}) });

export const SURFACE_PRIMITIVES: SurfaceComponentDefinition[] = [
  {
    name: "Stack",
    category: "layout",
    summary: "Arrange children in a column or a row.",
    props: props(
      {
        children: childIds,
        direction: { type: "string", enum: ["vertical", "horizontal"] },
        gap: { type: "string", enum: GAPS },
        align: { type: "string", enum: ["start", "center", "end", "stretch"] },
        justify: { type: "string", enum: ["start", "center", "end", "between"] },
        wrap: { type: "boolean" },
      },
      ["children"],
    ),
    slots: (p) => (p["children"] as string[]) ?? [],
  },
  {
    name: "Grid",
    category: "layout",
    summary: "Equal columns that collapse on narrow containers.",
    props: props(
      {
        children: childIds,
        columns: { type: "integer", minimum: 1, maximum: 4 },
        gap: { type: "string", enum: GAPS },
      },
      ["children"],
    ),
    slots: (p) => (p["children"] as string[]) ?? [],
  },
  {
    name: "Section",
    category: "layout",
    summary: "A titled group of children.",
    props: props(
      {
        title: text(),
        description: text(),
        tone: { type: "string", enum: TONES },
        children: childIds,
      },
      ["children"],
    ),
    slots: (p) => (p["children"] as string[]) ?? [],
  },
  {
    name: "Tabs",
    category: "layout",
    summary: "Switch between named panels. Keyboard accessible.",
    props: props(
      {
        label: text("Names the tab list for screen readers."),
        value: { ...boundValue, description: "Optional binding for the selected tab id." },
        tabs: fixed({
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            required: ["id", "label", "child"],
            properties: { id: { type: "string" }, label: { type: "string" }, child: { type: "string" } },
            additionalProperties: false,
          },
        }),
      },
      ["tabs"],
    ),
    slots: (p) => ((p["tabs"] as { child: string }[]) ?? []).map((t) => t.child),
  },
  {
    name: "List",
    category: "layout",
    summary: "Repeat one template for each row of an array; the template reads rows with $item.",
    props: props(
      {
        items: { type: "array", description: "A $path or $query that yields an array." },
        child: childId("The template component rendered once per row."),
        emptyText: text("Shown when there are no rows."),
        gap: { type: "string", enum: GAPS },
      },
      ["items", "child"],
    ),
    slots: (p) => (typeof p["child"] === "string" ? [p["child"]] : []),
    templateSlots: (p) => (typeof p["child"] === "string" ? [p["child"]] : []),
  },
  { name: "Divider", category: "layout", summary: "A horizontal rule between groups.", props: props({}) },
  {
    name: "Text",
    category: "display",
    summary: "Plain text. Never parsed as HTML or Markdown.",
    props: props(
      {
        text: { type: ["string", "number"] },
        variant: { type: "string", enum: ["title", "heading", "body", "caption", "label", "code"] },
        tone: { type: "string", enum: TONES },
      },
      ["text"],
    ),
  },
  {
    name: "Metric",
    category: "display",
    summary: "One headline number with a label and optional change.",
    props: props(
      {
        label: text(),
        value: { type: ["string", "number", "null"] },
        format: { type: "string", enum: FORMATS },
        delta: { type: "number" },
        deltaFormat: { type: "string", enum: FORMATS },
        hint: text(),
        tone: { type: "string", enum: TONES },
      },
      ["label", "value"],
    ),
  },
  {
    name: "Badge",
    category: "display",
    summary: "A short status label.",
    props: props({ text: { type: ["string", "number"] }, tone: { type: "string", enum: TONES } }, ["text"]),
  },
  {
    name: "Image",
    category: "display",
    summary: "An http(s) image with required alt text.",
    props: props({ src: text(), alt: text(), caption: text() }, ["src", "alt"]),
  },
  {
    name: "Link",
    category: "display",
    summary: "An http(s) link that opens in a new tab.",
    props: props({ text: text(), href: text() }, ["text", "href"]),
  },
  {
    name: "Field",
    category: "input",
    summary: "Text, number, date or multi-line input bound to the data model.",
    props: props(
      {
        label: text(),
        value: boundValue,
        type: { type: "string", enum: ["text", "number", "date", "textarea"] },
        placeholder: text(),
        helper: text(),
        min: { type: "number" },
        max: { type: "number" },
        step: { type: "number" },
      },
      ["label", "value"],
    ),
  },
  {
    name: "Select",
    category: "input",
    summary: "Choose one option; writes its value to the data model.",
    props: props(
      {
        label: text(),
        value: boundValue,
        options: {
          type: "array",
          items: {
            type: "object",
            required: ["value", "label"],
            properties: { value: { type: ["string", "number", "boolean"] }, label: { type: "string" } },
            additionalProperties: false,
          },
        },
        helper: text(),
      },
      ["label", "value", "options"],
    ),
  },
  {
    name: "Toggle",
    category: "input",
    summary: "An on/off switch bound to a boolean.",
    props: props({ label: text(), value: boundValue, helper: text() }, ["label", "value"]),
  },
  {
    name: "Slider",
    category: "input",
    summary: "Pick a number in a range.",
    props: props(
      {
        label: text(),
        value: boundValue,
        min: { type: "number" },
        max: { type: "number" },
        step: { type: "number" },
        format: { type: "string", enum: FORMATS },
      },
      ["label", "value", "min", "max"],
    ),
  },
  {
    name: "Button",
    category: "action",
    summary: "Runs one action when pressed: set local state, call an allowed tool, or send the agent an event.",
    props: props(
      {
        label: text(),
        action: ACTION_SCHEMA,
        variant: { type: "string", enum: ["primary", "secondary", "ghost", "danger"] },
        disabledWhen: CONDITION_SCHEMA,
      },
      ["label", "action"],
    ),
  },
];
