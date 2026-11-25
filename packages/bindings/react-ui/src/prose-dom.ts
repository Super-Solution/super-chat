// Keeping rendered Markdown on screen while it grows.
//
// A streamed answer is re-rendered many times a second, and the obvious way to show each
// render is to assign it to `innerHTML`. That throws away every node and builds them again, so
// nothing that lives on a node survives a frame: a text selection (it is gone within a frame),
// a hover, a focused button, a scroll position inside a wide table, a half-played animation.
// The model's answer cannot be selected while the model is still writing it.
//
// So the DOM is brought up to date instead of replaced, at two levels:
//
//   - The answer arrives as blocks, and a block that is the same string as last time is not
//     touched at all. All but the last block of a streamed answer are settled, so for most
//     frames only one block is looked at.
//   - A block that did change is morphed: the new markup is parsed (inertly, in a `<template>`)
//     and the live nodes are edited to match, element by element. A text node that only grew is
//     appended to, which is the one edit that leaves a selection inside it standing.
//
// This is plain DOM and knows nothing of React, Markdown or cards.

/** Attributes the host page puts on rendered nodes after the fact; a new render does not own them. */
const KEEP = /^(?:data-ui-|aria-|role$|tabindex$|title$|data-ref-live$|data-ref-state$|data-sc-new$)/;

function sameKind(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  return a.nodeType !== 1 || (a as Element).tagName === (b as Element).tagName;
}

function syncAttributes(live: Element, next: Element): void {
  for (const { name, value } of Array.from(next.attributes)) {
    if (live.getAttribute(name) !== value) live.setAttribute(name, value);
  }
  for (const { name } of Array.from(live.attributes)) {
    if (!next.hasAttribute(name) && !KEEP.test(name)) live.removeAttribute(name);
  }
}

function syncText(live: CharacterData, next: CharacterData): void {
  if (live.data === next.data) return;
  // Growing at the end is the case that matters, and the only edit that does not move a range
  // whose end sits in the old text.
  if (next.data.startsWith(live.data)) live.appendData(next.data.slice(live.data.length));
  else live.data = next.data;
}

/** Edit `live` (and what is under it) until it matches `next`, returning the node now in its place. */
function morphNode(live: Node, next: Node): Node {
  if (!sameKind(live, next)) {
    live.parentNode?.replaceChild(next, live);
    return next;
  }
  if (live.nodeType === 1) {
    syncAttributes(live as Element, next as Element);
    morphChildren(live, next);
  } else if (live.nodeType === 3 || live.nodeType === 8) {
    syncText(live as CharacterData, next as CharacterData);
  }
  return live;
}

function morphChildren(live: Node, next: Node): void {
  const target = Array.from(next.childNodes);
  for (let i = 0; i < target.length; i += 1) {
    const current = live.childNodes[i];
    if (current) morphNode(current, target[i]!);
    else live.appendChild(target[i]!);
  }
  while (live.childNodes.length > target.length) live.removeChild(live.lastChild!);
}

/** Parse markup without running or loading anything. */
export function parseHtml(html: string): Node[] {
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.childNodes);
}

/** What was last shown: each block's markup, and the nodes it became. */
export type ProseState = { parts: string[]; nodes: Node[][] };

export const newProseState = (): ProseState => ({ parts: [], nodes: [] });

/**
 * Make `root` show `next`, a list of blocks, touching only the blocks that differ from what
 * `state` says is there. `state` is told what is now shown. Returns whether anything changed.
 *
 * A new block is inserted at the end (or where it belongs) and, when `mark` is given, marked
 * with that attribute, which a stylesheet can use to fade it in.
 */
export function showBlocks(root: HTMLElement, state: ProseState, next: readonly string[], mark?: string): boolean {
  let changed = false;

  // First call over markup that is already there (the server's, or the first render's): claim
  // its nodes by counting what each block parses to, so none of them is rebuilt.
  if (!state.parts.length && root.childNodes.length) {
    let at = 0;
    const live = Array.from(root.childNodes);
    for (const part of next) {
      const count = parseHtml(part).length;
      state.parts.push(part);
      state.nodes.push(live.slice(at, at + count));
      at += count;
    }
    return false;
  }

  const size = Math.max(next.length, state.parts.length);
  for (let i = 0; i < size; i += 1) {
    const part = next[i];
    const old = state.nodes[i];
    if (part === undefined) {
      for (const node of old ?? []) node.parentNode?.removeChild(node);
      continue;
    }
    if (old && state.parts[i] === part) continue;
    changed = true;

    const fresh = parseHtml(part);
    if (!old) {
      // After the last node of the block before it, which is before the first of the next.
      const before = state.nodes.slice(i + 1).find((nodes) => nodes.length)?.[0] ?? null;
      for (const node of fresh) {
        if (mark && node.nodeType === 1) (node as Element).setAttribute(mark, "");
        root.insertBefore(node, before);
      }
      state.nodes[i] = fresh;
      continue;
    }

    const shown: Node[] = [];
    for (let k = 0; k < fresh.length; k += 1) {
      const was = old[k];
      if (was) shown.push(morphNode(was, fresh[k]!));
      else {
        const after = shown[shown.length - 1] ?? old[old.length - 1];
        const node = fresh[k]!;
        if (mark && node.nodeType === 1) (node as Element).setAttribute(mark, "");
        after?.parentNode?.insertBefore(node, after.nextSibling);
        shown.push(node);
      }
    }
    for (let k = fresh.length; k < old.length; k += 1) old[k]!.parentNode?.removeChild(old[k]!);
    state.nodes[i] = shown;
  }
  state.parts = next.slice();
  state.nodes.length = next.length;
  return changed;
}
