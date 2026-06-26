import { expect, test } from "@playwright/test";

// The #cart section declares `:state items = [] persist`, so its value is
// mirrored to localStorage under `wd:cart:items`. Change it, reload, and the
// state (and the computed total derived from it) must survive.

test("persisted cart survives a full page reload", async ({ page }) => {
  await page.goto("/data/");

  const cart = page.locator("#cart");
  await expect(cart).toContainText("holds 0 item(s) worth $0");

  await page.getByRole("button", { name: "Add sticker" }).click();
  await page.getByRole("button", { name: "Add poster" }).click();
  await expect(cart).toContainText("holds 2 item(s) worth $8");

  // Sanity: it actually wrote to localStorage.
  const stored = await page.evaluate(() => localStorage.getItem("wd:cart:items"));
  expect(stored).toBeTruthy();
  expect(JSON.parse(stored)).toHaveLength(2);

  // Hard reload — state must rehydrate from localStorage, not reset to [].
  await page.reload();

  const cartAfter = page.locator("#cart");
  await expect(cartAfter).toContainText("holds 2 item(s) worth $8");
});
