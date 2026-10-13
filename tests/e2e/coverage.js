// ---------------------------------------------------------------------------
// Shared e2e fixture: every spec imports `test`/`expect` from HERE, not from
// "@playwright/test", so the browser runtime's coverage net lives in one place.
//
// On the CHROMIUM project only, each test's page records V8 JavaScript coverage
// (Playwright's page.coverage API is Chromium-only; on firefox/webkit the
// fixture is a pass-through and writes nothing). After the test, the entries
// for the served framework scripts — /__wd/runtime.js and any
// /__wd/behaviors/*.js the page loaded — are appended to `.runtime-coverage/`
// as one JSON file per test. scripts/runtime-coverage-gate.mjs merges those
// files and gates the result; see that script's header for the gate design.
//
// `resetOnNavigation: false` because several specs navigate more than once
// (and store/persist specs reload): coverage must accumulate across the whole
// test, not just the last page load.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

/** Raw per-test coverage output. Gitignored; the gate reads it. */
export const COVERAGE_DIR = fileURLToPath(new URL("../../.runtime-coverage", import.meta.url));

/** The framework scripts the gate measures. Anything else (demo page .js) is noise. */
const MEASURED_PATH = /^\/__wd\/(?:runtime\.js|behaviors\/[^/?#]+\.js)$/;

export const test = base.extend({
  page: async ({ page, browserName }, use, testInfo) => {
    const collect = browserName === "chromium" && page.coverage !== undefined;
    if (collect) await page.coverage.startJSCoverage({ resetOnNavigation: false });

    await use(page);

    if (!collect) return;
    let entries;
    try {
      entries = await page.coverage.stopJSCoverage();
    } catch {
      return; // page already gone (a crashed test); never fail the teardown on coverage
    }
    const wanted = entries.filter((entry) => {
      try {
        return MEASURED_PATH.test(new URL(entry.url).pathname);
      } catch {
        return false;
      }
    });
    if (wanted.length === 0) return;
    fs.mkdirSync(COVERAGE_DIR, { recursive: true });
    // workerIndex + testId is unique per test; a retry overwrites with the same
    // or better coverage, which the gate's union merge absorbs either way.
    fs.writeFileSync(
      path.join(COVERAGE_DIR, `w${testInfo.workerIndex}-${testInfo.testId}.json`),
      JSON.stringify(wanted)
    );
  }
});

export { expect } from "@playwright/test";
