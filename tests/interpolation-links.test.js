// Issue #19: { } interpolation should resolve inside markdown link / image
// destinations so a build-time @loop can emit dynamic hrefs/srcs. Static
// (build-time) values only — the page must stay zero-JS.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compileWithShelf(pageLines, shelf = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-interp-"));
  const page = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, pageLines.join("\n"));
  const shelfDir = path.join(root, "site/_");
  fs.mkdirSync(shelfDir, { recursive: true });
  for (const [name, value] of Object.entries(shelf)) {
    fs.writeFileSync(path.join(shelfDir, name), JSON.stringify(value));
  }
  return compilePage(page, createPaths(root)).html;
}

test("@loop interpolates item values into a markdown link destination", () => {
  const html = compileWithShelf(
    ["@loop /items.json into it", "- [{ it.name }]({ it.url })", "@endloop"],
    { "items.json": [{ name: "Aurora", url: "/p/aurora/" }, { name: "Briza", url: "/p/briza/" }] }
  );
  assert.match(html, /<a href="\/p\/aurora\/">Aurora<\/a>/);
  assert.match(html, /<a href="\/p\/briza\/">Briza<\/a>/);
});

test("@loop interpolates item values into an image src", () => {
  const html = compileWithShelf(
    ["@loop /items.json into it", "![photo]({ it.img })", "@endloop"],
    { "items.json": [{ img: "/media/a.png" }] }
  );
  assert.match(html, /<img src="\/media\/a\.png" alt="photo">/);
});

test("a build-time loop driving link hrefs stays static (no runtime markers)", () => {
  const html = compileWithShelf(
    ["@loop /items.json into it", "- [{ it.name }]({ it.url })", "@endloop"],
    { "items.json": [{ name: "Aurora", url: "/p/aurora/" }] }
  );
  assert.ok(!/data-wd-/.test(html), "no reactive data-wd-* markers in a static loop");
});

test("interpolation resolves in a link destination from include/frontmatter scope", () => {
  const html = compileWithShelf([
    "---",
    "url: /from/meta/",
    "---",
    "[Go]({ meta.url })",
  ]);
  assert.match(html, /<a href="\/from\/meta\/">Go<\/a>/);
});

test("a destination interpolation with a title still forms the link", () => {
  const html = compileWithShelf(
    ["@loop /items.json into it", '[{ it.name }]({ it.url } "Profile")', "@endloop"],
    { "items.json": [{ name: "Aurora", url: "/p/aurora/" }] }
  );
  assert.match(html, /<a href="\/p\/aurora\/" title="Profile">Aurora<\/a>/);
});
