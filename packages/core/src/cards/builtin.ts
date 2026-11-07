// The built-in card catalogue — the agent's default visual vocabulary.
//
// Chosen to span the presentations an agent actually needs, not to be
// exhaustive: comparison (table), magnitude (stats), shape-over-time (chart),
// sequence (timeline), detail (keyvalue), long work (progress), rich text
// (markdown/code/diff), media, and the three interactive ones that let the agent
// ASK rather than assume (choice, form, confirm).
//
// Validators are permissive about extra fields and strict about the fields the
// renderer indexes. A card that renders with a missing optional is fine; a card
// whose `rows` is a string is a crash, so that is what we reject.

import { estimateJsonTokens } from "../tokens/estimate.js";
import { check, failed, isObj, type CardKindDefinition, type CardValidation } from "./registry.js";
import type { CardSpec } from "./types.js";

const ok: CardValidation = { ok: true };

/**
 * The entries of `spec[field]` that are already renderable. The last entry of
 * a streaming array is usually half-written; `ready` decides whether it can be
 * shown yet (a row with one cell can, a checklist item with no status cannot).
 */
const arrived = (spec: Record<string, unknown>, field: string, ready: (item: Record<string, unknown>) => boolean) => {
  const value = spec[field];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isObj(item) && ready(item)) : [];
};
const isScalar = (v: unknown) => typeof v === "string" || typeof v === "number";

const tokensOf = (spec: CardSpec) => estimateJsonTokens(spec);

const FORMATS = ["text", "number", "currency", "percent", "bytes", "duration", "datetime", "code"];

export const tableCard: CardKindDefinition = {
  kind: "table",
  summary: "Many items sharing the same fields. Search results, inventories, case lists, line items, survey rows.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "columns", "rows"],
    properties: {
      kind: { const: "table" },
      title: { type: "string" },
      caption: { type: "string" },
      columns: {
        type: "array",
        items: {
          type: "object",
          required: ["key", "label"],
          properties: {
            key: { type: "string", description: "Matches a key in each row object." },
            label: { type: "string" },
            format: { type: "string", enum: FORMATS },
            align: { type: "string", enum: ["left", "right", "center"] },
            pill: { type: "boolean", description: "Render the cell as a status pill." },
          },
        },
      },
      rows: { type: "array", items: { type: "object" }, description: "Objects keyed by column.key." },
      sortBy: { type: "string" },
      sortDir: { type: "string", enum: ["asc", "desc"] },
    },
  },
  validate(spec) {
    const s = check.object(spec, "table");
    if (failed(s)) return s;
    const cols = check.arrayField(s as Record<string, unknown>, "columns", "table");
    if (failed(cols)) return cols;
    const rows = check.arrayField(s as Record<string, unknown>, "rows", "table", 0);
    if (failed(rows)) return rows;
    for (const c of cols as unknown[]) {
      if (!isObj(c) || typeof c["key"] !== "string" || typeof c["label"] !== "string") {
        return { ok: false, error: "Each table column needs a string `key` and `label`.", expected: '{ key, label }' };
      }
    }
    return ok;
  },
  partial(spec) {
    const columns = arrived(spec, "columns", (c) => typeof c["key"] === "string" && typeof c["label"] === "string");
    if (!columns.length) return undefined;
    // A row shows from its first cell, so the table fills cell by cell. Sorting
    // waits for the whole card: rows land in arrival order rather than each new
    // one shuffling the ones already on screen.
    const rows = arrived(spec, "rows", (r) => Object.keys(r).length > 0);
    const { sortBy: _sortBy, sortDir: _sortDir, ...rest } = spec;
    return { ...rest, kind: "table", columns, rows } as CardSpec;
  },
};

