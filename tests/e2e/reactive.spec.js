import { test, expect } from "@playwright/test";

// Drives the real runtime on /reactive/: filter, per-row add/remove cart,
// counter increment, and an :if toggle. Selectors prefer text/role/data-attrs
// over nth-child so the demo copy can move without breaking the suite.

test.describe("/reactive/ — real browser reactivity", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reactive/");
  });

  test("loads the runtime (page is reactive)", async ({ page }) => {
    // The page must pull /__wd/runtime.js — that's what makes it reactive.
    const runtime = page.locator('script[src="/__wd/runtime.js"]');
    await expect(runtime).toHaveCount(1);
    // And the runtime must have hydrated initial state into the text bind.
    await expect(page.getByText("The count is 0.")).toBeVisible();
  });

  test("counter increments", async ({ page }) => {
    await expect(page.getByText("The count is 0.")).toBeVisible();
    await page.getByRole("button", { name: "Increment" }).click();
    await expect(page.getByText("The count is 1.")).toBeVisible();
    await page.getByRole("button", { name: "Increment" }).click();
    await expect(page.getByText("The count is 2.")).toBeVisible();
  });

  test(":if toggle shows/hides the conditional region", async ({ page }) => {
    // Initial branch: hidden.
    await expect(page.getByText("The details are hidden.")).toBeVisible();
    await expect(page.getByText("The details are visible now.")).toBeHidden();

    await page.getByRole("button", { name: "Show details" }).click();
    await expect(page.getByText("The details are visible now.")).toBeVisible();
    await expect(page.getByText("The details are hidden.")).toBeHidden();

    await page.getByRole("button", { name: "Hide details" }).click();
    await expect(page.getByText("The details are hidden.")).toBeVisible();
    await expect(page.getByText("The details are visible now.")).toBeHidden();
  });

  test(":bind search box filters the live product list", async ({ page }) => {
    const products = page.locator('[data-wd-loop="products"] [data-wd-loop-key]');
    // All five products visible to start.
    await expect(page.getByText("Aurora Lamp")).toBeVisible();
    await expect(page.getByText("Briza Fan")).toBeVisible();
    await expect(products).toHaveCount(5);

    const search = page.getByPlaceholder("Search products…");
    await search.fill("aurora");

    // Only the matching row survives the where-filter.
    await expect(page.getByText("Aurora Lamp")).toBeVisible();
    await expect(page.getByText("Briza Fan")).toBeHidden();
    await expect(products).toHaveCount(1);

    // Clearing the box restores the full list.
    await search.fill("");
    await expect(products).toHaveCount(5);
  });

  test("add-to-cart adds a row, remove takes it away", async ({ page }) => {
    const cart = page.locator('[data-wd-loop="cart"] [data-wd-loop-key]');
    await expect(cart).toHaveCount(0);

    // The first product card's own Add to cart button (per-row action).
    const auroraCard = page.locator(".card.product", { hasText: "Aurora Lamp" });
    await auroraCard.getByRole("button", { name: "Add to cart" }).click();

    await expect(cart).toHaveCount(1);
    const cartRegion = page.locator('[data-wd-loop="cart"]');
    await expect(cartRegion.getByText("Aurora Lamp")).toBeVisible();

    // Add a second, distinct product.
    const coveCard = page.locator(".card.product", { hasText: "Cove Speaker" });
    await coveCard.getByRole("button", { name: "Add to cart" }).click();
    await expect(cart).toHaveCount(2);
    await expect(cartRegion.getByText("Cove Speaker")).toBeVisible();

    // Remove the first cart line; it should disappear and the count drop.
    const auroraLine = page.locator(".card.line", { hasText: "Aurora Lamp" });
    await auroraLine.getByRole("button", { name: "Remove" }).click();

    await expect(cart).toHaveCount(1);
    await expect(cartRegion.getByText("Aurora Lamp")).toBeHidden();
    await expect(cartRegion.getByText("Cove Speaker")).toBeVisible();
  });
});
