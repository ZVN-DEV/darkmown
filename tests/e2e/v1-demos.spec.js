import { expect, test } from "@playwright/test";

// The 1.0 demos, driven in a real browser: aggregates + reactive sort (Ledger),
// the wd.subscribe escape hatch incl. pointer drag (Swiper/carousel), and the
// zero-JS media directives (Media). Each test gets a fresh context, so the
// Ledger's durable :store seeds cleanly from the page's 8-row script.

test.describe("Ledger — aggregates, format pipes, reactive sort", () => {
  test("running totals come from sum()/avg()/max() over the rows", async ({ page }) => {
    await page.goto("/ledger/");
    // Total spend is the first stat; sum of the eight seeded amounts = 1,109.35.
    await expect(page.locator(".stat-num").first()).toHaveText("$1,109.35");
    // Entries is the count aggregate.
    await expect(page.locator(".stat-num").nth(3)).toHaveText("8");
  });

  test("clicking a column header re-sorts the table live", async ({ page }) => {
    await page.goto("/ledger/");
    const firstMerchant = page.locator(".trow:not(.blank) .td.strong").first();
    // Default sort is amount desc; click Merchant to sort alphabetically.
    await page.locator(".th button", { hasText: "Merchant" }).click();
    await expect(firstMerchant).toHaveText("Aurora Studio");
  });

  test("the live filter narrows the rows by merchant", async ({ page }) => {
    await page.goto("/ledger/");
    await page.locator("input[data-wd-bind-input]").fill("Briza");
    const rows = page.locator(".trow:not(.blank)");
    await expect(rows).toHaveCount(2);
    await expect(page.locator(".trow:not(.blank) .td.strong").first()).toHaveText("Briza Coffee");
  });
});

test.describe("Swiper — the wd.subscribe escape hatch", () => {
  test("arrows and dots drive the shared slide state", async ({ page }) => {
    await page.goto("/carousel/");
    const readout = page.locator(".swiper-readout");
    await expect(readout).toContainText("Slide 1 of 5");

    await page.locator("[data-swiper-next]").click();
    await expect(readout).toContainText("Slide 2 of 5");

    // A dot jump is declarative (:button -> slide = N).
    await page.getByRole("button", { name: "5" }).click();
    await expect(readout).toContainText("Slide 5 of 5");

    // Next from the last slide wraps back to the first (escape-hatch logic).
    await page.locator("[data-swiper-next]").click();
    await expect(readout).toContainText("Slide 1 of 5");
  });

  test("pointer drag advances the carousel", async ({ page }) => {
    await page.goto("/carousel/");
    const readout = page.locator(".swiper-readout");
    await expect(readout).toContainText("Slide 1 of 5");

    const box = await page.locator("[data-swiper]").boundingBox();
    const y = box.y + box.height / 2;
    // Drag left across most of the viewport — past the 18% threshold → next.
    await page.mouse.move(box.x + box.width * 0.85, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
    await page.mouse.up();

    await expect(readout).toContainText("Slide 2 of 5");
  });
});

test.describe("Media — :video / :audio / :embed stay zero-JS", () => {
  test("hardened players render and the page ships no framework JS", async ({ page }) => {
    await page.goto("/media/");

    const video = page.locator("video");
    await expect(video).toHaveAttribute("src", "/media/clip.mp4");
    await expect(video).toHaveAttribute("preload", "metadata");
    await expect(page.locator("audio")).toHaveAttribute("src", "/media/tone.mp3");

    // :embed rewrites the YouTube URL to its no-cookie origin, lazily framed.
    const iframe = page.locator(".wd-embed iframe");
    await expect(iframe).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ"
    );
    await expect(iframe).toHaveAttribute("loading", "lazy");

    // The whole point: a media page loads no runtime.
    await expect(page.locator('script[src="/__wd/runtime.js"]')).toHaveCount(0);
  });
});
