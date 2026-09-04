#!/usr/bin/env node

// ===========================================================================
// HONEST coverage gate for Darkmown.
//
// WHAT IS COUNTED, AND WHY IT LOOKS LIKE THIS
// -------------------------------------------
// The headline number is LINE coverage of the PROJECT'S `src/**` ONLY.
//
//  * The denominator is src-only. The test files in `tests/**` and helper
//    scripts in `scripts/**` are deliberately EXCLUDED. (The previous gate
//    grepped node:test's "all files" aggregate, whose denominator included
//    all 21 test files — which are ~100% covered by definition — inflating
//    the headline to ~97.85% while real src coverage was ~78%. That was false
//    assurance. We do not do that anymore.)
//
//  * How: we run the suite once with NODE_V8_COVERAGE pointed at a temp dir.
//    V8 writes one raw coverage JSON per *process* (node:test spawns each test
//    file in its own child). We then aggregate per-byte execution status with
//    UNION semantics across every process (a byte counts as covered if ANY
//    process executed it), map covered bytes to source lines, and report the
//    line ratio per src file plus a weighted src-only total. This is pure
//    Node with NO experimental flags, so it behaves identically on Node 20,
//    22, and 24 (the CI matrix). We intentionally avoid
//    `--test-coverage-include` / `--test-coverage-exclude`, which exist on
//    Node 22+ but NOT Node 20.
//
//    These numbers track node:test's own per-file figures within ~1pt. They
//    can be a hair lower because node:test uses the AST to know precisely
//    which lines are executable statements, whereas we approximate "executable
//    line" as "a non-whitespace byte that falls inside some V8 function range".
//    The approximation only ever moves the number DOWN (it can over-count the
//    denominator slightly), so the gate is conservative, never lenient.
//
// WHAT IS *NOT* COUNTED — and why every exclusion is NAMED
// ---------------------------------------------------------
//   A handful of src files cannot be instrumented by a `node --test` run at
//   all. They are listed in NOT_MEASURED below, each with a one-line reason,
//   and every one of them is PRINTED in the report's disclosure block. They are
//   excluded from the ratio; they are never quietly scored.
//
//   The classic example is `src/runtime.js`: the browser reactive core, loaded
//   by the unit suite as a STRING through `vm.runInContext`, so V8 never
//   attributes coverage to it and it is physically absent from the coverage
//   JSON. Its real net is the Playwright e2e job, which drives the runtime in a
//   real browser. Honesty over a pretty number.
//
//   THE 0/0 LOOPHOLE (closed). This gate used to score a file with ZERO
//   instrumented lines as `pct: 100` — `total ? (hit / total) * 100 : 100`. Four
//   files rode that to a fake 100%: both `behaviors/*.js` modules and both
//   `templates/**/api/*.js` handlers, ~328 lines of shipped code reported as
//   perfect, and ANY new browser-only file would have entered at a fake 100 too.
//   A zero-line file is now UNMEASURED, not perfect: it must be in NOT_MEASURED
//   with a stated reason, or the gate FAILS and names it. The allowlist is
//   itself checked — an entry naming a file that no longer exists also fails, so
//   the exclusions cannot rot.
//
// THE GATE
//   Exit non-zero when measured src-only line coverage drops below the
//   threshold (first CLI arg, default 90), when a src file has zero instrumented
//   lines without being declared, or when the allowlist has gone stale. Passes
//   green on the current tree.
//
// TESTABILITY
//   The scoring and gating logic is pure and exported (`scoreFile`,
//   `scoreCoverage`, `staleAllowlistEntries`, `gateFailures`) so
//   `tests/gate-coverage.test.js` can drive it with synthetic rows instead of
//   running the whole suite under coverage. Nothing runs on import: the CLI body
//   lives in `main()` behind an entry-point check.
// ===========================================================================

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * src files deliberately outside the measured line ratio, each with the reason
 * it cannot be instrumented here. Every entry is printed in the report. A file
 * with zero instrumented lines that is NOT in here fails the gate by name.
 * Keys are paths relative to `src/`.
 * @type {Map<string, string>}
 */
