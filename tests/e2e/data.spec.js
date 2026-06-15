import { test, expect } from "@playwright/test";

// Drives /data/: declarative :fetch into a loop, a :form that writes state,
// the computed cart total, and the error fallback when a server form posts
// to an endpoint that doesn't exist under the static `serve` (no dev echo).

test.describe("/data/ — fetch, forms, computed", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/data/");
  });

  test("fetched team data renders into the loop", async ({ page }) => {
    // team.json is served from dist/__wd/data/team.json; once it lands the
    // :if team branch flips and the member loop fills in.
    const team = page.locator('[data-wd-loop="team"] [data-wd-loop-key]');
    await expect(team).toHaveCount(5);
    await expect(page.getByText("Acceptance & demo proof")).toBeVisible();
    // The loading fallback should be gone after the fetch resolves.
    await expect(page.getByText("Loading the team…")).toBeHidden();
    // Per-row :if over the fetched items: lead badge for the lead member.
    await expect(page.getByText("Team lead ★")).toBeVisible();
  });

  test(":form into state updates the page", async ({ page }) => {
    // Before submit, the conditional sentence is in its else branch.
    await expect(
      page.getByText("Submit the form and this sentence reacts.")
    ).toBeVisible();

    await page.getByPlaceholder("Your name").fill("Ada");
    await page.getByPlaceholder("Your quest").fill("the moat");
    await page.getByRole("button", { name: "Save profile" }).click();

    // State now exists → the reactive sentence renders with the values.
    await expect(
      page.getByText("Hello Ada — good luck with the moat.")
    ).toBeVisible();
    await expect(
      page.getByText("Submit the form and this sentence reacts.")
    ).toBeHidden();
  });

  test("computed total tracks the persisted cart", async ({ page }) => {
    // Fresh context: cart empty, total 0 (length 0 * 4).
    const cartLine = page.locator("#cart");
    await expect(cartLine).toContainText("holds 0 item(s) worth $0");

    await page.getByRole("button", { name: "Add sticker" }).click();
    await expect(cartLine).toContainText("holds 1 item(s) worth $4");

    await page.getByRole("button", { name: "Add poster" }).click();
    await expect(cartLine).toContainText("holds 2 item(s) worth $8");

    await page.getByRole("button", { name: "Empty cart" }).click();
    await expect(cartLine).toContainText("holds 0 item(s) worth $0");
  });

  test("server form surfaces the error fallback when the endpoint 404s", async ({
    page,
  }) => {
    // Under the static `serve`, /__wd/echo doesn't exist, so the fetch fails
    // and the :if reply_error branch must render.
    await page.getByPlaceholder("Say something to the server").fill("hi");
    await page.getByRole("button", { name: "Send to server" }).click();
    await expect(page.getByText(/The request failed:/)).toBeVisible();
  });
});
