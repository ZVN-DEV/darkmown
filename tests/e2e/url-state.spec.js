import { expect, test } from "@playwright/test";

// F2 — `:state … from-url` mirrors a value into the query string with
// replaceState: reload keeps it, a shared link arrives with it applied, and the
// back button is not filled with one entry per keystroke.

const rows = (page) => page.locator("[data-wd-loop-out] li");

test("a filter reaches the address bar without filling the back button", async ({ page }) => {
  await page.goto("/url-state/");
  const depth = await page.evaluate(() => history.length);
  const box = page.getByPlaceholder("Search products");

  await box.fill("aurora");
  await expect(page).toHaveURL(/\?q=aurora$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Aurora Lamp");
  expect(await page.evaluate(() => history.length)).toBe(depth);

  // A second change replaces the same entry rather than pushing another.
  await box.fill("cove");
  await expect(page).toHaveURL(/\?q=cove$/);
  expect(await page.evaluate(() => history.length)).toBe(depth);

  // Back at the declared seed, the parameter goes away entirely.
  await box.fill("");
  await expect(page).toHaveURL(/\/url-state\/$/);
  await expect(rows(page)).toHaveCount(4);
  expect(await page.evaluate(() => history.length)).toBe(depth);
});

test("the filter survives a reload", async ({ page }) => {
  await page.goto("/url-state/");
  await page.getByPlaceholder("Search products").fill("briza");
  await expect(page).toHaveURL(/\?q=briza$/);

  await page.reload();
  await expect(page.getByPlaceholder("Search products")).toHaveValue("briza");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Briza Fan");
});

test("a shared link arrives with the filter already applied", async ({ page }) => {
  await page.goto("/url-state/?q=cove&tier=premium");

  await expect(page.getByPlaceholder("Search products")).toHaveValue("cove");
  await expect(page.locator('input[type=radio][value="premium"]')).toBeChecked();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Cove Shelf");
});

test("a bound radio mirrors into the URL too, and clears at its seed", async ({ page }) => {
  await page.goto("/url-state/");
  await expect(page).toHaveURL(/\/url-state\/$/);

  await page.locator('input[type=radio][value="premium"]').check();
  await expect(page).toHaveURL(/\?tier=premium$/);

  await page.locator('input[type=radio][value="all"]').check();
  await expect(page).toHaveURL(/\/url-state\/$/);
});