export const statsCard: CardKindDefinition = {
  kind: "stats",
  summary: "A row of headline numbers, optionally with change vs a prior period. Totals, counts, rates, before/after.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "items"],
    properties: {
      kind: { const: "stats" },
      title: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "value"],
          properties: {
            label: { type: "string" },
            value: { type: ["string", "number"] },
            format: { type: "string", enum: FORMATS },
            delta: { type: "number", description: "Signed change; drives arrow and colour." },
            deltaFormat: { type: "string", enum: FORMATS },
            hint: { type: "string" },
            tone: { type: "string", enum: ["neutral", "positive", "negative", "warning", "info"] },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "stats");
    if (failed(s)) return s;
    const items = check.arrayField(s as Record<string, unknown>, "items", "stats");
    if (failed(items)) return items;
    for (const i of items as unknown[]) {
      if (!isObj(i) || typeof i["label"] !== "string" || i["value"] === undefined) {
        return { ok: false, error: "Each stat needs a `label` and a `value`.", expected: "{ label, value }" };
      }
    }
    return ok;
  },
  partial(spec) {
    const items = arrived(spec, "items", (i) => typeof i["label"] === "string" && isScalar(i["value"]));
    return items.length ? ({ ...spec, kind: "stats", items } as CardSpec) : undefined;
  },
};

export const chartCard: CardKindDefinition = {
  kind: "chart",
  summary:
    "Plot shape over time or across categories. `variant:\"series\"` with `series[]` for line/area/bar/scatter; `variant:\"candlestick\"` with `candles[]` for OHLC.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind"],
    properties: {
      kind: { const: "chart" },
      title: { type: "string" },
      variant: { type: "string", enum: ["series", "candlestick"] },
      xLabel: { type: "string" },
      yLabel: { type: "string" },
      xType: { type: "string", enum: ["time", "number", "category"] },
      stacked: { type: "boolean" },
      series: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "points"],
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["line", "area", "bar", "scatter"] },
            color: { type: "string" },
            axis: { type: "string", enum: ["left", "right"] },
            points: {
              type: "array",
              description: "[x, y] pairs. x may be a timestamp, number or category label.",
              items: { type: "array", items: [{ type: ["string", "number"] }, { type: "number" }] },
            },
          },
        },
      },
      candles: {
        type: "array",
        items: {
          type: "object",
          required: ["t", "o", "h", "l", "c"],
          properties: {
            t: { type: ["string", "number"] },
            o: { type: "number" },
            h: { type: "number" },
            l: { type: "number" },
            c: { type: "number" },
            v: { type: "number" },
          },
        },
      },
      annotations: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "value"],
          properties: {
            type: { type: "string", enum: ["hline", "vline", "band", "marker"] },
            value: { type: ["string", "number"] },
            to: { type: ["string", "number"] },
            label: { type: "string" },
            tone: { type: "string", enum: ["neutral", "positive", "negative", "warning", "info"] },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "chart");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    const variant = o["variant"] ?? "series";
    if (variant === "candlestick") {
      const candles = check.arrayField(o, "candles", "chart");
      if (failed(candles)) return candles;
      for (const c of candles as unknown[]) {
        if (!isObj(c) || ["o", "h", "l", "c"].some((k) => typeof c[k] !== "number")) {
          return { ok: false, error: "Each candle needs numeric o, h, l, c.", expected: "{ t, o, h, l, c, v? }" };
        }
      }
      return ok;
    }
    const series = check.arrayField(o, "series", "chart");
    if (failed(series)) return series;
    for (const sr of series as unknown[]) {
      if (!isObj(sr) || typeof sr["name"] !== "string" || !Array.isArray(sr["points"])) {
        return { ok: false, error: "Each series needs a `name` and a `points` array.", expected: '{ name, points: [[x,y],…] }' };
      }
      // Catch the common mistake of `points: [1,2,3]` instead of `[[x,y],…]`.
      const first = (sr["points"] as unknown[])[0];
      if (first !== undefined && !Array.isArray(first)) {
        return { ok: false, error: "`points` must be [x, y] pairs, not bare values.", expected: "points: [[0, 12], [1, 15]]" };
      }
    }
    return ok;
  },
};

