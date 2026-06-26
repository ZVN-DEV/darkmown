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
    {
      "items.json": [
        { name: "Aurora", url: "/p/aurora/" },
        { name: "Briza", url: "/p/briza/" }
      ]
    }
  );
  assert.match(html, /<a href="\/p\/aurora\/">Aurora<\/a>/);
  assert.match(html, /<a href="\/p\/briza\/">Briza<\/a>/);
});

test("@loop interpolates item values into an image src", () => {
  const html = compileWithShelf(["@loop /items.json into it", "![photo]({ it.img })", "@endloop"], {
    "items.json": [{ img: "/media/a.png" }]
  });
  assert.match(html, /<img src="\/media\/a\.png" alt="photo"[^>]*>/);
});

test("a build-time loop driving link hrefs stays static (no runtime markers)", () => {
  const html = compileWithShelf(
    ["@loop /items.json into it", "- [{ it.name }]({ it.url })", "@endloop"],
    { "items.json": [{ name: "Aurora", url: "/p/aurora/" }] }
  );
  assert.ok(!/data-wd-/.test(html), "no reactive data-wd-* markers in a static loop");
});

test("interpolation resolves in a link destination from include/frontmatter scope", () => {
  const html = compileWithShelf(["---", "url: /from/meta/", "---", "[Go]({ meta.url })"]);
  assert.match(html, /<a href="\/from\/meta\/">Go<\/a>/);
});

test("a destination interpolation with a title still forms the link", () => {
  const html = compileWithShelf(
    ["@loop /items.json into it", '[{ it.name }]({ it.url } "Profile")', "@endloop"],
    { "items.json": [{ name: "Aurora", url: "/p/aurora/" }] }
  );
  assert.match(html, /<a href="\/p\/aurora\/" title="Profile">Aurora<\/a>/);
});

// ---------------------------------------------------------------------------
// TASK-3A — URL-scheme safety regression lock-in
//
// Dangerous schemes in a markdown link/image destination must never compile to
// an executable href/src. Today this is guaranteed by markdown-it's incidental
// `validateLink` (a rejected scheme is left as literal text, never wrapped in an
// <a>/<img>). These tests LOCK IN that behavior so a future markdown-it bump or a
// custom renderer cannot silently reintroduce an XSS sink. Two surfaces are
// covered: (1) a PLAIN markdown destination, (2) an INTERPOLATED `{ … }`
// destination whose build-time value is a dangerous scheme.
// ---------------------------------------------------------------------------

// Schemes + obfuscations that must NEVER survive into an href/src.
const DANGEROUS_LINK_DESTINATIONS = [
  "javascript:alert(1)",
  "JavaScript:alert(1)", // case obfuscation
  " javascript:alert(1)", // leading-space obfuscation
  "java\tscript:alert(1)", // embedded-tab obfuscation
  "vbscript:msgbox(1)",
  "data:text/html,<script>alert(1)</script>",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="
];

// Assert nothing in the compiled HTML is an anchor/image pointing at an
// executable scheme. Checks the post-normalization form markdown-it would emit
// AND the obfuscated raw forms, so neither survives.
function assertNoExecutableSink(html, label) {
  // No anchor/image whose href/src begins with a dangerous scheme — tolerate any
  // case and a small amount of leading whitespace inside the attribute.
  assert.doesNotMatch(
    html,
    /<a\b[^>]*\bhref\s*=\s*["']\s*(?:javascript|data|vbscript)\s*:/i,
    `${label}: produced an <a> with an executable href`
  );
  assert.doesNotMatch(
    html,
    /<img\b[^>]*\bsrc\s*=\s*["']\s*(?:javascript|data|vbscript)\s*:/i,
    `${label}: produced an <img> with an executable src`
  );
}

for (const dest of DANGEROUS_LINK_DESTINATIONS) {
  test(`plain markdown link destination "${dest}" never yields an executable href`, () => {
    const html = compileWithShelf([`[click](${dest})`]);
    assertNoExecutableSink(html, `link ${dest}`);
  });

  test(`plain markdown image destination "${dest}" never yields an executable src`, () => {
    const html = compileWithShelf([`![alt](${dest})`]);
    assertNoExecutableSink(html, `image ${dest}`);
  });
}

test("plain javascript: link is left as literal text, not an anchor", () => {
  const html = compileWithShelf(["[click](javascript:alert(1))"]);
  // Positive proof of the neutralization: the destination survives as text, and
  // the only thing it is NOT is an executable link.
  assert.ok(!/<a /i.test(html), "no <a> element emitted at all for the rejected scheme");
});

test("an INTERPOLATED destination resolving to javascript: is neutralized (href)", () => {
  const html = compileWithShelf(["@loop /items.json into it", "- [x]({ it.u })", "@endloop"], {
    "items.json": [{ u: "javascript:alert(1)" }]
  });
  // Build-time value is substituted into the destination, then markdown-it parses
  // it — and rejects the scheme, so no <a href="javascript: is produced.
  assertNoExecutableSink(html, "interpolated link javascript:");
});

test("an INTERPOLATED image src resolving to javascript: is neutralized (src)", () => {
  const html = compileWithShelf(["@loop /items.json into it", "![a]({ it.s })", "@endloop"], {
    "items.json": [{ s: "javascript:alert(1)" }]
  });
  assertNoExecutableSink(html, "interpolated image javascript:");
});

test("an INTERPOLATED destination resolving to data:text/html is neutralized", () => {
  const html = compileWithShelf(
    ["@loop /items.json into it", "- [x]({ it.d })", "![a]({ it.d })", "@endloop"],
    { "items.json": [{ d: "data:text/html,<script>alert(1)</script>" }] }
  );
  assertNoExecutableSink(html, "interpolated data:text/html");
});

test("an INTERPOLATED destination resolving to a SAFE url still forms the link (control)", () => {
  // Guards against a future over-broad sanitizer that strips legitimate hrefs:
  // a benign interpolated destination must continue to produce a real anchor.
  const html = compileWithShelf(["@loop /items.json into it", "- [x]({ it.u })", "@endloop"], {
    "items.json": [{ u: "/p/safe/" }]
  });
  assert.match(html, /<a href="\/p\/safe\/">x<\/a>/, "safe interpolated destination still links");
});
