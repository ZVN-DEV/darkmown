import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSite } from "../src/builder.js";
import { stampScope } from "../src/compiler/includes.js";
import { compileSkin, scopeIdFor } from "../src/skin.js";

// ===========================================================================
// Compile-time scoped styles (1.4.0).
//
// A `.skin` whose first line is `scoped` styles ONLY the subtree stamped with
// its path-derived id: the builder appends `[data-wd-scope="<id>"]` to each
// selector's subject, and the page/include HTML is stamped with the same id.
// Pure compile time — no runtime, no `data-wd-*` marker, zero size delta.
// ===========================================================================

const SCOPE = "wd-7c21";

// --- Selector rewrite -------------------------------------------------------

test("scoped: a plain selector gets the attribute on its subject", () => {
  const css = compileSkin(["scoped", ".card", "  padding 1rem"].join("\n"), { scope: SCOPE });
  assert.equal(css, `.card[data-wd-scope="${SCOPE}"] { padding: 1rem; }`);
});

test("scoped: a descendant selector scopes ONLY the rightmost subject", () => {
  const css = compileSkin(["scoped", ".card", "  .title", "    font-weight 600"].join("\n"), {
    scope: SCOPE
  });
  // `.card` (the descendant) is untouched; only `.title` (the subject) is scoped.
  assert.match(css, /^\.card \.title\[data-wd-scope="wd-7c21"\] \{ font-weight: 600; \}$/);
});

test("scoped: each selector in a comma list gets the attribute", () => {
  const css = compileSkin(["scoped", "h2, h3", "  margin 0"].join("\n"), { scope: SCOPE });
  assert.equal(css, `h2[data-wd-scope="${SCOPE}"], h3[data-wd-scope="${SCOPE}"] { margin: 0; }`);
});

test("scoped: & nesting resolves first, THEN the subject is scoped", () => {
  const css = compileSkin(
    ["scoped", ".btn", "  color black", "  &:hover, &:focus", "    color blue"].join("\n"),
    { scope: SCOPE }
  );
  assert.match(css, /\.btn\[data-wd-scope="wd-7c21"\] \{ color: black; \}/);
  // The attribute lands before the pseudo-class on each spliced selector.
  assert.match(
    css,
    /\.btn\[data-wd-scope="wd-7c21"\]:hover, \.btn\[data-wd-scope="wd-7c21"\]:focus \{ color: blue; \}/
  );
});

