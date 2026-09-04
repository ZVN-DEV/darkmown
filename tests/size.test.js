import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { stripRuntimeComments } from "../src/builder.js";

// The runtime gzip budget has ONE source of truth: `.size-snapshot.json`'s
// `runtime.budget`. `scripts/size-check.mjs` reads it; `package.json` and the CI
// "Runtime size budget" job delegate to that script. (The 1.0 release shipped a
// stale hardcoded copy in ci.yml that failed the PR — these tests make that class
// of drift impossible to reintroduce silently.)
const snapshot = JSON.parse(readFileSync(".size-snapshot.json", "utf8"));
const BUDGET = snapshot.runtime.budget;

test("runtime stays under the gzip budget that the brand promises", () => {
  // Measure what actually ships: `src/runtime.min.js`, the committed esbuild
  // artifact `emitRuntime` copies verbatim to dist/__wd/runtime.js. The readable
  // source keeps full type annotations for checkJs/.d.ts and is never downloaded.
  // (tests/runtime-min.test.js is what proves the artifact still matches the
  // source; this test only asks whether the shipped bytes fit.)
  const size = gzipSync(readFileSync(snapshot.runtime.file)).length;
  assert.ok(size < BUDGET, `shipped runtime is ${size} bytes gzipped — budget is ${BUDGET}`);

  // The pre-minification measurement, for the record: it is the number the docs
  // quoted before 2.7 and the headroom minification bought is what pays for new
  // runtime features.
  const readable = gzipSync(stripRuntimeComments(readFileSync("src/runtime.js", "utf8"))).length;
  assert.ok(
    size < readable,
    `minifying must beat comment-stripping (${size} B vs ${readable} B) — if it does not, ` +
      "the extra build step is buying nothing and should go."
  );
  console.log(
    `shipped runtime: ${size} bytes gzipped (budget ${BUDGET}; ` +
      `readable source comment-stripped would be ${readable})`
  );
});

test("each behavior module stays under its own gzip budget, separate from the runtime", () => {
  // Behaviors are pay-for-what-you-use: emitted only on pages that use them, so they
  // carry their OWN budget and never count against the 8 KB core runtime ceiling.
  const behaviors = snapshot.behaviors ?? {};
  assert.ok(Object.keys(behaviors).length > 0, ".size-snapshot.json must list behavior budgets");
  for (const [name, entry] of Object.entries(behaviors)) {
    const shipped = stripRuntimeComments(readFileSync(entry.file, "utf8"));
    const size = gzipSync(shipped).length;
    assert.ok(
      size < entry.budget,
      `behavior ${name} is ${size} bytes gzipped — budget is ${entry.budget}`
    );
    console.log(`behavior ${name}: ${size} bytes gzipped (budget ${entry.budget})`);
  }
});

test("the gzip budget has a single source of truth — no config hardcodes it", () => {
  assert.equal(
    typeof BUDGET,
    "number",
    ".size-snapshot.json must define a numeric runtime.budget (the single source of truth)."
  );

  // package.json's size scripts must DELEGATE to size-check.mjs and never inline a
  // budget number of their own.
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const name of ["runtime:size", "size:check"]) {
    assert.match(
      pkg.scripts[name],
      /scripts\/size-check\.mjs/,
      `package.json "${name}" must delegate to scripts/size-check.mjs, not gate the size itself.`
    );
    assert.doesNotMatch(
      pkg.scripts[name],
      /\b\d{4}\b/,
      `package.json "${name}" hardcodes a budget number — read it from .size-snapshot.json instead.`
    );
  }

  // The CI "Runtime size budget" job must delegate too: it must run the npm script
  // and must NOT inline a `test "$size" -lt <budget>` gate (the exact 1.0 drift).
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(
    ci,
    /run: npm run (runtime:size|size:check)/,
    "ci.yml's size job must delegate to the npm size script."
  );
  assert.doesNotMatch(
    ci,
    /test\s+"?\$\{?size\}?"?\s+-lt\s+\d+/,
    "ci.yml hardcodes an inline runtime-size gate — delegate to scripts/size-check.mjs instead."
  );
});

test("CI fails a PR whose committed minified runtime is stale", () => {
  // The number the size job prints only means something if the artifact it
  // measures is still the current source. `npm test` already covers that
  // (tests/runtime-min.test.js), but the size job runs no build now, so it
  // states the requirement itself rather than inheriting it from another job.
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(
    ci,
    /scripts\/build-runtime\.mjs --check/,
    "ci.yml must run `node scripts/build-runtime.mjs --check`, or a PR could ship a " +
      "dist runtime that is not built from its own src/runtime.js."
  );

  // The publishing workflows gate on it too: a stale artifact reaching npm is
  // the one version of this failure nobody can fix after the fact.
  for (const workflow of ["release.yml", "canary.yml"]) {
    assert.match(
      readFileSync(`.github/workflows/${workflow}`, "utf8"),
      /scripts\/build-runtime\.mjs --check/,
      `${workflow} must verify the committed runtime artifact before publishing.`
    );
  }
});
