/**
 * How an editor document travels through chat: the card kind, its spec and its
 * validator. The editor package (any license) implements the renderer; hosts
 * and agents only need this file to produce and route the card.
 */
import type { CardKindDefinition, CardValidationResult } from "./chat.js";

export const EDITOR_CARD_KIND = "super-editor.document";

export interface EditorCardSpec {
  kind: typeof EDITOR_CARD_KIND;
  title?: string;
  mode?: "view" | "edit";
  /**
   * The document inline (schemaVersion 1 report document). Opaque to the
   * protocol; the editor validates it in full when it mounts.
   */
  document?: { schemaVersion: 1; id: string; title: string; blocks: unknown[]; [key: string]: unknown };
  /** Or a reference to a document held by a running editor service (read-only in v0). */
  service?: { baseUrl: string; documentId: string };
}

const fail = (error: string, expected?: string): CardValidationResult => (expected ? { ok: false, error, expected } : { ok: false, error });

export function validateEditorCardSpec(spec: unknown): CardValidationResult {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) return fail("Editor card spec must be an object.");
  const s = spec as Record<string, unknown>;
  if (s.kind !== EDITOR_CARD_KIND) return fail(`kind must be "${EDITOR_CARD_KIND}".`);
  if (s.title !== undefined && typeof s.title !== "string") return fail("title must be a string.");
  if (s.mode !== undefined && s.mode !== "view" && s.mode !== "edit") return fail('mode must be "view" or "edit".');
  const hasDocument = s.document !== undefined;
  const hasService = s.service !== undefined;
  if (hasDocument === hasService) return fail("Provide exactly one of `document` or `service`.", "document: {...} | service: { baseUrl, documentId }");
  if (hasService && s.mode === "edit") return fail("A service-backed document is read-only for now: use an inline document to edit.");
  if (hasDocument) {
    const d = s.document as Record<string, unknown> | null;
    if (typeof d !== "object" || d === null || d.schemaVersion !== 1 || typeof d.id !== "string" || typeof d.title !== "string" || !Array.isArray(d.blocks)) {
      return fail("document must be a schemaVersion 1 report document with id, title and blocks.");
    }
  } else {
    const v = s.service as Record<string, unknown> | null;
    let ok = false;
    if (typeof v === "object" && v !== null && typeof v.baseUrl === "string" && typeof v.documentId === "string" && v.documentId !== "") {
      try {
        const u = new URL(v.baseUrl);
        ok = u.protocol === "https:" || u.protocol === "http:";
      } catch {
        /* invalid URL */
      }
    }
    if (!ok) return fail("service needs an http(s) baseUrl and a documentId.");
  }
  return { ok: true };
}

export const editorCardKind: CardKindDefinition = {
  kind: EDITOR_CARD_KIND,
  summary: "A research document the user can read and edit in place: headings, text, tables, charts and citations.",
  schema: {
    type: "object",
    required: ["kind"],
    properties: {
      kind: { const: EDITOR_CARD_KIND },
      title: { type: "string" },
      mode: { enum: ["view", "edit"] },
      document: { type: "object", description: "A schemaVersion 1 report document." },
      service: { type: "object", properties: { baseUrl: { type: "string" }, documentId: { type: "string" } }, required: ["baseUrl", "documentId"] },
    },
  },
  validate: validateEditorCardSpec,
};
