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

// ---------------------------------------------------------------------------
// 5. The synthesized header must never reach the page
// ---------------------------------------------------------------------------

test("a blank line between loop rows does not leak the synthetic `| c | c |` header", () => {
  // A blank line ENDS a markdown table, so the synthesized header only covered
  // the rows before it and every later run formed its OWN table — with a visible
  // `<th>c</th>` header that only the first strip removed.
  const html = main(
    [
      "| A | B |",
      "| --- | --- |",
      "@loop /data.json into row",
      "| { row.name } | { row.qty } |",
      "",
      "| x | y |",
      "@endloop"
    ],
    { "site/_/data.json": SHELF }
  );
  assert.ok(!html.includes("<th>c</th>"), `the synthetic header leaked:\n${html}`);
  assert.equal(count(html, "thead"), 1, `expected only the author's header:\n${html}`);
});

test("a 4-space-indented loop row does not leak the synthetic header", () => {
  // Four leading spaces make the line an indented CODE BLOCK, not a table row,
  // so the body was never rows at all — `pipeRowShape` used to trim the line and
  // claim it anyway.
  const html = main(
    ["| A | B |", "| --- | --- |", "@loop /data.json into row", "    | { row.name } |", "@endloop"],
    { "site/_/data.json": SHELF }
  );
  assert.ok(!html.includes("<th>c</th>"), `the synthetic header leaked:\n${html}`);
  assert.equal(count(html, "thead"), 1);
});

test("a blank line inside a whole-table-in-loop body leaks nothing either", () => {
  const html = main(["@loop /data.json into row", "| { row.name } |", "", "| x |", "@endloop"], {
    "site/_/data.json": SHELF
  });
  assert.ok(!html.includes("<th>c</th>"), `the synthetic header leaked:\n${html}`);
});

test("a TRAILING blank line still unrolls into the table", () => {
  // Nothing follows a trailing blank, so it cannot re-open a table: the shape is
  // still claimed, and the rows still land in the author's table. (Refusing on
  // ANY blank line would have regressed this.)
  const html = main(
    [
      "| Item | Qty |",
      "| --- | --- |",
      "@loop /data.json into row",
      "| { row.name } | { row.qty } |",
      "",
      "@endloop"
    ],
    { "site/_/data.json": SHELF }
  );
  assertOneTable(html, 3);
  assert.ok(!html.includes("<th>c</th>"));
});

// ---------------------------------------------------------------------------
// 6. A header that already has a body row of its own
// ---------------------------------------------------------------------------

test("a fixed row written under the header joins the looped rows in ONE table", () => {
  const html = main(
    [
      "| Item | Qty |",
      "| --- | --- |",
      "| fixed | 0 |",
      "@loop /data.json into row",
      "| { row.name } | { row.qty } |",
      "@endloop"
    ],
    { "site/_/data.json": SHELF }
  );
  assertOneTable(html, 4);
  const body = html.slice(html.indexOf("<tbody>"));
  // Source order is preserved: the hand-written row first, then the loop's.
  assert.ok(
    body.indexOf("<td>fixed</td>") < body.indexOf("<td>Ash</td>"),
    `rows are out of order:\n${html}`
  );
});

test("two tables that each have their OWN header still stay separate", () => {
  // Negative control for the widened splice: merging them would silently drop
  // the second header.
  const html = main(["| A |", "| --- |", "| 1 |", "", "| B |", "| --- |", "| 2 |"], {
    "site/_/data.json": SHELF
  });
  assert.equal(count(html, "table"), 2, `two headered tables merged:\n${html}`);
});

// ---------------------------------------------------------------------------
// 7. WD191 names the RIGHT cause
// ---------------------------------------------------------------------------

test("WD191 blames the CLAUSE when the source is static", () => {
  // "Use: a static source" is useless advice for `@loop /rows.json …` — the
  // source is already static; the `where` reading `:state` is what made the loop
  // reactive, so that is what the hint has to name.
  const error = thrown(() =>
    main(
      [
        ":state min = 0",
        "",
        "| N |",
        "| --- |",
        "@loop /data.json into p where p.qty > min",
        "| { p.qty } |",
        "@endloop"
      ],
      { "site/_/data.json": SHELF }
    )
  );
  assert.equal(error.wd.code, "WD191");
  assert.match(error.message, /The source is static; the clauses read :state "min"/);
  assert.match(error.wd.hint, /^drop "min" from the clauses so the rows unroll at build time/);
  assert.ok(!error.wd.hint.includes("a static source"), `blamed the source: ${error.wd.hint}`);
});

test("WD191 names a state-driven limit / sort clause too", () => {
  for (const [clause, name] of [
    ["limit size", "size"],
    ["sort by { sk }", "sk"]
  ]) {
    const error = thrown(() =>
      main(
        [
          ":state size = 1",
          ':state sk = "qty"',
          "",
          "| N |",
          "| --- |",
          `@loop /data.json into p ${clause}`,
          "| { p.qty } |",
          "@endloop"
        ],
        { "site/_/data.json": SHELF }
      )
    );
    assert.equal(error.wd.code, "WD191", clause);
    assert.match(error.wd.hint, new RegExp(`^drop "${name}" from the clauses`), clause);
  }
});

test("WD191 still blames the SOURCE when the source is the reactive part", () => {
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
  assert.match(
    error.wd.hint,
    /^a static source \(a JSON file, a frontmatter list, or a collection\)/
  );
  assert.ok(!error.message.includes("The source is static"), error.message);
});