export const timelineCard: CardKindDefinition = {
  kind: "timeline",
  summary: "An ordered sequence of events with times and status. Best for history, schedules, execution traces.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "events"],
    properties: {
      kind: { const: "timeline" },
      title: { type: "string" },
      events: {
        type: "array",
        items: {
          type: "object",
          required: ["at", "label"],
          properties: {
            at: { type: ["string", "number"] },
            label: { type: "string" },
            detail: { type: "string" },
            tone: { type: "string", enum: ["neutral", "positive", "negative", "warning", "info"] },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "timeline");
    if (failed(s)) return s;
    const events = check.arrayField(s as Record<string, unknown>, "events", "timeline");
    return failed(events) ? events : ok;
  },
  partial(spec) {
    const events = arrived(spec, "events", (e) => typeof e["label"] === "string" && isScalar(e["at"]));
    return events.length ? ({ ...spec, kind: "timeline", events } as CardSpec) : undefined;
  },
};

export const keyValueCard: CardKindDefinition = {
  kind: "keyvalue",
  summary: "Labelled detail rows describing ONE thing. A record, a contract's key terms, a config, a profile.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "items"],
    properties: {
      kind: { const: "keyvalue" },
      title: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "value"],
          properties: {
            label: { type: "string" },
            value: { type: ["string", "number"] },
            format: { type: "string", enum: FORMATS },
            tone: { type: "string", enum: ["neutral", "positive", "negative", "warning", "info"] },
            mono: { type: "boolean", description: "Monospace — use for hashes, ids, addresses." },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "keyvalue");
    if (failed(s)) return s;
    const items = check.arrayField(s as Record<string, unknown>, "items", "keyvalue");
    return failed(items) ? items : ok;
  },
};

export const progressCard: CardKindDefinition = {
  kind: "progress",
  summary: "Multi-step work with per-step status. Best for long or background operations the user is waiting on.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "steps"],
    properties: {
      kind: { const: "progress" },
      title: { type: "string" },
      fraction: { type: "number", minimum: 0, maximum: 1 },
      steps: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "status"],
          properties: {
            label: { type: "string" },
            status: { type: "string", enum: ["pending", "active", "done", "failed", "skipped"] },
            detail: { type: "string" },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "progress");
    if (failed(s)) return s;
    const steps = check.arrayField(s as Record<string, unknown>, "steps", "progress");
    if (failed(steps)) return steps;
    const valid = new Set(["pending", "active", "done", "failed", "skipped"]);
    for (const st of steps as unknown[]) {
      if (!isObj(st) || !valid.has(String(st["status"]))) {
        return { ok: false, error: "Each step needs a status of pending|active|done|failed|skipped." };
      }
    }
    return ok;
  },
};

export const mediaCard: CardKindDefinition = {
  kind: "media",
  summary: "Images, audio, or video with captions.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "items"],
    properties: {
      kind: { const: "media" },
      title: { type: "string" },
      layout: { type: "string", enum: ["grid", "single"] },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string" },
            alt: { type: "string" },
            caption: { type: "string" },
            mediaType: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
            durationMs: { type: "number" },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "media");
    if (failed(s)) return s;
    const items = check.arrayField(s as Record<string, unknown>, "items", "media");
    return failed(items) ? items : ok;
  },
};

export const markdownCard: CardKindDefinition = {
  kind: "markdown",
  summary: "Formatted long-form text. Use only when structure genuinely needs headings/lists — plain replies do not need a card.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "body"],
    properties: { kind: { const: "markdown" }, title: { type: "string" }, body: { type: "string" } },
  },
  validate(spec) {
    const s = check.object(spec, "markdown");
    if (failed(s)) return s;
    return typeof (s as Record<string, unknown>)["body"] === "string"
      ? ok
      : { ok: false, error: "markdown.body must be a string." };
  },
  partial(spec) {
    const body = typeof spec["body"] === "string" ? spec["body"] : "";
    if (!body && typeof spec["title"] !== "string") return undefined;
    return { ...spec, kind: "markdown", body } as CardSpec;
  },
};

export const documentCard: CardKindDefinition = {
  kind: "document",
  // Written for the model, and deliberately about SIZE and REUSE rather than
  // about formatting: the distinction the model has to get right is "this is a
  // thing we will keep working on" versus "this is a long answer".
  summary:
    "A document the user will keep, read in a previewer and come back to. Use for something worth revising — a draft, a report, a set of notes — not for a long reply. Returns an id later turns use to re-read or edit it.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "docId", "title", "markdown", "revision"],
    properties: {
      kind: { const: "document" },
      docId: { type: "string" },
      title: { type: "string" },
      markdown: { type: "string" },
      revision: { type: "number" },
    },
  },
  validate(spec) {
    const s = check.object(spec, "document");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    if (typeof o["docId"] !== "string" || !o["docId"]) {
      return { ok: false, error: "document.docId must be a non-empty string." };
    }
    if (typeof o["title"] !== "string") return { ok: false, error: "document.title must be a string." };
    if (typeof o["markdown"] !== "string") return { ok: false, error: "document.markdown must be a string." };
    // A missing revision would let a stale edit through as revision 0, which is
    // exactly the failure the token exists to prevent — so it is required, not
    // defaulted.
    return typeof o["revision"] === "number"
      ? ok
      : { ok: false, error: "document.revision must be a number." };
  },
};

