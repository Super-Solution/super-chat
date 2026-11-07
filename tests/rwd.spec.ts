import { expect, test, type Page } from "@playwright/test";

/**
 * Layer 2 of the responsive test strategy (UI-SPEC 5.5): the assertions that
 * need a real layout engine.
 *
 * The load-bearing one is "no page-level horizontal scroll". It is a single
 * cheap check that catches most of what actually goes wrong on a phone — a
 * fixed width, an unbreakable string, a menu anchored off the right edge —
 * without anyone having to predict which component will break.
 *
 * Card-internal horizontal scroll is a separate matter and stays allowed. A
 * table that scrolls sideways is doing its job; flattening it into stacked
 * key/value pairs would destroy the comparison those card kinds exist for. So
 * the overflow scan walks up from each offender and forgives anything already
 * inside a scroll container.
 */

const PANELS = [
  { path: "/", name: "overview" },
  { path: "/cards", name: "agent cards" },
  { path: "/agent-ui", name: "agent surfaces" },
  { path: "/dev-ani", name: "animations" },
  { path: "/skills", name: "skills" },
  { path: "/tools", name: "tools" },
  { path: "/requests", name: "wire requests" },
  { path: "/app-state", name: "app state" },
  { path: "/documents", name: "documents" },
  { path: "/run", name: "run" },
];

/** Elements sticking out past the viewport that no scroll container explains. */
async function overflowingElements(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out: { selector: string; right: number; width: number }[] = [];

    const scrolls = (el: Element) => {
      const o = getComputedStyle(el);
      return /auto|scroll|hidden/.test(o.overflowX) || /auto|scroll|hidden/.test(o.overflow);
    };

    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= limit + 1) continue;

      // Forgiven if any ancestor can scroll it — that is card-internal
      // overflow, which the spec allows.
      let excused = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (scrolls(p)) {
          excused = true;
          break;
        }
      }
      if (excused) continue;

      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
      out.push({ selector: `${el.tagName.toLowerCase()}${id}${cls}`, right: Math.round(rect.right), width: Math.round(rect.width) });
    }
    return { limit, out: out.slice(0, 12) };
  });
}

async function settle(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  // Entrance animations move boxes; measuring mid-flight produces flakes.
  await page.waitForTimeout(400);
}

for (const panel of PANELS) {
  test(`${panel.name} — no page-level horizontal overflow`, async ({ page }) => {
    await settle(page, panel.path);

    const { limit, out } = await overflowingElements(page);
    expect(out, `elements past ${limit}px: ${JSON.stringify(out, null, 2)}`).toEqual([]);

    const scrollable = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(scrollable, "the page itself must not scroll sideways").toBeLessThanOrEqual(1);
  });
}

test("P0 — a phone can hold a conversation", async ({ page }) => {
  // The floor the whole plan was scoped against: type, send, see the exchange.
  await settle(page, "/run");

  const input = page.locator(".sc-composer__input");
  await expect(input).toBeVisible();

  await input.fill("Where are we losing people in the signup funnel?");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.locator(".sc-msg--user")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".sc-msg--assistant").first()).toBeVisible({ timeout: 30_000 });

  // A reply that renders off-screen has not been delivered.
  const { out } = await overflowingElements(page);
  expect(out, `reply overflowed: ${JSON.stringify(out, null, 2)}`).toEqual([]);
});

test("P0 — the composer clears Safari's zoom threshold", async ({ page }, testInfo) => {
  // Keyed on the pointer, so it is asserted where a pointer:coarse device is
  // being emulated — and deliberately NOT on desktop, where 15px is correct.
  test.skip(!testInfo.project.use.hasTouch, "touch devices only");
  await settle(page, "/run");
  const size = await page
    .locator(".sc-composer__input")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  // Under 16px, Safari zooms in on focus and never zooms back out.
  expect(size).toBeGreaterThanOrEqual(16);
});

