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
  const content = html.slice(html.indexOf("<main"));
  assert.ok(!/class=/.test(content));
});

test("an attr block separated by a space is NOT applied (stays literal)", () => {
  const html = compileWd(["[Go](/u/) {.btn}"]);
  assert.ok(
    !/<a [^>]*class="btn"/.test(html),
    "space breaks the association — no class on the link"
  );
});

// --- sizes="…" on images (2.12) --------------------------------------------
// The srcset variant wiring never invents a sizes value, so the author sets it
// in the attr block. It is image-only, quoted, and passes through with or
// without a srcset.

test("sizes on an image is emitted verbatim, spaces and all", () => {
  const html = compileWd(['![hero](/h.jpg){sizes="(max-width: 640px) 100vw, 640px"}']);
  assert.match(html, /<img [^>]*sizes="\(max-width: 640px\) 100vw, 640px"[^>]*>/);
  assert.ok(!html.includes("{sizes="), "attr block is consumed, not rendered as text");
});

test("sizes without any variants still passes through (no srcset invented)", () => {
  const html = compileWd(['![hero](/h.jpg){sizes="50vw"}']);
  const tag = html.match(/<img\b[^>]*>/)?.[0] ?? "";
  assert.match(tag, /sizes="50vw"/);
  assert.doesNotMatch(tag, /srcset/, "sizes alone must not conjure a srcset");
});

test("the sizes value is HTML-escaped into the attribute", () => {
  const html = compileWd(['![hero](/h.jpg){sizes="a<b&c"}']);
  assert.match(html, /sizes="a&lt;b&amp;c"/);
});

test("sizes composes with class and id on the same image", () => {
  const html = compileWd(['![logo](/l.png){.brand #mark sizes="100vw"}']);
  const tag = html.match(/<img\b[^>]*>/)?.[0] ?? "";
  assert.match(tag, /class="brand"/);
  assert.match(tag, /id="mark"/);
  assert.match(tag, /sizes="100vw"/);
});

test("sizes is image-only: ignored on a link target", () => {
  const html = compileWd(['[Go](/u/){sizes="100vw"}']);
  assert.match(html, /<a href="\/u\/">Go<\/a>/);
  assert.doesNotMatch(html, /sizes=/, "a link never gains a sizes attribute");
});

test("an unknown attribute still does not apply: the block stays literal text", () => {
  const html = compileWd(['![logo](/l.png){foo="x"}']);
  const tag = html.match(/<img\b[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(tag, /foo=/);
  assert.ok(html.includes("{foo="), "an unrecognized block renders as text, as before");
});

test("a raw-HTML <img> is author territory: sizes as authored, no srcset added", () => {
  const html = compileWd([
    "---",
    "html: true",
    "---",
    '<main><img src="/x.jpg" alt="x" sizes="(max-width: 640px) 100vw, 640px"></main>'
  ]);
  const tag = html.match(/<img\b[^>]*>/)?.[0] ?? "";
  assert.match(tag, /sizes="\(max-width: 640px\) 100vw, 640px"/);
  assert.doesNotMatch(tag, /srcset/);
});
