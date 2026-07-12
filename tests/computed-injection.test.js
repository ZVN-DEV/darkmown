// Regression tests for the :computed string-literal code-injection (CVE-class).
//
// Background
// ----------
// compileComputedExpr swaps every string literal for a `__WDSTR<n>__` placeholder
// BEFORE the whitelist checks run, then re-inserts it verbatim afterwards. The old
// code re-wrapped the literal's inner text in double quotes WITHOUT escaping, so a
// single-quoted literal containing a `"` (e.g. `'"+(7*7)+"'`) had its quotes
// stripped and re-wrapped unescaped — the inner `"` terminated the string and the
// rest (`+(7*7)+`) became live JS. The fix re-inserts via JSON.stringify so the
// literal round-trips as an inert string.
//
// Since 2.1 the runtime no longer builds a `new Function`: the compiler emits a
// serialized expression AST (see src/compiler/expr-ast.js) into
// `data-wd-computed-expr`, and the runtime WALKS it. That makes the A1 class even
// harder to hit — a string literal becomes a pure DATA node `["L", "…"]`, never
// code. These tests decode the emitted AST and assert the payload survives ONLY as
// an inert literal node, and that walking the AST computes a boolean comparison
// (never the arithmetic `7*7 => 49`, never a global).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evalAst } from "../src/compiler/expr-ast.js";
import { compileDocument } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// Write a single `.wd` page and compile it to its body HTML, returning the html
// string. Suppresses the expected "could not be evaluated at build time" warning
// for inputs that legitimately can't be folded.
function compileWd(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-computed-inj-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  const pageFile = path.join(root, "site/pages/index.wd");
  fs.writeFileSync(pageFile, body);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return compileDocument(pageFile, createPaths(root)).html;
  } finally {
    console.warn = originalWarn;
  }
}

// Pull the decoded `data-wd-computed-expr` artifact out of compiled HTML and
// JSON-parse it — the exact serialized AST the runtime walks.
function extractComputedAst(html) {
  const m = html.match(/data-wd-computed-expr="([^"]*)"/);
  assert.ok(m, "expected a data-wd-computed-expr attribute in the output");
  const decoded = m[1]
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
  return JSON.parse(decoded);
}

// Walk the AST exactly as runtime.js does (evalAst is the shared closed evaluator),
// reading state through a supplied map. No `new Function`, no eval.
function walk(ast, state = {}) {
  return evalAst(ast, undefined, { state: new Map(Object.entries(state)) });
}

test("A1: single-quoted literal with embedded double-quote does NOT execute (7*7 stays inert)", () => {
  const html = compileWd([':state x = "X"', ":computed pwned = x == '\"+(7*7)+\"'"].join("\n"));
  const ast = extractComputedAst(html);

  // The AST is a comparison whose RHS is a pure literal DATA node — the payload can
  // never be code. Shape: ["==", ["S","x"], ["L", '"+(7*7)+"']].
  assert.equal(ast[0], "==");
  assert.deepEqual(ast[1], ["S", "x"]);
  assert.deepEqual(
    ast[2],
    ["L", '"+(7*7)+"'],
    "literal must round-trip exactly, no arithmetic folded"
  );

  // Walking the whole AST yields a boolean comparison, never the number 49.
  const result = walk(ast, { x: "X" });
  assert.equal(
    typeof result,
    "boolean",
    "must evaluate to a boolean comparison, not run arithmetic"
  );
  assert.equal(result, false, 'S("x") ("X") never equals the literal string');
  assert.notEqual(walk(ast[2]), 49, "arithmetic in the payload must never execute");
});

test("A1: a '\"+globalThis+\"' payload does not reference any global when evaluated", () => {
  const html = compileWd(
    [':state x = "X"', ":computed pwned = x == '\"+globalThis+\"'"].join("\n")
  );
  const ast = extractComputedAst(html);

  // `globalThis` lives inside a ["L", …] literal node — inert data. Evaluating the
  // isolated RHS yields the STRING, never the global object.
  assert.deepEqual(ast[2], ["L", '"+globalThis+"'], "globalThis payload must stay an inert string");
  const literalValue = walk(ast[2]);
  assert.equal(literalValue, '"+globalThis+"');
  assert.equal(
    typeof literalValue,
    "string",
    "payload must evaluate to a string, never the global"
  );
});

test("A1: a backslash-bearing payload is REJECTED (never compiled)", () => {
  // A single-quoted literal whose inner text contains a backslash. The literal
  // matcher (`'[^'\\]*'`) deliberately excludes `\`, so the backslash survives into
  // the validated expression and trips the `["'\\\`]` guard — the expression is
  // rejected at compile time. Validation is unchanged by the AST switch.
  assert.throws(
    () => compileWd([':state x = "X"', ":computed pwned = x == '\\\\\"+1+\"'"].join("\n")),
    /Unsupported string syntax in :computed/
  );
});

test("A1: ordinary double-quoted literals still compile unchanged", () => {
  const html = compileWd([':state label = "hi"', ':computed shown = label == "hi"'].join("\n"));
  const ast = extractComputedAst(html);
  // Compiles to the comparison AST ["==", ["S","label"], ["L","hi"]].
  assert.deepEqual(ast, ["==", ["S", "label"], ["L", "hi"]]);
  assert.equal(
    walk(ast, { label: "hi" }),
    true,
    "double-quoted literal comparison must still work"
  );
});

test("A1: a plain string literal :computed evaluates to that string", () => {
  const html = compileWd([":state on = true", ':computed badge = "sale"'].join("\n"));
  const ast = extractComputedAst(html);
  assert.deepEqual(ast, ["L", "sale"]);
  assert.equal(walk(ast), "sale");
});

test("A2: a method call on state (x.valueOf()) is REJECTED, never compiled", () => {
  // Before the function-call guard, `x.valueOf()` compiled to `S("x","valueOf")()`
  // — a live invocation. SECURITY.md guarantees function calls are compile errors.
  // Validation is unchanged; the rejection still fires before any AST is built.
  assert.throws(
    () => compileWd([":state x = 1", ":computed pwned = x.valueOf()"].join("\n")),
    /Function calls are not allowed in :computed/
  );
});

test("A2: a bare call x() is REJECTED", () => {
  assert.throws(
    () => compileWd([":state x = 1", ":computed pwned = x()"].join("\n")),
    /Function calls are not allowed in :computed/
  );
});
