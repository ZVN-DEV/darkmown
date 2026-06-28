// Build-time syntax highlighting: highlight.js wired onto both markdown-it
// instances, the framework `$code-*`-token stylesheet, and the pay-for-what-you-
// use emission/injection (only on pages that contain a highlighted code block).
// Highlighting is build-time HTML + CSS only — zero runtime.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { compileDocument, compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";
import { HIGHLIGHT_CSS, HLJS_MARKER, highlightCode, htmlHasHighlight } from "../src/highlight.js";
import { compileSkin } from "../src/skin.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-highlight-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** Compile a single index.wd document (no page shell) from a raw body. */
function compileWd(root, body) {
  const file = path.join(root, "site/pages/index.wd");
  write(root, "site/pages/index.wd", body);
  return compileDocument(file, createPaths(root));
}

/** Compile a single page (full HTML shell) from a frontmatter'd body. */
function compilePageWith(root, lines) {
  const file = path.join(root, "site/pages/index.wd");
  write(root, "site/pages/index.wd", lines.join("\n"));
  return compilePage(file, createPaths(root));
}

// --- highlightCode: the markdown-it `highlight` callback --------------------

test("highlightCode highlights a known language and stamps the hljs marker", () => {
  const out = highlightCode("const x = 1;", "js");
  assert.match(out, new RegExp(`^<span class="${HLJS_MARKER}">`));
  assert.match(out, /<span class="hljs-keyword">const<\/span>/);
  assert.match(out, /<span class="hljs-number">1<\/span>/);
});

test("highlightCode defers (returns empty) for an unknown or absent language", () => {
  assert.equal(highlightCode("whatever", "klingon"), "");
  assert.equal(highlightCode("whatever", ""), "");
  // markdown-it passes undefined when a fence has no info string.
  assert.equal(highlightCode("whatever", undefined), "");
});

test("highlightCode escapes its output (markdown-it trusts the return value)", () => {
  const out = highlightCode('const s = "<b> & </b>";', "js");
  assert.match(out, /&lt;b&gt;/);
  assert.match(out, /&amp;/);
  assert.doesNotMatch(out, /<b>/);
});

test("highlightCode tolerates a snippet that doesn't fully parse (ignoreIllegal)", () => {
  // An obviously malformed snippet must still highlight best-effort, never throw.
  assert.doesNotThrow(() => highlightCode("def )( :: <<< 1", "python"));
});

// --- htmlHasHighlight: the post-render detector ----------------------------

test("htmlHasHighlight matches the marker stamped by highlightCode", () => {
  assert.equal(htmlHasHighlight(highlightCode("x = 1", "js")), true);
  assert.equal(htmlHasHighlight("<p>plain prose</p>"), false);
  // A page whose only code is plain/unknown never trips it.
  assert.equal(htmlHasHighlight(highlightCode("plain", "klingon")), false);
});

// --- compiler integration: .wd path ----------------------------------------

test("a fenced block with a known language highlights, flagging assets.hasCode", () => {
  const doc = compileWd(fixture(), "```js\nconst x = 1;\n```");
  assert.equal(doc.assets.hasCode, true);
  assert.match(doc.html, /<span class="hljs-keyword">const<\/span>/);
  // highlighting is build-time only — no runtime is forced on.
  assert.equal(doc.assets.runtime, false);
});

