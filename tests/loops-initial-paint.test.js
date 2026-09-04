// The reactive loop's INITIAL PAINT — the HTML that ships before the runtime
// boots, and the only HTML a crawler or a no-JS reader ever sees. It has to
// agree with what the runtime renders on its first pass, or the page flashes
// (and, for a crawler, is simply wrong).
//
// Two ways it disagreed: a per-row `:if` with an operator painted its TRUE
// branch for every row (the predicate is carried as a serialized AST, and the
// fill only understood the bare-path form), and a reactive `sort by { state }`
// painted the rows unsorted (the resolved state KEY was used as a literal field
// path, and the direction key never equalled "desc").

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

/** Compile one `.wd` body from memory and return its `<main>` HTML. */
function main(lines, extra = {}) {
  const page = compileFromMemory(
    { "site/pages/index.wd": `${lines.join("\n")}\n`, ...extra },
    "site/pages/index.wd",
    { cwd: "/proj" }
  );
  return page.html.match(/<main id="main">([\s\S]*?)<\/main>/)[1].trim();
}

/** Just the PAINTED rows — the `data-wd-loop-out` region, not the row template. */
function painted(html) {
  const at = html.indexOf("data-wd-loop-out>");
  return html.slice(at + "data-wd-loop-out>".length);
}

/** The painted branch of each `data-wd-each-if` region, in row order. */
function paintedBranches(html) {
  return [...painted(html).matchAll(/<span data-wd-each-if-out>([\s\S]*?)<\/span><\/span>/g)].map(
    (m) => m[1].replace(/<[^>]*>/g, "").trim()
  );
}

// ---------------------------------------------------------------------------
// C2: a predicate `:if` inside a reactive loop paints the RIGHT branch per row
// ---------------------------------------------------------------------------

test("a per-row :if with an operator paints the correct branch for each row", () => {
  const html = main([
    ':state rows = [{"n":"a","qty":0},{"n":"b","qty":5}]',
    "",
    "@loop rows into r",
    ":if r.qty > 1",
    "MANY",
    ":else",
    "FEW",
    ":endif",
    "@endloop"
  ]);
  // Pre-fix both rows painted MANY: the fill fell back to path "", so
  // `getPath(row, [])` handed back the row object and `Boolean(row)` was true.
  assert.deepEqual(paintedBranches(html), ["FEW", "MANY"]);
});

test("a per-row :if predicate that also reads :state resolves the state operand", () => {
  const html = main([
    ':state rows = [{"n":"a","qty":2},{"n":"b","qty":9}]',
    ":state floor = 5",
    "",
    "@loop rows into r",
    ":if r.qty > floor",
    "OVER",
    ":else",
    "UNDER",
    ":endif",
    "@endloop"
  ]);
  assert.deepEqual(paintedBranches(html), ["UNDER", "OVER"]);
});

test("a per-row :if predicate joined with and/or paints per row", () => {
  const html = main([
    ':state rows = [{"a":1,"b":1},{"a":1,"b":9},{"a":9,"b":9}]',
    "",
    "@loop rows into r",
    ":if r.a > 5 or r.b > 5",
    "HIT",
    ":else",
    "MISS",
    ":endif",
    "@endloop"
  ]);
  assert.deepEqual(paintedBranches(html), ["MISS", "HIT", "HIT"]);
});

test("the bare-path and meta forms of a per-row :if still paint correctly", () => {
  const html = main([
    ':state rows = [{"done":true},{"done":false}]',
    "",
    "@loop rows into r",
    ":if r.done",
    "YES",
    ":else",
    "NO",
    ":endif",
    ":if $first",
    "HEAD",
    ":else",
    "TAIL",
    ":endif",
    "@endloop"
  ]);
  assert.deepEqual(paintedBranches(html), ["YES", "HEAD", "NO", "TAIL"]);
});

test("the row <template> keeps BOTH branches so the runtime can still toggle", () => {
  const html = main([
    ':state rows = [{"qty":0}]',
    "",
    "@loop rows into r",
    ":if r.qty > 1",
    "MANY",
    ":else",
    "FEW",
    ":endif",
    "@endloop"
  ]);
  const template = html.match(
    /<template data-wd-loop-template>([\s\S]*?)<\/template><(?:div|ul)/
  )[1];
  assert.match(template, /<template data-wd-if-true><p>MANY<\/p><\/template>/);
  assert.match(template, /<template data-wd-if-false><p>FEW<\/p><\/template>/);
  assert.match(template, /<span data-wd-each-if-out><\/span>/, "the template paints no branch");
});

// ---------------------------------------------------------------------------
// C10: `sort by { state }` paints in the sorted order the runtime will produce
// ---------------------------------------------------------------------------

const NAMES = (html) =>
  [...painted(html).matchAll(/data-wd-path="name">([^<]*)</g)].map((m) => m[1]);

test("a reactive sort by { state } paints the rows already sorted", () => {
  const html = main([
    ':state rows = [{"name":"Bee"},{"name":"Ant"},{"name":"Cat"}]',
    ':state sortKey = "name"',
    "",
    "@loop rows into r sort by { sortKey }",
    "- { r.name }",
    "@endloop"
  ]);
  // Pre-fix the state KEY "sortKey" was used as a literal field path, which no
  // row has, so every row compared equal and the paint stayed in source order.
  assert.deepEqual(NAMES(html), ["Ant", "Bee", "Cat"]);
  assert.match(html, /data-wd-loop-sort="key:sortKey"/, "the runtime attribute is unchanged");
});

test("a reactive sort direction { state } of desc paints descending", () => {
  const html = main([
    ':state rows = [{"name":"Bee"},{"name":"Ant"},{"name":"Cat"}]',
    ':state sortKey = "name"',
    ':state sortDir = "desc"',
    "",
    "@loop rows into r sort by { sortKey } { sortDir }",
    "- { r.name }",
    "@endloop"
  ]);
  // Pre-fix the direction was the literal key "sortDir", which never equals
  // "desc", so desc painted ascending.
  assert.deepEqual(NAMES(html), ["Cat", "Bee", "Ant"]);
  assert.match(html, /data-wd-loop-sort-dir="key:sortDir"/);
});

test("a reactive sort over a dotted state key paints sorted too", () => {
  const html = main([
    ':state rows = [{"meta":{"rank":3},"name":"C"},{"meta":{"rank":1},"name":"A"}]',
    ':state sortKey = "meta.rank"',
    "",
    "@loop rows into r sort by { sortKey }",
    "- { r.name }",
    "@endloop"
  ]);
  assert.deepEqual(NAMES(html), ["A", "C"]);
});

test("an unset sort-key state falls back to comparing the rows themselves", () => {
  // `sortKey` is declared but empty, so there is no field to read. The paint
  // must still be deterministic rather than throwing.
  const html = main([
    ':state rows = [{"name":"Bee"},{"name":"Ant"}]',
    ':state sortKey = ""',
    "",
    "@loop rows into r sort by { sortKey }",
    "- { r.name }",
    "@endloop"
  ]);
  assert.equal(NAMES(html).length, 2);
});

test("a literal sort by item.field is untouched by the state resolution", () => {
  const html = main([
    ':state rows = [{"name":"Bee"},{"name":"Ant"}]',
    "@loop rows into r sort by r.name",
    "- { r.name }",
    "@endloop"
  ]);
  assert.deepEqual(NAMES(html), ["Ant", "Bee"]);
  assert.match(html, /data-wd-loop-sort="name"/);
});
