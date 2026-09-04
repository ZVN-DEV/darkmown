// Static-unroll block stitching, row keys, and sort stability.
//
// A static `@loop` compiles each row body as its OWN markdown document, so a row
// whose body is a single list item or table row used to close its own
// `<ul>`/`<ol>`/`<table>`: three rows produced three lists, three "1."s, and
// three tables. `joinRows` splices those back together at the row seam, so the
// flagship zero-JS path emits the list, the numbering, and the table an author
// actually wrote. Every other body shape must stay byte-identical.

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

// ---------------------------------------------------------------------------
// P2-16: one list, one correctly numbered list, one table
// ---------------------------------------------------------------------------

test("a static @loop of bullet rows produces ONE <ul>, not one per row", () => {
  const html = main(["---", "ps: [a, b, c]", "---", "@loop meta.ps into p", "- { p }", "@endloop"]);
  assert.equal((html.match(/<ul>/g) || []).length, 1, `expected one <ul>, got:\n${html}`);
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.match(html, /<ul>\n<li>a<\/li>\n<li>b<\/li>\n<li>c<\/li>\n<\/ul>/);
});

test("a static @loop of ordered rows numbers 1,2,3 instead of 1,1,1", () => {
  const html = main([
    "---",
    "ps: [a, b, c]",
    "---",
    "@loop meta.ps into p",
    "1. { p }",
    "@endloop"
  ]);
  // Three separate <ol>s all restart at 1; one <ol> with three items numbers
  // them 1, 2, 3 — which is the whole point of an ordered list.
  assert.equal((html.match(/<ol>/g) || []).length, 1, `expected one <ol>, got:\n${html}`);
  assert.match(html, /<ol>\n<li>a<\/li>\n<li>b<\/li>\n<li>c<\/li>\n<\/ol>/);
});

test("a static @loop of table rows produces ONE table with all rows in one tbody", () => {
  const html = main([
    "---",
    "ps: [a, b, c]",
    "---",
    "@loop meta.ps into p",
    "| N |",
    "|---|",
    "| { p } |",
    "@endloop"
  ]);
  assert.equal((html.match(/<table>/g) || []).length, 1, `expected one <table>, got:\n${html}`);
  assert.equal((html.match(/<tbody>/g) || []).length, 1);
  assert.equal((html.match(/<th>N<\/th>/g) || []).length, 1, "one header, not one per row");
  for (const cell of ["a", "b", "c"]) assert.match(html, new RegExp(`<td>${cell}</td>`));
});

test("a per-row table header keeps each row its own table (no header is lost)", () => {
  // The header interpolates the row, so the two tables are genuinely different
  // tables — splicing them would silently drop every header but the first.
  const html = main([
    "---",
    "ps: [a, b]",
    "---",
    "@loop meta.ps into p",
    "| { p } |",
    "|---|",
    "| x |",
    "@endloop"
  ]);
  assert.equal((html.match(/<table>/g) || []).length, 2, `expected two tables, got:\n${html}`);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<th>b<\/th>/);
});

test("a row body that is not a spliceable block still joins with a newline", () => {
  // The fallback path: ordinary prose rows are byte-identical to the pre-splice
  // output, so no existing static page changes shape.
  const html = main(["---", "ps: [a, b]", "---", "@loop meta.ps into p", "row { p }", "@endloop"]);
  assert.equal(html, "<p>row a</p>\n\n<p>row b</p>");
});

test("a single-row static loop is unchanged by the splice", () => {
  const html = main(["---", "ps: [only]", "---", "@loop meta.ps into p", "- { p }", "@endloop"]);
  assert.match(html, /^<ul>\n<li>only<\/li>\n<\/ul>$/);
});

test("an empty static loop with no @empty branch renders nothing", () => {
  const html = main(["---", "ps: []", "---", "@loop meta.ps into p", "- { p }", "@endloop"]);
  assert.equal(html, "");
});

test("a nested directive inside a spliced list row still compiles", () => {
  // Rows that contain directives must keep working: the `:if` folds per row and
  // the surviving <li>s still land in one list.
  const html = main([
    "---",
    "ps: [a, b]",
    "---",
    "@loop meta.ps into p",
    "- { p } is { $number } of { $count }",
    "@endloop"
  ]);
  assert.equal((html.match(/<ul>/g) || []).length, 1);
  assert.match(html, /<li>a is 1 of 2<\/li>/);
  assert.match(html, /<li>b is 2 of 2<\/li>/);
});

test("a header-only table row body is left alone (there is no tbody to splice)", () => {
  const html = main([
    "---",
    "ps: [a, b]",
    "---",
    "@loop meta.ps into p",
    "| { p } |",
    "|---|",
    "@endloop"
  ]);
  // markdown-it emits no <tbody> for a table with no data rows, so there is
  // nothing to concatenate and each row keeps its own table.
  assert.equal((html.match(/<table>/g) || []).length, 2);
  assert.doesNotMatch(html, /<tbody>/);
});