export const editReviewCard: CardKindDefinition = {
  kind: "editreview",
  interactive: true,
  summary:
    "Propose changes to a document and let the user accept them hunk by hunk. The only way to change a document — nothing is written until this is answered.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "docId", "title", "revision", "hunks"],
    properties: {
      kind: { const: "editreview" },
      docId: { type: "string" },
      title: { type: "string" },
      revision: { type: "number" },
      summary: { type: "string" },
      hunks: {
        type: "array",
        items: {
          type: "object",
          required: ["index", "block", "removed", "added"],
          properties: {
            index: { type: "number" },
            block: { type: "number" },
            removed: { type: "array", items: { type: "string" } },
            added: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "editreview");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    if (typeof o["docId"] !== "string" || !o["docId"]) {
      return { ok: false, error: "editreview.docId must be a non-empty string." };
    }
    if (typeof o["revision"] !== "number") {
      return { ok: false, error: "editreview.revision must be a number." };
    }
    const hunks = o["hunks"];
    if (!Array.isArray(hunks) || hunks.length === 0) {
      // An empty review would render as an approval prompt for nothing, and a
      // user who clicks Apply on it has approved a no-op they cannot see.
      return { ok: false, error: "editreview.hunks must be a non-empty array." };
    }
    return ok;
  },
};

export const emailCard: CardKindDefinition = {
  kind: "email",
  // NOT interactive, despite being editable. "Interactive" here means the run
  // suspends until the user answers, and nothing waits on this: the draft is a
  // deliverable the user takes away, not a question the model asked. Marking it
  // interactive would serialise it against real decisions for no reason.
  summary:
    "A drafted message for the user to send themselves. Use when the outcome of the work is something that has to reach someone.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "to", "subject", "body"],
    properties: {
      kind: { const: "email" },
      to: { type: "array", items: { type: "string" } },
      cc: { type: "array", items: { type: "string" } },
      bcc: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      body: { type: "string" },
    },
  },
  validate(spec) {
    const s = check.object(spec, "email");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    if (!Array.isArray(o["to"])) return { ok: false, error: "email.to must be an array." };
    if (typeof o["subject"] !== "string") return { ok: false, error: "email.subject must be a string." };
    return typeof o["body"] === "string" ? ok : { ok: false, error: "email.body must be a string." };
  },
};

export const codeCard: CardKindDefinition = {
  kind: "code",
  summary: "A code block with language and optional filename.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "code"],
    properties: {
      kind: { const: "code" },
      title: { type: "string" },
      language: { type: "string" },
      filename: { type: "string" },
      code: { type: "string" },
    },
  },
  validate(spec) {
    const s = check.object(spec, "code");
    if (failed(s)) return s;
    return typeof (s as Record<string, unknown>)["code"] === "string" ? ok : { ok: false, error: "code.code must be a string." };
  },
};

export const diffCard: CardKindDefinition = {
  kind: "diff",
  summary: "Before/after comparison of two texts.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "before", "after"],
    properties: {
      kind: { const: "diff" },
      title: { type: "string" },
      language: { type: "string" },
      before: { type: "string" },
      after: { type: "string" },
    },
  },
  validate(spec) {
    const s = check.object(spec, "diff");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    return typeof o["before"] === "string" && typeof o["after"] === "string"
      ? ok
      : { ok: false, error: "diff needs string `before` and `after`." };
  },
};

