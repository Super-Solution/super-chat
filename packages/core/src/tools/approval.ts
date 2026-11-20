// The card a person sees before a `side: "confirm"` tool runs.
//
// It is written for the person approving the action, not for the model or a
// developer: no tool names, package names or raw JSON. Those stay in the run
// trace, where a developer can still find them.

import type { CardSpec } from "../cards/types.js";
import type { ToolApproval, ToolDefinition } from "./types.js";

const MAX_FIELDS = 6;
const MAX_VALUE_CHARS = 160;
const MAX_DESCRIPTION_CHARS = 240;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "documentId" → "Document", "max_retry_count" → "Max retry count". */
export function humanizeFieldName(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length > 1 && (words[words.length - 1] === "id" || words[words.length - 1] === "ids")) words.pop();
  const text = words.join(" ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

/** A value as plain text, or `undefined` when it has no short plain form. */
function plainValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() ? clip(value.trim(), MAX_VALUE_CHARS) : undefined;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const items = value.map(plainValue);
    if (value.length && items.every((item) => item !== undefined)) return clip(items.join(", "), MAX_VALUE_CHARS);
    return value.length === 1 ? "1 item" : `${value.length} items`;
  }
  return undefined;
}

/** The first sentence of a tool description: the part that says what it does. */
function firstSentence(description: string): string {
  const text = description.trim().replace(/\s+/g, " ");
  const end = text.search(/[.!?](\s|$)/);
  return clip(end === -1 ? text : text.slice(0, end + 1), MAX_DESCRIPTION_CHARS);
}

function fieldsOf(input: unknown): { label: string; value: string }[] {
  if (input === undefined || input === null) return [];
  if (typeof input !== "object" || Array.isArray(input)) {
    const value = plainValue(input);
    return value === undefined ? [] : [{ label: "Details", value }];
  }
  const fields: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(input)) {
    const value = plainValue(raw);
    if (value !== undefined) fields.push({ label: humanizeFieldName(key), value });
    if (fields.length === MAX_FIELDS) break;
  }
  return fields;
}

const MAX_TITLE_CHARS = 120;
const MAX_LABEL_CHARS = 40;

const textOr = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? clip(value.trim().replace(/\s+/g, " "), max) : undefined;

/**
 * The tool's own wording, kept to plain text of sane length. A plugin's hook is code
 * the host does not control, so anything that is not a string is dropped.
 */
function customApproval(tool: Pick<ToolDefinition, "approval">, input: unknown): ToolApproval | undefined {
  if (typeof tool.approval !== "function") return undefined;
  let raw: unknown;
  try {
    raw = tool.approval(input);
  } catch {
    // A broken copy hook must not block the approval itself.
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const title = textOr(r["title"], MAX_TITLE_CHARS);
  const description = textOr(r["description"], MAX_DESCRIPTION_CHARS);
  const confirmLabel = textOr(r["confirmLabel"], MAX_LABEL_CHARS);
  const cancelLabel = textOr(r["cancelLabel"], MAX_LABEL_CHARS);
  const summary = Array.isArray(r["summary"])
    ? r["summary"].flatMap((row: unknown) => {
        const label = textOr((row as { label?: unknown } | null)?.label, MAX_LABEL_CHARS);
        const value = textOr((row as { value?: unknown } | null)?.value, MAX_VALUE_CHARS);
        return label && value ? [{ label, value }] : [];
      }).slice(0, MAX_FIELDS)
    : undefined;
  // Wording with neither a question nor a sentence says nothing; use the generic card.
  if (!title && !description) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(summary ? { summary } : {}),
    ...(confirmLabel ? { confirmLabel } : {}),
    ...(cancelLabel ? { cancelLabel } : {}),
    ...(typeof r["danger"] === "boolean" ? { danger: r["danger"] } : {}),
  };
}

/**
 * The approval card for a tool call. A tool's own `approval` wording wins; without it
 * the card uses the first sentence of the description and the input's plain fields.
 */
export function approvalCard(
  tool: Pick<ToolDefinition, "description" | "approval">,
  input: unknown,
  options: { danger?: boolean } = {},
): CardSpec {
  const custom = customApproval(tool, input);
  let description: string | undefined = custom?.description ?? firstSentence(tool.description);
  // A tool that words its own approval decides which details to list; without wording, the input's plain fields.
  let summary = custom ? (custom.summary ?? []) : fieldsOf(input);
  // With neither a sentence nor details there is nothing to approve but the bare act, so name it.
  if (!summary.length && !description) summary = [{ label: "Action", value: "Run a tool" }];
  description ||= undefined;
  const danger = custom?.danger ?? options.danger;
  return {
    kind: "confirm",
    title: custom?.title ?? "Allow this?",
    ...(description ? { description } : {}),
    summary,
    confirmLabel: custom?.confirmLabel ?? "Allow",
    cancelLabel: custom?.cancelLabel ?? "Not now",
    ...(danger ? { danger: true } : {}),
  };
}
