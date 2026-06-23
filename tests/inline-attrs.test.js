// Issue #18: attach a class/id to an inline element via a trailing {.class #id}
// block, so a link can be styled as a button without a wrapper container.
// The attr block must immediately follow the element (no space).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compileWd(lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-attrs-"));
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  return compilePage(file, createPaths(root)).html;
}

test("a trailing {.class} styles a link", () => {
  const html = compileWd(["[Get started](/start/){.btn}"]);
  assert.match(html, /<a [^>]*class="btn"[^>]*>Get started<\/a>/);
  assert.match(html, /href="\/start\/"/);
  assert.ok(!html.includes("{.btn}"), "attr block is consumed, not rendered as text");
});

test("multiple classes and an id attach to a link", () => {
  const html = compileWd(["[Go](/u/){.btn .lg #cta}"]);
  assert.match(html, /<a [^>]*>Go<\/a>/);
  assert.match(html, /class="btn lg"/);
  assert.match(html, /id="cta"/);
});

test("a trailing {.class} styles an image", () => {
  const html = compileWd(["![logo](/l.png){.brand}"]);
  assert.match(html, /<img [^>]*class="brand"[^>]*>/);
  assert.match(html, /src="\/l\.png"/);
  assert.match(html, /alt="logo"/);
});

test("a link with no attr block is unchanged", () => {
  const html = compileWd(["[Plain](/p/)"]);
  assert.match(html, /<a href="\/p\/">Plain<\/a>/);
  assert.ok(!/class=/.test(html));
});

test("an attr block separated by a space is NOT applied (stays literal)", () => {
  const html = compileWd(["[Go](/u/) {.btn}"]);
  assert.ok(!/<a [^>]*class="btn"/.test(html), "space breaks the association — no class on the link");
});
