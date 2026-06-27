import { expect, test } from "@playwright/test";

const routes = [
  { path: "/", runtime: true },
  { path: "/docs/", runtime: false },
  { path: "/markdown/", runtime: false },
  { path: "/reactive/", runtime: true },
  { path: "/data/", runtime: true },
  { path: "/app/", runtime: true },
  // Showcase hub (static) + the five flagship apps (reactive).
  { path: "/showcase/", runtime: false },
  { path: "/folio/", runtime: true },
  { path: "/folio/cart/", runtime: true },
  { path: "/pulse/", runtime: true },
  { path: "/forge/", runtime: true },
  { path: "/compass/", runtime: true },
  { path: "/ledger/", runtime: true },
  // The escape-hatch carousel is reactive; the media page is the 1.0 proof that
  // :video/:audio/:embed stay zero framework JS.
  { path: "/carousel/", runtime: true },
  { path: "/media/", runtime: false }
];

test.describe("demo routes — launch smoke", () => {
  for (const route of routes) {
    test(`${route.path} loads with the expected runtime contract`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("body")).not.toBeEmpty();
      const runtime = page.locator('script[src="/__wd/runtime.js"]');
      await expect(runtime).toHaveCount(route.runtime ? 1 : 0);
    });
  }

  test("top nav links resolve and hidden demo files stay unroutable", async ({ page }) => {
    await page.goto("/");
    for (const href of ["/", "/docs/", "/showcase/", "/reactive/", "/data/"]) {
      await expect(page.locator(`.topnav a[href="${href}"]`).first()).toBeVisible();
    }

    for (const hidden of ["/-draft/", "/docs/.secret/"]) {
      const response = await page.goto(hidden);
      expect(response?.status()).toBe(404);
      await expect(page.locator('script[src="/__wd/runtime.js"]')).toHaveCount(0);
    }
  });
});
