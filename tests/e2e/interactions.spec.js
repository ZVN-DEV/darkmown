import { expect, test } from "./coverage.js";

// Drives the two pay-for-what-you-use behavior modules on /interactions/:
// /__wd/behaviors/sortable.js (keyboard + pointer reorder of a `@loop sortable`)
// and /__wd/behaviors/carousel.js (prev/next, dots, mouse drag). These modules
// are standalone scripts with no runtime dependency of their own, so the spec
// also asserts the page loads them alongside the core runtime.

test.describe("/interactions/ — behavior modules", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/interactions/");
  });

  test("the page loads both behavior modules", async ({ page }) => {
    await expect(page.locator('script[src="/__wd/behaviors/sortable.js"]')).toHaveCount(1);
    await expect(page.locator('script[src="/__wd/behaviors/carousel.js"]')).toHaveCount(1);
  });

  test("sortable: Arrow Down on a focused row reorders the store", async ({ page }) => {
    const rows = page.locator("[data-wd-sortable] [data-wd-loop-key]");
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText("Sketch the idea");

    // Focus the first row's grip (the behavior sets tabindex=0 on the styled
    // row element inside the loop-piece wrapper) and move it down.
    const grips = page.locator("[data-wd-sortable] [data-wd-loop-key] .row");
    await grips.first().focus();
    await page.keyboard.press("ArrowDown");

    const reordered = page.locator("[data-wd-sortable] [data-wd-loop-key]");
    await expect(reordered.nth(0)).toContainText("Draft the page");
    await expect(reordered.nth(1)).toContainText("Sketch the idea");
  });

  test("sortable: pointer drag reorders on drop", async ({ page }) => {
    const rows = page.locator("[data-wd-sortable] [data-wd-loop-key]");
    // Raw page.mouse does NOT auto-scroll: the sortable panel sits below the
    // fold, so bring it into view before reading boxes or the events hit nothing.
    await rows.first().scrollIntoViewIfNeeded();
    const first = rows.first();
    const second = rows.nth(1);
    const firstBox = await first.boundingBox();
    const secondBox = await second.boundingBox();
    if (!firstBox || !secondBox) throw new Error("sortable rows not laid out");

    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    // Drag to clearly below the second row's center, in steps so pointermove lands.
    await page.mouse.move(firstBox.x + firstBox.width / 2, secondBox.y + secondBox.height, {
      steps: 5
    });
    await page.mouse.up();

    const reordered = page.locator("[data-wd-sortable] [data-wd-loop-key]");
    await expect(reordered.nth(0)).toContainText("Draft the page");
    await expect(reordered.nth(1)).toContainText("Sketch the idea");
  });

  test("carousel: next/prev buttons and dots sync the active slide", async ({ page }) => {
    const next = page.getByRole("button", { name: "Next slide" });
    const prev = page.getByRole("button", { name: "Previous slide" });
    const dots = page.locator(".wd-carousel-dot");
    await expect(dots).toHaveCount(3);

    await expect(prev).toBeDisabled();
    await expect(dots.first()).toHaveAttribute("aria-current", "true");

    await next.click();
    await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(prev).toBeEnabled();

    await next.click();
    await expect(dots.nth(2)).toHaveAttribute("aria-current", "true");
    await expect(next).toBeDisabled();

    await prev.click();
    await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  });

  test("carousel: a dot click jumps straight to its slide", async ({ page }) => {
    const dots = page.locator(".wd-carousel-dot");
    await dots.nth(2).click();
    await expect(dots.nth(2)).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("button", { name: "Next slide" })).toBeDisabled();
  });

  test("carousel: mouse drag scrolls the track", async ({ page }) => {
    const track = page.locator("[data-wd-carousel-track]");
    // Same below-the-fold rule as the sortable drag: scroll first.
    await track.scrollIntoViewIfNeeded();
    const before = await track.evaluate((el) => el.scrollLeft);

    const box = await track.boundingBox();
    if (!box) throw new Error("carousel track not laid out");
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  });
});