export const NOT_MEASURED = new Map([
  [
    "runtime.js",
    "browser reactive core, loaded as a vm string by the unit suite, so V8 cannot" +
      " instrument it here. Enforced net: the Playwright e2e job drives the real" +
      " runtime in a browser."
  ],
  [
    "behaviors/carousel.js",
    "browser-only behavior module: emitted to the page and executed by the browser," +
      " never imported by Node. Enforced net: the Playwright e2e job."
  ],
  [
    "behaviors/sortable.js",
    "browser-only behavior module: emitted to the page and executed by the browser," +
      " never imported by Node. Enforced net: the Playwright e2e job."
  ],
  [
    "templates/dashboard/api/metrics.js",
    "serverless template handler: scaffolded into a user's project and executed by" +
      " the deploy host, never imported by this suite. Enforced net: tests/api-runner.test.js" +
      " covers the runner that invokes handlers of this shape."
  ],
  [
    "templates/store/api/checkout.js",
    "serverless template handler: scaffolded into a user's project and executed by" +
      " the deploy host, never imported by this suite. Enforced net: tests/api-runner.test.js" +
      " covers the runner that invokes handlers of this shape."
  ]
]);

/**
 * Score ONE file's line ratio. A file with zero instrumented lines is reported
 * as UNMEASURED (`pct: null`), never as 100% — that conflation was the loophole.
 * @param {string} file Path relative to `src/`.
 * @param {number} total Instrumented (executable) lines.
 * @param {number} hit Instrumented lines that were executed.
 * @returns {{ file: string, total: number, hit: number, pct: number | null, unmeasured: boolean }}
 */
export function scoreFile(file, total, hit) {
  if (total <= 0) return { file, total: 0, hit: 0, pct: null, unmeasured: true };
  return { file, total, hit, pct: (hit / total) * 100, unmeasured: false };
}

/**
 * Aggregate per-file measurements into the report rows plus the weighted total.
 * Declared exclusions are dropped entirely; undeclared zero-line files are
 * collected in `undeclared` so the caller can fail and name them.
 * @param {{ file: string, total: number, hit: number }[]} measured
 * @param {Map<string, string>} [notMeasured]
 * @returns {{ rows: ReturnType<typeof scoreFile>[], undeclared: string[],
 *   totalLines: number, hitLines: number, aggregate: number }}
 */
export function scoreCoverage(measured, notMeasured = NOT_MEASURED) {
  const rows = [];
  const undeclared = [];
  let totalLines = 0;
  let hitLines = 0;
  for (const { file, total, hit } of measured) {
    if (notMeasured.has(file)) continue;
    const row = scoreFile(file, total, hit);
    if (row.unmeasured) undeclared.push(file);
    totalLines += row.total;
    hitLines += row.hit;
    rows.push(row);
  }
  // No instrumented lines at all means the measurement itself broke. Score it 0
  // so the gate fails loudly rather than declaring a vacuous 100%.
  return {
    rows,
    undeclared,
    totalLines,
    hitLines,
    aggregate: totalLines ? (hitLines / totalLines) * 100 : 0
  };
}

/**
 * Allowlist entries that no longer name a real src file. A stale exclusion is a
 * silent hole waiting for a filename to be reused, so it fails the gate too.
 * @param {Map<string, string>} notMeasured
 * @param {Iterable<string>} allSrcFiles Paths relative to `src/`.
 * @returns {string[]}
 */
export function staleAllowlistEntries(notMeasured, allSrcFiles) {
  const present = new Set(allSrcFiles);
  return [...notMeasured.keys()].filter((file) => !present.has(file));
}

/**
 * Render the human report: the per-file table, the weighted total, and the
 * DISCLOSURE BLOCK that names every declared exclusion with its reason. Pure, so
 * `tests/gate-coverage.test.js` can assert the disclosure really names all of
 * them (naming only runtime.js while three other files were silently scored
 * 100% is exactly what made the old loophole invisible).
 * @param {{ rows: ReturnType<typeof scoreFile>[], hitLines: number, totalLines: number,
 *   aggregate: number }} report
 * @param {{ covFiles?: number, notMeasured?: Map<string, string> }} [opts]
 * @returns {string[]} Lines, ready to print.
 */