export const comparisonCard: CardKindDefinition = {
  kind: "comparison",
  summary:
    "A matrix of options against criteria. Reach for this whenever the user is CHOOSING between things — vendors, clauses, plans, candidates, approaches. Boolean values render as ✓/✗.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "options", "criteria"],
    properties: {
      kind: { const: "comparison" },
      title: { type: "string" },
      options: {
        type: "array",
        description: "The things being compared. These become columns.",
        items: {
          type: "object",
          required: ["id", "label"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            note: { type: "string" },
            highlight: { type: "boolean", description: "Mark a recommended option." },
          },
        },
      },
      criteria: {
        type: "array",
        description: "The dimensions compared on. These become rows.",
        items: {
          type: "object",
          required: ["label", "values"],
          properties: {
            label: { type: "string" },
            detail: { type: "string" },
            weight: { type: "string", enum: ["low", "normal", "high"] },
            values: {
              type: "object",
              description: "Keyed by option id. true/false render as ✓/✗; null renders as —.",
              additionalProperties: true,
            },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "comparison");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    const options = check.arrayField(o, "options", "comparison");
    if (failed(options)) return options;
    const criteria = check.arrayField(o, "criteria", "comparison");
    if (failed(criteria)) return criteria;

    const ids = new Set<string>();
    for (const opt of options as unknown[]) {
      if (!isObj(opt) || typeof opt["id"] !== "string" || typeof opt["label"] !== "string") {
        return { ok: false, error: "Each comparison option needs a string `id` and `label`." };
      }
      if (ids.has(opt["id"])) return { ok: false, error: `Duplicate comparison option id "${opt["id"]}".` };
      ids.add(opt["id"]);
    }
    for (const c of criteria as unknown[]) {
      if (!isObj(c) || typeof c["label"] !== "string" || !isObj(c["values"])) {
        return { ok: false, error: "Each criterion needs a `label` and a `values` object keyed by option id.", expected: '{ label, values: { optionId: … } }' };
      }
    }
    return ok;
  },
};

const CHECK_STATUSES = new Set(["done", "todo", "blocked", "na"]);

export const checklistCard: CardKindDefinition = {
  kind: "checklist",
  summary:
    "Items with a state. Compliance reviews, launch readiness, document requirements, audit findings, QA passes. Use `group` to section a long list.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "items"],
    properties: {
      kind: { const: "checklist" },
      title: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "status"],
          properties: {
            label: { type: "string" },
            status: { type: "string", enum: ["done", "todo", "blocked", "na"] },
            detail: { type: "string" },
            group: { type: "string", description: "Heading to group consecutive items under." },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "checklist");
    if (failed(s)) return s;
    const items = check.arrayField(s as Record<string, unknown>, "items", "checklist");
    if (failed(items)) return items;
    for (const i of items as unknown[]) {
      if (!isObj(i) || typeof i["label"] !== "string" || !CHECK_STATUSES.has(String(i["status"]))) {
        return { ok: false, error: "Each checklist item needs a `label` and a status of done|todo|blocked|na." };
      }
    }
    return ok;
  },
  partial(spec) {
    // An item waits for its status: showing "todo" for one that is about to
    // say "blocked" would be a claim the model never made.
    const items = arrived(spec, "items", (i) => typeof i["label"] === "string" && CHECK_STATUSES.has(String(i["status"])));
    return items.length ? ({ ...spec, kind: "checklist", items } as CardSpec) : undefined;
  },
};

export const calloutCard: CardKindDefinition = {
  kind: "callout",
  summary:
    "One short highlighted note. Disclaimers, caveats, prerequisites, limits on what you checked. Use `danger` for anything the reader would regret missing.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "tone", "body"],
    properties: {
      kind: { const: "callout" },
      tone: { type: "string", enum: ["info", "warning", "danger", "success", "note"] },
      title: { type: "string" },
      body: { type: "string" },
    },
  },
  validate(spec) {
    const s = check.object(spec, "callout");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    if (typeof o["body"] !== "string") return { ok: false, error: "callout.body must be a string." };
    if (!["info", "warning", "danger", "success", "note"].includes(String(o["tone"]))) {
      return { ok: false, error: "callout.tone must be info|warning|danger|success|note." };
    }
    return ok;
  },
};

export const citationsCard: CardKindDefinition = {
  kind: "citations",
  summary:
    "The sources behind what you just said. Use whenever a claim rests on specific documents — case law, statutes, papers, filings, articles, internal docs. Quote the passage relied on in `snippet`.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "items"],
    properties: {
      kind: { const: "citations" },
      title: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            source: { type: "string", description: "Publication, court, statute, dataset, site." },
            url: { type: "string" },
            date: { type: ["string", "number"] },
            snippet: { type: "string", description: "The specific passage relied on." },
            locator: { type: "string", description: "Page, section, paragraph, or clause." },
            relevance: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "citations");
    if (failed(s)) return s;
    const items = check.arrayField(s as Record<string, unknown>, "items", "citations");
    if (failed(items)) return items;
    for (const i of items as unknown[]) {
      if (!isObj(i) || typeof i["title"] !== "string") {
        return { ok: false, error: "Each citation needs a `title`." };
      }
    }
    return ok;
  },
};

