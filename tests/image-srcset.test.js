// Responsive image variants via the `@width` convention (2.8.0, A2).
//
// Darkmown has no image pipeline (no resize dependency), so the compiler WIRES
// variants the author already made: next to `/doctors/dr-x.webp` sit
// `dr-x@640.webp`, `dr-x@1280.webp` (same directory, same extension, `@<width>`
// before it). When at least one exists, the markdown image gains a srcset:
// variants ascending by MEASURED intrinsic width (the filename width is only a
// fallback when the bytes cannot be read), then the original at its intrinsic
// width when that is known. The original stays the `src` fallback.
//
// Discovery probes a fixed list of common widths through the injected reader
// (the Reader contract has no directory listing), so both the real filesystem
// and `compileFromMemory` resolve the convention — and an off-list width is a
// documented miss, never an error.
//
// Also pinned here: the load-priority contract the srcset composes with
// (first image eager + fetchpriority="high", the rest lazy + decoding="async"),
// the byte-identical output when no variants exist, and the skips — a bound
// src the runtime repaints, remote/data/query sources, and raw-HTML <img>.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { compileFromMemory } from "../src/compiler/index.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

/** Latin-1 string → bytes. */
function bytes(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

/** A minimal but valid extended WebP (VP8X) carrying the given canvas size. */
function makeWebp(w, h) {
  const b = new Uint8Array(30);
  const view = new DataView(b.buffer);
  b.set(bytes("RIFF"), 0);
  view.setUint32(4, 22, true);
  b.set(bytes("WEBP"), 8);
  b.set(bytes("VP8X"), 12);
  view.setUint32(16, 10, true);
  const put24 = (at, v) => {
    b[at] = v & 0xff;
    b[at + 1] = (v >> 8) & 0xff;
    b[at + 2] = (v >> 16) & 0xff;
  };
  put24(24, w - 1);
  put24(27, h - 1);
  return b;
}

/**
 * A temp project with one page and image fixtures under `site/pages/`.
 * `files` maps a path relative to `site/pages` to [width, height] (a real VP8X
 * fixture is written) or to a Uint8Array (written verbatim — the garbage-bytes
 * case). Returns the compiled page HTML.
 */
function project(pageBody, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-srcset-"));
  for (const [name, contents] of Object.entries(files)) {
    const abs = path.join(root, "site/pages", name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Array.isArray(contents) ? makeWebp(...contents) : contents);
  }
  const file = path.join(root, "site/pages/index.wd");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pageBody);
  return compilePage(file, createPaths(root)).html;
}

/** Pull the Nth <img ...> tag out of the page for focused assertions. */
function img(html, n = 0) {
  const tags = html.match(/<img\b[^>]*>/g) || [];
  return tags[n] || "";
}

test("variants wire a srcset: measured widths ascending, then the original at its intrinsic width", () => {
  const html = project("![Dr X](/doctors/dr-x.webp)", {
    "doctors/dr-x.webp": [2400, 1600],
    "doctors/dr-x@640.webp": [600, 400], // a @640 file really holding 600px says 600w
    "doctors/dr-x@1280.webp": [1280, 853]
  });
  const tag = img(html, 0);
  assert.match(tag, /src="\/doctors\/dr-x\.webp"/, "the original stays the src fallback");
  assert.match(
    tag,
    /srcset="\/doctors\/dr-x@640\.webp 600w, \/doctors\/dr-x@1280\.webp 1280w, \/doctors\/dr-x\.webp 2400w"/
  );
});

test("the srcset is sorted by measured width — an original narrower than a variant sorts between them", () => {
  const html = project("![Dr X](/doctors/dr-x.webp)", {
    "doctors/dr-x.webp": [1000, 667],
    "doctors/dr-x@640.webp": [640, 427],
    "doctors/dr-x@1280.webp": [1280, 853]
  });
  assert.match(
    img(html, 0),
    /srcset="\/doctors\/dr-x@640\.webp 640w, \/doctors\/dr-x\.webp 1000w, \/doctors\/dr-x@1280\.webp 1280w"/
  );
});

