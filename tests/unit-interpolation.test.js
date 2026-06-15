import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage, escapeHtml, loopKeyOf } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Interpolation `{ name.path }` resolution priority + the pure helpers
// escapeHtml and loopKeyOf.
// ---------------------------------------------------------------------------

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-interp-"));
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

// --- Priority order: loop item → static scope → declared state → literal -----

test("a loop item shadows a same-named :state (loop item wins)", () => {
  // `item` exists both as :state and as the loop variable. Inside the loop,
  // { item } must resolve to the per-row each-binding, not the state bind.
  const root = fixture();
  write(root, "site/_/rows.json", JSON.stringify([{ id: 1, label: "row" }]));
  write(root, "site/pages/index.wd", [
    ':state item = "STATE"',
    "@loop /rows.json into item",
    "- { item.label }",
    "@endloop"
  ].join("\n"));
  // /rows.json is a static source so the loop unrolls; { item.label } resolves
  // to the row's value ("row"), never the :state string. The state declaration
  // still emits its JSON block, but { item.label } never reads it.
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<li>row<\/li>/);
  assert.doesNotMatch(page.html, /<li>STATE<\/li>/);
  assert.doesNotMatch(page.html, /data-wd-bind="item"/);
});

test("static include-arg scope wins over a declared :state of the same name", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state title = "FROM_STATE"',
    '@include /card.wd with title="FROM_ARG"'
  ].join("\n"));
  write(root, "site/_/card.wd", "Title is { title }");
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  // Inside the include, the static arg shadows the outer :state: the rendered
  // prose reads the arg, not a reactive bind to the state of the same name.
  assert.match(page.html, /Title is FROM_ARG/);
  assert.doesNotMatch(page.html, /Title is <span data-wd-bind="title">/);
});

test("declared :state wins over a literal fallback", () => {
  const page = compile([
    ":state count = 7",
    "Total: { count }"
  ]);
  assert.match(page.html, /Total: <span data-wd-bind="count">7<\/span>/);
});

test("an unresolved name falls through to literal text and stays static", () => {
  const page = compile("Hello { stranger } and { a.b }");
  assert.match(page.html, /Hello \{ stranger \} and \{ a\.b \}/);
  assert.equal(page.assets.runtime, false);
});

test("static scope arrays render joined with ', ' while state arrays bind reactively", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "---",
    "tags: [a, b, c]",
    "---",
    "<main>",
    "",
    "Static: { meta.tags }",
    "",
    "</main>"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Static: a, b, c/);
  assert.equal(page.assets.runtime, false);
});

// --- escapeHtml — all five entities, including the single quote --------------

test("escapeHtml escapes &, <, >, double-quote, and single-quote", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("escapeHtml escapes ampersand first so entities are not double-encoded oddly", () => {
  // & must become &amp; and the < after it must independently become &lt;.
  assert.equal(escapeHtml("a & b < c"), "a &amp; b &lt; c");
});

test("escapeHtml coerces non-string input to string", () => {
  assert.equal(escapeHtml(0), "0");
  assert.equal(escapeHtml(false), "false");
  assert.equal(escapeHtml(42), "42");
});

test("interpolated state values are HTML-escaped in the bound span", () => {
  const page = compile([
    ':state note = "<b>tag</b> & more"',
    "Note: { note }"
  ]);
  // The raw markup never survives unescaped inside the span.
  assert.doesNotMatch(page.html, /<span data-wd-bind="note"><b>/);
  assert.match(page.html, /<span data-wd-bind="note">&lt;b&gt;tag&lt;\/b&gt; &amp; more<\/span>/);
});

// --- loopKeyOf — id/key/JSON fallback + duplicate suffixing ------------------

test("loopKeyOf prefers object.id, then object.key, then JSON of the object", () => {
  assert.equal(loopKeyOf({ id: 5, key: "k" }, new Map()), "5");
  assert.equal(loopKeyOf({ key: "k" }, new Map()), "k");
  assert.equal(loopKeyOf({ a: 1 }, new Map()), JSON.stringify({ a: 1 }));
});

test("loopKeyOf stringifies primitive items directly", () => {
  assert.equal(loopKeyOf("apple", new Map()), "apple");
  assert.equal(loopKeyOf(3, new Map()), "3");
});

test("loopKeyOf disambiguates duplicate keys with a #N suffix", () => {
  const counts = new Map();
  assert.equal(loopKeyOf({ id: 1 }, counts), "1");
  assert.equal(loopKeyOf({ id: 1 }, counts), "1#1");
  assert.equal(loopKeyOf({ id: 1 }, counts), "1#2");
  // a different key starts its own counter
  assert.equal(loopKeyOf({ id: 2 }, counts), "2");
});

test("loopKeyOf duplicate suffixing shows up in rendered reactive loop keys", () => {
  const page = compile([
    ':state items = ["dup", "dup"]',
    "@loop items into item",
    "- { item }",
    "@endloop"
  ]);
  assert.match(page.html, /data-wd-loop-key="dup">/);
  assert.match(page.html, /data-wd-loop-key="dup#1">/);
});
