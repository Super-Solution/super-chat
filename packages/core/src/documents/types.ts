// The document seam.
//
// A document is none of the five things this framework already persists, and
// the mismatch is not cosmetic:
//
//   ThreadStore   the transcript. A document outlives its thread and must not
//                 be trimmed by compaction.
//   FileStore     IMMUTABLE provider refs. A document changes; every edit would
//                 invalidate the id that made uploading worthwhile.
//   MemoryStore   loose facts, with no notion of position — nothing to address.
//   Retriever     read-only.
//   app-state     a snapshot of the screen, and its own header rules out
//                 "diffing, CRDT, bidirectional sync".
//
// That last exclusion is right for UI state and wrong for documents, which is
// why this is a separate module rather than an app-state binding: for a
// document the diff IS the product, because it is what the user approves.
//
// The host owns storage. The framework owns the model, the edit protocol and
// the approval surface — the same division Transport draws when it refuses to
// hold a credential.

import type { MarkdownBlockKind } from "../content/blocks.js";

export type DocumentSnapshot = {
  id: string;
  title: string;
  markdown: string;
  /**
   * Optimistic-concurrency token, bumped on every accepted write.
   *
   * The user can change a document between the model reading it and proposing
   * an edit — in another tab, or by accepting a different edit first. Without
   * this the second edit would apply its find/replace to text that has moved.
   * It is cheap now and impossible to retrofit, so it is required from the
   * first version rather than added when someone hits the bug.
   */
  revision: number;
  /**
   * Set when this revision is an undo: the revision whose body it checked out,
   * resolved to the original rather than to another undo.
   *
   * Undo mints a new revision instead of rolling the number back, so without
   * this the store cannot tell "v4, which is v2 restored" from "v4, a fresh
   * edit" — and the next undo would step back one from v4, i.e. to v3, which is
   * the body the user just undid. Walking back from here instead is what makes
   * the second undo an undo rather than a redo.
   */
  restoredFrom?: number;
  createdAt: number;
  updatedAt: number;
};

/**
 * Host-owned persistence. Mirrors ThreadStore/FileStore deliberately: same
 * shape, same defensiveness, so a host that has implemented one has implemented
 * this.
 */
export type DocumentStore = {
  list(): Promise<DocumentSnapshot[]>;
  get(id: string): Promise<DocumentSnapshot | undefined>;
  create(input: { title: string; markdown: string; id?: string }): Promise<DocumentSnapshot>;
  /**
   * Write a new body. Rejects when `expectedRevision` is not the current one —
   * the store is where the check belongs, because it is the only place that
   * sees concurrent writers.
   *
   * `restoredFrom` marks the write as an undo and must be persisted on the new
   * snapshot (and cleared by any write without it). A store that drops it
   * still undoes once; the second undo then walks forward instead of back.
   */
  update(
    id: string,
    markdown: string,
    expectedRevision: number,
    opts?: { restoredFrom?: number },
  ): Promise<DocumentSnapshot>;
  remove(id: string): Promise<void>;
  /** Prior revisions, newest first. Undo is a checkout, never an inverse edit. */
  history(id: string): Promise<DocumentSnapshot[]>;
};

/** One navigable entry in a document's outline. */
export type DocumentOutlineEntry = {
  block: number;
  kind: MarkdownBlockKind;
  /** 1–6 for a heading block; absent otherwise. */
  level?: number;
  /** First line, trimmed — enough to steer by without paying for the body. */
  preview: string;
  chars: number;
};

/**
 * One proposed change: find this exact text, put that in its place.
 *
 * Not a line range, which the previous edit in the same batch would invalidate,
 * and not a whole-document rewrite, which costs tokens proportional to size ×
 * edits, silently revises paragraphs nobody asked about, and — worst — leaves
 * nothing meaningful to approve, because everything appears changed.
 *
 * `block` narrows the search to one block. Optional, but the model should send
 * it whenever it read the text through an outline or a quote, because a short
 * `find` that is unique within a block is often ambiguous across a document.
 */
export type DocumentEdit = {
  block?: number;
  find: string;
  replace: string;
};

/** Why a proposed edit could not be applied. Each maps to a different retry. */
export type EditRejection =
  /** No occurrence — the model is quoting text that is not there. Re-read. */
  | "not-found"
  /** Several occurrences — the anchor is too short. Widen it or name a block. */
  | "ambiguous"
  /** The document moved underneath. Re-read and re-propose. */
  | "stale-revision"
  /** The named block does not exist. */
  | "no-such-block";

export type EditResult =
  | { ok: true; markdown: string; applied: AppliedEdit[] }
  | { ok: false; reason: EditRejection; message: string; edit?: DocumentEdit };

/** An edit resolved against the source — enough to render and to reverse. */
export type AppliedEdit = {
  edit: DocumentEdit;
  /** Where the match landed in the ORIGINAL source. */
  start: number;
  end: number;
  block: number;
};
