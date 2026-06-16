import { test, expect } from "@playwright/test";

// Drives the real :store machinery on /store/: durable persistence across a
// reload, cross-tab sync via the `storage` event (two browser contexts on one
// origin), the `ephemeral` opt-out (no persistence), and `reset` returning a
// store to its DECLARED seed (not its last persisted value). Selectors prefer
// text/role/data-attrs so the demo copy can move without breaking the suite.
//
// Demo contract the /store/ page must satisfy (owned by the docs/demo page):
//   - A durable `:store cart = []` whose count is shown as text "Cart: N".
//     A button labelled "Add to cart" appends one item (bumping the count).
//     A button labelled "Reset cart" runs `-> cart reset`.
//   - An `:store draft = "" ephemeral` bound to an input (placeholder /draft/)
//     and echoed as text so we can read it back after a reload.

test.describe("/store/ — global :store in a real browser", () => {
  test("loads the runtime (page is reactive)", async ({ page }) => {
    await page.goto("/store/");
    await expect(page.locator('script[src="/__wd/runtime.js"]')).toHaveCount(1);
  });

  test("a durable store survives a full page reload", async ({ page }) => {
    await page.goto("/store/");
    await expect(page.getByText(/Cart: 0/)).toBeVisible();

    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByText(/Cart: 2/)).toBeVisible();

    // It actually wrote the store to localStorage under the wd:store: prefix.
    const stored = await page.evaluate(() => localStorage.getItem("wd:store:cart"));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored)).toHaveLength(2);

    // Hard reload — the store rehydrates from localStorage, not back to [].
    await page.reload();
    await expect(page.getByText(/Cart: 2/)).toBeVisible();
  });

  test("mutating the store in one tab updates another tab via the storage event", async ({ browser }) => {
    // Two contexts share the same origin + localStorage-backed BroadcastChannel
    // for `storage` events in Chromium when they live in the same browser.
    const context = await browser.newContext();
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    await tabA.goto("/store/");
    await tabB.goto("/store/");

    await expect(tabA.getByText(/Cart: 0/)).toBeVisible();
    await expect(tabB.getByText(/Cart: 0/)).toBeVisible();

    // Mutate in A; B must pick it up through the runtime's `storage` listener.
    await tabA.getByRole("button", { name: "Add to cart" }).click();
    await expect(tabA.getByText(/Cart: 1/)).toBeVisible();
    await expect(tabB.getByText(/Cart: 1/)).toBeVisible();

    await context.close();
  });

  test("an ephemeral store does NOT persist across a reload", async ({ page }) => {
    await page.goto("/store/");
    const draft = page.getByPlaceholder(/draft/i);
    await draft.fill("scratch note");
    await expect(page.getByText("scratch note")).toBeVisible();

    // Ephemeral stores are in-memory only: nothing under wd:store:draft.
    const stored = await page.evaluate(() => localStorage.getItem("wd:store:draft"));
    expect(stored).toBeNull();

    // After reload the ephemeral value is gone (back to its seed).
    await page.reload();
    await expect(page.getByText("scratch note")).toBeHidden();
  });

  test("reset returns a persisted store to its declared seed", async ({ page }) => {
    await page.goto("/store/");
    await page.getByRole("button", { name: "Add to cart" }).click();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByText(/Cart: 2/)).toBeVisible();

    await page.getByRole("button", { name: "Reset cart" }).click();
    await expect(page.getByText(/Cart: 0/)).toBeVisible();

    // Reset also wrote the seed back to storage, so a reload stays at the seed.
    const stored = await page.evaluate(() => localStorage.getItem("wd:store:cart"));
    expect(JSON.parse(stored)).toHaveLength(0);
    await page.reload();
    await expect(page.getByText(/Cart: 0/)).toBeVisible();
  });
});
