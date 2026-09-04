import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  gateFailures,
  NOT_MEASURED,
  renderReport,
  scoreCoverage,
  scoreFile,
  staleAllowlistEntries
} from "../scripts/test-coverage-gate.mjs";

// ---------------------------------------------------------------------------
// The coverage gate's own gate. Everything here runs against SYNTHETIC rows —
// no suite is spawned, no NODE_V8_COVERAGE run happens — so the loophole this
// closed is proven directly instead of inferred from a green CI badge.
//
// The bug: `pct: total ? (hit / total) * 100 : 100` scored a file with ZERO
// instrumented lines as a perfect 100%. Four real src files rode that to a fake
// 100% while the report's disclosure block named only runtime.js.
// ---------------------------------------------------------------------------

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

/** Every real `src/**\/*.js`, relative to src/ — the same set the gate walks. */
function allSrcFiles(dir = srcDir, prefix = "") {
  const found = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) found.push(...allSrcFiles(path.join(dir, ent.name), rel));
    else if (ent.name.endsWith(".js")) found.push(rel);
  }
  return found;
}

// --- the 0/0 loophole ------------------------------------------------------

test("a file with zero instrumented lines is UNMEASURED, never 100%", () => {
  const row = scoreFile("behaviors/carousel.js", 0, 0);
  assert.equal(row.unmeasured, true);
  assert.equal(row.pct, null, "0/0 must not resolve to a percentage at all");
  // The exact shape of the old bug: `total ? … : 100`.
  assert.notEqual(row.pct, 100, "0/0 scored 100% — the loophole is back");
});

test("a measured file still scores its real ratio", () => {
  assert.deepEqual(scoreFile("skin.js", 200, 199), {
    file: "skin.js",
    total: 200,
    hit: 199,
    pct: 99.5,
    unmeasured: false
  });
  // Negative control: a fully covered file is 100 for a REAL reason.
  assert.equal(scoreFile("skin.js", 200, 200).pct, 100);
});

test("an UNDECLARED zero-line file fails the gate and is named", () => {
  const measured = [
    { file: "compiler/body.js", total: 400, hit: 400 },
    { file: "behaviors/newthing.js", total: 0, hit: 0 }
  ];
  const report = scoreCoverage(measured, new Map());
  assert.deepEqual(report.undeclared, ["behaviors/newthing.js"]);

  const failures = gateFailures({ ...report, stale: [] }, 100);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /behaviors\/newthing\.js/, "the failure must name the file");
  assert.match(failures[0], /ZERO instrumented lines/);
  // And the aggregate is NOT dragged to a fake 100 by the zero-line row: the
  // covered file alone is 100%, but the gate fails anyway.
  assert.equal(report.aggregate, 100);
});

test("a DECLARED zero-line file is excluded, not scored", () => {
  const declared = new Map([["behaviors/carousel.js", "browser-only behavior module"]]);
  const measured = [
    { file: "compiler/body.js", total: 400, hit: 396 },
    { file: "behaviors/carousel.js", total: 0, hit: 0 }
  ];
  const report = scoreCoverage(measured, declared);
  assert.deepEqual(report.undeclared, []);
  assert.deepEqual(
    report.rows.map((r) => r.file),
    ["compiler/body.js"],
    "a declared exclusion must not appear as a scored row"
  );
  assert.equal(report.totalLines, 400);
  assert.equal(gateFailures({ ...report, stale: [] }, 99).length, 0);
});

test("declaring a file does not launder its lines into the numerator", () => {
  // A declared exclusion must be dropped whole — never counted as hit lines.
  const declared = new Map([["runtime.js", "vm string"]]);
  const report = scoreCoverage(
    [
      { file: "runtime.js", total: 900, hit: 0 },
      { file: "skin.js", total: 100, hit: 100 }
    ],
    declared
  );
  assert.equal(report.totalLines, 100);
  assert.equal(report.hitLines, 100);
  assert.equal(report.aggregate, 100);
});

test("a run that measured nothing scores 0, not a vacuous 100", () => {
  const report = scoreCoverage([], new Map());
  assert.equal(report.aggregate, 0);
  assert.equal(gateFailures({ ...report, stale: [] }, 90).length, 1);
});

// --- the allowlist cannot rot ---------------------------------------------