test("a variant whose bytes cannot be parsed falls back to the width in its filename", () => {
  const html = project("![Dr X](/doctors/dr-x.webp)", {
    "doctors/dr-x.webp": [2400, 1600],
    "doctors/dr-x@640.webp": new Uint8Array([1, 2, 3, 4, 5]) // not an image at all
  });
  assert.match(
    img(html, 0),
    /srcset="\/doctors\/dr-x@640\.webp 640w, \/doctors\/dr-x\.webp 2400w"/
  );
});

test("compileFromMemory wires variants from the in-memory map (filename widths; the unmeasurable original is omitted)", () => {
  const page = compileFromMemory(
    {
      "site/pages/index.wd": "---\ntitle: T\n---\n\n![a](/img/x.webp)\n",
      "site/pages/img/x.webp": "placeholder",
      "site/pages/img/x@1280.webp": "placeholder",
      "site/pages/img/x@640.webp": "placeholder"
    },
    "site/pages/index.wd"
  );
  assert.match(
    img(page.html, 0),
    /<img src="\/img\/x\.webp" alt="a" srcset="\/img\/x@640\.webp 640w, \/img\/x@1280\.webp 1280w"/,
    "probe order (640 before 1280 in the map is irrelevant) — output is ascending"
  );
});

test("the first image stays eager with variants wired; the second lazy-loads", () => {
  const html = project("![a](/img/x.webp)\n\n![b](/img/y.webp)", {
    "img/x.webp": [2400, 1600],
    "img/x@640.webp": [640, 427],
    "img/y.webp": [1200, 800]
  });
  const first = img(html, 0);
  assert.match(first, /srcset="\/img\/x@640\.webp 640w, \/img\/x\.webp 2400w"/);
  assert.doesNotMatch(first, /loading="lazy"/, "the LCP candidate is never lazy");
  assert.match(first, /fetchpriority="high"/);
  assert.match(first, /decoding="async"/);
  const second = img(html, 1);
  assert.match(second, /loading="lazy"/);
  assert.match(second, /decoding="async"/);
  assert.doesNotMatch(second, /srcset/, "y.webp has no variants");
});

test("no variants anywhere: the <img> tag is byte-identical to before the feature", () => {
  const html = project("![a](/img/x.webp)", { "img/x.webp": [640, 360] });
  assert.equal(
    img(html, 0),
    '<img src="/img/x.webp" alt="a" width="640" height="360" decoding="async" fetchpriority="high">'
  );
});

test("an author-set sizes coexists with the wired srcset on one img", () => {
  const html = project('![a](/img/x.webp){sizes="(max-width: 640px) 100vw, 640px"}', {
    "img/x.webp": [2400, 1600],
    "img/x@640.webp": [640, 427]
  });
  const tag = img(html, 0);
  assert.match(tag, /srcset="\/img\/x@640\.webp 640w, \/img\/x\.webp 2400w"/);
  assert.match(
    tag,
    /sizes="\(max-width: 640px\) 100vw, 640px"/,
    "the author's sizes rides alongside the srcset the variants added"
  );
});

test("a raw-HTML <img> is author territory: never probed, never given a srcset", () => {
  const html = project('---\nhtml: true\n---\n\n<img src="/img/x.webp" alt="a">', {
    "img/x.webp": [2400, 1600],
    "img/x@640.webp": [640, 427]
  });
  assert.doesNotMatch(img(html, 0), /srcset/);
});

test("a bound src is repainted by the runtime, so no build-time srcset is baked from the seed", () => {
  const html = project('---\ntitle: T\n---\n\n:state photo = "/img/x.webp"\n\n![a]({ photo })', {
    "img/x.webp": [2400, 1600],
    "img/x@640.webp": [640, 427]
  });
  const tag = img(html, 0);
  assert.match(tag, /data-wd-attr=/, "sanity: the src really is bound");
  assert.doesNotMatch(tag, /srcset/);
});

test("a per-row bound src in a reactive loop is skipped too", () => {
  const html = project(
    '---\ntitle: T\n---\n\n:state items = [{"photo": "/img/x.webp"}]\n\n@loop items into p\n![a]({ p.photo })\n@endloop',
    { "img/x.webp": [2400, 1600], "img/x@640.webp": [640, 427] }
  );
  const tag = img(html, 0);
  assert.match(tag, /data-wd-each-attr=/, "sanity: the src really is row-bound");
  assert.doesNotMatch(tag, /srcset/);
});

