import { defineConfig, devices } from "@playwright/test";

// Playwright forces colored reporter output in some terminals. This repo often
// runs with NO_COLOR set by the parent agent shell; passing both through makes
// Node print noisy warning banners before every browser worker. Prefer the
// runner's forced-color choice for this e2e process and its children.
if (process.env.NO_COLOR) delete process.env.NO_COLOR;

// Fixed port so baseURL and the webServer agree. Override with PORT if needed.
const PORT = Number(process.env.PORT || 4173);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  // Browser e2e is the slow tier; give it room but keep CI honest.
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["list"]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Build the demo site, then serve the static dist on the fixed port.
  // The published package stays zero-dep; this only runs under `npm run test:e2e`.
  webServer: {
    command: `npm run build && PORT=${PORT} node src/cli.js serve`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
