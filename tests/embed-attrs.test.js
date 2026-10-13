// F4 — :embed attributes: `height=<css length>`, `aspect=<w>:<h>`, and a
// whitelisted `allow="token token"`. Defaults are byte-compatible with the
// pre-attribute output: no new attribute means the exact same HTML as before.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EMBED_ALLOW_TOKENS } from "../src/compiler/media.js";
import { compileDocument } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compile(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-embed-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  const pageFile = path.join(root, "site/pages/index.wd");
  fs.writeFileSync(pageFile, body);
  return compileDocument(pageFile, createPaths(root));
}

/** Capture the Error thrown by compiling `body` (asserts it throws). */
function thrownBy(body) {
  let err;
  try {
    compile(body);
  } catch (e) {
    err = e;
  }
  assert.ok(err, `expected "${body}" to throw`);
  return err;
}

test("an embed with no new attributes is byte-identical to before", () => {
  const doc = compile(":embed https://youtu.be/dQw4w9WgXcQ");
  assert.ok(
    doc.html.includes(
      '<div class="wd-embed" style="aspect-ratio:16/9">' +
        '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="YouTube video" ' +
        'loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ' +
        'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
        'allowfullscreen style="width:100%;height:100%;border:0"></iframe></div>'
    ),
    doc.html
  );
});

test("aspect=4:3 overrides the 16:9 ratio box", () => {
  const doc = compile(":embed https://youtu.be/dQw4w9WgXcQ aspect=4:3");
  assert.match(doc.html, /<div class="wd-embed" style="aspect-ratio:4\/3">/);
});

test("aspect accepts decimal ratios", () => {
  const doc = compile(":embed https://youtu.be/dQw4w9WgXcQ aspect=2.35:1");
  assert.match(doc.html, /style="aspect-ratio:2.35\/1">/);
});

test("height= pins the frame height, replacing the ratio box", () => {
  const doc = compile(":embed https://youtu.be/dQw4w9WgXcQ height=400px");
  assert.match(doc.html, /<div class="wd-embed" style="height:400px">/);
  assert.doesNotMatch(doc.html, /aspect-ratio/);
});

test("height accepts rem, em, vh, vw, and % lengths", () => {
  for (const height of ["24rem", "1.5em", "60vh", "50vw", "80%"]) {
    const doc = compile(`:embed https://youtu.be/dQw4w9WgXcQ height=${height}`);
    assert.match(doc.html, new RegExp(`style="height:${height.replace("%", "\\%")}">`));
  }
});

test("height wins over aspect when both are given", () => {
  const doc = compile(":embed https://youtu.be/dQw4w9WgXcQ aspect=4:3 height=300px");
  assert.match(doc.html, /style="height:300px">/);
  assert.doesNotMatch(doc.html, /aspect-ratio/);
});

test("allow= replaces the default permission set with whitelisted tokens", () => {
  const doc = compile(':embed https://example.com/pay allow="payment clipboard-write"');
  assert.match(doc.html, /allow="payment; clipboard-write"/);
  assert.doesNotMatch(doc.html, /gyroscope/, "the default permission set is replaced");
  // The iframe keeps its standalone allowfullscreen attribute.
  assert.match(doc.html, /allowfullscreen/);
});

test("allow= accepts a single unquoted token", () => {
  const doc = compile(":embed https://example.com/x allow=autoplay");
  assert.match(doc.html, /allow="autoplay"/);
});

test("allow= accepts every whitelisted token together", () => {
  const doc = compile(`:embed https://example.com/x allow="${EMBED_ALLOW_TOKENS.join(" ")}"`);
  assert.match(doc.html, new RegExp(`allow="${EMBED_ALLOW_TOKENS.join("; ")}"`));
});

test('an empty allow="" strips all iframe permissions', () => {
  const doc = compile(':embed https://example.com/x allow=""');
  assert.match(doc.html, /allow=""/);
});

test("an unknown allow token is a WD706 compile error naming the whitelist", () => {
  const err = thrownBy(':embed https://example.com/x allow="payment blink"');
  assert.equal(err.wd.code, "WD706");
  assert.match(err.message, /Unknown :embed allow token "blink"/);
  assert.match(err.message, /payment/);
  assert.match(err.message, /geolocation/);
});

test("a malformed aspect ratio is a WD707 compile error", () => {
  for (const aspect of ["wide", "4:", ":3", "4x3"]) {
    const err = thrownBy(`:embed https://youtu.be/dQw4w9WgXcQ aspect=${aspect}`);
    assert.equal(err.wd.code, "WD707", aspect);
    assert.match(err.message, /Invalid :embed aspect/);
  }
});

test("a height that is not a CSS length is a WD707 compile error", () => {
  for (const height of ["auto", "10", "10pxx", "calc(100%_-_1rem)"]) {
    const err = thrownBy(`:embed https://youtu.be/dQw4w9WgXcQ height=${height}`);
    assert.equal(err.wd.code, "WD707", height);
    assert.match(err.message, /Invalid :embed height/);
  }
});

test("an attribute outside title/height/aspect/allow is still WD705", () => {
  const err = thrownBy(':embed https://youtu.be/dQw4w9WgXcQ caption="hi"');
  assert.equal(err.wd.code, "WD705");
  assert.match(err.message, /Unknown :embed attribute "caption"/);
});

test("title, sizing, and allow compose on one line", () => {
  const doc = compile(
    ':embed https://vimeo.com/76979871 title="Demo" aspect=21:9 allow="fullscreen picture-in-picture"'
  );
  assert.match(doc.html, /style="aspect-ratio:21\/9">/);
  assert.match(doc.html, /title="Demo"/);
  assert.match(doc.html, /allow="fullscreen; picture-in-picture"/);
  assert.equal(doc.assets.runtime, false, "embeds stay compile-time only");
});
