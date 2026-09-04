// A `@loop` that emits markdown TABLE ROWS.
//
// A static `@loop` compiles each row body as its own markdown document, so a
// body of bare `| … |` cells produced one document per row — and markdown-it
// needs a header plus a `|---|` separator before it will read a line as a table
// row at all, so the rows either rendered as literal pipe prose or as one
// single-row table each. Two shapes have to work:
//
//   1. the header sits in PROSE above the loop and the loop supplies the rows
//      (`spliceTables` grafts each row's `<tbody>` onto the prose table), and
//   2. the whole table lives INSIDE the loop as bare rows (`staticUnroll`
//      synthesizes a throwaway header so markdown-it parses the cells, then
//      strips the `<thead>` back off).
//
// Both must land as ONE `<table>` with one `<tr>` per row. The reactive shape
// cannot work at all — a reactive row is cloned into a `<div>`, which is not a
// legal child of `<table>` — so it is a coded compile error, not silent junk.

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

/** Run `fn`, and return the error it threw (asserting that it threw one). */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a compile error, got none");
}

// The fixture: a three-row shelf JSON, read through `/data.json` (site/_).
const SHELF = JSON.stringify([
  { name: "Ash", qty: 3, price: 12 },
  { name: "Birch", qty: 1, price: 40 },
  { name: "Cedar", qty: 7, price: 5 }
]);

/** Compile one `.wd` body from memory and return its `<main>` HTML. */
function main(lines, extra = {}) {
  const page = compileFromMemory(
    { "site/pages/index.wd": `${lines.join("\n")}\n`, ...extra },
    "site/pages/index.wd",
    { cwd: "/proj" }
  );
  return page.html.match(/<main id="main">([\s\S]*?)<\/main>/)[1].trim();
}

