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
  // Three engines, because the runtime is the one part of Darkmown that does not
  // run under node:test — src/runtime.js ships to a browser and e2e is its only
  // enforced net (see the coverage-gate comment in .github/workflows/ci.yml).
  // Blink / Gecko / WebKit each get a vote on the keyed loop reconciler, the
  // binding pass, fetch, forms, and the AST interpreter.
  //
  // CI runs one engine per job (`--project=<name>`, see the e2e matrix in
  // ci.yml) so three engines cost the same wall-clock as one. Locally, a bare
  // `npm run test:e2e` runs all three; pass `--project=chromium` for a fast loop.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  // Build the demo site, then serve the static dist on the fixed port.
  // The published package stays zero-dep; this only runs under `npm run test:e2e`.
  //
  // PORT goes through `env`, NOT a `PORT=… node …` prefix on the command: that
  // prefix is Bourne-shell syntax, and Playwright hands this string to cmd.exe
  // on Windows, which would read "PORT=4173" as the program name. `env` is
  // portable and reaches the same process.
  webServer: {
    command: "npm run build && node src/cli.js serve",
    env: { PORT: String(PORT) },
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
