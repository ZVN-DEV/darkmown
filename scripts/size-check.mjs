#!/usr/bin/env node
// Size-trend guard for the shipped reactive runtime. Gzips
// `dist/__wd/runtime.js`, compares it against the committed
// `.size-snapshot.json` baseline, and prints the byte delta so a PR surfaces
// any growth. The hard budget gate (< 6144 B gzipped) still applies: this exits
// non-zero if the runtime reaches it. Run `npm run build` first (CI does).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const BUDGET = 6144; // bytes, gzipped — the CI-enforced ceiling (< 6 KB)
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

const baseline = snapshot?.runtime?.gzip;
const delta = typeof baseline === "number" ? size - baseline : null;
const deltaText = delta === null ? "no snapshot" : `${delta >= 0 ? "+" : ""}${delta} vs snapshot`;

console.log(`runtime: ${size} B (${deltaText}, budget ${BUDGET})`);

if (size >= BUDGET) {
  console.error(`size:check — runtime ${size} B reached the ${BUDGET} B budget.`);
  process.exit(1);
}