export function renderReport(report, opts = {}) {
  const { covFiles = 0, notMeasured = NOT_MEASURED } = opts;
  const { rows, hitLines, totalLines, aggregate } = report;
  const fmt = (/** @type {number} */ n) => `${n.toFixed(2)}%`.padStart(10);
  const width = Math.max(14, ...rows.map((r) => r.file.length));
  const rule = `  ${"-".repeat(width)}-+-${"-".repeat(10)}-+-------------------`;
  const out = [
    "",
    "=== Darkmown src-only line coverage (honest gate) ===",
    `Aggregated from ${covFiles} V8 coverage file(s) via NODE_V8_COVERAGE.`,
    "Denominator is src/** only — tests/** and scripts/** are excluded.",
    "",
    `  ${"file".padEnd(width)} | ${"line %".padStart(10)} | lines (hit/total)`,
    rule
  ];
  for (const r of rows) {
    const pct = r.unmeasured ? "UNMEASURED".padStart(10) : fmt(/** @type {number} */ (r.pct));
    out.push(`  ${r.file.padEnd(width)} | ${pct} | ${r.hit}/${r.total}`);
  }
  out.push(rule);
  out.push(`  ${"src TOTAL".padEnd(width)} | ${fmt(aggregate)} | ${hitLines}/${totalLines}`);
  out.push("");
  out.push("  NOT MEASURED HERE (declared exclusions, all outside the number above):");
  for (const [file, reason] of notMeasured) {
    out.push(`    src/${file}`);
    out.push(`      — ${reason}`);
  }
  return out;
}

/**
 * The gate itself: every reason this run must exit non-zero, as printable lines.
 * An empty array means PASS.
 * @param {{ aggregate: number, undeclared: string[], stale: string[] }} report
 * @param {number} threshold
 * @returns {string[]}
 */
export function gateFailures(report, threshold) {
  const failures = [];
  for (const file of report.undeclared) {
    failures.push(
      `FAIL: src/${file} has ZERO instrumented lines — it is unmeasured, not 100%.` +
        ` Cover it, or declare it in NOT_MEASURED (scripts/test-coverage-gate.mjs) with a reason.`
    );
  }
  for (const file of report.stale) {
    failures.push(
      `FAIL: NOT_MEASURED lists src/${file}, which does not exist — prune the stale exclusion.`
    );
  }
  if (report.aggregate + 1e-9 < threshold) {
    failures.push(
      `FAIL: measured src-only line coverage ${report.aggregate.toFixed(2)}% is below the required ${threshold}%.`
    );
  }
  return failures;
}

// --- 1. Run the suite, capturing raw V8 coverage to a temp dir --------------

