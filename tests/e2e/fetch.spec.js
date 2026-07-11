import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { compilePage } from "../../src/compiler.js";
import { createPaths } from "../../src/config.js";

// ---------------------------------------------------------------------------
// Fetch lifecycle e2e. The published e2e suite serves the static `dist`, but
// :fetch needs a live, route-mockable endpoint and a per-test page, so these
// tests are self-contained: compile a .wd fixture to HTML, set it as the page
// content, mock the network with page.route(), then boot the *real* runtime.
// The runtime is injected by URL (`/__wd/runtime.js`, same-origin, covered by
// the served page's `script-src 'self'`) rather than as an inline <script>,
// which the shipped reactive CSP blocks — matching how the other e2e specs load
// it and driving the genuine startFetch lifecycle without adding a demo page.
// ---------------------------------------------------------------------------

/**
 * Compile a .wd source string and return just the <body> inner HTML, with the
 * runtime <script> tag removed (we inject the runtime ourselves, post-route).
 * @param {string} src
 * @returns {string}
 */
function compileBody(src) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-fetch-e2e-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/index.wd"), src);
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  const body = (page.html.match(/<body>([\s\S]*)<\/body>/) || ["", ""])[1];
  return body.replace(/<script type="module"[^>]*><\/script>/g, "");
}

/**
 * Load compiled :fetch markup into the page, then boot the runtime so the
 * fetch fires against whatever routes the test has registered.
 * @param {import('@playwright/test').Page} page
 * @param {string} src
 */
async function mount(page, src) {
  // Land on the served origin first so the page's relative fetch URLs resolve
  // (and page.route can intercept them); then swap in the compiled markup.
  await page.goto("/");
  await page.setContent(`<!doctype html><html><body>${compileBody(src)}</body></html>`);
  await page.addScriptTag({ url: "/__wd/runtime.js" });
}

test.describe("fetch lifecycle", () => {
  test("loading flips to data on success", async ({ page }) => {
    // Hold the response open briefly so the loading branch is observable.
    await page.route("**/team.json", async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, name: "Ada" }])
      });
    });
    await mount(
      page,
      [
        ':fetch team from "/team.json"',
        ":if team_loading",
        "Loading…",
        ":endif",
        "@loop team into m",
        "- { m.name }",
        "@endloop"
      ].join("\n")
    );

    await expect(page.getByText("Loading…")).toBeVisible();
    await expect(page.getByText("Ada")).toBeVisible();
    await expect(page.getByText("Loading…")).toBeHidden();
  });

  test("non-2xx surfaces name_error", async ({ page }) => {
    await page.route("**/team.json", (route) => route.fulfill({ status: 500, body: "boom" }));
    await mount(
      page,
      [':fetch team from "/team.json"', ":if team_error", "Failed: { team_error }", ":endif"].join(
        "\n"
      )
    );

    await expect(page.getByText(/Failed: .*HTTP 500/)).toBeVisible();
  });

  test("timeout aborts into name_error", async ({ page }) => {
    // Route never resolves; the AbortController timeout must fire.
    await page.route("**/slow.json", async () => {
      /* hang forever */
    });
    await mount(
      page,
      [
        ':fetch slow from "/slow.json" timeout=400',
        ":if slow_error",
        "Timed out: { slow_error }",
        ":endif"
      ].join("\n")
    );

    await expect(page.getByText(/Timed out:/)).toBeVisible();
  });

  test("empty array sets name_empty", async ({ page }) => {
    await page.route("**/team.json", (route) =>
      route.fulfill({ contentType: "application/json", body: "[]" })
    );
    await mount(
      page,
      [':fetch team from "/team.json"', ":if team_empty", "Nobody here yet.", ":endif"].join("\n")
    );

    await expect(page.getByText("Nobody here yet.")).toBeVisible();
  });

  test("dynamic URL auto-refetches when a :bind field changes", async ({ page }) => {
    await page.route("**/u/*", (route) => {
      const id = route.request().url().split("/").pop();
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id, name: `User ${id}` })
      });
    });
    await mount(
      page,
      [
        ":state userId = 1",
        ':fetch user from "/u/{ userId }"',
        ":bind userId",
        ":if user",
        "Loaded { user.name }",
        ":endif"
      ].join("\n")
    );

    await expect(page.getByText("Loaded User 1")).toBeVisible();
    await page.locator('[data-wd-bind-input="userId"]').fill("7");
    await expect(page.getByText("Loaded User 7")).toBeVisible();
  });

  test("dynamic URL skips the fetch while a dep is empty", async ({ page }) => {
    let hits = 0;
    await page.route("**/u/*", (route) => {
      hits++;
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ name: "set" }) });
    });
    await mount(
      page,
      [':state userId = ""', ':fetch user from "/u/{ userId }"', ":bind userId"].join("\n")
    );

    // No request should have fired with an empty dep.
    await page.waitForTimeout(300);
    expect(hits).toBe(0);

    await page.locator('[data-wd-bind-input="userId"]').fill("3");
    await expect.poll(() => hits).toBeGreaterThan(0);
  });

  test("refetch button reloads the data", async ({ page }) => {
    let n = 0;
    await page.route("**/count.json", (route) => {
      n++;
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ n }) });
    });
    await mount(
      page,
      [
        ':fetch counter from "/count.json"',
        ":if counter",
        "Count is { counter.n }",
        ":endif",
        ':button "Reload" -> counter refetch'
      ].join("\n")
    );

    await expect(page.getByText("Count is 1")).toBeVisible();
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByText("Count is 2")).toBeVisible();
  });

  test("@loop over a nested fetched array (dotted source) renders rows", async ({ page }) => {
    await page.route("**/payload.json", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            { id: 1, name: "Alpha" },
            { id: 2, name: "Beta" }
          ]
        })
      })
    );
    await mount(
      page,
      [
        ':fetch payload from "/payload.json"',
        "@loop payload.items into row",
        "- { row.name }",
        "@endloop"
      ].join("\n")
    );

    await expect(page.getByText("Alpha")).toBeVisible();
    await expect(page.getByText("Beta")).toBeVisible();
    await expect(page.locator('[data-wd-loop="payload.items"] [data-wd-loop-key]')).toHaveCount(2);
  });
});
