import { expect, test, type Page } from "@playwright/test";

/**
 * Layer 2 for the document artifact (UI-SPEC 6.8).
 *
 * Selection is a DOM behaviour end to end — a Range across rendered nodes,
 * resolved back to source offsets through anchors that only exist once the
 * browser has laid the markup out. Layer 1 can prove the offsets are right;
 * only this layer can prove the user's gesture reaches them.
 */

async function settle(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
}

/** Drive the demo script that produces a document artifact. */
async function draftDocument(page: Page) {
  await settle(page, "/run");
  const input = page.locator(".sc-composer__input");
  await expect(input).toBeVisible();
  await input.fill("draft a vendor review document");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".sc-doc").first()).toBeVisible({ timeout: 30_000 });
  // Wait for the turn to commit before touching the document. The live turn is
  // replaced by the persisted message when it lands, which remounts the card —
  // and a remount drops any selection or pending quote on the floor. Real use
  // hits this the same way, so waiting here is fidelity, not test hygiene.
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

/** Select the text of one rendered block by its anchor index. */
async function selectBlock(page: Page, blockIndex: number) {
  await page.evaluate((i) => {
    const el = document.querySelector(`.sc-doc__body [data-sc-block="${i}"]`);
    if (!el) throw new Error(`no block ${i}`);
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, blockIndex);
  await page.waitForTimeout(120);
}

test("a generated document renders in the previewer, not as inline prose", async ({ page }) => {
  await draftDocument(page);

  const doc = page.locator(".sc-doc").first();
  await expect(doc.locator(".sc-doc__title")).toHaveText("Vendor review");
  // The revision is on screen because an edit will later be refused against a
  // stale one — the user needs to be able to see which one they are looking at.
  await expect(doc.locator(".sc-doc__rev")).toHaveText("v1");

  // Every block is addressable, which is what selection resolution depends on.
  const anchors = await doc.locator("[data-sc-block]").count();
  expect(anchors).toBeGreaterThan(3);
});

test("selecting a block offers a quote, and quoting stages it in the composer", async ({ page }) => {
  await draftDocument(page);
  await selectBlock(page, 0);

  const bar = page.locator(".sc-doc__quotebar");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Ask about this" }).click();

  const chip = page.locator(".sc-quote").first();
  await expect(chip).toBeVisible();
  await expect(chip.locator(".sc-quote__doc")).toHaveText("Vendor review");
  // The chip shows the source, so a heading still reads as a heading.
  await expect(chip.locator(".sc-quote__text")).toContainText("# Vendor review");
});

test("the quote travels with the next message and then clears", async ({ page }) => {
  await draftDocument(page);
  await selectBlock(page, 0);
  await page.locator(".sc-doc__quotebar").getByRole("button", { name: "Ask about this" }).click();
  await expect(page.locator(".sc-quote")).toHaveCount(1);

  const before = await page.locator(".sc-msg--user").count();
  await page.locator(".sc-composer__input").fill("what does this cover?");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.locator(".sc-msg--user")).toHaveCount(before + 1, { timeout: 15_000 });

  // The quoted source is part of the message the user sent…
  const sent = page.locator(".sc-msg--user").last();
  await expect(sent).toContainText("Quoted from");
  await expect(sent).toContainText("what does this cover?");

  // …and the composer is empty again. A quote left staged would ride along with
  // the following message too, which is the stale-context failure that keeping
  // quotes off app-state exists to prevent.
  await expect(page.locator(".sc-quote")).toHaveCount(0);
});

test("the selection survives the quote bar appearing", async ({ page }) => {
  // The regression test for a bug that read as broken selection code and was
  // not. Passing a fresh {__html} object to dangerouslySetInnerHTML on every
  // render makes React re-apply innerHTML even when the string is identical;
  // that rebuilds every child node, and rebuilding the nodes a selection lives
  // in collapses it. So displaying the offer destroyed the selection the offer
  // was made about, and the bar removed itself the instant it appeared.
  await draftDocument(page);
  await selectBlock(page, 0);

  await expect(page.locator(".sc-doc__quotebar")).toBeVisible();
  // Still visible a beat later — the render that showed it must not have wiped
  // what it was showing.
  await page.waitForTimeout(400);
  await expect(page.locator(".sc-doc__quotebar")).toBeVisible();
  const alive = await page.evaluate(() => {
    const sel = window.getSelection();
    return { collapsed: sel?.isCollapsed, text: sel?.toString() };
  });
  expect(alive.collapsed, "the selection must outlive the bar's own render").toBe(false);
  expect(alive.text).toContain("Vendor review");
});

