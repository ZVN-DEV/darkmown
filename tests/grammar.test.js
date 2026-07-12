import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CATALOG_ACTION_TOKENS, directiveCatalog } from "../src/catalog.js";
import { generateGrammar } from "../src/grammar.js";

const grammar = generateGrammar();

/** Strip GBNF string literals and char classes so only rule references remain. */
function stripTerminals(text) {
  return text
    .replace(/"(?:\\.|[^"])*"/g, " ") // "…" string literals (incl. \" )
    .replace(/\[(?:\\.|[^\]])*\]/g, " "); // […] char classes (incl. \] )
}

function rules(text) {
  /** @type {Map<string, string>} */
  const defined = new Map();
  for (const line of text.split("\n")) {
    const m = line.match(/^([a-z][a-z0-9-]*)\s*::=\s*(.*)$/);
    if (m) defined.set(m[1], m[2]);
  }
  return defined;
}

// ---------------------------------------------------------------------------
// Well-formedness: balanced, every referenced rule defined, root reachable.
// ---------------------------------------------------------------------------

test("grammar has a root rule and every referenced rule is defined", () => {
  const defined = rules(grammar);
  assert.ok(defined.has("root"), "grammar has no root rule");
  const names = new Set(defined.keys());
  for (const [name, rhs] of defined) {
    for (const ref of stripTerminals(rhs).match(/[a-z][a-z0-9-]*/g) ?? []) {
      assert.ok(names.has(ref), `rule "${name}" references undefined rule "${ref}"`);
    }
  }
});

test("grammar parentheses and quotes are balanced", () => {
  const stripped = stripTerminals(grammar);
  let depth = 0;
  for (const ch of stripped) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    assert.ok(depth >= 0, "unbalanced ) in grammar");
  }
  assert.equal(depth, 0, "unbalanced ( in grammar");
  // Quotes: every string literal is fully matched by the strip regex, so no bare
  // double-quote can survive into the stripped text.
  assert.ok(!stripped.includes('"'), "an unterminated string literal remains");
});

test("every rule is reachable from root", () => {
  const defined = rules(grammar);
  const seen = new Set();
  const stack = ["root"];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    for (const ref of stripTerminals(defined.get(name) ?? "").match(/[a-z][a-z0-9-]*/g) ?? []) {
      stack.push(ref);
    }
  }
  for (const name of defined.keys()) {
    assert.ok(seen.has(name), `rule "${name}" is unreachable from root (dead rule)`);
  }
});

// ---------------------------------------------------------------------------
// Coverage against the catalog: the constrained vocabulary is all present.
// ---------------------------------------------------------------------------

test("every catalog directive keyword is a literal in the grammar", () => {
  for (const d of directiveCatalog().directives) {
    assert.ok(grammar.includes(`"${d.name}"`), `grammar missing directive keyword ${d.name}`);
  }
});

test("every predicate operator and format pipe is a literal in the grammar", () => {
  const cat = directiveCatalog();
  for (const op of cat.predicateOps) {
    assert.ok(grammar.includes(`"${op.name}"`), `grammar missing operator ${op.name}`);
  }
  for (const p of cat.formatPipes) {
    assert.ok(grammar.includes(`"${p.name}"`), `grammar missing pipe ${p.name}`);
  }
});

test("every action-op token is a literal in the grammar", () => {
  for (const token of CATALOG_ACTION_TOKENS) {
    assert.ok(grammar.includes(`"${token}"`), `grammar missing action token ${token}`);
  }
});

// ---------------------------------------------------------------------------
// The committed grammar file is in sync with the generator.
// ---------------------------------------------------------------------------

test("grammar/wd-directives.gbnf is checked in and up to date", () => {
  const file = new URL("../grammar/wd-directives.gbnf", import.meta.url);
  assert.ok(fs.existsSync(file), "grammar/wd-directives.gbnf is not committed");
  assert.equal(fs.readFileSync(file, "utf8"), `${grammar}\n`, "run: node scripts/gen-grammar.mjs");
});
