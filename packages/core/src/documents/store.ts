// Reference DocumentStores.
//
// Mirrors JobStore/FileStore: an in-memory one for tests and a localStorage one
// for a browser, both defensive on read so a corrupted entry degrades to "that
// document is gone" rather than taking the page with it.
//
// History is kept as full snapshots, not as inverse edits. Undo is then a
// checkout of a previous body — which cannot be computed wrongly, whereas an
// inverse edit can, and does, precisely when the document has moved on.

import { AgentError } from "../errors.js";
import type { DocumentSnapshot, DocumentStore } from "./types.js";

/** Bounded so a long editing session cannot fill a storage quota. */
const MAX_HISTORY = 20;

let counter = 0;
const mintId = () => `doc_${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/**
 * Newest first, with insertion order as the tie-break.
 *
 * `updatedAt` is a millisecond clock and two documents created in the same tick
 * tie on it — which a plain sort resolves as insertion order, i.e. oldest
 * first, i.e. exactly backwards. Both stores hold their documents in insertion
 * order, so reversing before a stable sort puts the later one ahead of the
 * earlier one whenever the timestamps cannot separate them.
 */
const byRecency = (docs: DocumentSnapshot[]): DocumentSnapshot[] =>
  [...docs].reverse().sort((a, b) => b.updatedAt - a.updatedAt);

const staleError = (id: string, expected: number, actual: number) =>
  new AgentError(
    "invalid-request",
    `Document ${id} is at revision ${actual}, not ${expected}. Re-read it before editing.`,
  );

/**
 * The snapshot a write produces. `restoredFrom` is set only by an undo and is
 * dropped by every other write — carried over by the spread, it would make an
 * ordinary edit after an undo look like part of the undo, and the next undo
 * would skip it.
 */
const nextSnapshot = (current: DocumentSnapshot, markdown: string, restoredFrom: number | undefined): DocumentSnapshot => {
  const { restoredFrom: _previous, ...rest } = current;
  return {
    ...rest,
    markdown,
    revision: current.revision + 1,
    ...(restoredFrom !== undefined ? { restoredFrom } : {}),
    updatedAt: Date.now(),
  };
};

export function createMemoryDocumentStore(): DocumentStore {
  const docs = new Map<string, DocumentSnapshot>();
  const past = new Map<string, DocumentSnapshot[]>();

  return {
    async list() {
      return byRecency([...docs.values()]);
    },
    async get(id) {
      return docs.get(id);
    },
    async create({ title, markdown, id }) {
      const now = Date.now();
      const doc: DocumentSnapshot = {
        id: id ?? mintId(),
        title,
        markdown,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      docs.set(doc.id, doc);
      past.set(doc.id, []);
      return doc;
    },
    async update(id, markdown, expectedRevision, opts) {
      const current = docs.get(id);
      if (!current) throw new AgentError("invalid-request", `No document ${id}.`);
      if (current.revision !== expectedRevision) {
        throw staleError(id, expectedRevision, current.revision);
      }
      past.set(id, [current, ...(past.get(id) ?? [])].slice(0, MAX_HISTORY));
      const next = nextSnapshot(current, markdown, opts?.restoredFrom);
      docs.set(id, next);
      return next;
    },
    async remove(id) {
      docs.delete(id);
      past.delete(id);
    },
    async history(id) {
      return past.get(id) ?? [];
    },
  };
}

export function createLocalDocumentStore(key = "superchat:documents"): DocumentStore {
  type Persisted = { docs: Record<string, DocumentSnapshot>; past: Record<string, DocumentSnapshot[]> };

  const read = (): Persisted => {
    try {
      const raw = globalThis.localStorage?.getItem(key) ?? null;
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (typeof parsed !== "object" || parsed === null) return { docs: {}, past: {} };
      const p = parsed as Partial<Persisted>;
      return { docs: p.docs ?? {}, past: p.past ?? {} };
    } catch {
      return { docs: {}, past: {} };
    }
  };

  const write = (all: Persisted) => {
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(all));
    } catch {
      // Quota or private mode. A lost document is bad; a thrown exception in
      // the middle of an approved edit is worse — the user already said yes.
    }
  };

  return {
    async list() {
      return byRecency(Object.values(read().docs));
    },
    async get(id) {
      return read().docs[id];
    },
    async create({ title, markdown, id }) {
      const all = read();
      const now = Date.now();
      const doc: DocumentSnapshot = {
        id: id ?? mintId(),
        title,
        markdown,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      all.docs[doc.id] = doc;
      all.past[doc.id] = [];
      write(all);
      return doc;
    },
    async update(id, markdown, expectedRevision, opts) {
      const all = read();
      const current = all.docs[id];
      if (!current) throw new AgentError("invalid-request", `No document ${id}.`);
      if (current.revision !== expectedRevision) {
        throw staleError(id, expectedRevision, current.revision);
      }
      all.past[id] = [current, ...(all.past[id] ?? [])].slice(0, MAX_HISTORY);
      const next = nextSnapshot(current, markdown, opts?.restoredFrom);
      all.docs[id] = next;
      write(all);
      return next;
    },
    async remove(id) {
      const all = read();
      delete all.docs[id];
      delete all.past[id];
      write(all);
    },
    async history(id) {
      return read().past[id] ?? [];
    },
  };
}
