// ---------------------------------------------------------------------------
// Block-form @include: `@include /card.wd … @endinclude` is compile-time macro
// expansion. The lines between opener and closer compile in the CALLER's
// context (its scope, its :state, its loop item), once, at build time; the
// include places the result with a standalone `{ children }` line. No runtime
// marker is added and a static page stays static.
//
// Pairing: `@endinclude` closes the nearest preceding unpaired `@include`. An
// opener that never pairs is the inline form (backward compatible), so there
// is deliberately no "unclosed block" error — an `@include` followed by prose
// is indistinguishable from one followed by children. The error cases are a
// stray closer (WD614) and nesting past one level (WD616).
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

/** Compile an in-memory project and return the full CompiledPage. */
function project(files) {
  return compileFromMemory(files, "site/pages/index.wd", { cwd: "/proj" });
}

/** Compile and return the page's body HTML. */
function body(files) {
  const page = project(files);
  return (page.html.match(/<main[^>]*>([\s\S]*?)<\/main>/) ?? ["", ""])[1];
}

/** The compile error the project throws, or null. */
function compileError(files) {
  try {
    project(files);
  } catch (err) {
    return /** @type {Error} */ (err);
  }
  return null;
}

const CARD = "::: card\n{ children }\n:::\n";

// --- the slot ---------------------------------------------------------------

test("children compile in the caller's scope and land at the { children } line", () => {
  const html = body({
    "site/pages/index.wd":
      '@include /card.wd with title="Hi"\n\nEverything is **children**.\n\n@endinclude\n',
    "site/_/card.wd": "---\ndefaults: []\n---\n\n::: card\n## { title }\n{ children }\n:::\n"
  });
  assert.match(html, /<h2[^>]*>Hi<\/h2>/);
  assert.match(html, /Everything is <strong>children<\/strong>\./);
  assert.doesNotMatch(html, /\{ children \}/);
});

test("children read the caller's :state (a reactive parent keeps working)", () => {
  const page = project({
    "site/pages/index.wd": ":state n = 7\n\n@include /card.wd\n\nCount: { n }\n\n@endinclude\n",
    "site/_/card.wd": CARD
  });
  const main = (page.html.match(/<main[^>]*>([\s\S]*?)<\/main>/) ?? ["", ""])[1];
  // The slot content is in the emitted HTML, bound to the caller's state…
  assert.match(main, /<div class="card">/);
  assert.match(main, /Count: <span data-wd-bind="n">7<\/span>/);
  // …and the page ships the runtime because of its own :state, exactly as it
  // would without the include — the slot itself adds no reactivity.
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /<script type="module" src="\/__wd\/runtime\.js"><\/script>/);
});

test("a fully static block include ships zero JS", () => {
  const page = project({
    "site/pages/index.wd": "@include /card.wd\n\nStatic slot.\n\n@endinclude\n",
    "site/_/card.wd": CARD
  });
  assert.equal(page.assets.runtime, false);
  assert.doesNotMatch(page.html, /runtime\.js/);
});

test("children inside a caller's static loop see the loop item", () => {
  const html = body({
    "site/pages/index.wd":
      "@loop /rows.json into r\n@include /card.wd\n{r.name}\n@endinclude\n@endloop\n",
    "site/_/rows.json": JSON.stringify([{ name: "Aurora" }, { name: "Briza" }]),
    "site/_/card.wd": CARD
  });
  assert.match(html, /<div class="card">[\s\S]*?<p>Aurora<\/p>/);
  assert.match(html, /<div class="card">[\s\S]*?<p>Briza<\/p>/);
});

test("children inside a caller's reactive loop bind per row", () => {
  const page = project({
    "site/pages/index.wd":
      ':state rows = [{"name":"A"}]\n\n@loop rows into r\n@include /card.wd\n{r.name}\n@endinclude\n@endloop\n',
    "site/_/card.wd": CARD
  });
  // One row template, per-row bindings inside the spliced slot content.
  assert.match(page.html, /data-wd-each/);
  assert.equal(page.assets.runtime, true);
});

test("{ children } in an include called without a block renders empty", () => {
  const html = body({
    "site/pages/index.wd": "@include /card.wd\n",
    "site/_/card.wd": CARD
  });
  assert.match(html, /<div class="card">\s*<\/div>/);
  assert.doesNotMatch(html, /\{ children \}/);
});

test("{ children } on a top-level page stays literal text", () => {
  const html = body({ "site/pages/index.wd": "Slot: { children }\n\n{ children }\n" });
  assert.match(html, /\{ children \}/);
});

test("an include may place { children } twice (macro expansion)", () => {
  const html = body({
    "site/pages/index.wd": "@include /card.wd\n\n**X**\n\n@endinclude\n",
    "site/_/card.wd": "::: a\n{ children }\n:::\n::: b\n{ children }\n:::\n"
  });
  assert.equal(html.match(/<strong>X<\/strong>/g)?.length, 2);
});

// --- the drop hint ------------------------------------------------------------

test("a block passed to an include that never uses { children } warns it is dropped", () => {
  const page = project({
    "site/pages/index.wd": "@include /plain.wd\n\ndropped stuff\n\n@endinclude\n",
    "site/_/plain.wd": "no slot here\n"
  });
  assert.equal(page.warnings.length, 1);
  assert.match(page.warnings[0], /never uses a \{ children \} line, so the content is dropped/);
});

test("a .md include cannot host a slot, so the drop hint still fires", () => {
  const page = project({
    "site/pages/index.wd": "@include /plain.md\n\ndropped\n\n@endinclude\n",
    // Mentions the marker as prose — inert in .md, so it is NOT a slot.
    "site/_/plain.md": "prose mentioning { children } inline\n"
  });
  assert.equal(page.warnings.length, 1);
  assert.match(page.warnings[0], /content is dropped/);
});