/** How many times `tag` opens in `html`. */
const count = (html, tag) => (html.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;

/** Assert the standard shape: one table, one thead, one tbody, `rows` rows. */
function assertOneTable(html, rows) {
  assert.equal(count(html, "table"), 1, `expected ONE <table>, got:\n${html}`);
  assert.equal(count(html, "thead"), 1, `expected ONE <thead>, got:\n${html}`);
  assert.equal(count(html, "tbody"), 1, `expected ONE <tbody>, got:\n${html}`);
  const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  assert.equal(count(body, "tr"), rows, `expected ${rows} body rows, got:\n${html}`);
}

// ---------------------------------------------------------------------------
// 1. Header in prose, rows in the loop
// ---------------------------------------------------------------------------

test("a header above the loop and rows inside it make ONE table with one <tr> per row", () => {
  const html = main(
    [
      "| Item | Qty | Price |",
      "| --- | --- | --- |",
      "@loop /data.json into row",
      "| { row.name } | { row.qty } | { row.price } |",
      "@endloop"
    ],
    { "site/_/data.json": SHELF }
  );
  assertOneTable(html, 3);
  // The header stays the header, and every row's cells land as data cells in
  // source order — the point of the feature, not just the tag count.
  assert.match(html, /<th>Item<\/th>\n<th>Qty<\/th>\n<th>Price<\/th>/);
  assert.match(html, /<td>Ash<\/td>\n<td>3<\/td>\n<td>12<\/td>/);
  assert.match(html, /<td>Birch<\/td>\n<td>1<\/td>\n<td>40<\/td>/);
  assert.match(html, /<td>Cedar<\/td>\n<td>7<\/td>\n<td>5<\/td>/);
  // No pipe survived as prose: that is the failure this replaces.
  assert.ok(!html.includes("<p>|"), `a row rendered as prose:\n${html}`);
});

test("a cell holds nested inline markdown around its interpolation", () => {
  const html = main(
    [
      "| Item | Note |",
      "| --- | --- |",
      "@loop /data.json into row",
      "| **{ row.name }** | _{ row.qty }_ x [buy](/buy/{ row.name }) |",
      "@endloop"
    ],
    { "site/_/data.json": SHELF }
  );
  assertOneTable(html, 3);
  assert.match(html, /<td><strong>Ash<\/strong><\/td>/);
  assert.match(html, /<td><em>3<\/em> x <a href="\/buy\/Ash">buy<\/a><\/td>/);
  assert.match(html, /<td><strong>Cedar<\/strong><\/td>/);
});

// ---------------------------------------------------------------------------
// 2. The whole table inside the loop
// ---------------------------------------------------------------------------

test("a loop body of bare rows is ONE headerless table, not one table per row", () => {
  const html = main(["@loop /data.json into row", "| { row.name } | { row.qty } |", "@endloop"], {
    "site/_/data.json": SHELF
  });
  assert.equal(count(html, "table"), 1, `expected ONE <table>, got:\n${html}`);
  // The synthesized header is scaffolding for markdown-it, and must not ship.
  assert.equal(count(html, "thead"), 0, `the synthesized header leaked:\n${html}`);
  assert.equal(count(html, "th"), 0, `the synthesized header leaked:\n${html}`);
  assert.equal(count(html, "tr"), 3);
  assert.match(html, /<td>Ash<\/td>\n<td>3<\/td>/);
  assert.match(html, /<td>Cedar<\/td>\n<td>7<\/td>/);
});

test("a loop body that writes its OWN header is left to the row splice", () => {
  // `pipeRowShape` fires only when the body has no `|---|` separator, so a body
  // that is a COMPLETE table per row goes down the wave-1 row-seam path instead:
  // identical headers collapse to one table, and the rows stack under it.
  const html = main(
    ["@loop /data.json into row", "| Item |", "| --- |", "| { row.name } |", "@endloop"],
    { "site/_/data.json": SHELF }
  );
  assertOneTable(html, 3);
  assert.match(html, /<th>Item<\/th>/);
  assert.match(html, /<td>Ash<\/td>/);
  assert.match(html, /<td>Cedar<\/td>/);
});

// ---------------------------------------------------------------------------
// 3. `@empty`, and the surrounding prose
// ---------------------------------------------------------------------------

test("an empty list renders the @empty branch and leaves the header table alone", () => {
  const html = main(
    [
      "| Item | Qty |",
      "| --- | --- |",
      "@loop /data.json into row",
      "| { row.name } | { row.qty } |",
      "@empty",
      "Nothing on the shelf.",
      "@endloop"
    ],
    { "site/_/data.json": "[]" }
  );
  assert.equal(count(html, "table"), 1, `expected ONE <table>, got:\n${html}`);
  // markdown-it emits no <tbody> for a header-only table, and the empty branch
  // is prose, so it must NOT be spliced into the table.
  assert.equal(count(html, "tbody"), 0, `an empty loop invented a body:\n${html}`);
  assert.match(html, /<th>Item<\/th>/);
  assert.match(html, /<p>Nothing on the shelf\.<\/p>/);
});

test("prose after the table is still prose", () => {
  // The splice must fire ONLY at a table/table seam. A paragraph after the loop
  // proves it is not swallowing whatever follows.
  const html = main(
    [
      "| Item | Qty |",
      "| --- | --- |",
      "@loop /data.json into row",
      "| { row.name } | { row.qty } |",
      "@endloop",
      "",
      "Stock as of today."
    ],
    { "site/_/data.json": SHELF }
  );
  assertOneTable(html, 3);
  assert.match(html, /<\/table>\n\n<p>Stock as of today\.<\/p>/);
});

// ---------------------------------------------------------------------------
// 4. The reactive shape is refused, with the static alternative in the hint
// ---------------------------------------------------------------------------

test("a REACTIVE loop over pipe rows is a coded compile error, not broken markup", () => {
  const error = thrown(() =>
    main([
      ':state shelf = [{ "name": "Ash" }]',
      "",
      "| Item |",
      "| --- |",
      "@loop shelf into row",
      "| { row.name } |",
      "@endloop"
    ])
  );
  assert.equal(error.wd.code, "WD191");
  // The message has to point at the loop that caused it and name the way out.
  assert.match(error.message, /index\.wd:5/);
  assert.match(error.message, /@loop shelf into row/);
  assert.match(
    error.message,
    /a static source \(a JSON file, a frontmatter list, or a collection\)/
  );
  assert.match(error.message, /::: trow/);
});

test("an item-relative reactive loop over pipe rows is refused too", () => {
  const error = thrown(() =>
    main([
      ':state teams = [{ "members": [{ "name": "Ash" }] }]',
      "",
      "@loop teams into team",
      "@loop team.members into m",
      "| { m.name } |",
      "@endloop",
      "@endloop"
    ])
  );
  assert.equal(error.wd.code, "WD191");
});

test("a reactive loop over NON-row content is untouched", () => {
  // Negative control for the guard: it must key on the pipe-row shape, not on
  // "reactive loop" — every shipped reactive loop still compiles.
  const html = main([
    ':state shelf = [{ "name": "Ash" }]',
    "",
    "@loop shelf into row",
    "- { row.name }",
    "@endloop"
  ]);
  assert.match(html, /data-wd-loop="shelf"/);
});
