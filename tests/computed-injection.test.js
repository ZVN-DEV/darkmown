// Regression tests for the :computed string-literal code-injection (CVE-class).
//
// Background
// ----------
// compileComputedExpr swaps every string literal for a `__WDSTR<n>__` placeholder
// BEFORE the whitelist checks run, then re-inserts it verbatim afterwards. The old
// code re-wrapped the literal's inner text in double quotes WITHOUT escaping, so a
// single-quoted literal containing a `"` (e.g. `'"+(7*7)+"'`) had its quotes
// stripped and re-wrapped unescaped — the inner `"` terminated the string and the
// rest (`+(7*7)+`) became live JS that ran via `new Function` at BUILD time (full
// Node access) AND in the browser. The fix re-inserts via JSON.stringify so the
// literal round-trips as an inert string.
//
// These tests decode the emitted `data-wd-computed-expr` attribute and EVALUATE it
// in a trapped sandbox: if the payload were live code, evaluating it would compute
// 7*7 (=> 49) or reference a global. We assert it does neither — the payload must
// round-trip as the literal string it was written as.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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

// Pull the decoded `data-wd-computed-expr` artifact out of compiled HTML — the
// exact string that runtime.js feeds to `new Function`.
function extractComputedExpr(html) {
  const m = html.match(/data-wd-computed-expr="([^"]*)"/);
  assert.ok(m, "expected a data-wd-computed-expr attribute in the output");
  return m[1]
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

// Evaluate a compiled expr exactly as runtime.js does: `new Function("S", ...)`.
// `S` is the only injected reader. A breakout would compute arithmetic or reach a
// global; a correctly-escaped literal evaluates to itself.
function evalExpr(expr, read = () => "X") {
  return new Function("S", `return (${expr});`)(read);
}

test("A1: single-quoted literal with embedded double-quote does NOT execute (7*7 stays inert)", () => {
  const html = compileWd([':state x = "X"', ":computed pwned = x == '\"+(7*7)+\"'"].join("\n"));
  const expr = extractComputedExpr(html);

  // The payload must round-trip as the literal STRING `"+(7*7)+"`, never as code.
  // If it were live, `S("x")` ("X") == ... would evaluate the arithmetic; with the
  // fix it is a plain string comparison that is simply false.
  assert.doesNotMatch(
    expr,
    /\bS\("x"\)\s*==\s*""\s*\+\s*\(7\s*\*\s*7\)/,
    "the literal must not have re-wrapped into live arithmetic"
  );

  // Evaluating the whole expr must not yield 49 (or any number) — it's a boolean
  // string compare. And the right-hand operand, isolated, must equal the literal.
  const result = evalExpr(expr, (key) => (key === "x" ? "X" : undefined));
  assert.equal(
    typeof result,
    "boolean",
    "compiled expr must evaluate to a boolean comparison, not run arithmetic"
  );
  assert.equal(result, false, 'S("x") ("X") never equals the literal string');

  // Directly evaluate the right-hand literal in isolation to prove it is the
  // inert string '"+(7*7)+"' and not the number 49.
  const rhs = expr.replace(/^.*==\s*/, "");
  const literalValue = evalExpr(rhs);
  assert.equal(
    literalValue,
    '"+(7*7)+"',
    "literal must round-trip exactly, with no arithmetic folded"
  );
  assert.notEqual(literalValue, 49, "arithmetic in the payload must never execute");
});

test("A1: a '\"+globalThis+\"' payload does not reference any global when evaluated", () => {
  const html = compileWd(
    [':state x = "X"', ":computed pwned = x == '\"+globalThis+\"'"].join("\n")
  );
  const expr = extractComputedExpr(html);

  // The compiled artifact is `S("x") == "\"+globalThis+\""` — `globalThis` lives
  // inside the escaped string literal. Evaluating the isolated RHS literal must
  // yield the inert STRING, not the global object. A `globalThis` reference would
  // evaluate to an object; the trapped reader proves nothing outside `S` is reached.
  const rhs = expr.replace(/^.*==\s*/, "");
  const literalValue = evalExpr(rhs, () => {
    throw new Error("the compiled expr must not call S for an inert literal RHS");
  });
  assert.equal(literalValue, '"+globalThis+"', "globalThis payload must stay an inert string");
  assert.equal(
    typeof literalValue,
    "string",
    "payload must evaluate to a string, never the global"
  );
});

test("A1: a backslash-bearing payload is REJECTED (never compiled to live code)", () => {
  // A single-quoted literal whose inner text contains a backslash. The literal
  // matcher (`'[^'\\]*'`) deliberately excludes `\`, so the backslash survives
  // into the validated expression and trips the `["'\\\`]` guard — the expression
  // is rejected at compile time rather than re-wrapped into something live. That
  // rejection IS the safe outcome: a backslash must never reach `new Function`.
  assert.throws(
    () => compileWd([':state x = "X"', ":computed pwned = x == '\\\\\"+1+\"'"].join("\n")),
    /Unsupported string syntax in :computed/
  );
});

test("A1: ordinary double-quoted literals still compile unchanged", () => {
  const html = compileWd([':state label = "hi"', ':computed shown = label == "hi"'].join("\n"));
  const expr = extractComputedExpr(html);
  // Matches the pre-existing unit-grammar expectation: S("label") == "hi".
  assert.equal(expr, 'S("label") == "hi"');
  const result = evalExpr(expr, (key) => (key === "label" ? "hi" : undefined));
  assert.equal(result, true, "double-quoted literal comparison must still work");
});

test("A1: a plain string literal :computed evaluates to that string", () => {
  const html = compileWd([":state on = true", ':computed badge = "sale"'].join("\n"));
  const expr = extractComputedExpr(html);
  assert.equal(evalExpr(expr), "sale");
});

test("A2: a method call on state (x.valueOf()) is REJECTED, never compiled to S(...)()", () => {
  // Before the function-call guard, `x.valueOf()` compiled to `S("x","valueOf")()`
  // — a live invocation reaching `new Function`. It is inert under the JSON-state
  // model (S returns data, not functions), but SECURITY.md guarantees function
  // calls are compile errors. Assert the rejection so the artifact can never carry
  // a trailing `()`.
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
