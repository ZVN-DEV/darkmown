import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage, parseFrontmatter } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// parseFrontmatter — inline flow arrays (scalar behavior otherwise unchanged)
// ---------------------------------------------------------------------------

test("inline array frontmatter parses to a real array", () => {
  const { meta } = parseFrontmatter("---\ntags: [sales, revenue]\n---\nbody");
  assert.deepEqual(meta.tags, ["sales", "revenue"]);
});

test("empty, single, and quoted-with-comma array items", () => {
  assert.deepEqual(parseFrontmatter("---\ntags: []\n---\n").meta.tags, []);
  assert.deepEqual(parseFrontmatter("---\ntags: [solo]\n---\n").meta.tags, ["solo"]);
  // a quoted item keeps its internal comma; quotes are stripped
  assert.deepEqual(parseFrontmatter('---\ntags: ["a, b", c]\n---\n').meta.tags, ["a, b", "c"]);
});

test("a scalar field beside an array field both parse correctly", () => {
  const { meta } = parseFrontmatter("---\ntitle: Hello\ntags: [x, y]\n---\n");
  assert.equal(meta.title, "Hello");
  assert.deepEqual(meta.tags, ["x", "y"]);
});

test("scalars without a leading bracket keep their existing behavior", () => {
  const { meta } = parseFrontmatter('---\ntitle: "Quoted Title"\ncount: 3\nresource: bq://t\n---\n');
  assert.equal(meta.title, "Quoted Title");
  assert.equal(meta.count, "3"); // still a string — no numeric coercion
  assert.equal(meta.resource, "bq://t"); // a bracket-free scalar is untouched
});

test("an unbalanced bracket stays a scalar string", () => {
  const { meta } = parseFrontmatter("---\nweird: [not closed\n---\n");
  assert.equal(meta.weird, "[not closed");
});

// ---------------------------------------------------------------------------
// meta is readable in the page body (interpolation + loops), build-time only
// ---------------------------------------------------------------------------

test("{ meta.field } interpolates a frontmatter scalar in the body", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "subtitle: From frontmatter", "---", "<main>", "", "Note: { meta.subtitle }", "", "</main>"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Note: From frontmatter/);
  assert.equal(page.assets.runtime, false);
});

test("{ meta.tags } renders an array joined with ', '", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "tags: [sales, revenue, ops]", "---", "<main>", "", "Tags: { meta.tags }", "", "</main>"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Tags: sales, revenue, ops/);
  assert.equal(page.assets.runtime, false);
});

test("@loop over a frontmatter array unrolls at build time and stays static", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    "---",
    "tags: [alpha, beta]",
    "---",
    "<main>",
    "",
    "@loop meta.tags into tag",
    "- { tag }",
    "@endloop",
    "",
    "</main>"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<li>alpha<\/li>/);
  assert.match(page.html, /<li>beta<\/li>/);
  assert.equal(page.assets.runtime, false, "looping a frontmatter array must stay zero-JS");
  assert.doesNotMatch(page.html, /data-wd-loop/);
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-frontmatter-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
