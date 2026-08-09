#!/usr/bin/env node
// Regenerate docs/errors.md from the error-code registry (src/errors.js).
// Run: node scripts/gen-errors.mjs   (also runnable as a check with --check).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorsMarkdown } from "../src/errors.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(root, "docs", "errors.md");
const markdown = errorsMarkdown();

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (current !== markdown) {
    console.error("docs/errors.md is out of date. Run: node scripts/gen-errors.mjs");
    process.exit(1);
  }
  console.log("docs/errors.md is up to date");
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, markdown);
  console.log(`Wrote ${path.relative(root, outFile)} (${markdown.split("\n").length} lines)`);
}
