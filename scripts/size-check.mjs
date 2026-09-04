#!/usr/bin/env node
// Size guard for the shipped reactive runtime AND the pay-for-what-you-use
// behavior modules. Gzips each artifact, compares it against the committed
// `.size-snapshot.json`, prints the per-item byte delta so a PR surfaces any
// growth, and exits non-zero if ANY item reaches its budget. Run `npm run build`
// first (CI does) — the runtime is measured from `dist/`.
//
// SINGLE SOURCE OF TRUTH: `.size-snapshot.json` holds BOTH the baselines
// (`runtime.gzip`, `behaviors.<name>.gzip`) and the hard ceilings (`.budget`).
// Everything that gates size — `package.json`'s `runtime:size`/`size:check`
// scripts and the CI "Runtime size budget" job — DELEGATES to this file, so the
// budget numbers live in exactly one place and can't drift across configs (the
// 1.0 release shipped with three out-of-sync copies of it; this is the fix). At
// release, bump each `gzip` to the new measured size; change a `budget` to move
// a ceiling. The `tests/size.test.js` drift guard enforces the delegation.
//
// UNBUDGETED FILES FAIL. A behavior module that exists in `src/behaviors/` but
// has no snapshot entry is not "fine", it is unmeasured: it would ship to real
// pages with no ceiling at all. Same shape of hole as the coverage gate's 0/0
// loophole, closed the same way — declare it or fail.
//
// TESTABILITY: the measuring and gating logic is pure and exported
// (`measureFile`, `formatDelta`, `scoreItem`, `unbudgetedBehaviors`) so
// `tests/gate-size-check.test.js` can drive it without a build. Nothing runs on
// import: the CLI body is `main()` behind an entry-point check.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { stripRuntimeComments } from "../src/builder.js";

const FALLBACK_BUDGET = 8192; // only if .size-snapshot.json is missing runtime.budget
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Gzipped size of a file, measured EXACTLY as it ships (JSDoc stripped, the way
 * `emitRuntime`/`emitBehaviors` emit it).
 * @param {string} file Absolute path.
 * @param {boolean} [strip] Strip comments first (behaviors: yes; built runtime: no).
 * @returns {number} Bytes.
 */
export function measureFile(file, strip = false) {
  const raw = fs.readFileSync(file);
  return zlib.gzipSync(strip ? stripRuntimeComments(raw.toString("utf8")) : raw).length;
}

/**
 * Human delta against a snapshot baseline, e.g. `+12 vs snapshot`.
 * @param {number} size
 * @param {unknown} baseline
 * @returns {string}
 */
export function formatDelta(size, baseline) {
  if (typeof baseline !== "number") return "no snapshot";
  const delta = size - baseline;
  return `${delta >= 0 ? "+" : ""}${delta} vs snapshot`;
}

/**
 * One measured item's report line plus whether it breached its budget.
 * A size that REACHES the budget is a breach (`>=`): the budget is a ceiling the
 * runtime must stay under, not one it may sit on.
 * @param {string} label
 * @param {number} size
 * @param {number} budget
 * @param {unknown} baseline
 * @returns {{ line: string, failed: boolean, error?: string }}
 */
export function scoreItem(label, size, budget, baseline) {
  const line = `${label}: ${size} B (${formatDelta(size, baseline)}, budget ${budget})`;
  if (size >= budget) {
    return {
      line,
      failed: true,
      error: `size:check — ${label} ${size} B reached the ${budget} B budget.`
    };
  }
  return { line, failed: false };
}

/**
 * Behavior modules present on disk with no `.size-snapshot.json` entry. An
 * unbudgeted module ships to real pages with no ceiling, so it fails the gate.
 * @param {Record<string, { file: string }>} snapshotBehaviors
 * @param {string[]} onDisk Paths relative to the repo root.
 * @returns {string[]} The unbudgeted paths.
 */
export function unbudgetedBehaviors(snapshotBehaviors, onDisk) {
  const budgeted = new Set(
    Object.values(snapshotBehaviors ?? {}).map((entry) => entry.file.replaceAll("\\", "/"))
  );
  return onDisk.map((f) => f.replaceAll("\\", "/")).filter((f) => !budgeted.has(f));
}

function main() {
  const runtimePath = path.join(repoRoot, "dist", "__wd", "runtime.js");
  const snapshotPath = path.join(repoRoot, ".size-snapshot.json");

  if (!fs.existsSync(runtimePath)) {
    console.error(`size:check — ${runtimePath} not found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const snapshot = fs.existsSync(snapshotPath)
    ? JSON.parse(fs.readFileSync(snapshotPath, "utf8"))
    : null;

  let failed = false;
  const fail = (/** @type {string} */ message) => {
    console.error(message);
    failed = true;
  };

  // --- runtime ------------------------------------------------------------
  const budget =
    typeof snapshot?.runtime?.budget === "number" ? snapshot.runtime.budget : FALLBACK_BUDGET;
  const runtime = scoreItem("runtime", measureFile(runtimePath), budget, snapshot?.runtime?.gzip);
  console.log(runtime.line);
  if (runtime.failed) fail(/** @type {string} */ (runtime.error));

  // --- behaviors ----------------------------------------------------------
  // Pay-for-what-you-use modules each carry their OWN budget, separate from the
  // core runtime ceiling — they only ship on pages that use them, so they never
  // tax the 8 KB core. Measured from source (comment-stripped, exactly what
  // emitBehaviors emits) so the check does not depend on a demo page importing
  // them, and so it runs without a build.
  for (const [name, entry] of Object.entries(snapshot?.behaviors ?? {})) {
    const file = path.join(repoRoot, entry.file);
    if (!fs.existsSync(file)) {
      fail(`size:check — behavior "${name}" file ${entry.file} not found.`);
      continue;
    }
    const item = scoreItem(`behavior ${name}`, measureFile(file, true), entry.budget, entry.gzip);
    console.log(item.line);
    if (item.failed) fail(/** @type {string} */ (item.error));
  }

  // Every behavior module on disk must be budgeted. A new one that nobody adds
  // to the snapshot would otherwise ship with no ceiling at all.
  const behaviorsDir = path.join(repoRoot, "src", "behaviors");
  const onDisk = fs.existsSync(behaviorsDir)
    ? fs
        .readdirSync(behaviorsDir)
        .filter((f) => f.endsWith(".js"))
        .map((f) => `src/behaviors/${f}`)
    : [];
  for (const file of unbudgetedBehaviors(snapshot?.behaviors ?? {}, onDisk)) {
    fail(
      `size:check — ${file} has no budget in .size-snapshot.json.` +
        ` Add a "behaviors" entry with a file/gzip/budget, or it ships unmeasured.`
    );
  }

  console.log(
    failed
      ? "size:check — FAIL (see the errors above)."
      : `size:check — PASS (runtime + ${onDisk.length} behavior module(s), all under budget).`
  );
  if (failed) process.exit(1);
}

// Only run the CLI when this file IS the entry point — importing it (the unit
// test does) must not read `dist/` or exit the process.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
