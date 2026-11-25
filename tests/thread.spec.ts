import { expect, test, type Page } from "@playwright/test";

/**
 * Layer 2 for the conversation itself: what it tells assistive technology, what survives while an
 * answer is still being written, and what the code and tables inside an answer can do.
 *
 * These are plain assertions on roles, attributes and the DOM, on purpose: nothing here depends on
 * an accessibility engine being installed, and a failure names the attribute that is missing.
 */

test.setTimeout(90_000);

const RICH = "Give me a rich answer in Markdown: how do we roll out the new billing flow?";

async function settle(page: Page, path = "/run") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
}

async function ask(page: Page, text: string) {
  const input = page.locator(".sc-composer__input");
  await expect(input).toBeVisible();
  await input.fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

/** The turn has been saved: the stop button is gone and Send is back. */
async function finished(page: Page) {
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(250);
}

test("the thread is a named log, and a screen reader is told when a turn starts and ends", async ({ page }) => {
  await settle(page);
  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log).toBeVisible();
  const status = page.locator("[data-sc-announcer]");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveText("");

  await ask(page, "Where are we losing people in the signup funnel?");
  // While the answer is open it is busy, so it is not read out token by token.
  await expect(page.locator(".sc-msg--assistant[aria-busy='true']")).toBeVisible({ timeout: 15_000 });
  await expect(status).toHaveText("Assistant is responding…");

  await finished(page);
  await expect(status).toHaveText("Assistant replied.");
  await expect(page.locator(".sc-msg--assistant[aria-busy='true']")).toHaveCount(0);
  // The finished answer is inside the log, where a screen reader finds what was appended.
  await expect(log.locator(".sc-msg--assistant")).toHaveCount(1);
});

test("text selected while an answer streams stays selected", async ({ page }) => {
  await settle(page);
  await ask(page, RICH);

  // Wait until there is a settled block and an open tail, then select inside the FIRST block and
  // inside the LAST one: the first is never touched again, the last grows under the selection.
  const stream = page.locator(".sc-msg__text--streaming");
  await expect.poll(async () => (await stream.evaluate((el) => el.children.length).catch(() => 0)), { timeout: 30_000 }).toBeGreaterThan(3);

  const picked = await stream.evaluate((el) => {
    const texts = (node: Element) => {
      const out: Text[] = [];
      const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if ((n.textContent ?? "").trim().length > 8) out.push(n as Text);
      return out;
    };
    const first = texts(el.children[0]!)[0]!;
    const tail = el.children[el.children.length - 1]!;
    const last = texts(tail).pop()!;
    const make = (node: Text, from: number, to: number) => {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, Math.min(to, node.length));
      return range;
    };
    const a = make(first, 0, 9);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(a);
    const w = window as unknown as { __first: Text; __last: Text; __lastText: string };
    w.__first = first;
    w.__last = last;
    w.__lastText = last.data.slice(0, 6);
    return { first: a.toString(), lastStart: last.data.slice(0, 6) };
  });
  expect(picked.first.length).toBeGreaterThan(5);

  // The answer keeps coming for a few seconds: the selection is still there, on the same nodes.
  await page.waitForTimeout(1500);
  const during = await page.evaluate(() => {
    const w = window as unknown as { __first: Text };
    return { text: window.getSelection()!.toString(), connected: w.__first.isConnected, streaming: !!document.querySelector(".sc-msg__text--streaming") };
  });
  expect(during.connected, "the selected text node was not replaced").toBe(true);
  expect(during.text).toBe(picked.first);
  expect(during.streaming, "the answer was still streaming when selection was checked").toBe(true);

  // And a text node that only grows at its end is appended to rather than replaced.
  const grown = await page.evaluate(() => {
    const w = window as unknown as { __last: Text; __lastText: string };
    return { connected: w.__last.isConnected, startsSame: w.__last.data.startsWith(w.__lastText) };
  });
  expect(grown.connected || !grown.startsSame).toBe(true);
});

test("a code block in an answer says its language, copies, wraps and is coloured", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await settle(page);
  await ask(page, RICH);
  await finished(page);

  const block = page.locator(".sc-mdcode", { has: page.locator("pre[data-lang='ts']") });
  await expect(block.locator(".sc-mdcode__lang")).toHaveText("ts");
  await expect(block.locator(".sc-tok-k").first()).toBeVisible();

  // The buttons carry words (the renderer wrote them empty) and say what they do.
  const copy = block.getByRole("button", { name: "Copy code" });
  await expect(copy).toHaveText("Copy");
  const wrap = block.getByRole("button", { name: "Wrap lines" });
  await expect(wrap).toHaveAttribute("aria-pressed", "false");
  await wrap.click();
  await expect(wrap).toHaveAttribute("aria-pressed", "true");
  expect(await block.locator("pre").evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
  await wrap.click();
  expect(await block.locator("pre").evaluate((el) => getComputedStyle(el).whiteSpace)).not.toBe("pre-wrap");

  await copy.click();
  await expect(copy).toHaveText("Copied");
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) {
    expect(clip).toContain("export async function createInvoice");
    expect(clip).not.toContain("<span");
  }
  await expect(copy).toHaveText("Copy", { timeout: 4_000 });
});

test("a table in an answer scrolls in a labelled box a keyboard can reach, and copies as TSV and Markdown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await settle(page);
  await ask(page, RICH);
  await finished(page);

  const box = page.locator(".sc-md-tablebox").first();
  const scroll = box.locator(".sc-md-scroll");
  await expect(scroll).toHaveAttribute("tabindex", "0");
  await expect(scroll).toHaveAttribute("role", "region");
  await expect(scroll).toHaveAttribute("aria-label", "Table");
  // A real table, not a block that looks like one.
  expect(await box.locator("table").evaluate((el) => getComputedStyle(el).display)).toBe("table");

  await box.getByRole("button", { name: "Copy as TSV" }).click();
  const tsv = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (tsv !== null) {
    expect(tsv.split("\n")[0]).toBe("Metric\tHealthy\tAlarm\tOwner");
    expect(tsv.split("\n")).toHaveLength(4);
  }
  await box.getByRole("button", { name: "Copy as Markdown" }).click();
  const md = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (md !== null) {
    expect(md.split("\n")[1]).toBe("| :--- | ---: | ---: | :--- |");
    expect(md).toContain("| Checkout success rate | above 98.5% | below 97% | Payments |");
  }

  // The page itself never scrolls sideways because of it.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("task lists, bare links and pictures render as the safe, readable thing", async ({ page }) => {
  await settle(page);
  await ask(page, RICH);
  await finished(page);
  const answer = page.locator(".sc-msg--assistant").last();

  // A checkbox that shows and cannot change, named by its text.
  const boxes = answer.locator("li.sc-md-task input[type=checkbox]");
  await expect(boxes).toHaveCount(4);
  await expect(boxes.first()).toBeDisabled();
  await expect(boxes.first()).toBeChecked();
  await expect(answer.getByLabel("Migration 0042_add_invoice_status merged")).toHaveCount(1);

  // A bare URL is a link; a Markdown image is a link, not a request the page makes by itself.
  await expect(answer.getByRole("link", { name: "https://example.com/status" })).toHaveAttribute("href", "https://example.com/status");
  await expect(answer.locator("img")).toHaveCount(0);
  await expect(answer.getByRole("link", { name: "invoice layout" })).toHaveAttribute("href", "https://example.com/invoice.png");
});
