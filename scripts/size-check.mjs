#!/usr/bin/env node
// Size guard for the shipped reactive runtime. Gzips `dist/__wd/runtime.js`,
// compares it against the committed `.size-snapshot.json`, prints the byte delta
// so a PR surfaces any growth, and exits non-zero if the runtime reaches the
// budget. Run `npm run build` first (CI does).
//
// SINGLE SOURCE OF TRUTH: `.size-snapshot.json` holds BOTH the baseline
// (`runtime.gzip`) and the hard ceiling (`runtime.budget`). Everything that gates
// size — `package.json`'s `runtime:size`/`size:check` scripts and the CI
// "Runtime size budget" job — DELEGATES to this file, so the budget number lives
// in exactly one place and can't drift across configs (the 1.0 release shipped
// with three out-of-sync copies of it; this is the fix). At release, bump
// `runtime.gzip` to the new measured size; change `runtime.budget` to move the
// ceiling. The `tests/size.test.js` drift guard enforces the delegation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const FALLBACK_BUDGET = 8192; // only if .size-snapshot.json is missing runtime.budget
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimePath = path.join(repoRoot, "dist", "__wd", "runtime.js");
const snapshotPath = path.join(repoRoot, ".size-snapshot.json");

if (!fs.existsSync(runtimePath)) {
  console.error(`size:check — ${runtimePath} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

const size = zlib.gzipSync(fs.readFileSync(runtimePath)).length;

let snapshot = null;
if (fs.existsSync(snapshotPath)) {
  snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
}

const budget =
  typeof snapshot?.runtime?.budget === "number" ? snapshot.runtime.budget : FALLBACK_BUDGET;
const baseline = snapshot?.runtime?.gzip;
const delta = typeof baseline === "number" ? size - baseline : null;
const deltaText = delta === null ? "no snapshot" : `${delta >= 0 ? "+" : ""}${delta} vs snapshot`;

console.log(`runtime: ${size} B (${deltaText}, budget ${budget})`);

if (size >= budget) {
  console.error(`size:check — runtime ${size} B reached the ${budget} B budget.`);
  process.exit(1);
}