test("a fence with no language renders plain escaped code, hasCode stays false", () => {
  const doc = compileWd(fixture(), "```\nplain & <text>\n```");
  assert.equal(doc.assets.hasCode, false);
  assert.match(doc.html, /<pre><code>plain &amp; &lt;text&gt;/);
  assert.doesNotMatch(doc.html, /class="hljs/);
});

test("a fence with an unknown language degrades to plain escaped code", () => {
  const doc = compileWd(fixture(), "```klingon\nnuqneH & <x>\n```");
  assert.equal(doc.assets.hasCode, false);
  assert.match(doc.html, /<code class="language-klingon">nuqneH &amp; &lt;x&gt;/);
  assert.doesNotMatch(doc.html, /class="hljs/);
});

test("inline `code` is never highlighted", () => {
  const doc = compileWd(fixture(), "Some `const x = 1` inline.");
  assert.equal(doc.assets.hasCode, false);
  assert.doesNotMatch(doc.html, /class="hljs/);
});

// --- compiler integration: .md path ----------------------------------------

test("plain .md pages highlight fenced code too and flag hasCode", () => {
  const root = fixture();
  write(root, "site/pages/post.md", "# Title\n\n```css\n.a { color: red; }\n```\n");
  const doc = compileDocument(path.join(root, "site/pages/post.md"), createPaths(root));
  assert.equal(doc.assets.hasCode, true);
  assert.match(doc.html, /class="hljs/);
});

// --- html: false (strict, no-raw-HTML) instance ----------------------------

test("html: false pages still highlight (the strict instance shares the option)", () => {
  const page = compilePageWith(fixture(), [
    "---",
    "title: S",
    "html: false",
    "---",
    "",
    "```python",
    "def f(): return 1",
    "```"
  ]);
  assert.equal(page.assets.hasCode, true);
  assert.match(page.html, /class="hljs-keyword">def<\/span>/);
});

// --- page shell: pay-for-what-you-use stylesheet link ----------------------

test("a code-bearing page links /__wd/highlight.css in <head>", () => {
  const page = compilePageWith(fixture(), [
    "---",
    "title: T",
    "---",
    "",
    "```js",
    "const x = 1;",
    "```"
  ]);
  const head = page.html.slice(0, page.html.indexOf("</head>"));
  assert.match(head, /<link rel="stylesheet" href="\/__wd\/highlight\.css">/);
});

test("a page with no highlighted code links nothing extra", () => {
  const page = compilePageWith(fixture(), [
    "---",
    "title: T",
    "---",
    "",
    "Just prose with `inline` and a plain block:",
    "",
    "```",
    "no language here",
    "```"
  ]);
  assert.equal(page.assets.hasCode, false);
  assert.doesNotMatch(page.html, /\/__wd\/highlight\.css/);
});

test("the highlight stylesheet sits ahead of page skins so $code-* overrides cascade", () => {
  const root = fixture();
  write(root, "site/pages/index.skin", "page\n  color $ink\n");
  const page = compilePageWith(root, [
    "---",
    "title: T",
    "---",
    "",
    "```js",
    "const x = 1;",
    "```"
  ]);
  const head = page.html.slice(0, page.html.indexOf("</head>"));
  const hl = head.indexOf("/__wd/highlight.css");
  const skin = head.indexOf("/__wd/styles/");
  assert.ok(hl > -1 && skin > -1, "both stylesheets must be linked");
  assert.ok(hl < skin, "highlight.css must come before the page skin");
});

// --- the framework stylesheet maps onto $code-* tokens ----------------------

test("HIGHLIGHT_CSS maps highlight.js classes onto var(--code-*) tokens", () => {
  assert.match(HIGHLIGHT_CSS, /\.hljs\s*\{[^}]*var\(--code-fg/);
  assert.match(HIGHLIGHT_CSS, /\.hljs\s*\{[^}]*var\(--code-bg/);
  assert.match(HIGHLIGHT_CSS, /\.hljs-keyword[^{]*\{[^}]*var\(--code-keyword/);
  assert.match(HIGHLIGHT_CSS, /\.hljs-string[^{]*\{[^}]*var\(--code-string/);
  assert.match(HIGHLIGHT_CSS, /\.hljs-comment[^{]*\{[^}]*var\(--code-comment/);
  // each var has a literal fallback so highlighting is legible without the tokens
  assert.match(HIGHLIGHT_CSS, /var\(--code-fg,\s*#/);
});

// --- the base skin defines the $code-* token set, light + dark --------------

test("base.skin defines $code-* tokens with a dark override", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "site", "_", "base.skin"),
    "utf8"
  );
  const css = compileSkin(source);
  for (const name of [
    "code-bg",
    "code-fg",
    "code-keyword",
    "code-string",
    "code-comment",
    "code-function",
    "code-number",
    "code-punctuation"
  ]) {
    assert.match(css, new RegExp(`--${name}:`), `base skin must define $${name}`);
  }
  // the dark override re-declares code-keyword inside the dark rules
  assert.match(css, /prefers-color-scheme: dark[\s\S]*--code-keyword:/);
});

// --- build emission: pay-for-what-you-use ----------------------------------

test("build emits dist/__wd/highlight.css only when a page uses highlighting", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ["---", "title: Home", "---", "", "Just prose."].join("\n"));
  const { distRoot } = buildSite(root);
  assert.equal(
    fs.existsSync(path.join(distRoot, "__wd/highlight.css")),
    false,
    "a site with no highlighted code must not ship the stylesheet"
  );

  // Add a code-bearing page and rebuild.
  write(
    root,
    "site/pages/snippets.wd",
    ["---", "title: Snippets", "---", "", "```js", "const x = 1;", "```"].join("\n")
  );
  const { distRoot: dist2 } = buildSite(root);
  const cssPath = path.join(dist2, "__wd/highlight.css");
  assert.ok(fs.existsSync(cssPath), "the stylesheet must be emitted for a code-bearing site");
  assert.equal(fs.readFileSync(cssPath, "utf8"), HIGHLIGHT_CSS);
});

test("a static page with only prose + code stays runtime: false in routes.json", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    ["---", "title: Doc", "---", "", "# Heading", "", "```python", "x = 1", "```"].join("\n")
  );
  const { distRoot } = buildSite(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(distRoot, "routes.json"), "utf8"));
  const entry = manifest.find((r) => r.route === "/");
  assert.equal(entry.assets.runtime, false, "highlighting must not pull in the runtime");
  // the emitted HTML is genuinely highlighted
  const html = fs.readFileSync(path.join(distRoot, "index.html"), "utf8");
  assert.match(html, /class="hljs/);
  assert.match(html, /\/__wd\/highlight\.css/);
});
