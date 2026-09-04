import { expect, test } from "@playwright/test";

// F1 — a markdown link/image destination that reads state or a loop row is a
// live binding, not a build-time paint. /attr-binding/ drives all three shapes:
// a value in the middle of a path, one per row, and one the runtime has to
// refuse.

test("a bound destination follows state through button clicks", async ({ page }) => {
  await page.goto("/attr-binding/");
  const link = page.getByRole("link", { name: "Open the docs for this region" });

  // The compile-time paint is the seed, so the link works before hydration.
  await expect(link).toHaveAttribute("href", "/docs/eu/");

  await page.getByRole("button", { name: "US", exact: true }).click();
  await expect(link).toHaveAttribute("href", "/docs/us/");

  await page.getByRole("button", { name: "APAC", exact: true }).click();
  await expect(link).toHaveAttribute("href", "/docs/apac/");

  await page.getByRole("button", { name: "EU", exact: true }).click();
  await expect(link).toHaveAttribute("href", "/docs/eu/");
});

test("one row template fills each row's own href, including a row added at runtime", async ({
  page
}) => {
  await page.goto("/attr-binding/");
  const rows = page.locator("a[data-wd-each-attr]");

  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("href", "/products/aurora/");
  await expect(rows.nth(1)).toHaveAttribute("href", "/products/briza/");
  await expect(rows.nth(2)).toHaveAttribute("href", "/products/cove/");

  await page.getByRole("button", { name: "Add a product" }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(3)).toHaveAttribute("href", "/products/dune/");
  await expect(rows.nth(3)).toHaveText("Dune Rug");
});

test("a javascript: value never lands in a bound href", async ({ page }) => {
  /** @type {string[]} */
  const dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto("/attr-binding/");
  const link = page.getByRole("link", { name: "This link's href" });
  await expect(link).toHaveAttribute("href", "/safe/place/");

  await page.getByRole("button", { name: "Try a javascript: URL" }).click();

  // The state really does hold the payload: it is the GUARD that stopped it,
  // not some earlier layer refusing to store the value.
  expect(await page.evaluate(() => window.wd.get("danger"))).toBe("javascript:alert(1)");
  await expect(link).toHaveAttribute("href", "");

  // Clicking it navigates nowhere and executes nothing.
  await link.click();
  await expect(page).toHaveURL(/\/attr-binding\/$/);
  expect(dialogs).toEqual([]);

  await page.getByRole("button", { name: "Set a safe URL" }).click();
  await expect(link).toHaveAttribute("href", "/safe/place/");
});
