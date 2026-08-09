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

// ---------------------------------------------------------------------------
// CRLF sources. Regression guard: every delimiter test here is LF-shaped, so an
// un-normalized `---\r\n` opener silently fell through to "no frontmatter" and
// the whole block was treated as body text. That made a Windows checkout (git's
// core.autocrlf is on by default there) fail collection schema validation for
// fields that were plainly present. Caught by the windows-latest CI matrix.
// ---------------------------------------------------------------------------

test("CRLF frontmatter parses identically to LF", () => {
  const lf = "---\ntitle: Hello\ntags: [a, b]\n---\n\n# Body\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  const a = parseFrontmatter(lf, "test.md");
  const b = parseFrontmatter(crlf, "test.md");
  assert.deepEqual(b.meta, a.meta);
  assert.equal(b.meta.title, "Hello");
  assert.equal(b.bodyLine, a.bodyLine);
  assert.equal(b.body, a.body);
});

test("a CRLF page compiles to the same HTML as its LF twin", () => {
  const body = "---\ntitle: Post\n---\n\n# Heading\n\nSome prose.\n";
  const html = (source) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-crlf-"));
    const file = path.join(root, "site/pages/index.wd");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
    return compilePage(file, createPaths(root)).html;
  };
  assert.equal(html(body.replace(/\n/g, "\r\n")), html(body));
});

test("inline array frontmatter parses to a real array", () => {
  const { meta } = parseFrontmatter("---\ntags: [sales, revenue]\n---\nbody");
  assert.deepEqual(meta.tags, ["sales", "revenue"]);
});

test("empty, single, and quoted-with-comma array items", () => {
  assert.deepEqual(parseFrontmatter("---\ntags: []\n---\n").meta.tags, []);
  assert.deepEqual(parseFrontmatter("---\ntags: [solo]\n---\n").meta.tags, ["solo"]);
  // a quoted item keeps its internal comma; quotes are stripped
  assert.deepEqual(parseFrontmatter('---\ntags: ["a, b", c]\n---\n').meta.tags, ["a, b", "c"]);
  // whitespace between a comma and a following quoted item is dropped (not leaked in)
  assert.deepEqual(parseFrontmatter('---\ntags: [a, "b, c"]\n---\n').meta.tags, ["a", "b, c"]);
});

test("a scalar field beside an array field both parse correctly", () => {
  const { meta } = parseFrontmatter("---\ntitle: Hello\ntags: [x, y]\n---\n");
  assert.equal(meta.title, "Hello");
  assert.deepEqual(meta.tags, ["x", "y"]);
});

test("scalars without a leading bracket keep their existing behavior", () => {
  const { meta } = parseFrontmatter(
    '---\ntitle: "Quoted Title"\ncount: 3\nresource: bq://t\n---\n'
  );
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
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "subtitle: From frontmatter",
      "---",
      "<main>",
      "",
      "Note: { meta.subtitle }",
      "",
      "</main>"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Note: From frontmatter/);
  assert.equal(page.assets.runtime, false);
});

test("{ meta.tags } renders an array joined with ', '", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      "---",
      "tags: [sales, revenue, ops]",
      "---",
      "<main>",
      "",
      "Tags: { meta.tags }",
      "",
      "</main>"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Tags: sales, revenue, ops/);
  assert.equal(page.assets.runtime, false);
});

test("@loop over a frontmatter array unrolls at build time and stays static", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
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
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<li>alpha<\/li>/);
  assert.match(page.html, /<li>beta<\/li>/);
  assert.equal(page.assets.runtime, false, "looping a frontmatter array must stay zero-JS");
  assert.doesNotMatch(page.html, /data-wd-loop/);
});

// ---------------------------------------------------------------------------
// Malformed frontmatter: opened-but-unclosed throws; no-frontmatter is fine
// ---------------------------------------------------------------------------

test("an opened-but-unclosed frontmatter block throws an actionable error", () => {
  assert.throws(
    () => parseFrontmatter("---\ntitle: Oops\nbody with no closing fence"),
    /Unterminated frontmatter[\s\S]*Use:/
  );
});

test("the unterminated-frontmatter error names the file when given one", () => {
  assert.throws(
    () => parseFrontmatter("---\ntitle: Oops\nno close", "/site/pages/index.wd"),
    /\/site\/pages\/index\.wd/
  );
});

test("a file with no frontmatter at all is left untouched (no error)", () => {
  const raw = "Just a plain body, no leading fence.";
  assert.deepEqual(parseFrontmatter(raw), { meta: {}, body: raw, bodyLine: 0 });
});

test("parseFrontmatter reports the 0-based file line the body starts on", () => {
  const { bodyLine, body } = parseFrontmatter(
    "---\ntitle: T\ndate: 2026-01-01\n---\n\n# Heading\n"
  );
  assert.equal(bodyLine, 4);
  assert.equal(body.split("\n")[1], "# Heading");
});

// ---------------------------------------------------------------------------
// raw-HTML opt-in: default escapes raw HTML, `html: true` passes it through
// ---------------------------------------------------------------------------

test("raw HTML in a .md body is escaped by default", () => {
  const root = fixture();
  write(root, "site/pages/index.md", '<div class="raw">hi</div>\n<img src=x onerror=alert(1)>\n');
  const page = compilePage(path.join(root, "site/pages/index.md"), createPaths(root));
  assert.doesNotMatch(page.html, /<div class="raw">/);
  assert.doesNotMatch(page.html, /<img src=x/);
  assert.match(page.html, /&lt;div/);
  assert.match(page.html, /&lt;img/);
});

test("raw HTML in a .wd body is escaped by default", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "# Hi\n\n<script>alert(1)</script>\n");
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.doesNotMatch(page.html, /<script>alert/);
  assert.match(page.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("frontmatter html: true restores raw HTML passthrough", () => {
  const root = fixture();
  write(root, "site/pages/index.md", '---\nhtml: true\n---\n<div class="raw">hi</div>\n');
  const page = compilePage(path.join(root, "site/pages/index.md"), createPaths(root));
  assert.match(page.html, /<div class="raw">hi<\/div>/);
});

test("frontmatter html: true on a .wd page passes raw HTML through", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    '---\nhtml: true\n---\n\n<section class="hero">\n\n# Hi\n\n</section>\n'
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<section class="hero">/);
});

test("interpolated values stay escaped regardless of the html setting", () => {
  const root = fixture();
  for (const fm of ["", "---\nhtml: true\n---\n\n"]) {
    write(
      root,
      "site/pages/index.wd",
      `${fm}:state label = "<b>bold</b> & <script>x</script>"\n\nValue: { label }\n`
    );
    const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
    assert.match(page.html, /&lt;b&gt;bold&lt;\/b&gt; &amp; &lt;script&gt;x&lt;\/script&gt;/);
    assert.doesNotMatch(page.html, /<b>bold<\/b>/);
  }
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-frontmatter-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
