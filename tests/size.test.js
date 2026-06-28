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
  // Measure what actually ships: the runtime with JSDoc stripped (exactly as emitRuntime emits it).
  // Source keeps full type annotations for checkJs/.d.ts; the browser download stays lean.
  const shipped = stripRuntimeComments(readFileSync("src/runtime.js", "utf8"));
  const size = gzipSync(shipped).length;
  assert.ok(size < BUDGET, `shipped runtime is ${size} bytes gzipped — budget is ${BUDGET}`);
  console.log(`shipped runtime: ${size} bytes gzipped (budget ${BUDGET})`);
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
