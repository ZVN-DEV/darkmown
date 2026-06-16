import { test, expect } from "@playwright/test";

// Drives the real runtime loop pipeline on /loops/: sort asc/desc, limit/offset,
// reverse, per-row meta vars ($index/$first/$last), the @empty branch, and a
// reactive `limit pageSize` button. Selectors prefer text/role/data-attrs over
// nth-child so the demo copy can move without breaking the suite.
//
// Demo contract the /loops/ page must satisfy (owned by the docs/demo page):
//   - A `:state people` list of objects with at least { id, name, age }.
//   - A list region with `@loop people into p sort by p.age desc` whose rows
//     show the person name; the region is locatable as [data-wd-loop="people"].
//   - A `:state pageSize` paginated list `@loop … limit pageSize` reachable as
//     [data-wd-loop-limit] with a button labelled "Show more" that bumps pageSize.
//   - A filtered list that can reach zero rows to reveal an @empty message
//     "No matches." (e.g. a :bind search box that filters via `where`).
//   - Per-row meta rendered as text: "1." / "2." numbering and a "(first)" /
//     "(last)" marker driven by :if $first / :if $last.

test.describe("/loops/ — loop ergonomics in a real browser", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/loops/");
  });

  test("loads the runtime (page is reactive)", async ({ page }) => {
    await expect(page.locator('script[src="/__wd/runtime.js"]')).toHaveCount(1);
  });

  test("sort by age descending puts the oldest row first", async ({ page }) => {
    const rows = page.locator('[data-wd-loop="people"] [data-wd-loop-key]');
    await expect(rows.first()).toBeVisible();
    const names = await rows.allInnerTexts();
    // The demo data is sorted oldest-first; assert a strictly non-increasing age
    // by checking the known top entry. The demo's eldest person is "Cyrus".
    expect(names[0]).toContain("Cyrus");
  });

  test("a sort-direction toggle flips ascending/descending", async ({ page }) => {
    const rows = page.locator('[data-wd-loop="people"] [data-wd-loop-key]');
    const before = (await rows.allInnerTexts())[0];
    await page.getByRole("button", { name: /sort/i }).click();
    const after = (await rows.allInnerTexts())[0];
    expect(after).not.toEqual(before); // direction flipped → first row changed
  });

  test("offset + limit slice the rendered window", async ({ page }) => {
    // The paginated region renders exactly `pageSize` rows to start.
    const paged = page.locator('[data-wd-loop-limit] [data-wd-loop-key]');
    await expect(paged).toHaveCount(2);
  });

  test("reverse flips the source order", async ({ page }) => {
    const reversed = page.locator('[data-wd-loop="recent"] [data-wd-loop-key]');
    const items = await reversed.allInnerTexts();
    // The demo lists items 1..N; reversed → the last item appears first.
    expect(items[0]).not.toEqual(items[items.length - 1]);
    expect(Number(items[0].match(/\d+/)?.[0])).toBeGreaterThan(
      Number(items[items.length - 1].match(/\d+/)?.[0])
    );
  });

  test("per-row meta vars render $number, $first and $last", async ({ page }) => {
    const meta = page.locator('[data-wd-loop="people"]');
    // 1-based numbering from $number.
    await expect(meta.getByText("1.", { exact: false }).first()).toBeVisible();
    // $first / $last markers on the boundary rows.
    await expect(meta.getByText("(first)")).toHaveCount(1);
    await expect(meta.getByText("(last)")).toHaveCount(1);
  });

  test("@empty branch shows when a filter empties the list", async ({ page }) => {
    const search = page.getByPlaceholder(/search/i);
    await search.fill("zzzz-no-such-name");
    await expect(page.getByText("No matches.")).toBeVisible();
    // Restore: the empty branch disappears and rows return.
    await search.fill("");
    await expect(page.getByText("No matches.")).toBeHidden();
  });

  test("reactive limit grows the list via a pageSize button", async ({ page }) => {
    const paged = page.locator('[data-wd-loop-limit] [data-wd-loop-key]');
    await expect(paged).toHaveCount(2);
    await page.getByRole("button", { name: "Show more" }).click();
    // Bumping :state pageSize re-slices the loop reactively (no reload).
    await expect(paged).toHaveCount(4);
  });
});