test("composer controls meet the 44px touch target", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "touch devices only");
  await settle(page, "/agent-ui");

  // The painted control stays small by design; the target is carried by a
  // transparent ::after, so measure the pseudo-element rather than the button.
  const targets = await page.evaluate(() => {
    const sels = [".sc-ai__icon", ".sc-ai__send", ".sc-ai__model", ".sc-ai__enhance"];
    const out: { sel: string; w: number; h: number }[] = [];
    for (const sel of sels) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const after = getComputedStyle(el, "::after");
        const w = parseFloat(after.width);
        const h = parseFloat(after.height);
        if (Number.isNaN(w) || Number.isNaN(h)) continue;
        out.push({ sel, w, h });
      }
    }
    return out;
  });

  expect(targets.length, "expected composer controls on this panel").toBeGreaterThan(0);
  for (const t of targets) {
    expect(t.w, `${t.sel} hit area width (${testInfo.project.name})`).toBeGreaterThanOrEqual(44);
    expect(t.h, `${t.sel} hit area height (${testInfo.project.name})`).toBeGreaterThanOrEqual(44);
  }
});

test("composer menus open inside the viewport", async ({ page }) => {
  await settle(page, "/agent-ui");

  const attach = page.locator(".sc-ai__icon").first();
  await attach.click();

  const menu = page.locator(".sc-ai__menu").first();
  await expect(menu).toBeVisible();

  const within = async (loc: ReturnType<Page["locator"]>) => {
    const box = await loc.boundingBox();
    const width = page.viewportSize()!.width;
    expect(box, "menu must have a box").not.toBeNull();
    expect(box!.x, "menu left edge off-screen").toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, "menu right edge off-screen").toBeLessThanOrEqual(width + 1);
  };
  await within(menu);

  // The submenu used to open sideways at left:100%+4 with a 170px floor: on a
  // 360px screen that lands past the edge every time. Compact makes it an
  // indented group inside the parent menu instead.
  const skills = page.locator(".sc-ai__submenuwrap .sc-ai__menuitem").first();
  if (await skills.isVisible().catch(() => false)) {
    await skills.click();
    const sub = page.locator(".sc-ai__submenu").first();
    if (await sub.isVisible().catch(() => false)) await within(sub);
  }
});

test("cards compact on their own width, not the window's", async ({ page }) => {
  await settle(page, "/cards");

  // .sc-card is a query container, so this holds whether the card sits in a
  // narrow thread or standalone in this panel with no thread above it.
  const cards = await page.evaluate(() => {
    const out: { w: number; padding: string }[] = [];
    for (const el of Array.from(document.querySelectorAll(".sc-card")).slice(0, 40)) {
      const r = el.getBoundingClientRect();
      out.push({ w: Math.round(r.width), padding: getComputedStyle(el).paddingLeft });
    }
    return out;
  });

  expect(cards.length).toBeGreaterThan(0);
  for (const c of cards) {
    if (c.w <= 600) expect(c.padding, `card at ${c.w}px should use compact padding`).toBe("12px");
  }
});

test("P1 — nothing inside a card overflows the card", async ({ page }) => {
  // The viewport-overflow check above misses a narrower failure: an element
  // wider than its card, inside a page that still fits. That reads as a card
  // whose content is clipped or bleeding over its own border.
  await settle(page, "/cards");

  const bleeding = await page.evaluate(() => {
    const out: { card: string; child: string; over: number }[] = [];
    const scrolls = (el: Element) => {
      const o = getComputedStyle(el);
      return /auto|scroll|hidden/.test(o.overflowX) || /auto|scroll|hidden/.test(o.overflow);
    };

    for (const card of Array.from(document.querySelectorAll<HTMLElement>(".sc-card"))) {
      const box = card.getBoundingClientRect();
      const kind = card.closest("[id]")?.id ?? card.className;
      for (const child of Array.from(card.querySelectorAll<HTMLElement>("*"))) {
        const r = child.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const over = Math.round(r.right - box.right);
        if (over <= 1) continue;

        let excused = false;
        for (let p = child.parentElement; p && p !== card.parentElement; p = p.parentElement) {
          if (scrolls(p)) {
            excused = true;
            break;
          }
        }
        if (!excused) out.push({ card: kind, child: child.className || child.tagName, over });
      }
    }
    return out.slice(0, 12);
  });

  expect(bleeding, `card content bled past its border: ${JSON.stringify(bleeding, null, 2)}`).toEqual([]);
});