test("a { children } line inside a fence is documentation, not a slot", () => {
  const page = project({
    "site/pages/index.wd": "@include /guide.wd\n\ndropped\n\n@endinclude\n",
    "site/_/guide.wd": "Usage:\n\n```wd\n{ children }\n```\n"
  });
  assert.equal(page.warnings.length, 1);
  assert.match(page.warnings[0], /content is dropped/);
  const main = (page.html.match(/<main[^>]*>([\s\S]*?)<\/main>/) ?? ["", ""])[1];
  assert.match(main, /\{ children \}/); // the fenced marker renders as code
});

// --- pairing ------------------------------------------------------------------

test("@endinclude pairs with the nearest preceding unpaired @include", () => {
  // An inline include AFTER a block opener claims the closer; the outer opener
  // falls back to the inline form. Deterministic, documented behavior.
  const html = body({
    "site/pages/index.wd": "@include /outer.wd\n@include /inner.wd\ntext\n@endinclude\n",
    "site/_/outer.wd": "outer\n",
    "site/_/inner.wd": "::: inner\n{ children }\n:::\n"
  });
  assert.match(html, /<p>outer<\/p>/);
  assert.match(html, /<div class="inner">[\s\S]*?<p>text<\/p>/);
});

test("a fenced @endinclude is never a closer", () => {
  const html = body({
    "site/pages/index.wd": "@include /nav.wd\n\n```wd\n@endinclude\n```\n",
    "site/_/nav.wd": "nav\n"
  });
  assert.match(html, /<p>nav<\/p>/);
  assert.match(html, /<code class="language-wd">@endinclude/);
});

test("a block include compiles its symbol with an endLine", () => {
  const page = project({
    "site/pages/index.wd": "@include /card.wd\n\nx\n\n@endinclude\n",
    "site/_/card.wd": CARD
  });
  const sym = page.symbols.find((s) => s.kind === "include");
  assert.equal(sym?.line, 1);
  assert.equal(sym?.endLine, 5);
});

// --- errors -------------------------------------------------------------------

test("@endinclude without an opener is WD614", () => {
  const err = compileError({ "site/pages/index.wd": "hello\n\n@endinclude\n" });
  assert.match(err?.message, /^\[WD614\] /);
  assert.match(err?.message, /Stray "@endinclude" with no unpaired @include/);
  assert.match(err?.message, /index\.wd:3/);
});

test("a closer left over after every opener paired is WD614", () => {
  const err = compileError({
    "site/pages/index.wd": "@include /card.wd\n\nx\n\n@endinclude\n\n@endinclude\n",
    "site/_/card.wd": CARD
  });
  assert.match(err?.message, /^\[WD614\] /);
});

// --- nesting ------------------------------------------------------------------

test("one level of block nesting inside an include body works", () => {
  const html = body({
    "site/pages/index.wd": "@include /card.wd\n\ncard children\n\n@endinclude\n",
    "site/_/card.wd": "{ children }\n\n@include /inner.wd\n\ninner children\n\n@endinclude\n",
    "site/_/inner.wd": "::: inner\n{ children }\n:::\n"
  });
  assert.match(html, /<p>card children<\/p>/);
  assert.match(html, /<div class="inner">[\s\S]*?<p>inner children<\/p>/);
});

test("one level of block nesting inside children works", () => {
  const html = body({
    "site/pages/index.wd":
      "@include /outer.wd\n\n@include /inner.wd\n\ninner children\n\n@endinclude\n\n@endinclude\n",
    "site/_/outer.wd": "::: outer\n{ children }\n:::\n",
    "site/_/inner.wd": "::: inner\n{ children }\n:::\n"
  });
  assert.match(
    html,
    /<div class="outer">[\s\S]*?<div class="inner">[\s\S]*?<p>inner children<\/p>/
  );
});

test("a block include inside a nested include's body is WD616", () => {
  const err = compileError({
    "site/pages/index.wd": "@include /card.wd\n\nc\n\n@endinclude\n",
    "site/_/card.wd": "{ children }\n\n@include /inner.wd\n\nic\n\n@endinclude\n",
    "site/_/inner.wd": "{ children }\n\n@include /deep.wd\n\ndc\n\n@endinclude\n",
    "site/_/deep.wd": "deep\n"
  });
  assert.match(err?.message, /^\[WD616\] /);
  assert.match(err?.message, /nested too deep/);
  assert.match(err?.message, /inner\.wd:3/);
});

test("a block include nested two levels deep in children is WD616", () => {
  const err = compileError({
    "site/pages/index.wd":
      "@include /a.wd\n\n@include /b.wd\n\n@include /c.wd\n\nx\n\n@endinclude\n\n@endinclude\n\n@endinclude\n",
    "site/_/a.wd": "::: a\n{ children }\n:::\n",
    "site/_/b.wd": "::: b\n{ children }\n:::\n",
    "site/_/c.wd": "::: c\n{ children }\n:::\n"
  });
  assert.match(err?.message, /^\[WD616\] /);
  assert.match(err?.message, /nested too deep/);
});

test("an inline include inside a nested include's body stays legal", () => {
  // The depth guard covers the BLOCK form only; inline includes compose freely.
  const html = body({
    "site/pages/index.wd": "@include /card.wd\n\nc\n\n@endinclude\n",
    "site/_/card.wd": "{ children }\n\n@include /inner.wd\n\nic\n\n@endinclude\n",
    "site/_/inner.wd": "{ children }\n\n@include /deep.wd\n",
    "site/_/deep.wd": "deep\n"
  });
  assert.match(html, /<p>deep<\/p>/);
});
