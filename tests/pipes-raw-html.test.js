// Format pipes inside raw HTML (`html: true` pages).
//
// `{ name }` in a raw-HTML attribute or html block resolves through
// `fillRawHtml` (src/compiler/markdown.js), a separate path from the inline
// `wd_binding` rule that handles prose. The raw-HTML brace matcher used to
// accept only a bare path, so `{ post.date | date:"medium" }` — which folds in
// prose — shipped literally (braces, pipe and all) in raw HTML. The matcher now
// accepts the same path-plus-pipe-chain shape the inline rule does, so a static
// value folds identically in every position, and a reactive value takes the
// existing "raw HTML cannot bind" warning instead of failing silently.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCollections } from "../src/compiler/collections.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";
import { discoverRoutes } from "../src/router.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-pipes-raw-html-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function compile(root, file = "site/pages/index.wd") {
  return compilePage(path.join(root, file), createPaths(root));
}

// --- Static loops: pipes fold in raw-HTML bodies ----------------------------

test("repro: a static collection loop folds pipes in a raw-HTML card body", () => {
  const root = fixture();
  write(root, "site/pages/blog/aurora.md", "---\ntitle: Aurora\ndate: 2026-06-22\n---\nBody.");
  write(root, "site/pages/blog/briza.md", "---\ntitle: Briza\ndate: 2026-06-23\n---\nBody.");
  const paths = createPaths(root);
  const collections = buildCollections(discoverRoutes(paths.routesRoot), paths);
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: Home",
      "html: true",
      "---",
      "",
      "@loop blog into post sort by post.date desc",
      '<div class="card">',
      "<h2>{ post.title }</h2>",
      '<p>{ post.date | date:"medium" }</p>',
      "</div>",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), paths, { collections });
  assert.match(page.html, /<h2>Briza<\/h2>/);
  assert.match(page.html, /<p>Jun 23, 2026<\/p>/);
  assert.match(page.html, /<p>Jun 22, 2026<\/p>/);
  assert.ok(!page.html.includes("{ post."), "no braces left literal");
  assert.equal(page.assets.runtime, false, "a static loop stays zero-JS");
});

test("a static JSON-file loop folds pipes in a raw-HTML body", () => {
  const root = fixture();
  write(
    root,
    "site/_/products.json",
    JSON.stringify([
      { name: "Aurora", price: 89 },
      { name: "Briza", price: 42.5 }
    ])
  );
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: Shop",
      "html: true",
      "---",
      "",
      "@loop /products.json into p",
      '<div class="row"><span>{ p.name | upper }</span><b>{ p.price | money }</b></div>',
      "@endloop"
    ].join("\n")
  );
  const page = compile(root);
  assert.match(page.html, /<span>AURORA<\/span>/);
  assert.match(page.html, /<b>\$89\.00<\/b>/);
  assert.match(page.html, /<b>\$42\.50<\/b>/);
  assert.equal(page.assets.runtime, false);
});

test("a loop over an in-scope frontmatter array folds pipes in raw HTML", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: Team",
      "html: true",
      "members: [ada, grace]",
      "---",
      "",
      "@loop meta.members into m",
      "<p>{ m | capitalize }</p>",
      "@endloop"
    ].join("\n")
  );
  const page = compile(root);
  assert.match(page.html, /<p>Ada<\/p>/);
  assert.match(page.html, /<p>Grace<\/p>/);
  assert.ok(!page.html.includes("{ m |"), "no pipe left literal");
});

test("pipe chains with literal args fold in raw HTML, HTML-escaped", () => {
  const root = fixture();
  write(root, "site/_/rows.json", JSON.stringify([{ name: "  a<b  ", price: 5 }]));
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: X",
      "html: true",
      "---",
      "",
      "@loop /rows.json into r",
      '<div title="{ r.name | trim | upper }">{ r.price | money:"EUR" }</div>',
      "@endloop"
    ].join("\n")
  );
  const page = compile(root);
  // trim → upper folds to "A<B", then the raw-HTML fill escapes for output.
  assert.match(page.html, /title="A&lt;B"/);
  assert.match(page.html, />€5\.00</);
});

// --- Static non-loop raw HTML: same code path -------------------------------

test("a static page-level value with a pipe folds in raw HTML too", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: hello darkmown",
      "html: true",
      "---",
      "",
      "<div>{ meta.title | upper }</div>"
    ].join("\n")
  );
  const page = compile(root);
  assert.match(page.html, /<div>HELLO DARKMOWN<\/div>/);
});

// --- Reactive values: the existing cannot-bind warning covers pipes ----------

test("a :state value with a pipe in raw HTML paints the folded seed and warns", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: X",
      "html: true",
      "---",
      "",
      ":state count = 49",
      "",
      "<div>{ count | money }</div>"
    ].join("\n")
  );
  const page = compile(root);
  assert.match(page.html, /<div>\$49\.00<\/div>/, "the folded seed is painted once");
  assert.equal(page.warnings.length, 1);
  assert.match(page.warnings[0], /"\{ count \| money \}" is reactive/);
  assert.match(page.warnings[0], /raw HTML \(an attribute or an html block\) cannot bind/);
  assert.match(page.warnings[0], /never updates/);
});

test("a reactive @loop row with a pipe in raw HTML stays literal and warns", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: X",
      "html: true",
      "---",
      "",
      ':state items = [{"name": "ada"}]',
      "",
      "@loop items into item",
      "<div>{ item.name | upper }</div>",
      "@endloop"
    ].join("\n")
  );
  const page = compile(root);
  assert.ok(
    page.html.includes("{ item.name | upper }"),
    "one template serves every row, so nothing can fold"
  );
  assert.equal(page.warnings.length, 1);
  assert.match(page.warnings[0], /"\{ item\.name \| upper \}" is reactive/);
  assert.match(page.warnings[0], /raw HTML \(an attribute or an html block\) cannot bind/);
  assert.match(page.warnings[0], /stays literal text/);
});

// --- Guards ------------------------------------------------------------------

test("an unknown pipe in raw HTML is a compile error listing the valid names", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "title: X", "html: true", "---", "", "<div>{ meta.title | shout }</div>"].join("\n")
  );
  assert.throws(() => compile(root), /Unknown formatter "shout".*Available: .*money.*upper/s);
});

test("a pipe expression inside a fenced code block is never rewritten", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "title: X",
      "html: true",
      "---",
      "",
      "```html",
      "<div>{ meta.title | upper }</div>",
      "```"
    ].join("\n")
  );
  const page = compile(root);
  assert.ok(page.html.includes("{ meta.title | upper }"), "fenced code stays literal");
  assert.ok(!page.html.includes("HELLO"), "nothing folded inside the fence");
});

test("a pipe expression inside an inline code span is never rewritten", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "title: X", "html: true", "---", "", "Use `{ meta.title | upper }` to shout."].join(
      "\n"
    )
  );
  const page = compile(root);
  assert.match(page.html, /<code>\{ meta\.title \| upper \}<\/code>/);
});

test("a name that is not in scope stays literal in raw HTML, pipe or not", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "title: X", "html: true", "---", "", "<div>{ ghost | upper }</div>"].join("\n")
  );
  const page = compile(root);
  assert.ok(page.html.includes("{ ghost | upper }"), "the author's text is left alone");
  assert.equal(page.warnings.length, 0);
});