test("the quote bar can be dismissed without quoting", async ({ page }) => {
  await draftDocument(page);
  await selectBlock(page, 0);
  await expect(page.locator(".sc-doc__quotebar")).toBeVisible();

  await page.getByRole("button", { name: "Dismiss quote" }).click();
  await expect(page.locator(".sc-doc__quotebar")).toHaveCount(0);
  await expect(page.locator(".sc-quote")).toHaveCount(0);
});

test("a quote can be removed before sending", async ({ page }) => {
  await draftDocument(page);
  await selectBlock(page, 0);
  await page.locator(".sc-doc__quotebar").getByRole("button", { name: "Ask about this" }).click();
  await expect(page.locator(".sc-quote")).toHaveCount(1);

  await page.locator(".sc-quote__remove").click();
  await expect(page.locator(".sc-quote")).toHaveCount(0);
});

test("selecting across blocks quotes the whole range", async ({ page }) => {
  await draftDocument(page);

  await page.evaluate(() => {
    const body = document.querySelector(".sc-doc__body")!;
    const first = body.querySelector('[data-sc-block="1"]')!;
    const second = body.querySelector('[data-sc-block="2"]')!;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, second.childNodes.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.waitForTimeout(120);

  await page.locator(".sc-doc__quotebar").getByRole("button", { name: "Ask about this" }).click();
  await page.locator(".sc-composer__input").fill("summarise");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const sent = page.locator(".sc-msg--user").last();
  await expect(sent).toContainText("blocks 1–2");
});

test("opening a document does not push the page sideways", async ({ page }, testInfo) => {
  await draftDocument(page);
  await page.locator(".sc-doc__expand").first().click();
  await expect(page.locator(".sc-doc__surface")).toBeVisible();

  // The compact tier turns the panel into a bottom sheet; either way the page
  // itself must not scroll horizontally (UI-SPEC 5.5's load-bearing assertion).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `opened document overflowed on ${testInfo.project.name}`).toBeLessThanOrEqual(1);

  const box = await page.locator(".sc-doc__surface").boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);

  // Escape closes it. A sheet that traps the user is the usual complaint about
  // this pattern on a phone.
  await page.keyboard.press("Escape");
  await expect(page.locator(".sc-doc__surface")).toHaveCount(0);
});

async function ask(page: Page, prompt: string, appears: string) {
  await settle(page, "/run");
  const input = page.locator(".sc-composer__input");
  await expect(input).toBeVisible();
  await input.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(appears)).toBeVisible({ timeout: 30_000 });
}

/**
 * Propose edits. Deliberately does NOT wait for the run to finish: an edit
 * review is interactive, so the run stays suspended until it is answered. That
 * is the guarantee the feature rests on — nothing is written while the question
 * is still open — and a helper that waited for idle would hang on it.
 */
const proposeEdits = (page: Page) => ask(page, "tighten the vendor review", ".sc-editreview");

/** Draft the covering note. Separate turn, because the review blocks its own. */
const draftEmail = (page: Page) => ask(page, "email it to counsel", ".sc-email");

test("an edit arrives as a diff, selected by default, with signs not just colour", async ({ page }) => {
  await proposeEdits(page);

  const review = page.locator(".sc-editreview");
  await expect(review.locator(".sc-hunk")).toHaveCount(2);
  // Everything starts accepted: the model proposed these because it was asked
  // to, so opting out is the exception rather than the price of admission.
  await expect(review.locator('input[type="checkbox"]:checked')).toHaveCount(2);
  await expect(review.getByText("Apply all changes")).toBeVisible();

  // Red and green are the classic failure case, so every line is signed too.
  await expect(review.locator(".sc-hunk__line--del").first()).toContainText("−");
  await expect(review.locator(".sc-hunk__line--add").first()).toContainText("+");
});

test("hunks can be accepted individually", async ({ page }) => {
  await proposeEdits(page);
  const review = page.locator(".sc-editreview");

  await review.locator('input[type="checkbox"]').first().uncheck();
  await expect(review.locator(".sc-hunk--off")).toHaveCount(1);
  // The button states what will actually happen, rather than staying "Apply".
  await expect(review.getByRole("button", { name: "Apply 1 of 2" })).toBeVisible();

  // A deselected hunk stays readable — the user has to be able to re-read what
  // they are declining.
  await expect(review.locator(".sc-hunk--off .sc-hunk__text").first()).toBeVisible();
});