export const funnelCard: CardKindDefinition = {
  kind: "funnel",
  summary:
    "Staged drop-off, in order. Conversion funnels, hiring pipelines, application intake, case attrition. Stages must be ordered widest to narrowest.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "stages"],
    properties: {
      kind: { const: "funnel" },
      title: { type: "string" },
      format: { type: "string", enum: FORMATS },
      stages: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "value"],
          properties: { label: { type: "string" }, value: { type: "number" }, note: { type: "string" } },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "funnel");
    if (failed(s)) return s;
    const stages = check.arrayField(s as Record<string, unknown>, "stages", "funnel", 2);
    if (failed(stages)) return stages;
    for (const st of stages as unknown[]) {
      if (!isObj(st) || typeof st["label"] !== "string" || typeof st["value"] !== "number") {
        return { ok: false, error: "Each funnel stage needs a string `label` and a numeric `value`." };
      }
    }
    return ok;
  },
};

export const gaugeCard: CardKindDefinition = {
  kind: "gauge",
  summary:
    "One value on a scale, with optional named bands. Risk levels, readiness scores, sentiment, confidence, utilisation. Label the bands so the number means something.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "value"],
    properties: {
      kind: { const: "gauge" },
      title: { type: "string" },
      value: { type: "number" },
      min: { type: "number", description: "Default 0." },
      max: { type: "number", description: "Default 100." },
      label: { type: "string", description: "What the current value means in words." },
      format: { type: "string", enum: FORMATS },
      bands: {
        type: "array",
        items: {
          type: "object",
          required: ["from", "to", "label"],
          properties: {
            from: { type: "number" },
            to: { type: "number" },
            label: { type: "string" },
            tone: { type: "string", enum: ["neutral", "positive", "negative", "warning", "info"] },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "gauge");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    if (typeof o["value"] !== "number") return { ok: false, error: "gauge.value must be a number." };
    const min = typeof o["min"] === "number" ? o["min"] : 0;
    const max = typeof o["max"] === "number" ? o["max"] : 100;
    if (max <= min) return { ok: false, error: "gauge.max must be greater than gauge.min." };
    return ok;
  },
};

export const treeCard: CardKindDefinition = {
  kind: "tree",
  summary:
    "Nested structure. Document outlines, org charts, taxonomies, decision trees, dependency chains, file layouts.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "nodes"],
    properties: {
      kind: { const: "tree" },
      title: { type: "string" },
      nodes: {
        type: "array",
        description: "Each node is { label, detail?, tone?, children?: [ …same shape… ] }.",
        items: {
          type: "object",
          required: ["label"],
          properties: {
            label: { type: "string" },
            detail: { type: "string" },
            tone: { type: "string", enum: ["neutral", "positive", "negative", "warning", "info"] },
            children: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "tree");
    if (failed(s)) return s;
    const nodes = check.arrayField(s as Record<string, unknown>, "nodes", "tree");
    if (failed(nodes)) return nodes;

    // Depth-limited walk: a cyclic or absurdly deep tree would hang the renderer.
    const walk = (list: unknown[], depth: number): CardValidation => {
      if (depth > 8) return { ok: false, error: "tree nesting is limited to 8 levels." };
      for (const n of list) {
        if (!isObj(n) || typeof n["label"] !== "string") {
          return { ok: false, error: "Each tree node needs a string `label`." };
        }
        const kids = n["children"];
        if (kids !== undefined) {
          if (!Array.isArray(kids)) return { ok: false, error: "tree node `children` must be an array." };
          const inner = walk(kids, depth + 1);
          if (!inner.ok) return inner;
        }
      }
      return ok;
    };
    return walk(nodes as unknown[], 1);
  },
};

// ── Interactive ─────────────────────────────────────────────────────────────

export const choiceCard: CardKindDefinition = {
  kind: "choice",
  interactive: true,
  summary:
    "Ask the user to pick from options. Use instead of guessing when several candidates fit. Each option may carry `meta` facts shown on its row.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "options"],
    properties: {
      kind: { const: "choice" },
      title: { type: "string" },
      prompt: { type: "string" },
      multiple: { type: "boolean" },
      options: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "label"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            description: { type: "string" },
            imageUrl: { type: "string" },
            disabled: { type: "boolean" },
            disabledReason: { type: "string" },
            meta: {
              type: "array",
              items: {
                type: "object",
                required: ["label", "value"],
                properties: { label: { type: "string" }, value: { type: ["string", "number"] }, format: { type: "string", enum: FORMATS } },
              },
            },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "choice");
    if (failed(s)) return s;
    const options = check.arrayField(s as Record<string, unknown>, "options", "choice");
    if (failed(options)) return options;
    const ids = new Set<string>();
    for (const o of options as unknown[]) {
      if (!isObj(o) || typeof o["id"] !== "string" || typeof o["label"] !== "string") {
        return { ok: false, error: "Each choice option needs a string `id` and `label`." };
      }
      // Duplicate ids make the selection ambiguous when it comes back.
      if (ids.has(o["id"])) return { ok: false, error: `Duplicate choice option id "${o["id"]}".` };
      ids.add(o["id"]);
    }
    return ok;
  },
};

export const formCard: CardKindDefinition = {
  kind: "form",
  interactive: true,
  summary: "Collect structured input. Use when you need several values at once rather than a back-and-forth.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "fields"],
    properties: {
      kind: { const: "form" },
      title: { type: "string" },
      description: { type: "string" },
      submitLabel: { type: "string" },
      fields: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "label", "type"],
          properties: {
            name: { type: "string" },
            label: { type: "string" },
            type: { type: "string", enum: ["text", "textarea", "number", "select", "boolean"] },
            placeholder: { type: "string" },
            required: { type: "boolean" },
            min: { type: "number" },
            max: { type: "number" },
            step: { type: "number" },
            suffix: { type: "string" },
            options: {
              type: "array",
              items: { type: "object", required: ["value", "label"], properties: { value: { type: "string" }, label: { type: "string" } } },
            },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "form");
    if (failed(s)) return s;
    const fields = check.arrayField(s as Record<string, unknown>, "fields", "form");
    if (failed(fields)) return fields;
    const types = new Set(["text", "textarea", "number", "select", "boolean"]);
    for (const f of fields as unknown[]) {
      if (!isObj(f) || typeof f["name"] !== "string" || !types.has(String(f["type"]))) {
        return { ok: false, error: "Each field needs a `name` and a type of text|textarea|number|select|boolean." };
      }
      if (f["type"] === "select" && !Array.isArray(f["options"])) {
        return { ok: false, error: `Select field "${String(f["name"])}" needs an \`options\` array.` };
      }
    }
    return ok;
  },
};

export const confirmCard: CardKindDefinition = {
  kind: "confirm",
  interactive: true,
  summary:
    "Get explicit approval before a consequential action. `summary` must state exactly what will happen — amounts, targets, and anything irreversible.",
  estimateTokens: tokensOf,
  schema: {
    type: "object",
    required: ["kind", "title", "summary"],
    properties: {
      kind: { const: "confirm" },
      title: { type: "string" },
      description: { type: "string" },
      confirmLabel: { type: "string" },
      cancelLabel: { type: "string" },
      danger: { type: "boolean" },
      summary: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "value"],
          properties: {
            label: { type: "string" },
            value: { type: ["string", "number"] },
            tone: { type: "string", enum: ["neutral", "positive", "negative", "warning", "info"] },
            mono: { type: "boolean" },
          },
        },
      },
    },
  },
  validate(spec) {
    const s = check.object(spec, "confirm");
    if (failed(s)) return s;
    const o = s as Record<string, unknown>;
    if (typeof o["title"] !== "string") return { ok: false, error: "confirm.title is required." };
    const summary = check.arrayField(o, "summary", "confirm");
    if (failed(summary)) return summary;
    return ok;
  },
};

export const BUILTIN_CARDS: CardKindDefinition[] = [
  // structured data
  tableCard,
  statsCard,
  comparisonCard,
  keyValueCard,
  treeCard,
  // quantitative shape
  chartCard,
  funnelCard,
  gaugeCard,
  // sequence and state
  timelineCard,
  progressCard,
  checklistCard,
  // prose and evidence
  markdownCard,
  documentCard,
  calloutCard,
  citationsCard,
  codeCard,
  diffCard,
  mediaCard,
  // interactive — these ask the user and pause the run
  choiceCard,
  formCard,
  confirmCard,
  editReviewCard,
  emailCard,
];
