// Accessibility & i18n page-shell triplet.
//
// 1. `lang:` frontmatter drives `<html lang>` (default "en", escaped).
// 2. Every page gets a skip-to-content link targeting the main landmark; the
//    shell wraps the body in `<main id="main">` when the author didn't write
//    one, stamps `id="main"` onto an id-less author `<main>`, and honors an
//    author-supplied id as the skip target. Static pages stay static.
// 3. `:fetch` lifecycle regions announce themselves: a bare `:if <key>_loading`
//    if-region is `role="status" aria-live="polite"`, `:if <key>_error` is
//    `role="alert"` — compile-time attributes only, no runtime growth. Author
//    aria inside the region wins; non-fetch keys are untouched.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function compileWd(lines, name = "index.wd") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-shell-"));
  const file = path.join(root, "site/pages", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n"));
  return compilePage(file, createPaths(root));
}

// ---------------------------------------------------------------------------
// lang frontmatter
// ---------------------------------------------------------------------------

test('pages default to <html lang="en">', () => {
  const { html } = compileWd(["# Hello"]);
  assert.match(html, /<html lang="en">/);
});

test("lang frontmatter sets the document language", () => {
  const { html } = compileWd(["---", "title: Bonjour", "lang: fr", "---", "# Salut"]);
  assert.match(html, /<html lang="fr">/);
});

test("lang is trimmed and HTML-escaped", () => {
  const { html } = compileWd(["---", 'lang: "pt-BR"', "---", "# Oi"]);
  assert.match(html, /<html lang="pt-BR">/);
  const hostile = compileWd(["---", 'lang: en"><script>alert(1)</script>', "---", "# X"]);
  assert.doesNotMatch(hostile.html, /lang="en"><script>alert/);
  assert.match(hostile.html, /<html lang="en&quot;&gt;&lt;script&gt;/);
});

test("an empty lang value falls back to en", () => {
  const { html } = compileWd(["---", 'lang: "  "', "---", "# X"]);
  assert.match(html, /<html lang="en">/);
});

// ---------------------------------------------------------------------------
// skip link + main landmark
// ---------------------------------------------------------------------------

test('the shell emits a skip link and wraps a main-less body in <main id="main">', () => {
  const page = compileWd(["# Hello", "", "Some prose."]);
  assert.match(
    page.html,
    /<body>\n<a class="wd-skip-link" href="#main">Skip to content<\/a>\n<main id="main">/
  );
  assert.match(page.html, /<\/main>\n\n<\/body>/);
  assert.match(page.html, /\.wd-skip-link\{position:absolute/);
  assert.match(page.html, /\.wd-skip-link:focus\{transform:none\}/);
  assert.equal(page.assets.runtime, false, "skip link must not flip a static page reactive");
});

test('an author <main> without an id gets id="main" stamped on (no double wrap)', () => {
  const page = compileWd(["---", "html: true", "---", "<main>", "", "# Inside", "", "</main>"]);
  assert.match(page.html, /<main id="main">/);
  assert.equal(page.html.match(/<main\b/g).length, 1, "exactly one <main>");
  assert.match(page.html, /href="#main"/);
});

test("an author-supplied main id wins as the skip target", () => {
  const page = compileWd([
    "---",
    "html: true",
    "---",
    '<main id="content" class="wrap">',
    "",
    "# Inside",
    "",
    "</main>"
  ]);
  assert.match(page.html, /<a class="wd-skip-link" href="#content">Skip to content<\/a>/);
  assert.equal(page.html.match(/<main\b/g).length, 1);
  assert.doesNotMatch(page.html, /<main id="main">/);
});

test('a data-id on <main> is not mistaken for the id: id="main" still gets stamped', () => {
  const page = compileWd([
    "---",
    "html: true",
    "---",
    '<main data-id="hero">',
    "",
    "# Inside",
    "",
    "</main>"
  ]);
  assert.match(page.html, /<main data-id="hero" id="main">/);
  assert.match(page.html, /<a class="wd-skip-link" href="#main">Skip to content<\/a>/);
  assert.equal(page.html.match(/<main\b/g).length, 1, "no double wrap");
});

test("a real id next to a data-id still wins as the skip target", () => {
  const page = compileWd([
    "---",
    "html: true",
    "---",
    '<main data-id="hero" id="content">',
    "",
    "# Inside",
    "",
    "</main>"
  ]);
  assert.match(page.html, /<a class="wd-skip-link" href="#content">Skip to content<\/a>/);
  assert.doesNotMatch(page.html, /id="main"/);
});

test("an empty author main id keeps the markup intact and falls back to #main", () => {
  const page = compileWd([
    "---",
    "html: true",
    "---",
    '<main id="">',
    "",
    "# Inside",
    "",
    "</main>"
  ]);
  assert.match(page.html, /<main id="">/);
  assert.equal(page.html.match(/<main\b/g).length, 1, "no double wrap");
  assert.doesNotMatch(page.html, /<main id=""[^>]*\bid=/, "no duplicate id attribute");
  assert.match(page.html, /href="#main"/);
});

// ---------------------------------------------------------------------------
// :fetch lifecycle live regions
// ---------------------------------------------------------------------------

const FETCH_PAGE = [
  ':fetch posts from "/api/posts.json"',
  "",
  ":if posts_loading",
  "Loading…",
  ":endif",
  "",
  ":if posts_error",
  "Something broke.",
  ":endif"
];

test(":if <key>_loading over a :fetch key is a polite status region", () => {
  const { html } = compileWd(FETCH_PAGE);
  assert.match(
    html,
    /<div data-wd-if="posts_loading" role="status" aria-live="polite" data-wd-if-active="false">/
  );
});

test(":if <key>_error over a :fetch key is an alert region", () => {
  const { html } = compileWd(FETCH_PAGE);
  assert.match(html, /<div data-wd-if="posts_error" role="alert" data-wd-if-active="false">/);
});

test("author-supplied aria inside the region suppresses the defaults", () => {
  const { html } = compileWd([
    "---",
    "html: true",
    "---",
    ':fetch posts from "/api/posts.json"',
    "",
    ":if posts_loading",
    '<p role="status" aria-live="assertive">Hold on</p>',
    ":endif"
  ]);
  assert.match(html, /<div data-wd-if="posts_loading" data-wd-if-active="false">/);
  assert.match(html, /aria-live="assertive"/);
});

test("a _loading state key not declared by :fetch gets no live-region attributes", () => {
  const { html } = compileWd([
    ":state page_loading = true",
    "",
    ":if page_loading",
    "Spinning…",
    ":endif"
  ]);
  assert.match(html, /<div data-wd-if="page_loading" data-wd-if-active="true">/);
  assert.doesNotMatch(html, /role="status"/);
});

test("a dotted path under a fetch lifecycle key stays unannounced", () => {
  const { html } = compileWd([
    ':fetch posts from "/api/posts.json"',
    "",
    ":if posts_error.status",
    "HTTP error",
    ":endif"
  ]);
  assert.match(
    html,
    /<div data-wd-if="posts_error" data-wd-path="status" data-wd-if-active="false">/
  );
  assert.doesNotMatch(html, /role="alert"/);
});
