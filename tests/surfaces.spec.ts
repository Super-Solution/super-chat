import { expect, test, type Page } from "@playwright/test";

/**
 * The Surface panel, driven end to end at every viewport: one request builds a
 * working interface, a filter changes its neighbours with no model call, the agent
 * updates it and reacts to a press, a tool goes through approval, and a reload
 * brings all of it back.
 */

test.setTimeout(120_000);

const surface = (page: Page) => page.locator('[data-surface-id="spend"]').first();
const modelCalls = async (page: Page) => Number(await page.getByTestId("model-calls").textContent());

async function build(page: Page) {
  await page.goto("/surfaces", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  // The server's HTML is clickable before React has hydrated it, so a press can land on nothing.
  await expect(async () => {
    await page.getByRole("button", { name: "Build me a spend explorer for Q3." }).click({ timeout: 2_000 });
    await expect(page.getByTestId("model-calls")).not.toHaveText("0", { timeout: 1_500 });
  }).toPass({ timeout: 45_000 });
  await expect(surface(page).getByRole("button", { name: "Ask for a review" })).toBeEnabled({ timeout: 45_000 });
  await expect(page.locator(".sc-msg__text").last()).toContainText("share one data model", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0, { timeout: 30_000 });
}

const metric = (page: Page, label: string) => surface(page).locator(".sc-surface-metric", { hasText: label }).locator(".sc-surface-metric__value");

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const box = await surface(page).boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
}

test("one request assembles a working interface that answers locally", async ({ page }) => {
  await build(page);
  await noSidewaysScroll(page);

  // Prose, then the interface, then prose: the order the agent wrote them in.
  const order = await page.locator(".sc-msg--assistant").last().evaluate((turn) => {
    const lead = turn.querySelector(".sc-msg__text")!;
    const built = turn.querySelector("[data-surface-id]")!;
    const texts = turn.querySelectorAll(".sc-msg__text");
    const after = texts[texts.length - 1]!;
    return {
      leadFirst: Boolean(lead.compareDocumentPosition(built) & Node.DOCUMENT_POSITION_FOLLOWING),
      afterLast: Boolean(built.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(order).toEqual({ leadFirst: true, afterLast: true });

  const before = await modelCalls(page);
  const total = await metric(page, "Total").textContent();
  await surface(page).getByLabel("Team").selectOption({ label: "Growth" });
  await expect(metric(page, "Total")).not.toHaveText(total!);
  await expect(metric(page, "Lines")).toHaveText("5");
  expect(await modelCalls(page)).toBe(before);

  await surface(page).getByRole("button", { name: "Reset filters" }).click();
  await expect(metric(page, "Total")).toHaveText(total!);
  expect(await modelCalls(page)).toBe(before);
});

test("the agent reads the person's filters, reacts to a press and updates in place", async ({ page }) => {
  await build(page);
  await surface(page).getByLabel("Team").selectOption({ label: "Research" });
  await surface(page).getByRole("button", { name: "Ask for a review" }).click();

  await expect(surface(page).locator(".sc-card", { hasText: "Review of Research" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".sc-msg__text").last()).toContainText("Alder Studio", { timeout: 30_000 });
  // Updated where it stands: one live copy, and a pointer from the later turn.
  await expect(page.locator('[data-surface-id="spend"]')).toHaveCount(1);
  await expect(page.locator(".sc-surface-reference").first()).toContainText("Updated Q3 spend explorer");
  await noSidewaysScroll(page);
});

test("a tool action waits for approval, then writes its result back", async ({ page }) => {
  await build(page);
  const before = await modelCalls(page);
  await surface(page).getByRole("button", { name: "Approve this view" }).click();
  const confirm = page.locator(".sc-card--interactive", { hasText: "Approve this spend?" });
  await expect(confirm).toBeVisible({ timeout: 15_000 });
  await expect(confirm).toBeInViewport();
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(surface(page).getByText(/Approved under reference APR-/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("metered-actions")).toHaveText("1");
  expect(await modelCalls(page)).toBe(before);
});

test("the interface and the person's filters survive a reload", async ({ page }) => {
  await build(page);
  await surface(page).getByLabel("Team").selectOption({ label: "Support" });
  await expect(metric(page, "Lines")).toHaveText("4");
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(metric(page, "Lines")).toHaveText("4", { timeout: 30_000 });
  await expect(surface(page).getByLabel("Team")).toHaveValue("4");
});

test("tabs work from the keyboard", async ({ page }, testInfo) => {
  test.skip(Boolean(testInfo.project.use.hasTouch), "keyboard path");
  await build(page);
  const first = surface(page).getByRole("tab", { name: "By month" });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(surface(page).getByRole("tab", { name: "Lines" })).toBeFocused();
  await expect(surface(page).getByRole("tab", { name: "Lines" })).toHaveAttribute("aria-selected", "true");
  await expect(surface(page).locator("table")).toBeVisible();
});

test("a host can place the surface in its own panel", async ({ page }) => {
  await build(page);
  await page.getByRole("button", { name: "Side panel" }).click();
  await expect(page.locator("aside [data-surface-id='spend']")).toBeVisible();
  await expect(page.locator(".sc-thread [data-surface-id='spend']")).toHaveCount(0);
  await expect(page.locator(".sc-surface-reference").first()).toContainText("open beside the conversation");
});

test("surface controls meet the 44px touch target", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "touch devices only");
  await build(page);
  for (const control of [surface(page).getByRole("button", { name: "Ask for a review" }), surface(page).getByLabel("Team")]) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