test("a NOT_MEASURED entry naming a missing file fails the gate", () => {
  const declared = new Map([
    ["runtime.js", "vm string"],
    ["behaviors/deleted.js", "was browser-only, now gone"]
  ]);
  const stale = staleAllowlistEntries(declared, ["runtime.js", "skin.js"]);
  assert.deepEqual(stale, ["behaviors/deleted.js"]);

  const failures = gateFailures({ aggregate: 100, undeclared: [], stale }, 100);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /behaviors\/deleted\.js/);
  assert.match(failures[0], /stale/);
});

test("the shipped NOT_MEASURED allowlist is not stale", () => {
  assert.deepEqual(
    staleAllowlistEntries(NOT_MEASURED, allSrcFiles()),
    [],
    "NOT_MEASURED names a src file that no longer exists"
  );
});

test("every NOT_MEASURED entry states a reason, and the four 0/0 files are in it", () => {
  // The audit found these four riding the 0/0 loophole to a fake 100% while the
  // disclosure block named only runtime.js.
  for (const file of [
    "runtime.js",
    "behaviors/carousel.js",
    "behaviors/sortable.js",
    "templates/dashboard/api/metrics.js",
    "templates/store/api/checkout.js"
  ]) {
    assert.ok(NOT_MEASURED.has(file), `${file} is not declared in NOT_MEASURED`);
  }
  for (const [file, reason] of NOT_MEASURED) {
    assert.equal(typeof reason, "string");
    assert.ok(reason.length > 30, `NOT_MEASURED reason for ${file} is not a real reason`);
    assert.match(
      reason,
      /Enforced net:/,
      `NOT_MEASURED reason for ${file} must state what covers it instead`
    );
  }
});

// --- the disclosure block actually discloses -------------------------------

test("the report's disclosure block names EVERY declared exclusion with its reason", () => {
  const text = renderReport(
    { rows: [scoreFile("skin.js", 10, 10)], hitLines: 10, totalLines: 10, aggregate: 100 },
    { covFiles: 3 }
  ).join("\n");

  assert.match(text, /NOT MEASURED HERE \(declared exclusions/);
  for (const [file, reason] of NOT_MEASURED) {
    assert.ok(text.includes(`src/${file}`), `disclosure block omits src/${file}`);
    assert.ok(text.includes(reason), `disclosure block omits the reason for src/${file}`);
  }
  // The old block hard-coded runtime.js's prose for every entry, so a second
  // exclusion would have been described as "the browser reactive core" too.
  assert.equal(
    text.split("browser reactive core").length - 1,
    1,
    "one reason string is being reused for several files"
  );
});

test("an unmeasured row prints as UNMEASURED, not as a percentage", () => {
  const text = renderReport(
    {
      rows: [scoreFile("behaviors/x.js", 0, 0), scoreFile("skin.js", 4, 2)],
      hitLines: 2,
      totalLines: 4,
      aggregate: 50
    },
    { covFiles: 1, notMeasured: new Map() }
  ).join("\n");
  assert.match(text, /behaviors\/x\.js\s*\|\s*UNMEASURED/);
  assert.doesNotMatch(text, /behaviors\/x\.js\s*\|\s*100\.00%/);
  assert.match(text, /skin\.js\s*\|\s*50\.00%/);
});

// --- the threshold half still works ---------------------------------------

test("the aggregate threshold still gates, and passes on a clean report", () => {
  const report = scoreCoverage(
    [
      { file: "a.js", total: 100, hit: 99 },
      { file: "b.js", total: 100, hit: 100 }
    ],
    new Map()
  );
  assert.equal(report.aggregate, 99.5);
  assert.equal(gateFailures({ ...report, stale: [] }, 99).length, 0);
  const failures = gateFailures({ ...report, stale: [] }, 100);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /99\.50% is below the required 100%/);
});

// --- the script must not run on import ------------------------------------

test("importing the gate module does not spawn the test suite", () => {
  // Proven by construction: this file imported it at module load and the suite
  // did not recurse. Assert the entry-point guard is present so a refactor that
  // drops it fails here rather than in an infinite CI loop.
  const source = fs.readFileSync(
    fileURLToPath(new URL("../scripts/test-coverage-gate.mjs", import.meta.url)),
    "utf8"
  );
  assert.match(source, /process\.argv\[1\][\s\S]{0,120}import\.meta\.url\) main\(\);/);
});
