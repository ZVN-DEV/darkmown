// ---------------------------------------------------------------------------
// THE SILENT-FAILURE CLASS: `{ name }` in a position markdown never parses.
//
// `{ … }` is an INLINE rule, so it fires only where markdown-it parses inline
// content. Three positions are not inline content, and in all three the compiler
// used to emit the author's braces verbatim with no error and no warning — the
// worst possible property, because an AI authoring loop reads a green compile
// and stops while the page ships `{ p.url }` in its URL bar.
//
// One row per cell of the audit's table:
//
//   | form                                    | static      | reactive        |
//   | `[{ p.name }]({ p.url })`               | link        | link + warning  |
//   | `[{ p.name }](/p/{ p.slug }/)`  partial | link        | link + warning  |
//   | `<a href="{ p.url }">`  (html: true)    | attribute   | painted + warn  |
//   | `<div>{ p.name }</div>` raw html block  | text        | painted + warn  |
//   | `## Heading { p.name }`                 | real slug   | real slug       |
//
// Plus the two invariants a fix here must not break: a static page stays
// `runtime: false`, and `.md` gets no directive behavior at all.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-interp-pos-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** Compile `lines` as the page body, with an optional `site/_` shelf. */
function compile(lines, { shelf = {}, ext = "wd" } = {}) {
  const root = fixture();
  write(root, `site/pages/index.${ext}`, lines.join("\n"));
  for (const [name, value] of Object.entries(shelf)) {
    write(root, `site/_/${name}`, typeof value === "string" ? value : JSON.stringify(value));
  }
  try {
    return compilePage(path.join(root, `site/pages/index.${ext}`), createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const HTML_PAGE = ["---", "title: Shelf", "html: true", "---", ""];
const SHELF = { "data.json": [{ name: "Alpha", url: "/a/", slug: "a" }] };

// ---------------------------------------------------------------------------
// (a) STATIC values resolve in every position
// ---------------------------------------------------------------------------

test("a static loop value fills a WHOLE link destination (the case that already worked)", () => {
  const page = compile(
    [...HTML_PAGE, "@loop /data.json into p", "[{ p.name }]({ p.url })", "@endloop"],
    { shelf: SHELF }
  );
  assert.match(page.html, /<a href="\/a\/">Alpha<\/a>/);
});

test("a static loop value fills a PARTIAL link destination", () => {
  // Previously: the whole construct degraded to the literal text
  // `[Alpha](/products/a/)` — no link, no error, no warning.
  const page = compile(
    [...HTML_PAGE, "@loop /data.json into p", "[{ p.name }](/products/{ p.slug }/)", "@endloop"],
    { shelf: SHELF }
  );
  assert.match(page.html, /<a href="\/products\/a\/">Alpha<\/a>/);
  assert.doesNotMatch(page.html, /\[Alpha\]/, "no literal markdown left in the output");
});

test("a static loop value fills a PARTIAL image destination", () => {
  const page = compile(
    [...HTML_PAGE, "@loop /data.json into p", "![{ p.name }](/img/{ p.slug }.png)", "@endloop"],
    { shelf: SHELF }
  );
  assert.match(page.html, /<img src="\/img\/a\.png" alt="Alpha"/);
});

test("several interpolations in one destination all resolve", () => {
  const page = compile(
    [...HTML_PAGE, "@loop /data.json into p", "[go](/{ p.slug }/x/{ p.slug }/)", "@endloop"],
    { shelf: SHELF }
  );
  assert.match(page.html, /<a href="\/a\/x\/a\/">go<\/a>/);
});

test("a static value fills a raw HTML attribute (html: true)", () => {
  // Previously: shipped the literal string `{ p.url }` as the href.
  const page = compile(
    [...HTML_PAGE, "@loop /data.json into p", '<a href="{ p.url }">go</a>', "@endloop"],
    { shelf: SHELF }
  );
  assert.match(page.html, /<a href="\/a\/">go<\/a>/);
  assert.doesNotMatch(page.html, /\{ p\.url \}/);
});

test("a static value fills a raw html_block body", () => {
  const page = compile([...HTML_PAGE, '<div class="x">{ meta.title }</div>'], { shelf: SHELF });
  assert.match(page.html, /<div class="x">Shelf<\/div>/);
});

test("a value substituted into raw HTML is escaped for the attribute it lands in", () => {
  // `&` and `"` inside a resolved value must not break out of the attribute.
  const page = compile([
    "---",
    "title: T",
    'q: a&b"c',
    "html: true",
    "---",
    "",
    '<a href="/s?q={ meta.q }">go</a>'
  ]);
  assert.match(page.html, /href="\/s\?q=a&amp;b&quot;c"/);
});

test("a static destination fill keeps the page zero-JS", () => {
  const page = compile(
    ["@loop /data.json into p", "[{ p.name }](/products/{ p.slug }/)", "@endloop"],
    { shelf: SHELF }
  );
  assert.equal(page.assets.runtime, false, "a build-time fill must not flip the page reactive");
  assert.doesNotMatch(page.html.split("<main")[1], /data-wd-/);
});

test("fenced code is never rewritten — a docs example is documentation, not markup", () => {
  const page = compile(
    [
      ...HTML_PAGE,
      "@loop /data.json into p",
      "```wd",
      "[{ p.name }](/products/{ p.slug }/)",
      "```",
      "@endloop"
    ],
    { shelf: SHELF }
  );
  assert.match(page.html, /\[\{ p\.name \}\]\(\/products\/\{ p\.slug \}\/\)/);
});

// ---------------------------------------------------------------------------
// (b) REACTIVE values warn — and paint what they can
// ---------------------------------------------------------------------------

/** Warnings whose text mentions `expr`. */
function warningsFor(page, expr) {
  return page.warnings.filter((w) => w.includes(`{ ${expr} }`));
}

test("a :state value in a whole link destination paints the initial value AND warns", () => {
  const page = compile([
    ...HTML_PAGE,
    ':state url = "/live/"',
    ':state name = "Live"',
    "",
    "[{ name }]({ url })"
  ]);
  // The link is at least valid on first load…
  assert.match(page.html, /<a href="\/live\/"><span data-wd-bind="name">Live<\/span><\/a>/);
  // …and the author is told it will never update, with a file:line and a fix.
  const [warning, ...rest] = warningsFor(page, "url");
  assert.equal(rest.length, 0, "exactly one warning");
  assert.match(warning, /index\.wd:9: /, "carries file:line");
  assert.match(warning, /link\/image destination cannot bind/);
  assert.match(warning, /painted once and then never updates/);
  assert.match(warning, /wd\.subscribe/, "names the workaround");
});

test("a :state value in a PARTIAL link destination paints the initial value and warns", () => {
  const page = compile([...HTML_PAGE, ':state slug = "abc"', "", "[go](/p/{ slug }/)"]);
  assert.match(page.html, /<a href="\/p\/abc\/">go<\/a>/);
  assert.equal(warningsFor(page, "slug").length, 1);
});

test("a :state value in a raw HTML attribute paints the initial value and warns", () => {
  const page = compile([...HTML_PAGE, ':state url = "/live/"', "", '<a href="{ url }">go</a>']);
  assert.match(page.html, /<a href="\/live\/">go<\/a>/);
  const [warning] = warningsFor(page, "url");
  assert.match(warning, /raw HTML \(an attribute or an html block\) cannot bind/);
  assert.match(warning, /index\.wd:8: /);
});

test("a reactive @loop row in a destination is left alone and warns (one template, many rows)", () => {
  const page = compile([
    ...HTML_PAGE,
    ':state items = [{"name":"A","slug":"a"}]',
    "",
    "@loop items into it",
    "[{ it.name }](/p/{ it.slug }/)",
    "@endloop"
  ]);
  // Painting row 1's slug into every row would be worse than leaving it visible.
  assert.match(page.html, /\/p\/<span data-wd-each data-wd-path="slug">/);
  const [warning] = warningsFor(page, "it.slug");
  assert.match(warning, /it stays literal text/);
  assert.match(warning, /index\.wd:9: /);
});

test("a reactive @loop row in a raw HTML attribute is left alone and warns", () => {
  const page = compile([
    ...HTML_PAGE,
    ':state items = [{"url":"/a/"}]',
    "",
    "@loop items into it",
    "text",
    '<a href="{ it.url }">go</a>',
    "@endloop"
  ]);
  assert.ok(page.html.includes('<a href="{ it.url }">'), "left exactly as written");
  const [warning] = warningsFor(page, "it.url");
  // Line 10, not the line the paragraph opened on: softbreaks are counted.
  assert.match(warning, /index\.wd:10: /);
});

test("a $index meta marker in a destination warns like any other per-row value", () => {
  const page = compile([
    ...HTML_PAGE,
    ':state items = [{"n":1}]',
    "",
    "@loop items into it",
    "[row](/p/{ $index }/)",
    "@endloop"
  ]);
  assert.equal(warningsFor(page, "$index").length, 1);
});

test("a reactive binding in ordinary prose still binds and never warns", () => {
  // The control: the warning must fire only in the positions that cannot bind.
  const page = compile([...HTML_PAGE, ':state name = "Live"', "", "Hello { name }."]);
  assert.match(page.html, /<span data-wd-bind="name">Live<\/span>/);
  assert.deepEqual(page.warnings, []);
});

test("a name that is in no scope is left as written, with no warning", () => {
  const page = compile([...HTML_PAGE, "[go](/p/{ nothing.here }/)"]);
  assert.ok(page.html.includes("{ nothing.here }"));
  assert.deepEqual(page.warnings, []);
});

// ---------------------------------------------------------------------------
// (c) Heading slugs come from the RESOLVED text
// ---------------------------------------------------------------------------

test("a heading containing a static value gets a slug of what the reader sees", () => {
  const page = compile(
    [...HTML_PAGE, "@loop /data.json into p", "## { p.name } notes", "@endloop"],
    {
      shelf: SHELF
    }
  );
  assert.match(page.html, /<h2 id="alpha-notes">/);
});

test("a heading of ONLY an interpolation is no longer the meaningless id 'section'", () => {
  // Live on darkmown.com/blog/: id="section", "section-1", "section-2"…
  const page = compile([...HTML_PAGE, "@loop /many.json into p", "## { p.name }", "@endloop"], {
    shelf: { "many.json": [{ name: "First post" }, { name: "Second post" }] }
  });
  assert.match(page.html, /<h2 id="first-post">/);
  assert.match(page.html, /<h2 id="second-post">/);
  assert.doesNotMatch(page.html, /id="section/);
});

test("a heading with a reactive value slugs its INITIAL value (ids must be stable)", () => {
  const page = compile([...HTML_PAGE, ':state name = "Live"', "", "## Heading { name } here"]);
  assert.match(page.html, /<h2 id="heading-live-here">/);
});

test("author-written HTML TAGS in a heading still contribute no slug text", () => {
  // The tag names must not leak into the id (`hello-b-world-b`); the text the
  // tags wrap is ordinary heading text and always counted, as before.
  const page = compile([...HTML_PAGE, "## Hello <b>World</b>"]);
  assert.match(page.html, /<h2 id="hello-world">/);
});

// ---------------------------------------------------------------------------
// (d) `.md` never gets directive behavior — the extension is the feature gate
// ---------------------------------------------------------------------------

test(".md is untouched in every one of these positions", () => {
  const page = compile(
    [
      "---",
      "title: Plain",
      "html: true",
      "---",
      "",
      "[a]({ meta.title })",
      "[a](/p/{ meta.title }/)",
      '<a href="{ meta.title }">raw</a>',
      "<div>{ meta.title }</div>",
      "",
      "## Heading { meta.title } here"
    ],
    { ext: "md" }
  );
  assert.ok(page.html.includes("[a]({ meta.title })"), "destination untouched");
  assert.ok(page.html.includes('<a href="{ meta.title }">'), "attribute untouched");
  assert.ok(page.html.includes("<div>{ meta.title }</div>"), "html block untouched");
  assert.match(page.html, /<h2 id="heading--metatitle--here">/, "slug from the literal text");
  assert.equal(page.assets.runtime, false);
});

// ---------------------------------------------------------------------------
// C11 — an array bind's initial paint must equal what the runtime will paint
// ---------------------------------------------------------------------------

test("a reactive array bind paints String(array), matching the runtime's textContent", () => {
  // The runtime repaints with `node.textContent = value`, which coerces
  // ["a","b"] to "a,b". Painting "a, b" here made the first render silently
  // rewrite the text.
  const page = compile([':state tags = ["a", "b"]', "", "Tags: { tags }"]);
  assert.match(page.html, /<span data-wd-bind="tags">a,b<\/span>/);
});

test("a STATIC array still joins with ', ' — the documented { meta.tags } contract", () => {
  const page = compile(["---", "title: T", "tags: [a, b, c]", "---", "", "Tags: { meta.tags }"]);
  assert.match(page.html, /Tags: a, b, c/);
});

test("a loop row's array field paints the same String(array) the runtime will", () => {
  const page = compile([
    ':state rows = [{"tags":["a","b"]}]',
    "",
    "@loop rows into r",
    "{ r.tags }",
    "@endloop"
  ]);
  assert.match(page.html, /<span data-wd-each data-wd-path="tags">a,b<\/span>/);
});

// ---------------------------------------------------------------------------
// A resolved value is DATA, never a template
// ---------------------------------------------------------------------------

test("a state value that itself contains braces is never resolved a second time", () => {
  // The raw-HTML pass walks html_inline tokens, and a resolved binding IS an
  // html_inline token. Without a skip, `:state name = "{ meta.title }"` would
  // have its own painted text re-resolved and leak the page title.
  const page = compile([
    "---",
    "title: SECRET-TITLE",
    "html: true",
    "---",
    "",
    ':state name = "{ meta.title }"',
    "",
    "Value: { name }"
  ]);
  assert.match(page.html, /<span data-wd-bind="name">\{ meta\.title \}<\/span>/);
  const body = page.html.slice(page.html.indexOf("<main"));
  assert.doesNotMatch(body, /SECRET-TITLE/, "the page title leaked through a state value");
});

test("a static loop value containing braces stays literal text", () => {
  const page = compile(
    [
      "---",
      "title: SECRET-TITLE",
      "html: true",
      "---",
      "",
      "@loop /d.json into p",
      "Row: { p.v }",
      "@endloop"
    ],
    { shelf: { "d.json": [{ v: "{ meta.title }" }] } }
  );
  const body = page.html.slice(page.html.indexOf("<main"));
  assert.match(body, /Row: \{ meta\.title \}/);
  assert.doesNotMatch(body, /SECRET-TITLE/);
});
