#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const threshold = Number(process.argv[2] || 80);
if (!Number.isFinite(threshold)) {
  console.error(`Invalid coverage threshold: ${process.argv[2]}`);
  process.exit(1);
}

const files = readdirSync("tests")
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => join("tests", name));

const result = spawnSync(process.execPath, ["--test", "--experimental-test-coverage", ...files], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 32
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

const output = `${result.stdout}\n${result.stderr}`;
const match = output.match(/(?:#|ℹ)?\s*all files\s+\|\s+([0-9.]+)/);
if (!match) {
  console.error("Could not find the total line coverage row in node:test output.");
  process.exit(1);
}

const actual = Number(match[1]);
if (actual < threshold) {
  console.error(`Line coverage ${actual}% is below required ${threshold}%.`);
  process.exit(1);
}

console.log(`Line coverage ${actual}% meets required ${threshold}%.`);
