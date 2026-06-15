import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Compiler grammar whitelists: :computed, @loop … where predicate, :button.
// These assert that SAFE expressions compile to the expected runtime artifacts
// and that DANGEROUS ones are rejected at compile time with actionable text.
// ---------------------------------------------------------------------------

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-grammar-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function compile(lines) {
  const root = fixture();
  write(root, "site/pages/index.wd", Array.isArray(lines) ? lines.join("\n") : lines);
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
}

function compileThrows(lines, re) {
  const root = fixture();
  write(root, "site/pages/index.wd", Array.isArray(lines) ? lines.join("\n") : lines);
  assert.throws(() => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)), re);
}

// --- :computed — SAFE forms compile ----------------------------------------

test(":computed compiles arithmetic, comparisons, and boolean operators safely", () => {
  const page = compile([
    ":state a = 10",
    ":state b = 3",
    ":computed sum = a + b",
    ":computed diff = a - b",
    ":computed prod = a * b",
    ":computed quot = a / b",
    ":computed modv = a % b",
    ":computed cmp = a > b && b < a || a == 10",
    ":computed neg = !cmp"
  ]);
  // Every state reference is mapped to S("key"); no bare identifiers survive.
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;a&quot;\) \+ S\(&quot;b&quot;\)"/);
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;a&quot;\) % S\(&quot;b&quot;\)"/);
  assert.match(page.html, /data-wd-computed-expr="!S\(&quot;cmp&quot;\)"/);
  // Build-time seed: 10 + 3 = 13 baked into the bound span.
  assert.match(page.html, /data-wd-computed-key="sum"[\s\S]*?"sum":13/);
  assert.equal(page.assets.runtime, true);
});

test(":computed allows string literals as a safe operand", () => {
  const page = compile([
    ':state name = "Kirby"',
    ':computed greet = name == "Kirby"'
  ]);
  // The quoted literal is preserved and the identifier is mapped to S().
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;name&quot;\) == &quot;Kirby&quot;"/);
  assert.match(page.html, /"greet":true/);
});

test(":computed resolves dotted state paths through S(key, rest)", () => {
  const page = compile([
    ':state cart = {"count": 4}',
    ":computed double = cart.count * 2"
  ]);
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;cart&quot;,&quot;count&quot;\) \* 2"/);
  assert.match(page.html, /"double":8/);
});

// --- :computed — DANGEROUS forms rejected ----------------------------------

test(":computed rejects a backtick template literal", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = `${a}`"
  ], /Unsupported string syntax/);
});

test(":computed rejects a free identifier (process) not declared as state", () => {
  compileThrows(":computed x = process", /unknown state "process"/);
});

test(":computed rejects a call to a non-state name", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = alert(a)"
  ], /unknown state "alert"/);
});

test(":computed rejects assignment", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = a = 5"
  ], /Assignment is not allowed/);
});

test(":computed rejects __proto__ / prototype / constructor path segments", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = a.__proto__"
  ], /not allowed in :computed/);
  compileThrows([
    ":state a = 1",
    ":computed x = a.prototype"
  ], /not allowed in :computed/);
});

test(":computed rejects stray punctuation / statement separators", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = a; return a"
  ], /Unsupported syntax/);
});

test(":computed with no '=' is a malformed-directive error with a Use: hint", () => {
  compileThrows(":computed total", /Malformed :computed[\s\S]*Use: :computed/);
});

// --- @loop where predicate — SAFE forms -------------------------------------

test("@loop where compiles every comparison operator to a safe I()/S() expression", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, price: 5, name: "a" }]));
  write(root, "site/pages/index.wd", [
    ":state limit = 100",
    "@loop /x.json into p where p.price >= 1 and p.price <= limit and p.id != 9 and p.price > 0 and p.price < 999",
    "- { p.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  // references :state (limit) → reactive, predicate baked into the data attr.
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /I\(&quot;price&quot;\) &gt;= 1/);
  assert.match(page.html, /I\(&quot;price&quot;\) &lt;= S\(&quot;limit&quot;\)/);
  assert.match(page.html, /I\(&quot;id&quot;\) != 9/);
});

test("@loop where 'contains' compiles to the C() helper", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "Mug" }]));
  write(root, "site/pages/index.wd", [
    ':state q = "m"',
    "@loop /x.json into p where p.name contains q",
    "- { p.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-loop-where="\(C\(I\(&quot;name&quot;\), S\(&quot;q&quot;\)\)\)"/);
});

// --- @loop where predicate — DANGEROUS forms --------------------------------

test("@loop where rejects a bare free identifier as a left operand", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1 }]));
  write(root, "site/pages/index.wd", [
    "@loop /x.json into p where evil == 1",
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /references unknown name "evil"/
  );
});

test("@loop where rejects a function call operand", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "a" }]));
  write(root, "site/pages/index.wd", [
    '@loop /x.json into p where p.name == alert(1)',
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unsupported operand/
  );
});

test("@loop where rejects prototype path segments on either side", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1 }]));
  write(root, "site/pages/index.wd", [
    "@loop /x.json into p where p.__proto__ == 1",
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /not allowed in @loop where/
  );
});

// --- :button actions — SAFE forms -------------------------------------------

test(":button compiles inc/dec/add/append/set actions to their ops", () => {
  const page = compile([
    ":state count = 0",
    ":state tags = []",
    ':state name = ""',
    ':button "Inc" -> count++',
    ':button "Dec" -> count--',
    ':button "Add5" -> count += 5',
    ':button "Tag" -> tags += "x"',
    ':button "Set" -> name = "Kirby"'
  ]);
  assert.match(page.html, /data-wd-action="inc" data-wd-target="count"/);
  assert.match(page.html, /data-wd-action="dec" data-wd-target="count"/);
  assert.match(page.html, /data-wd-action="add" data-wd-target="count" data-wd-value="5"/);
  assert.match(page.html, /data-wd-action="append" data-wd-target="tags" data-wd-value="&quot;x&quot;"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="name" data-wd-value="&quot;Kirby&quot;"/);
});

test(":button set accepts boolean, null, number, and JSON literals", () => {
  const page = compile([
    ":state flag = false",
    ":state n = 0",
    ":state obj = {}",
    ':button "On" -> flag = true',
    ':button "Off" -> flag = null',
    ':button "Num" -> n = 42',
    ':button "Obj" -> obj = {"a": 1}'
  ]);
  assert.match(page.html, /data-wd-action="set" data-wd-target="flag" data-wd-value="true"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="flag" data-wd-value="null"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="n" data-wd-value="42"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="obj" data-wd-value="\{&quot;a&quot;:1\}"/);
});

// --- :button actions — DANGEROUS / malformed forms --------------------------

test(":button with no '->' arrow is a malformed-directive error", () => {
  compileThrows([
    ":state count = 0",
    ':button "Bad" count++'
  ], /Malformed :button/);
});

test(":button += with a non-number value and a non-list target is rejected", () => {
  compileThrows([
    ':state name = ""',
    ':button "Bad" -> name += "x"'
  ], /requires a list state target/);
});

test(":button action targeting unknown state names the corrective :state form", () => {
  compileThrows(':button "Bad" -> ghost = 1', /unknown state "ghost"[\s\S]*Declare it first/);
});

test(":button rejects an unparseable action literal", () => {
  compileThrows([
    ":state n = 0",
    ':button "Bad" -> n = {not json}'
  ], /Unsupported action literal/);
});
