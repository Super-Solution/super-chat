// Branching over a flat message list.
//
// The tree is stored FLAT — an array of messages with `parentId` pointers —
// because that is what serializes, diffs and persists cleanly. These helpers
// derive everything else: the active path (what the UI renders and the run
// consumes), siblings (the "< 2/3 >" switcher), and leaves (where a switched
// branch resumes). A thread with no branching is the degenerate case: every
// message's parent is the previous one and the path IS the array.

import type { Message } from "./types.js";

/** Root-first path from the root to `headId`. Unknown/missing head → []. */
export function pathTo(tree: readonly Message[], headId: string | null | undefined): Message[] {
  if (!headId) return [];
  const byId = new Map(tree.map((m) => [m.id, m]));
  const path: Message[] = [];
  let cursor = byId.get(headId);
  const seen = new Set<string>(); // cycle guard — corrupted data must not hang the UI
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path.reverse();
}

/** parentId → children, in tree insertion order. Built once per call site that needs repeated lookups. */
function indexByParent(tree: readonly Message[]): Map<string | null, Message[]> {
  const index = new Map<string | null, Message[]>();
  for (const m of tree) {
    const parentId = m.parentId ?? null;
    const kids = index.get(parentId);
    if (kids) kids.push(m);
    else index.set(parentId, [m]);
  }
  return index;
}

/** Direct children of `parentId` (null = roots), in tree insertion order. */
export function childrenOf(tree: readonly Message[], parentId: string | null): Message[] {
  return indexByParent(tree).get(parentId) ?? [];
}

/** The message plus its siblings (shared parent), in insertion order. */
export function siblingsOf(tree: readonly Message[], id: string): Message[] {
  const self = tree.find((m) => m.id === id);
  if (!self) return [];
  return indexByParent(tree).get(self.parentId ?? null) ?? [];
}

/**
 * Deepest descendant of `fromId`, following the LATEST child at each level —
 * switching to a branch resumes at where that branch last left off.
 */
export function latestLeaf(tree: readonly Message[], fromId: string): string {
  // Built once here rather than via repeated `childrenOf` scans — one O(n)
  // pass instead of one per level of depth.
  const index = indexByParent(tree);
  let cursor = fromId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(cursor)) return cursor;
    seen.add(cursor);
    const kids = index.get(cursor) ?? [];
    if (!kids.length) return cursor;
    cursor = kids[kids.length - 1]!.id;
  }
}

/**
 * Give a linear (pre-branching) message list its parent pointers. Used to
 * migrate v1 stored threads and to accept plain arrays as `initialMessages`.
 * Messages that already carry a parentId are left untouched.
 */
export function linkLinear(messages: readonly Message[]): Message[] {
  if (messages.some((m) => m.parentId !== undefined)) return [...messages];
  return messages.map((m, i) => ({ ...m, parentId: i === 0 ? null : messages[i - 1]!.id }));
}