test("the bubble tier follows the thread, not the window", async ({ page }) => {
  // Two things at once.
  //
  // Guards the failure that already happened: compact and medium both match at
  // 360px, so only source order separates them, and authoring medium last
  // silently handed phones the tablet cap.
  //
  // And states the premise the whole design rests on. Writing this as "desktop
  // viewport implies desktop bubble" is what failed first at 1280px — the run
  // panel gives up 232px to the sidebar and 330 to the event rail, so its
  // thread is 678px and the medium tier is exactly right there. The viewport
  // was never the question; the container is.
  await settle(page, "/run");

  const measured = await page.evaluate(() => {
    const thread = document.querySelector(".sc-thread") as HTMLElement | null;
    if (!thread) return null;
    const cs = getComputedStyle(thread);
    const inner = thread.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);

    const probe = document.createElement("div");
    probe.className = "sc-bubble";
    thread.appendChild(probe);
    // Read the resolved declaration, not a measured box: Chrome reports a
    // percentage max-width back as a percentage, and dividing that by a pixel
    // width yields a number that looks like a ratio and is not one.
    const cap = getComputedStyle(probe).maxWidth;
    probe.remove();
    return { inner, cap };
  });

  expect(measured, "no thread to measure").not.toBeNull();
  const { inner, cap } = measured!;

  if (inner <= 600) expect(cap, `thread ${inner}px is compact`).toBe("88%");
  else if (inner <= 900) expect(cap, `thread ${inner}px is medium`).toContain("84%");
  else expect(cap, `thread ${inner}px is desktop`).toContain("76%");
});

test("P2 — every panel stays reachable on a phone", async ({ page }) => {
  // The shell used to display:none the sidebar below 900px, which left a phone
  // stranded on whichever panel it loaded. A strip that scrolls is the whole
  // fix; this asserts the links are present, hit-sized and actually navigate.
  await settle(page, "/");

  const links = page.locator(".dev__nav a");
  // Not an exact count: the number of panels is not what this test is about,
  // and pinning it means every new panel arrives as a failure in a responsive
  // test that has nothing to say about it. What matters is that the strip is
  // really there and every link in it can be reached.
  const count = await links.count();
  expect(count, "the nav strip should list the panels").toBeGreaterThanOrEqual(8);
  for (let i = 0; i < count; i += 1) await expect(links.nth(i)).toBeVisible();

  const first = links.first();
  const box = await first.boundingBox();
  expect(box!.height, "nav links need a touch-sized row").toBeGreaterThanOrEqual(30);

  await page.locator('.dev__nav a[href="/cards"]').click();
  await expect(page).toHaveURL(/\/cards$/);
  await expect(page.locator(".sc-card").first()).toBeVisible();
});

test("desktop keeps the values the compact tier overrides", async ({ page }, testInfo) => {
  // A regression guard, not a tier. Everything in the responsive section was
  // bolted onto a stylesheet that already worked at this width, and a leaked
  // compact value — a query that matches wider than intended, a rule authored
  // after the one it was meant to lose to — is invisible to a suite that only
  // looks at phones.
  test.skip(testInfo.project.name !== "desktop-1280", "desktop-only regression check");
  await settle(page, "/run");

  const desktop = await page.evaluate(() => {
    const thread = document.querySelector(".sc-thread") as HTMLElement | null;
    if (!thread) return null;
    const input = document.querySelector(".sc-composer__input");
    return {
      threadPadding: getComputedStyle(thread).paddingLeft,
      composerFont: input ? getComputedStyle(input).fontSize : null,
      // No pointer:coarse here, so the hit-area pseudo-element must not paint.
      sendTarget: (() => {
        const btn = document.querySelector(".sc-btn--primary");
        return btn ? getComputedStyle(btn, "::after").content : null;
      })(),
    };
  });

  expect(desktop).not.toBeNull();
  expect(desktop!.threadPadding, "desktop thread keeps 20px").toBe("20px");
  expect(desktop!.composerFont, "desktop composer keeps its designed 15px").toBe("15px");
  expect(desktop!.sendTarget, "touch hit areas must not exist on a mouse").toBe("none");
});

test("desktop shell keeps the sidebar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1280", "desktop-only regression check");
  await settle(page, "/");

  const nav = page.locator(".dev__nav");
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box!.width, "the sidebar is a column, not a strip").toBeGreaterThan(200);
  // The per-link hints are hidden in the strip; they belong on desktop.
  await expect(page.locator(".dev__link-hint").first()).toBeVisible();
});
