// Compile-time image hardening. Bare markdown `![alt](src)` renders to a bare
// <img>, which (a) reflows the page as it decodes — cumulative layout shift,
// the literal "jump" on navigation — and (b) loads every image eagerly. The
// compiler now stamps intrinsic width/height (read from the file on disk),
// decoding="async" on all, fetchpriority="high" on the first (LCP candidate,
// eager), and loading="lazy" on the rest. Compile-time only — zero runtime JS.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// A minimal but valid PNG: signature + IHDR carrying the dimensions. image-size
// reads width/height from the IHDR, so this is enough for a dimension fixture.
function makePng(w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  return Buffer.concat([sig, ihdr]);
}

function project(pageBody, images = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-imgattrs-"));
  fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
  for (const [name, [w, h]] of Object.entries(images)) {
    fs.writeFileSync(path.join(root, "site/_", name), makePng(w, h));
  }
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pageBody);
  return compilePage(file, createPaths(root)).html;
}

// Pull the Nth <img ...> tag out of the page for focused assertions.
function img(html, n = 0) {
  const tags = html.match(/<img\b[^>]*>/g) || [];
  return tags[n] || "";
}

test("first image is the LCP candidate: width/height + fetchpriority=high + decoding=async, never lazy", () => {
  const html = project(
    ["![Hero](/__wd/media/hero.png)", "", "![Thumb](/__wd/media/thumb.png)"].join("\n"),
    { "hero.png": [640, 360], "thumb.png": [120, 80] }
  );
  const hero = img(html, 0);
  assert.match(hero, /width="640"/, "hero must carry intrinsic width");
  assert.match(hero, /height="360"/, "hero must carry intrinsic height");
  assert.match(hero, /fetchpriority="high"/, "hero is the LCP candidate");
  assert.match(hero, /decoding="async"/);
  assert.doesNotMatch(hero, /loading="lazy"/, "never lazy-load the LCP image");
});

test("subsequent images get width/height + loading=lazy + decoding=async", () => {
  const html = project(
    ["![Hero](/__wd/media/hero.png)", "", "![Thumb](/__wd/media/thumb.png)"].join("\n"),
    { "hero.png": [640, 360], "thumb.png": [120, 80] }
  );
  const thumb = img(html, 1);
  assert.match(thumb, /width="120"/);
  assert.match(thumb, /height="80"/);
  assert.match(thumb, /loading="lazy"/, "below-the-fold images lazy-load");
  assert.match(thumb, /decoding="async"/);
  assert.doesNotMatch(thumb, /fetchpriority/);
});

test("remote images are enhanced for loading but not measured (no disk read, no crash)", () => {
  const html = project(
    "![Hero](/__wd/media/hero.png)\n\n![Remote](https://cdn.example.com/x.png)",
    { "hero.png": [640, 360] }
  );
  const remote = img(html, 1);
  assert.match(remote, /decoding="async"/);
  assert.match(remote, /loading="lazy"/);
  assert.doesNotMatch(remote, /width=/, "cannot measure a remote file");
  assert.doesNotMatch(remote, /height=/);
});

test("a missing local file degrades gracefully — no dimensions, no throw", () => {
  const html = project("![Gone](/__wd/media/missing.png)");
  const gone = img(html, 0);
  assert.doesNotMatch(gone, /width=/);
  assert.doesNotMatch(gone, /height=/);
  assert.match(gone, /decoding="async"/, "still gets the safe attrs");
});

test("author-set sizing/loading is never clobbered", () => {
  // Raw HTML <img> with explicit width + loading; the compiler must respect it:
  // no auto height (would distort the author's width), keep loading as written.
  const html = project(
    '---\nhtml: true\n---\n\n<img src="/__wd/media/hero.png" width="50" loading="eager">',
    { "hero.png": [640, 360] }
  );
  const tag = img(html, 0);
  assert.match(tag, /width="50"/, "keep the author width");
  assert.doesNotMatch(tag, /height=/, "do not add a mismatched height when author sized it");
  assert.match(tag, /loading="eager"/);
  assert.doesNotMatch(tag, /loading="lazy"/);
});