function main() {
  const threshold = Number(process.argv[2] ?? 90);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    console.error(`Invalid coverage threshold: ${process.argv[2]}`);
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const srcDir = resolve(repoRoot, "src");
  const srcUrlPrefix = pathToFileURL(srcDir + "/").href; // e.g. file:///…/src/

  const testFiles = readdirSync("tests")
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => join("tests", name));

  if (testFiles.length === 0) {
    console.error("No test files found under tests/.");
    process.exit(1);
  }

  const covDir = mkdtempSync(join(tmpdir(), "darkmown-cov-"));
  try {
    const result = spawnSync(process.execPath, ["--test", ...testFiles], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64,
      env: { ...process.env, NODE_V8_COVERAGE: covDir }
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) {
      console.error("\nTest suite failed; coverage gate aborted (fix the tests first).");
      process.exit(result.status ?? 1);
    }

    reportAndGate(covDir, { srcDir, srcUrlPrefix, threshold });
  } finally {
    try {
      rmSync(covDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

// --- 2. Aggregate src-only line coverage from the raw V8 JSON ---------------

function reportAndGate(dir, { srcDir, srcUrlPrefix, threshold }) {
  // Per-file, per-byte accumulators across ALL coverage files (= all processes).
  //   inRange[i] = byte i is inside some V8 function range (i.e. executable code)
  //   covered[i] = byte i was executed (count>0) in AT LEAST ONE process (union)
  const sourceByUrl = new Map();
  const inRangeByUrl = new Map();
  const coveredByUrl = new Map();

  const ensure = (url) => {
    if (sourceByUrl.has(url)) return;
    const src = readFileSync(fileURLToPath(url), "utf8");
    sourceByUrl.set(url, src);
    inRangeByUrl.set(url, new Uint8Array(src.length));
    coveredByUrl.set(url, new Uint8Array(src.length));
  };

  let covFiles = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      continue; // partially written / unrelated file — skip
    }
    covFiles++;
    for (const entry of data.result ?? []) {
      // Strict prefix match against THIS project's src dir. Avoids matching
      // node_modules/**/src/** and the smoke test's temp consumer copy.
      if (!entry.url.startsWith(srcUrlPrefix)) continue;
      let exists = true;
      try {
        ensure(entry.url);
      } catch {
        exists = false; // transient file (e.g. temp consumer) already deleted
      }
      if (!exists) continue;

      const len = sourceByUrl.get(entry.url).length;
      const inR = inRangeByUrl.get(entry.url);
      const cov = coveredByUrl.get(entry.url);

      // Derive THIS process's per-byte covered status into local buffers first.
      // Ranges are nested; processing parent (wider) before child lets a child
      // range with count===0 CARVE OUT (reset to 0) bytes its covered parent set
      // — that reset must be local, never applied to the cross-process union.
      const localIn = new Uint8Array(len);
      const localCov = new Uint8Array(len);
      const ranges = [];
      for (const fn of entry.functions ?? []) {
        for (const rg of fn.ranges ?? []) ranges.push(rg);
      }
      ranges.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
      for (const rg of ranges) {
        const executed = rg.count > 0 ? 1 : 0;
        const end = Math.min(rg.endOffset, len);
        for (let i = rg.startOffset; i < end; i++) {
          localIn[i] = 1;
          localCov[i] = executed; // child count=0 resets parent's covered byte
        }
      }
      // Now UNION this process's result into the cross-process accumulators:
      // a byte is executable if any process saw it in a range, and covered if
      // any process executed it.
      for (let i = 0; i < len; i++) {
        if (localIn[i]) inR[i] = 1;
        if (localCov[i]) cov[i] = 1;
      }
    }
  }

  // Map covered bytes to lines. A line counts toward the denominator if it has
  // at least one non-whitespace byte inside a function range (≈ an executable
  // statement). It counts as hit if any such byte was executed.
  const lineRatio = (url) => {
    const src = sourceByUrl.get(url);
    const inR = inRangeByUrl.get(url);
    const cov = coveredByUrl.get(url);
    let total = 0;
    let hit = 0;
    let exec = false;
    let covered = false;
    let nonWs = false;
    const finalize = () => {
      if (exec && nonWs) {
        total++;
        if (covered) hit++;
      }
      exec = false;
      covered = false;
      nonWs = false;
    };
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === "\n") {
        finalize();
        continue;
      }
      if (ch !== " " && ch !== "\t" && ch !== "\r") nonWs = true;
      if (inR[i]) {
        exec = true;
        if (cov[i]) covered = true;
      }
    }
    finalize();
    return { total, hit };
  };

  // Enumerate every real src/**/*.js (RECURSIVELY — src/ has subdirectories like
  // src/compiler/) so we can name files that were NEVER loaded (0 coverage) and
  // files that are deliberately not measured here. Paths are relative to src/
  // (e.g. "compiler/directives.js"); top-level files stay bare ("runtime.js").
  const walkSrc = (dir, prefix = "") => {
    const found = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) found.push(...walkSrc(join(dir, ent.name), rel));
      else if (ent.name.endsWith(".js")) found.push(rel);
    }
    return found;
  };
  const allSrcFiles = walkSrc(srcDir).sort();

  // Measure every real src file, including ones no test ever loaded (which are
  // genuinely 0% covered rather than absent). Declared exclusions are dropped by
  // scoreCoverage; an UNDECLARED zero-line file is a gate failure, not a 100%.
  const measured = allSrcFiles.map((file) => {
    const url = srcUrlPrefix + file;
    if (!sourceByUrl.has(url)) {
      const src = readFileSync(fileURLToPath(url), "utf8");
      sourceByUrl.set(url, src);
      inRangeByUrl.set(url, new Uint8Array(src.length));
      coveredByUrl.set(url, new Uint8Array(src.length));
    }
    return { file, ...lineRatio(url) };
  });

  const { rows, undeclared, totalLines, hitLines, aggregate } = scoreCoverage(
    measured,
    NOT_MEASURED
  );
  const stale = staleAllowlistEntries(NOT_MEASURED, allSrcFiles);

  // --- 3. Print the honest breakdown ---------------------------------------

  for (const line of renderReport(
    { rows, hitLines, totalLines, aggregate },
    { covFiles, notMeasured: NOT_MEASURED }
  )) {
    console.log(line);
  }

  // --- 4. Gate ------------------------------------------------------------

  console.log("");
  const failures = gateFailures({ aggregate, undeclared, stale }, threshold);
  if (failures.length) {
    for (const message of failures) console.error(message);
    process.exit(1);
  }
  console.log(
    `PASS: measured src-only line coverage ${aggregate.toFixed(2)}% meets the required ${threshold}%` +
      ` (${NOT_MEASURED.size} declared exclusion${NOT_MEASURED.size === 1 ? "" : "s"}, 0 undeclared zero-line files).`
  );
}

// Only run the CLI when this file IS the entry point — importing it (the unit
// test does) must not spawn the suite.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