test("rejecting everything is a decision the card records", async ({ page }) => {
  await proposeEdits(page);
  const review = page.locator(".sc-editreview");

  for (const box of await review.locator('input[type="checkbox"]').all()) await box.uncheck();
  // With nothing selected, Apply is not a meaningful action; Reject all is.
  await expect(review.getByRole("button", { name: /^Apply/ })).toBeDisabled();
  await expect(review.getByRole("button", { name: "Reject all" })).toBeEnabled();
});

test("the email draft offers .eml first and flags a truncating mailto", async ({ page }) => {
  await draftEmail(page);
  const email = page.locator(".sc-email");
  await expect(email).toBeVisible();

  // .eml is the primary exit because it is the one with no limits.
  await expect(email.getByRole("button", { name: "Download .eml" })).toBeVisible();

  const href = await email.getByRole("link", { name: "Open in mail client" }).getAttribute("href");
  expect(href).toMatch(/^mailto:counsel%40example\.com/);
  expect(href).toContain("%0D%0A");

  // No send button without a host handler: the framework holds no credential,
  // so offering to send would be a promise it cannot keep.
  await expect(email.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
});

test("the email draft is editable and the mailto follows the edits", async ({ page }) => {
  await draftEmail(page);
  const email = page.locator(".sc-email");

  await email.locator("input").first().fill("someone-else@example.com");
  const href = await email.getByRole("link", { name: "Open in mail client" }).getAttribute("href");
  expect(href).toContain("someone-else%40example.com");
});

test("a long body warns before the user clicks, not after", async ({ page }) => {
  await draftEmail(page);
  const email = page.locator(".sc-email");
  await expect(email.locator(".sc-email__warn")).toHaveCount(0);

  // Past the mailto ceiling clients truncate silently — the letter goes out
  // missing its end and nothing says so.
  await email.locator("textarea").fill("x".repeat(2200));
  await expect(email.locator(".sc-email__warn")).toBeVisible();
  await expect(email.locator(".sc-email__warn")).toContainText(".eml");
});

// ── The documents panel ──────────────────────────────────────────────────────
//
// The panel drives the seam with no model, which makes it the only place a
// browser test can reach the REFUSALS — the half of the edit protocol that
// matters most and that a scripted demo transport never triggers.

test("the panel renders the constructs a report is actually made of", async ({ page }) => {
  await settle(page, "/documents");
  const body = page.locator(".sc-doc__body").first();

  // Each of these came out as literal punctuation until the renderer grew past
  // what a chat bubble needs.
  await expect(body.locator("table")).toHaveCount(1);
  await expect(body.locator("blockquote")).toHaveCount(1);
  await expect(body.locator("ol > li")).toHaveCount(2);
  await expect(body.locator("pre code")).toHaveCount(1);
  await expect(body).not.toContainText("|---");
});

test("a wide table scrolls inside its own box, never the page", async ({ page }) => {
  await settle(page, "/documents");

  // The hard RWD limit (UI-SPEC 5.1.3): nothing may make the page scroll
  // sideways. A table is the most common way that happens, and at 360px almost
  // any table is wider than the column it sits in.
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const table = document.querySelector<HTMLElement>(".sc-doc__body table")!;
    return {
      page: de.scrollWidth > de.clientWidth,
      containedX: getComputedStyle(table).overflowX,
    };
  });
  expect(overflow.page).toBe(false);
  expect(overflow.containedX).toBe("auto");
});

test("an ambiguous anchor is refused with its reason, and nothing is written", async ({ page }) => {
  await settle(page, "/documents");
  await expect(page.locator(".sc-doc__rev").first()).toHaveText("v1");

  await page.getByRole("button", { name: "Anchor that matches twice" }).click();

  const refusal = page.locator(".sc-callout--negative");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("ambiguous");
  // The point of the refusal: no diff was offered, so there is nothing to
  // approve, so the document cannot have moved.
  await expect(page.locator(".sc-editreview")).toHaveCount(0);
  await expect(page.locator(".sc-doc__rev").first()).toHaveText("v1");
});

test("accepting a hunk rewrites the document and bumps the revision", async ({ page }) => {
  await settle(page, "/documents");
  const body = page.locator(".sc-doc__body").first();
  await expect(body).toContainText("Recommendation");

  await page.getByRole("button", { name: "Rename a heading" }).click();
  await page.getByRole("button", { name: /^Apply/ }).click();

  await expect(body).toContainText("What we recommend");
  await expect(page.locator(".sc-doc__rev").first()).toHaveText("v2");
});
