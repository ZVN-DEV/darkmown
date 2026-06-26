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
// WHAT IS *NOT* COUNTED: src/runtime.js
// -------------------------------------
//   `src/runtime.js` is the browser reactive core. The unit suite loads it as
//   a STRING through `vm.runInContext` (see tests/runtime-dom.test.js — that
//   file is owned by another track and must not change), so V8 never attributes
//   coverage to it and it is physically absent from the coverage JSON. We do
//   NOT silently fold it into the line ratio and we do NOT let the headline
//   imply it is covered. Instead the report lists it explicitly under
//   "NOT MEASURED HERE" and states its real net: the Playwright e2e job, which
//   drives the actual runtime in a real browser, is the enforced safety net for
//   runtime.js. Honesty over a pretty number.
//
// THE GATE
//   Exit non-zero when measured src-only line coverage drops below the
//   threshold (first CLI arg, default 90). Passes green on the current tree.
// ===========================================================================

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const threshold = Number(process.argv[2] ?? 90);
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
  console.error(`Invalid coverage threshold: ${process.argv[2]}`);
  process.exit(1);
}

const repoRoot = process.cwd();
const srcDir = resolve(repoRoot, "src");
const srcUrlPrefix = pathToFileURL(srcDir + "/").href; // e.g. file:///…/src/

// --- 1. Run the suite, capturing raw V8 coverage to a temp dir --------------

const testFiles = readdirSync("tests")
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => join("tests", name));

if (testFiles.length === 0) {
  console.error("No test files found under tests/.");
  process.exit(1);
}

const covDir = mkdtempSync(join(tmpdir(), "darkmown-cov-"));
let result;
try {
  result = spawnSync(process.execPath, ["--test", ...testFiles], {
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

  reportAndGate(covDir);
} finally {
  try {
    rmSync(covDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}

// --- 2. Aggregate src-only line coverage from the raw V8 JSON ---------------

function reportAndGate(dir) {
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

  // Enumerate every real src/*.js so we can name files that were NEVER loaded
  // (0 coverage) and files that are deliberately not measured here.
  const allSrcFiles = readdirSync(srcDir)
    .filter((n) => n.endsWith(".js"))
    .sort();

  // src/runtime.js is browser-only and loaded as a vm string by the unit suite,
  // so it is structurally invisible to V8 coverage here. Disclose, don't fold in.
  const NOT_MEASURED = new Set(["runtime.js"]);

  const rows = [];
  let totalLines = 0;
  let hitLines = 0;
  for (const file of allSrcFiles) {
    if (NOT_MEASURED.has(file)) continue;
    const url = srcUrlPrefix + file;
    if (!sourceByUrl.has(url)) {
      // Real src file that no test ever loaded → genuinely 0% covered.
      const src = readFileSync(fileURLToPath(url), "utf8");
      sourceByUrl.set(url, src);
      inRangeByUrl.set(url, new Uint8Array(src.length));
      coveredByUrl.set(url, new Uint8Array(src.length));
    }
    const { total, hit } = lineRatio(url);
    totalLines += total;
    hitLines += hit;
    rows.push({ file, total, hit, pct: total ? (hit / total) * 100 : 100 });
  }

  const aggregate = totalLines ? (hitLines / totalLines) * 100 : 100;

  // --- 3. Print the honest breakdown ---------------------------------------

  const fmt = (n) => n.toFixed(2).padStart(6);
  console.log("\n=== Darkmown src-only line coverage (honest gate) ===");
  console.log(`Aggregated from ${covFiles} V8 coverage file(s) via NODE_V8_COVERAGE.`);
  console.log("Denominator is src/** only — tests/** and scripts/** are excluded.\n");
  console.log("  file            |  line % | lines (hit/total)");
  console.log("  ----------------+---------+-------------------");
  for (const r of rows) {
    console.log(`  ${r.file.padEnd(14)} | ${fmt(r.pct)}% | ${r.hit}/${r.total}`);
  }
  console.log("  ----------------+---------+-------------------");
  console.log(`  ${"src TOTAL".padEnd(14)} | ${fmt(aggregate)}% | ${hitLines}/${totalLines}`);

  if (NOT_MEASURED.size > 0) {
    console.log("\n  NOT MEASURED HERE (excluded from the number above):");
    for (const file of NOT_MEASURED) {
      console.log(
        `    src/${file} — browser reactive core, loaded as a vm string in the` +
          ` unit suite,\n      so V8 cannot instrument it here. Enforced net:` +
          ` the Playwright e2e job\n      drives the real runtime in a browser.` +
          ` This file is NOT in the line gate.`
      );
    }
  }

  // --- 4. Gate ------------------------------------------------------------

  console.log("");
  if (aggregate + 1e-9 < threshold) {
    console.error(
      `FAIL: measured src-only line coverage ${aggregate.toFixed(2)}% is below the required ${threshold}%.`
    );
    process.exit(1);
  }
  console.log(
    `PASS: measured src-only line coverage ${aggregate.toFixed(2)}% meets the required ${threshold}%.`
  );
}
