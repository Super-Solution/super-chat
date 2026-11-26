// The buttons on code blocks and tables in rendered Markdown.
//
// The Markdown renderer draws them as empty `<button data-sc-act="…">`: it knows nothing of
// languages or the clipboard. This file gives them words and answers them, on the DOM that
// `ProseHtml` keeps up to date. Everything a button changes about itself is an attribute
// starting `data-ui-` (or its own text), which a later render of the same block leaves alone.

import { tableToMarkdown, tableToTsv } from "@supersolutions/super-chat-ui-core";
import type { Labels } from "./labels.js";

/** Longer than this and a code block is cut off at this height until "Show all" is pressed. */
export const LONG_CODE_LINES = 24;

const label = (act: string, words: Labels): string =>
  act === "copy"
    ? words.copyCode
    : act === "wrap"
      ? words.wrapCode
      : act === "copy-tsv"
        ? words.copyTsv
        : act === "copy-md"
          ? words.copyMarkdown
          : "";

const setText = (el: Element, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};

/** Give the action buttons under `root` their words, and mark the code blocks that are long. */
export function decorateActions(root: HTMLElement, words: Labels): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-sc-act]")) {
    const act = button.getAttribute("data-sc-act") ?? "";
    if (act === "more") {
      const open = button.closest(".sc-mdcode")?.hasAttribute("data-ui-open");
      setText(button, open ? words.collapseCode : words.expandCode);
      continue;
    }
    const name = label(act, words);
    if (button.getAttribute("aria-label") !== name) button.setAttribute("aria-label", name);
    if (button.title !== name) button.title = name;
    if (act === "wrap") {
      const on = button.closest(".sc-mdcode")?.hasAttribute("data-ui-wrap") ?? false;
      button.setAttribute("aria-pressed", String(on));
    } else if (!button.hasAttribute("data-ui-done")) {
      // An action that has just happened shows its result in place of its name until it is reset.
      setText(button, act === "copy" ? words.copy : name);
    }
  }
  for (const box of root.querySelectorAll<HTMLElement>(".sc-mdcode")) {
    const lines = (box.querySelector("pre")?.textContent ?? "").split("\n").length;
    if (lines > LONG_CODE_LINES) box.setAttribute("data-ui-long", "");
    else box.removeAttribute("data-ui-long");
  }
  for (const scroll of root.querySelectorAll<HTMLElement>(".sc-md-scroll")) {
    if (scroll.getAttribute("role") !== "region") scroll.setAttribute("role", "region");
    if (scroll.getAttribute("aria-label") !== words.table) scroll.setAttribute("aria-label", words.table);
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Say what happened where the pressed button is, then go back to its name. */
function report(button: HTMLElement, ok: boolean, words: Labels): void {
  button.setAttribute("data-ui-done", ok ? "ok" : "failed");
  setText(button, ok ? words.copied : words.copyFailed);
  setTimeout(() => {
    button.removeAttribute("data-ui-done");
    decorateActions(button.closest<HTMLElement>(".sc-prose") ?? button.parentElement ?? button, words);
  }, 1500);
}

const cellText = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** A rendered table as the strings a reader sees: its header, its rows and each column's alignment. */
export function readTable(table: HTMLTableElement) {
  const head = Array.from(table.querySelectorAll("thead th"));
  const align = head.map((th) =>
    th.classList.contains("sc-md-center") ? "center" : th.classList.contains("sc-md-right") ? "right" : th.classList.contains("sc-md-left") ? "left" : null,
  );
  return {
    header: head.map(cellText),
    rows: Array.from(table.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.children, cellText)),
    align,
  };
}

/** Answer a press on an action button. Returns whether it was one. */
export function runAction(target: EventTarget | null, words: Labels): boolean {
  const button = target instanceof Element ? target.closest<HTMLElement>("[data-sc-act]") : null;
  if (!button) return false;
  const act = button.getAttribute("data-sc-act");
  const box = button.closest<HTMLElement>(".sc-mdcode");

  if (act === "wrap" && box) {
    box.toggleAttribute("data-ui-wrap");
    button.setAttribute("aria-pressed", String(box.hasAttribute("data-ui-wrap")));
  } else if (act === "more" && box) {
    box.toggleAttribute("data-ui-open");
    setText(button, box.hasAttribute("data-ui-open") ? words.collapseCode : words.expandCode);
  } else if (act === "copy" && box) {
    void copyText(box.querySelector("pre")?.textContent ?? "").then((ok) => report(button, ok, words));
  } else if ((act === "copy-tsv" || act === "copy-md") && button.closest(".sc-md-tablebox")) {
    const table = button.closest(".sc-md-tablebox")!.querySelector("table");
    if (table) {
      const { header, rows, align } = readTable(table);
      const text = act === "copy-tsv" ? tableToTsv(header, rows) : tableToMarkdown(header, rows, align);
      void copyText(text).then((ok) => report(button, ok, words));
    }
  }
  return true;
}