test("the same image referenced twice probes the reader once and wires both tags", () => {
  const html = project("![a](/img/x.webp)\n\n![b](/img/x.webp)", {
    "img/x.webp": [2400, 1600],
    "img/x@640.webp": [640, 427]
  });
  for (const n of [0, 1]) {
    assert.match(img(html, n), /srcset="\/img\/x@640\.webp 640w, \/img\/x\.webp 2400w"/);
  }
});

test("shelf media resolves variants against site/_ and keeps the /__wd/media/ public path", () => {
  const page = compileFromMemory(
    {
      "site/pages/index.wd": "---\ntitle: T\n---\n\n![a](/__wd/media/team/x.webp)\n",
      "site/_/team/x.webp": "placeholder",
      "site/_/team/x@640.webp": "placeholder"
    },
    "site/pages/index.wd"
  );
  assert.match(img(page.html, 0), /srcset="\/__wd\/media\/team\/x@640\.webp 640w"/);
});

test("an off-list width is a documented miss, never an error and never wired", () => {
  const html = project("![a](/img/x.webp)", {
    "img/x.webp": [2400, 1600],
    "img/x@500.webp": [500, 333] // 500 is not in the probe list
  });
  assert.doesNotMatch(img(html, 0), /srcset/);
});

test("sources the convention does not cover are left alone", () => {
  const html = project(
    [
      "![remote](https://cdn.example.com/x.webp)",
      "",
      "![data](data:image/webp;base64,AAAA)",
      "",
      "![query](/img/x.webp?v=2)",
      "",
      "![relative](img/x.webp)",
      "",
      "![noext](/img/x)",
      "",
      "![empty]()"
    ].join("\n"),
    { "img/x.webp": [2400, 1600], "img/x@640.webp": [640, 427] }
  );
  const tags = html.match(/<img\b[^>]*>/g) || [];
  assert.equal(tags.length, 6, "all six images rendered");
  for (const tag of tags) assert.doesNotMatch(tag, /srcset/, tag);
});

test("a plain .md page has no compile context for the convention — no srcset (dimension/lazy hardening still applies)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-srcset-md-"));
  for (const [name, size] of Object.entries({
    "img/x.webp": [2400, 1600],
    "img/x@640.webp": [640, 427]
  })) {
    const abs = path.join(root, "site/pages", name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, makeWebp(...size));
  }
  const file = path.join(root, "site/pages/index.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "---\ntitle: T\n---\n\n![a](/img/x.webp)\n");
  const tag = img(compilePage(file, createPaths(root)).html, 0);
  assert.doesNotMatch(tag, /srcset/);
  assert.match(tag, /width="2400"/, "the page.js enhancement pass still measures it");
});

test("variant files are ordinary colocated assets: they copy to dist and are never routes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-srcset-build-"));
  const write = (rel, contents) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  };
  write("site/pages/index.wd", "---\ntitle: T\n---\n\n![a](/img/x.webp)\n");
  write("site/pages/img/x.webp", makeWebp(2400, 1600));
  write("site/pages/img/x@640.webp", makeWebp(640, 427));
  write("site/pages/img/x@1280.webp", makeWebp(1280, 853));
  buildSite(root);
  const distFile = (rel) => path.join(root, "dist", rel);
  assert.ok(fs.existsSync(distFile("img/x@640.webp")), "the 640 variant publishes");
  assert.ok(fs.existsSync(distFile("img/x@1280.webp")), "the 1280 variant publishes");
  assert.ok(
    fs.readFileSync(distFile("img/x@640.webp")).equals(Buffer.from(makeWebp(640, 427))),
    "copied verbatim"
  );
  assert.ok(
    !fs.existsSync(distFile("img/x@640/index.html")),
    "an @-suffixed file is never mistaken for a route"
  );
  const html = fs.readFileSync(distFile("index.html"), "utf8");
  assert.match(
    html,
    /srcset="\/img\/x@640\.webp 640w, \/img\/x@1280\.webp 1280w, \/img\/x\.webp 2400w"/
  );
});

test("a src that climbs out of site/pages is never probed for variants", () => {
  // `files` paths are relative to site/pages, so `../../outside/` lands beside the project.
  const html = project("![x](/../../outside/a.png)\n", {
    "../../outside/a.png": [1200, 800],
    "../../outside/a@640.png": [640, 427]
  });
  assert.doesNotMatch(img(html), /srcset/);
});
