// ---------------------------------------------------------------------------
// F1 — reactive attribute binding, compile side.
//
// `[go]({ url })` used to paint the seed once and warn that it would never
// update. It now emits a `data-wd-attr` template (state/`:computed`) or a
// `data-wd-each-attr` one (anything per-row) that src/runtime.js re-evaluates.
// The runtime half of this feature (including the scheme guard, with its
// negative control) lives in tests/runtime-dom.test.js.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { unsafeUrlValue } from "../src/compiler/interpolation.js";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

/** Compile `lines` as the page body, with an optional `site/_` shelf. */
function compile(lines, { shelf = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-attr-bind-"));
  const write = (file, content) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  write("site/pages/index.wd", lines.join("\n"));
  for (const [name, value] of Object.entries(shelf))
    write(`site/_/${name}`, typeof value === "string" ? value : JSON.stringify(value));
  try {
    return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The page body, so the assertions never match the shell. */
const body = (page) => page.html.slice(page.html.indexOf("<main"), page.html.indexOf("</main>"));

/** An attribute value as it appears in the HTML (markdown-it escapes it). */
const marker = (...parts) =>
  JSON.stringify(parts).replaceAll('"', "&quot;").replaceAll("'", "&#39;");

test("a :computed value drives an href through the same state marker", () => {
  const page = compile([
    ":state page = 2",
    ':computed next = "/page/" + page',
    "",
    "[Next]({ next })"
  ]);
  assert.match(body(page), /<a href="\/page\/2" data-wd-attr=/);
  assert.ok(body(page).includes(`data-wd-attr="${marker("href", ["s", "next", ""])}"`));
});

test("a bound image src emits the marker and paints the seed", () => {
  const page = compile([':state photo = "/a.png"', "", "![Portrait]({ photo })"]);
  assert.match(body(page), /<img src="\/a\.png" alt="Portrait" data-wd-attr=/);
  assert.ok(body(page).includes(`data-wd-attr="${marker("src", ["s", "photo", ""])}"`));
});

test("a bound image is NOT given build-time width/height", () => {
  // enhanceImages measures the seed off disk. Baking those numbers would
  // stretch every later image to the first one's aspect ratio.
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000200000001008060000", "hex");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-attr-img-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.writeFileSync(path.join(root, "site/pages/a.png"), png);
  fs.writeFileSync(
    path.join(root, "site/pages/index.wd"),
    [':state photo = "/a.png"', "", "![Seed](/a.png)", "", "![Bound]({ photo })"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  fs.rmSync(root, { recursive: true, force: true });
  const [, staticImg, boundImg] = body(page).match(
    /(<img [^>]*alt="Seed"[^>]*>)[\s\S]*(<img [^>]*alt="Bound"[^>]*>)/
  );
  assert.match(staticImg, /width="32" height="16"/, "the control: a static src IS measured");
  assert.doesNotMatch(boundImg, /width=/, "a bound src must not carry the seed's dimensions");
});

test("an unsafe seed is neutralized in the build-time paint too", () => {
  // markdown-it's validateLink vetted the PLACEHOLDER, not the value that
  // replaced it, so the compiler runs the same guard the runtime does.
  const page = compile([':state u = "javascript:alert(1)"', "", "[x]({ u })"]);
  assert.match(body(page), /<a href="" data-wd-attr=/);
  assert.doesNotMatch(body(page), /href="javascript/i);
  assert.equal(unsafeUrlValue("javascript:alert(1)"), true);
});

test("a destination whose LITERAL half spells javascript: never forms a link at all", () => {
  // markdown-it's own validateLink sees the destination before the binding is
  // resolved, so this degrades to literal text and never reaches the marker —
  // the author's braces come back rather than the internal placeholder.
  const page = compile([':state rest = "alert(1)"', "", "[x](javascript:{ rest })"]);
  assert.doesNotMatch(body(page), /<a /);
  assert.ok(body(page).includes("[x](javascript:{ rest })"), "left exactly as written");
});

test("a bound destination flips the page reactive", () => {
  const page = compile([':state url = "/a/"', "", "[go]({ url })"]);
  assert.equal(page.assets.runtime, true);
});

test("NEGATIVE CONTROL: a build-time value still folds, with no marker at all", () => {
  // The static path must be untouched: no marker, no runtime, no warning. If
  // this ever grows a data-wd-attr, static pages have stopped being static.
  const page = compile(["@loop /data.json into p", "[{ p.name }](/p/{ p.slug }/)", "@endloop"], {
    shelf: { "data.json": [{ name: "Alpha", slug: "a" }] }
  });
  assert.match(body(page), /<a href="\/p\/a\/">Alpha<\/a>/);
  assert.doesNotMatch(body(page), /data-wd-/);
  assert.equal(page.assets.runtime, false);
  assert.deepEqual(page.warnings, []);
});

test("raw HTML still warns — there is no element there to mark", () => {
  const page = compile([
    "---",
    "title: T",
    "html: true",
    "---",
    "",
    ':state url = "/live/"',
    "",
    '<a href="{ url }">go</a>'
  ]);
  const [warning] = page.warnings;
  assert.match(warning, /raw HTML \(an attribute or an html block\) cannot bind/);
  // The warning now points at the position that DOES bind.
  assert.match(warning, /markdown link\/image destination/);
});

// ---------------------------------------------------------------------------
// Reviewer findings — a value in URL position is URL text, not markdown.
// ---------------------------------------------------------------------------

// `)` closes a markdown destination. Splicing a value in raw therefore let the
// value END the link and hand the remainder back to the parser, which on an
// `html: true` page means raw HTML.
const BREAKOUT = ") <script>alert(2)</script> [x](/y";
const SPACED = "/a b/c";

for (const html of [true, false]) {
  test(`a static row value containing ")" cannot break out of the destination (html: ${html})`, () => {
    const page = compile(
      ["---", `html: ${html}`, "---", "", "@loop /rows.json into r", "[go]({ r.u })", "@endloop"],
      { shelf: { "rows.json": [{ u: BREAKOUT }] } }
    );
    const out = body(page);
    assert.doesNotMatch(out, /<script>/, "no script tag escaped the destination");
    assert.doesNotMatch(out, /alert\(2\)/, "the payload is not live anywhere in the page");
    // One link, and the whole value is inside its href.
    assert.equal(out.match(/<a /g).length, 1, "exactly one link, not a second one from the tail");
    const href = out.match(/<a href="([^"]*)"/)[1];
    assert.match(
      href,
      /^%29%20%3Cscript%3E/,
      "the payload is percent-encoded, starting at the `)`"
    );
    assert.doesNotMatch(
      href,
      /[()<>\s"']/,
      "no destination-terminating or tag-opening character survived"
    );
  });

  test(`a state value containing ")" is encoded in the painted href too (html: ${html})`, () => {
    const page = compile([
      "---",
      `html: ${html}`,
      "---",
      "",
      `:state u = ${JSON.stringify(BREAKOUT)}`,
      "",
      "[go]({ u })"
    ]);
    const out = body(page);
    assert.doesNotMatch(out, /<script>/);
    assert.equal(out.match(/<a /g).length, 1);
    const href = out.match(/<a href="([^"]*)"/)[1];
    assert.match(href, /^%29%20%3Cscript%3E/);
    assert.doesNotMatch(href, /[()<>\s"']/);
    // The template still carries the reader, so the runtime repaints it live.
    assert.ok(out.includes(`data-wd-attr="${marker("href", ["s", "u", ""])}"`));
  });

  test(`a value containing a space still makes a link (html: ${html})`, () => {
    const page = compile(
      ["---", `html: ${html}`, "---", "", "@loop /rows.json into r", "[go]({ r.u })", "@endloop"],
      { shelf: { "rows.json": [{ u: SPACED }] } }
    );
    assert.match(
      body(page),
      /<a href="\/a%20b\/c">go<\/a>/,
      "the space is encoded, so the link survives"
    );
  });

  test(`a state value containing a space still makes a bound link (html: ${html})`, () => {
    const page = compile([
      "---",
      `html: ${html}`,
      "---",
      "",
      `:state u = ${JSON.stringify(SPACED)}`,
      "",
      "[go]({ u })"
    ]);
    assert.match(body(page), /<a href="\/a%20b\/c" data-wd-attr=/);
  });
}

test("NEGATIVE CONTROL: the raw value is what would have escaped", () => {
  // Guards the test above from passing for the wrong reason: without encoding,
  // this is exactly the string that would have been spliced into the markdown.
  assert.ok(BREAKOUT.includes(")"), "the payload really does contain the destination terminator");
  assert.ok(SPACED.includes(" "));
});

test("a destination inside an inline code span is documentation, not a binding", () => {
  // A STATIC value is what makes this observable: it is spliced into the source
  // outright, so an unmasked code span DOCUMENTING the syntax would silently
  // show the resolved URL instead of the `{ … }` the author typed.
  const page = compile(
    [
      "@loop /rows.json into p",
      "Write `[x](/p/{ p.slug }/)` to link to { p.slug }.",
      "",
      "[real](/p/{ p.slug }/)",
      "@endloop"
    ],
    { shelf: { "rows.json": [{ slug: "alpha" }] } }
  );
  const out = body(page);
  assert.match(
    out,
    /<code>\[x\]\(\/p\/\{ p\.slug \}\/\)<\/code>/,
    "the code span kept the author's braces"
  );
  assert.doesNotMatch(out, /<code>[^<]*alpha/, "the value was not spliced into the documentation");
  // ...and the real one outside the span still resolves.
  assert.match(out, /<a href="\/p\/alpha\/">real<\/a>/);
});

test("a code span on the same line as a real destination masks only itself", () => {
  const page = compile(
    ["@loop /rows.json into p", "Use `](/p/{ p.slug }/)` for [this](/p/{ p.slug }/).", "@endloop"],
    { shelf: { "rows.json": [{ slug: "alpha" }] } }
  );
  const out = body(page);
  assert.match(out, /<code>\]\(\/p\/\{ p\.slug \}\/\)<\/code>/);
  assert.match(out, /<a href="\/p\/alpha\/">this<\/a>/);
});

test("a reactive destination inside a code span stays the author's source too", () => {
  const page = compile([
    ':state slug = "live"',
    "",
    "Write `[x](/p/{ slug }/)` to bind a destination.",
    "",
    "[real](/p/{ slug }/)"
  ]);
  const out = body(page);
  assert.match(out, /<code>\[x\]\(\/p\/\{ slug \}\/\)<\/code>/);
  assert.doesNotMatch(out, /<code>[^<]*wd-attr/, "no placeholder leaked into the documentation");
  assert.match(out, /<a href="\/p\/live\/" data-wd-attr=/);
});

// --- finding 3: a brace in a raw-HTML URL attribute ------------------------

const RAW_HTML = ["---", "html: true", "---", ""];

for (const scheme of [
  "javascript:alert(4)",
  "JaVaScRiPt:alert(4)",
  " javascript:alert(4)",
  "data:text/html,<b>x</b>",
  "vbscript:msgbox"
]) {
  test(`a raw-HTML href resolving to ${JSON.stringify(scheme)} is emitted empty`, () => {
    const page = compile(
      [...RAW_HTML, "@loop /rows.json into r", '<a href="{ r.u }">go</a>', "@endloop"],
      {
        shelf: { "rows.json": [{ u: scheme }] }
      }
    );
    const out = body(page);
    assert.match(out, /<a href="">go<\/a>/);
    assert.doesNotMatch(out, /script:/i);
    assert.equal(page.warnings.length, 1);
    assert.match(
      page.warnings[0],
      /index\.wd:\d+: "\{ r\.u \}" resolves to a javascript:, data: or vbscript: URL/
    );
    assert.match(page.warnings[0], /Use an https:, mailto: or site-relative value/);
  });
}

for (const allowed of [
  "https://example.com/x",
  "/local/path",
  "mailto:a@b.example",
  "#anchor",
  "../up/"
]) {
  test(`a raw-HTML href resolving to ${JSON.stringify(allowed)} is left alone`, () => {
    const page = compile(
      [...RAW_HTML, "@loop /rows.json into r", '<a href="{ r.u }">go</a>', "@endloop"],
      {
        shelf: { "rows.json": [{ u: allowed }] }
      }
    );
    assert.ok(body(page).includes(`<a href="${allowed}">go</a>`));
    assert.deepEqual(page.warnings, []);
  });
}

test("every URL-bearing attribute is guarded, and a non-URL attribute is not", () => {
  const page = compile(
    [
      ...RAW_HTML,
      "@loop /rows.json into r",
      '<a href="{ r.u }">a</a>',
      "<img src='{ r.u }' alt=x>",
      '<form action="{ r.u }"><button formaction="{ r.u }">b</button></form>',
      '<svg><use xlink:href="{ r.u }"></use></svg>',
      '<a title="{ r.u }">t</a>',
      "@endloop"
    ],
    { shelf: { "rows.json": [{ u: "javascript:alert(5)" }] } }
  );
  const out = body(page);
  assert.equal(out.match(/javascript:/g)?.length, 1, "only the title kept the value");
  assert.match(out, /<a title="javascript:alert\(5\)">/);
  assert.match(out, /<a href="">/);
  assert.match(out, /<img src='' alt=x/);
  assert.match(out, /<form action="">/);
  assert.match(out, /formaction=""/);
  assert.match(out, /xlink:href=""/);
  assert.equal(page.warnings.length, 5, "one warning per blocked attribute");
});

test("a :state value in a raw-HTML href is guarded as well as warned about", () => {
  const page = compile([
    ...RAW_HTML,
    ':state u = "javascript:alert(6)"',
    "",
    '<a href="{ u }">go</a>'
  ]);
  assert.match(body(page), /<a href="">go<\/a>/);
  assert.equal(page.warnings.length, 2, "the unbindable warning AND the scheme warning");
  assert.match(page.warnings[0], /raw HTML \(an attribute or an html block\) cannot bind/);
  assert.match(page.warnings[1], /resolves to a javascript:, data: or vbscript: URL/);
});

// ---------------------------------------------------------------------------
// Wave 2 — the guard runs on the ASSEMBLED attribute value, not on one brace.
// ---------------------------------------------------------------------------

test("a scheme split between a literal prefix and a value is still refused", () => {
  const page = compile(
    [...RAW_HTML, "@loop /rows.json into r", '<a href="java{ r.tail }">go</a>', "@endloop"],
    {
      shelf: { "rows.json": [{ tail: "script:alert(1)" }] }
    }
  );
  const out = body(page);
  assert.match(out, /<a href="">go<\/a>/, "the literal head goes with the refused value");
  assert.doesNotMatch(out, /javascript:/i);
  assert.equal(page.warnings.length, 1);
  assert.match(page.warnings[0], /resolves to a javascript:, data: or vbscript: URL/);
});

test("a scheme split across TWO values is refused when the second lands", () => {
  const page = compile(
    [...RAW_HTML, "@loop /rows.json into r", '<a href="{ r.a }{ r.b }">go</a>', "@endloop"],
    { shelf: { "rows.json": [{ a: "java", b: "script:alert(1)" }] } }
  );
  const out = body(page);
  assert.match(out, /<a href="">go<\/a>/, "the half already written is dropped too");
  assert.doesNotMatch(out, /javascript:/i);
  assert.equal(page.warnings.length, 1, "one warning, on the brace that tipped it");
});

test("the split shape is caught in every URL-bearing attribute", () => {
  const page = compile(
    [
      ...RAW_HTML,
      "@loop /rows.json into r",
      '<a href="java{ r.tail }">a</a>',
      "<img src='java{ r.tail }' alt=x>",
      '<form action="java{ r.tail }"><button formaction="java{ r.tail }">b</button></form>',
      '<svg><use xlink:href="java{ r.tail }"></use></svg>',
      "@endloop"
    ],
    { shelf: { "rows.json": [{ tail: "script:alert(1)" }] } }
  );
  const out = body(page);
  assert.doesNotMatch(out, /javascript:/i, "not one of the five got through");
  assert.match(out, /<a href="">/);
  assert.match(out, /<img src=''/);
  assert.match(out, /<form action="">/);
  assert.match(out, /formaction=""/);
  assert.match(out, /xlink:href=""/);
  assert.equal(page.warnings.length, 5, "one per refused attribute");
});

test("CONTROL: a harmless prefix keeps its value, scheme-looking or not", () => {
  const page = compile(
    [
      ...RAW_HTML,
      "@loop /rows.json into r",
      '<a href="/p/{ r.slug }">a</a>',
      '<a href="/go/{ r.tail }">b</a>',
      "@endloop"
    ],
    { shelf: { "rows.json": [{ slug: "alpha", tail: "javascript:alert(1)" }] } }
  );
  const out = body(page);
  assert.ok(out.includes('<a href="/p/alpha">a</a>'), "an ordinary value is untouched");
  // `/go/javascript:alert(1)` is a relative path, not a javascript: URL, and a
  // guard that blanked it would be refusing safe pages.
  assert.ok(out.includes('<a href="/go/javascript:alert(1)">b</a>'));
  assert.deepEqual(page.warnings, []);
});

// --- the compile-time guard tests the RAW value, like the runtime does -------

const LEADING_SPACE = " javascript:alert(1)";

test("a static destination value is scheme-checked BEFORE encoding", () => {
  const page = compile(["@loop /rows.json into r", "[go]({ r.u })", "@endloop"], {
    shelf: { "rows.json": [{ u: LEADING_SPACE }] }
  });
  const out = body(page);
  assert.match(out, /<a href="">go<\/a>/, "refused, not shipped as %20javascript:…");
  assert.doesNotMatch(out, /%20javascript/i);
  assert.equal(page.warnings.length, 1);
  assert.match(page.warnings[0], /index\.wd:\d+: "\{ r\.u \}" resolves to a javascript:/);
});

test("a bound destination's painted seed is scheme-checked BEFORE encoding", () => {
  const page = compile([`:state u = ${JSON.stringify(LEADING_SPACE)}`, "", "[go]({ u })"]);
  const out = body(page);
  assert.match(
    out,
    /<a href="" data-wd-attr=/,
    "the paint is empty, exactly as applyAttr would leave it"
  );
  assert.doesNotMatch(out, /%20javascript/i);
  // The binding itself survives: the runtime re-tests the live value.
  assert.ok(out.includes(`data-wd-attr="${marker("href", ["s", "u", ""])}"`));
});

test("CONTROL: the same value one character shorter is a normal relative URL", () => {
  const page = compile(["@loop /rows.json into r", "[go]({ r.u })", "@endloop"], {
    shelf: { "rows.json": [{ u: "/a javascript:alert(1)" }] }
  });
  assert.match(body(page), /<a href="\/a%20javascript:alert%281%29">go<\/a>/);
  assert.deepEqual(body(page).match(/<a /g).length, 1);
});
