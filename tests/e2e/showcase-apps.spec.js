import { expect, test } from "@playwright/test";

// The four flagship showcase apps, driven in a real browser. These lock in the
// core interaction of each — proving the apps are reactive, not just rendered.

test.describe("showcase apps — real interactions", () => {
  test("Folio: add to cart bumps the persisted count", async ({ page }) => {
    await page.goto("/folio/");
    const count = page.locator('[data-wd-bind="store:count"]').first();
    await expect(count).toHaveText("0");
    await page.getByRole("button", { name: "Add" }).first().click();
    await expect(count).toHaveText("1");
    // The cart is a :store — it survives a reload.
    await page.reload();
    await expect(page.locator('[data-wd-bind="store:count"]').first()).toHaveText("1");
  });

  test("Forge: toggling a feature recomputes the live price", async ({ page }) => {
    await page.goto("/forge/");
    const total = page.locator('[data-wd-bind="forge:total"]').first();
    const before = Number((await total.innerText()).replace(/\D/g, ""));
    await page.getByRole("button", { name: /add/i }).first().click();
    await expect
      .poll(async () => Number((await total.innerText()).replace(/\D/g, "")))
      .toBeGreaterThan(before);
  });

  test("Compass: answering a question advances the state machine", async ({ page }) => {
    await page.goto("/compass/");
    await expect(page.getByText(/Question 1 of 4/i)).toBeVisible();
    await page.locator(".app-compass button").first().click();
    await expect(page.getByText(/Question 2 of 4/i)).toBeVisible();
  });

  test("Pulse: :fetch renders the service grid", async ({ page }) => {
    await page.goto("/pulse/");
    await expect(page.getByText(/API Gateway|Primary DB|Mail Relay/).first()).toBeVisible();
  });
});