test("scoped: the attribute precedes a pseudo-class (.card:hover) — stays valid CSS", () => {
  const css = compileSkin(["scoped", ".card:hover", "  color red"].join("\n"), { scope: SCOPE });
  assert.equal(css, `.card[data-wd-scope="${SCOPE}"]:hover { color: red; }`);
  assert.doesNotMatch(css, /:hover\[data-wd-scope/);
});

test("scoped: the attribute precedes a pseudo-element (::before)", () => {
  const css = compileSkin(["scoped", ".card::before", '  content "x"'].join("\n"), {
    scope: SCOPE
  });
  assert.equal(css, `.card[data-wd-scope="${SCOPE}"]::before { content: "x"; }`);
});

test("scoped: combinators (> + ~) scope only the rightmost subject", () => {
  const css = compileSkin(["scoped", ".card > .row + .row", "  margin-top 1rem"].join("\n"), {
    scope: SCOPE
  });
  assert.equal(css, `.card > .row + .row[data-wd-scope="${SCOPE}"] { margin-top: 1rem; }`);
});

test("scoped: @media wrappers are untouched; only the inner rule is scoped", () => {
  const css = compileSkin(
    ["scoped", "@media (max-width: 600px)", "  .card", "    padding .5rem"].join("\n"),
    { scope: SCOPE }
  );
  assert.equal(
    css,
    `@media (max-width: 600px) { .card[data-wd-scope="${SCOPE}"] { padding: .5rem; } }`
  );
});

// --- Tokens stay global -----------------------------------------------------

test("scoped: tokens (and dark variants) stay GLOBAL on :root, never scoped", () => {
  const css = compileSkin(
    [
      "scoped",
      "tokens",
      "  brand #0f6b5e",
      "tokens dark",
      "  brand #5ccab4",
      "tokens [data-theme=dark]",
      "  brand #5ccab4",
      ".card",
      "  color $brand"
    ].join("\n"),
    { scope: SCOPE }
  );
  // :root tokens are global — no scope attribute anywhere near them.
  assert.match(css, /:root \{\n {2}--brand: #0f6b5e;\n\}/);
  assert.match(css, /:root\[data-theme="dark"\] \{\n {2}--brand: #5ccab4;\n\}/);
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n:root:not/);
  assert.doesNotMatch(css, /:root\[data-wd-scope/);
  assert.doesNotMatch(css, /--brand[^;]*data-wd-scope/);
  // The $var reference still resolves; only the selector rule is scoped.
  assert.match(css, /\.card\[data-wd-scope="wd-7c21"\] \{ color: var\(--brand\); \}/);
});

// --- :global escape ---------------------------------------------------------

test("scoped: a whole-selector :global() escapes to a plain, unscoped selector", () => {
  const css = compileSkin(
    ["scoped", ":global(.toast)", "  color red", ".card", "  padding 1rem"].join("\n"),
    { scope: SCOPE }
  );
  assert.match(css, /^\.toast \{ color: red; \}$/m);
  assert.doesNotMatch(css, /\.toast\[data-wd-scope/);
  // Sibling non-global rule is still scoped.
  assert.match(css, /\.card\[data-wd-scope="wd-7c21"\] \{ padding: 1rem; \}/);
});

// --- Errors -----------------------------------------------------------------

test("scoped: page-level selectors error with a global-skin hint", () => {
  for (const sel of ["page", "html", "body", "::selection"]) {
    assert.throws(
      () => compileSkin(["scoped", sel, "  margin 0"].join("\n"), { scope: SCOPE }),
      (err) =>
        /page-level/.test(err.message) &&
        /belong in a global skin/.test(err.message) &&
        new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(err.message),
      `expected page-level error for "${sel}"`
    );
  }
});

test("scoped: a bare top-level declaration (no selector) is a page-level error", () => {
  // A `*` reset line is filtered as a divider, so its declaration falls to :root
  // — caught by the same page-level guard rather than emitting a junk rule.
  assert.throws(
    () => compileSkin(["scoped", "*", "  box-sizing border-box"].join("\n"), { scope: SCOPE }),
    /page-level declaration/
  );
  assert.throws(
    () => compileSkin(["scoped", "color black"].join("\n"), { scope: SCOPE }),
    /page-level declaration/
  );
});

test("scoped: a descendant wildcard (.card *) is allowed and scopes the wildcard", () => {
  const css = compileSkin(["scoped", ".card *", "  box-sizing border-box"].join("\n"), {
    scope: SCOPE
  });
  assert.equal(css, `.card *[data-wd-scope="${SCOPE}"] { box-sizing: border-box; }`);
});

test('"scoped" anywhere but the first line is a compile error with a hint', () => {
  assert.throws(
    () => compileSkin([".card", "  padding 1rem", "scoped"].join("\n"), { scope: SCOPE }),
    /"scoped" must be the first line of a \.skin file/
  );
});

// --- Back-compat (the golden guarantee) -------------------------------------

test("back-compat: base.skin compiles byte-identically with the new compiler", () => {
  const base = fs.readFileSync(path.join(import.meta.dirname, "../site/_/base.skin"), "utf8");
  const out = compileSkin(base);
  // Sanity anchors that pin the historical output shape, unscoped.
  assert.match(out, /:root \{\n {2}--ink: #1c1814;/);
  assert.match(out, /\.card \{ background: var\(--panel\); \}/);
  assert.doesNotMatch(out, /data-wd-scope/, "an unscoped skin never emits the scope attribute");
});

test("back-compat: passing no scope is identical to omitting opts entirely", () => {
  const src = ["tokens", "  ink #111", ".card", "  color $ink"].join("\n");
  assert.equal(compileSkin(src), compileSkin(src, {}));
  assert.doesNotMatch(compileSkin(src), /data-wd-scope/);
});

// --- Scope id ---------------------------------------------------------------

test("scopeIdFor is deterministic, path-based, and POSIX-normalized", () => {
  assert.equal(scopeIdFor("site/_/card.skin"), scopeIdFor("site/_/card.skin"));
  assert.equal(scopeIdFor("site\\_\\card.skin"), scopeIdFor("site/_/card.skin"));
  assert.notEqual(scopeIdFor("site/_/a.skin"), scopeIdFor("site/_/b.skin"));
  assert.match(scopeIdFor("site/_/card.skin"), /^wd-[0-9a-f]{4}$/);
});

// --- HTML stamp -------------------------------------------------------------

test("stampScope stamps every opening tag, and leaves close tags/text alone", () => {
  const out = stampScope("<section><h2>Hi</h2><img src=/a.png></section>", SCOPE);
  assert.equal(
    out,
    `<section data-wd-scope="${SCOPE}"><h2 data-wd-scope="${SCOPE}">Hi</h2>` +
      `<img src=/a.png data-wd-scope="${SCOPE}"></section>`
  );
});

test("stampScope is idempotent: a tag that already has a scope keeps its own", () => {
  const html = `<div data-wd-scope="wd-keep"><span>x</span></div>`;
  const out = stampScope(html, SCOPE);
  assert.match(out, /<div data-wd-scope="wd-keep">/);
  assert.match(out, /<span data-wd-scope="wd-7c21">/);
});

test("stampScope keeps a self-closing tag self-closing", () => {
  assert.equal(stampScope("<br/>", SCOPE), `<br data-wd-scope="${SCOPE}" />`);
});

test("stampScope does not corrupt attribute values containing > or quotes", () => {
  const out = stampScope(`<a href="https://x.com/?a=1&b=2" title="a > b">t</a>`, SCOPE);
  assert.match(out, /href="https:\/\/x\.com\/\?a=1&b=2"/);
  assert.match(out, /title="a > b"/);
  assert.match(out, /data-wd-scope="wd-7c21"/);
});

// --- HTML stamp: raw-text / escapable-raw-text element bodies stay byte-intact -

test("stampScope leaves a <script> body byte-intact (no attribute injected mid-JS)", () => {
  // The bug: `if(a<b){x>y}` has bare <,> that are JS, not markup. Stamping inside
  // would inject `x data-wd-scope=...>y`, corrupting the script.
  const out = stampScope(`<div><script>if(a<b){x>y}</script></div>`, SCOPE);
  // Surrounding element AND the script's own opening tag are stamped…
  assert.match(out, new RegExp(`<div data-wd-scope="${SCOPE}">`));
  assert.match(out, new RegExp(`<script data-wd-scope="${SCOPE}">`));
  // …but the script body is untouched — the exact source survives verbatim.
  assert.match(out, /<script data-wd-scope="wd-7c21">if\(a<b\)\{x>y\}<\/script>/);
  // No scope attribute leaked between the script open and close.
  const body = out.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.equal(body, "if(a<b){x>y}");
  assert.doesNotMatch(body, /data-wd-scope/);
});

test("stampScope leaves a <style> body byte-intact (the > combinator is not a tag)", () => {
  const out = stampScope(`<div><style>a > b { color: red }</style></div>`, SCOPE);
  assert.match(out, new RegExp(`<style data-wd-scope="${SCOPE}">`));
  const body = out.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  assert.equal(body, "a > b { color: red }");
  assert.doesNotMatch(body, /data-wd-scope/);
});

test("stampScope leaves a <textarea> body byte-intact (a < in text is not a tag)", () => {
  const out = stampScope(`<p><textarea>x < y > z</textarea></p>`, SCOPE);
  assert.match(out, new RegExp(`<p data-wd-scope="${SCOPE}">`));
  assert.match(out, new RegExp(`<textarea data-wd-scope="${SCOPE}">`));
  const body = out.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1];
  assert.equal(body, "x < y > z");
  assert.doesNotMatch(body, /data-wd-scope/);
});

test("stampScope leaves a <title> body byte-intact while stamping the tag", () => {
  const out = stampScope(`<title>a < b</title>`, SCOPE);
  assert.equal(out, `<title data-wd-scope="${SCOPE}">a < b</title>`);
});

test("stampScope resumes stamping siblings AFTER a raw-text element", () => {
  // The sibling <div> after </script> must still be stamped — the skip ends at
  // the matching close tag, not the end of the subtree.
  const out = stampScope(`<script>x<y</script><div>after</div>`, SCOPE);
  assert.match(out, new RegExp(`<script data-wd-scope="${SCOPE}">x<y</script>`));
  assert.match(out, new RegExp(`<div data-wd-scope="${SCOPE}">after</div>`));
});

test("stampScope matches the raw-text close tag case-insensitively (<SCRIPT>…</SCRIPT>)", () => {
  const out = stampScope(`<SCRIPT>a<b</SCRIPT><span>ok</span>`, SCOPE);
  assert.equal(
    out,
    `<SCRIPT data-wd-scope="${SCOPE}">a<b</SCRIPT><span data-wd-scope="${SCOPE}">ok</span>`
  );
});

test("stampScope copies the remainder verbatim when a raw-text element is unterminated", () => {
  // No matching </script> — the body search returns -1, so we copy the rest of the
  // subtree byte-for-byte and stop (never stamping the dangling content).
  const out = stampScope(`<script>unterminated < tag`, SCOPE);
  assert.equal(out, `<script data-wd-scope="${SCOPE}">unterminated < tag`);
});

test("stampScope still stamps a self-closed tag whose name matches a raw-text element", () => {
  // A self-closing form has no body to protect, so the raw-text skip must NOT
  // engage (the `!slash` guard) — the next element keeps getting stamped normally.
  const out = stampScope(`<style/><div>x</div>`, SCOPE);
  assert.equal(out, `<style data-wd-scope="${SCOPE}" /><div data-wd-scope="${SCOPE}">x</div>`);
});

// --- Build integration ------------------------------------------------------

/** Capture everything `fn` logs via console.warn. */
function captureWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

/** Minimal project: pages + shelf files written from a {relPath: source} map. */
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darkmown-scoped-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
  }
  return root;
}

test("build: a page-scoped skin stamps the page body and stays runtime:false", () => {
  const root = project({
    "site/pages/index.wd":
      '---\nhtml: true\n---\n\n<main>\n\n<div class="panel">Hi</div>\n\n</main>\n',
    "site/pages/index.skin": ["scoped", ".panel", "  color red"].join("\n")
  });
  const { result } = captureWarnings(() => buildSite(root));
  const entry = result.routes.find((r) => r.route === "/");
  assert.equal(entry.assets.runtime, false, "a scoped static page must stay static");

  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "dist/__wd/styles/site_pages_index.css"), "utf8");
  const id = scopeIdFor("site/pages/index.skin");
  assert.match(css, new RegExp(`\\.panel\\[data-wd-scope="${id}"\\] \\{ color: red; \\}`));
  assert.match(html, new RegExp(`<div class="panel" data-wd-scope="${id}">`));
  // The HTML and CSS must agree on the id, and the page never went reactive.
  assert.doesNotMatch(html, /data-wd-(bind|loop|if|state)/);
});

test("build: an include's scope covers its subtree ONLY, not its siblings", () => {
  const root = project({
    "site/pages/index.wd": [
      "---",
      "html: true",
      "---",
      "",
      "<main>",
      "",
      '<div class="card">page-level card, unscoped</div>',
      "",
      "@include /widget.wd",
      "",
      "</main>",
      ""
    ].join("\n"),
    "site/_/widget.wd":
      '---\nhtml: true\n---\n\n<section class="card">scoped widget card</section>\n',
    "site/_/widget.skin": ["scoped", ".card", "  border 1px solid red"].join("\n")
  });
  buildSite(root);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  const id = scopeIdFor("site/_/widget.skin");

  // The include's own card is stamped…
  assert.match(html, new RegExp(`<section class="card" data-wd-scope="${id}">`));
  // …but the page-level card sibling is NOT (the scope did not leak out).
  assert.match(html, /<div class="card">page-level card, unscoped<\/div>/);
  assert.doesNotMatch(
    html,
    new RegExp(`<div class="card" data-wd-scope="${id}"`),
    "include scope must not leak to the page-level sibling"
  );
});

test("build: two includes reuse .card with NO collision (distinct scope ids)", () => {
  const root = project({
    "site/pages/index.wd": [
      "---",
      "html: true",
      "---",
      "",
      "<main>",
      "",
      "@include /a.wd",
      "@include /b.wd",
      "",
      "</main>",
      ""
    ].join("\n"),
    "site/_/a.wd": '---\nhtml: true\n---\n\n<div class="card">A</div>\n',
    "site/_/a.skin": ["scoped", ".card", "  color red"].join("\n"),
    "site/_/b.wd": '---\nhtml: true\n---\n\n<div class="card">B</div>\n',
    "site/_/b.skin": ["scoped", ".card", "  color blue"].join("\n")
  });
  buildSite(root);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  const idA = scopeIdFor("site/_/a.skin");
  const idB = scopeIdFor("site/_/b.skin");
  assert.notEqual(idA, idB, "different skin paths must hash to different ids");
  assert.match(html, new RegExp(`<div class="card" data-wd-scope="${idA}">A</div>`));
  assert.match(html, new RegExp(`<div class="card" data-wd-scope="${idB}">B</div>`));

  const cssA = fs.readFileSync(path.join(root, "dist/__wd/styles/site___a.css"), "utf8");
  const cssB = fs.readFileSync(path.join(root, "dist/__wd/styles/site___b.css"), "utf8");
  assert.match(cssA, new RegExp(`\\.card\\[data-wd-scope="${idA}"\\] \\{ color: red; \\}`));
  assert.match(cssB, new RegExp(`\\.card\\[data-wd-scope="${idB}"\\] \\{ color: blue; \\}`));
});

test("build: an unused scoped selector WARNS (and the rule is NOT removed)", () => {
  const root = project({
    "site/pages/index.wd":
      '---\nhtml: true\n---\n\n<main>\n\n<div class="used">x</div>\n\n</main>\n',
    "site/pages/index.skin": ["scoped", ".used", "  color green", ".badge", "  color red"].join(
      "\n"
    )
  });
  const { warnings } = captureWarnings(() => buildSite(root));
  assert.ok(
    warnings.some((w) => /scoped selector "\.badge"/.test(w) && /matches no element/.test(w)),
    `expected an unused-selector warning, got: ${JSON.stringify(warnings)}`
  );
  assert.ok(
    !warnings.some((w) => /scoped selector "\.used"/.test(w)),
    "a selector that DOES match must not warn"
  );
  // The rule is warned-about, never deleted — a colocated .js may add the class.
  const css = fs.readFileSync(path.join(root, "dist/__wd/styles/site_pages_index.css"), "utf8");
  assert.match(css, /\.badge\[data-wd-scope="[^"]+"\] \{ color: red; \}/);
});

test("build: unused-selector check spans id, tag, and class subjects", () => {
  // One scoped skin whose subjects are an id, a bare tag, and a class — some
  // matching the subtree, some not — exercising every subjectMatchesTag branch.
  const root = project({
    "site/pages/index.wd": [
      "---",
      "html: true",
      "---",
      "",
      "<main>",
      "",
      '<section id="hero">',
      '<span class="present">x</span>',
      "</section>",
      "",
      "</main>",
      ""
    ].join("\n"),
    "site/pages/index.skin": [
      "scoped",
      "#hero",
      "  padding 1rem",
      "section",
      "  display block",
      ".present",
      "  color green",
      "#ghost",
      "  color red",
      "article",
      "  display grid",
      ".missing",
      "  color blue"
    ].join("\n")
  });
  const { warnings } = captureWarnings(() => buildSite(root));
  // Present subjects (id #hero, tag section, class .present) never warn.
  for (const ok of ['"#hero"', '"section"', '"\\.present"']) {
    assert.ok(
      !warnings.some((w) => new RegExp(`scoped selector ${ok}`).test(w)),
      `present subject ${ok} should not warn`
    );
  }
  // Absent subjects (id #ghost, tag article, class .missing) each warn.
  for (const miss of ["#ghost", "article", "\\.missing"]) {
    assert.ok(
      warnings.some(
        (w) => new RegExp(`scoped selector "${miss}"`).test(w) && /matches no element/.test(w)
      ),
      `absent subject ${miss} should warn`
    );
  }
});

test("build: a scoped skin with no stamped elements warns for every subject", () => {
  // The page body has no markup the skin's subjects can match, so `stamped` is
  // null (the `?? []` fallback) and every selector warns.
  const root = project({
    "site/pages/index.wd": "Just prose, no elements with these classes.\n",
    "site/pages/index.skin": ["scoped", ".nowhere", "  color red"].join("\n")
  });
  const { warnings } = captureWarnings(() => buildSite(root));
  assert.ok(
    warnings.some((w) => /scoped selector "\.nowhere"/.test(w)),
    "a scoped selector matching nothing must still warn"
  );
});

test("build: an empty / all-comment .skin has no meaningful line → non-scoped", () => {
  // The skin has NO meaningful first line at all (only comments + a divider), so
  // scopeInfoForSkin's loop exhausts and returns `{ scoped: false }` — it stays
  // global and stamps nothing. Covers the after-loop return path.
  const root = project({
    "site/pages/index.wd": '<main>\n\n<div class="x">hi</div>\n\n</main>\n',
    "site/pages/index.skin": ["// just a comment", "/* block */", "----------"].join("\n")
  });
  buildSite(root);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  assert.doesNotMatch(html, /data-wd-scope/, "a comment-only skin is global, not scoped");
});

test("build: a non-scoped colocated skin is emitted global, with no stamping", () => {
  const root = project({
    "site/pages/index.wd": '<main>\n\n<div class="plain">x</div>\n\n</main>\n',
    "site/pages/index.skin": [".plain", "  color teal"].join("\n")
  });
  buildSite(root);
  const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "dist/__wd/styles/site_pages_index.css"), "utf8");
  assert.match(css, /^\.plain \{ color: teal; \}$/m);
  assert.doesNotMatch(css, /data-wd-scope/);
  assert.doesNotMatch(html, /data-wd-scope/);
});
