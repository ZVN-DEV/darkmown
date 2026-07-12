#!/usr/bin/env node
// Regenerate grammar/wd-directives.gbnf from the directive catalog.
// Run: node scripts/gen-grammar.mjs   (also runnable as a check with --check).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateGrammar } from "../src/grammar.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = path.join(root, "grammar", "wd-directives.gbnf");
const grammar = `${generateGrammar()}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (current !== grammar) {
    console.error("grammar/wd-directives.gbnf is out of date — run: node scripts/gen-grammar.mjs");
    process.exit(1);
  }
  console.log("grammar/wd-directives.gbnf is up to date");
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, grammar);
  console.log(`Wrote ${path.relative(root, outFile)} (${grammar.split("\n").length} lines)`);
}
