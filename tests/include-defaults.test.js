// ---------------------------------------------------------------------------
// Include argument defaults: an include file's `defaults: [name="value" …]`
// frontmatter supplies fallback values for `with` arguments the caller did not
// pass. Before this, a missing `with` arg rendered `{ title }` literally and no
// pipe could rescue it (the name never resolved, so the pipe never ran).
//
// The contract: defaults apply only inside the include that declares them, a
// caller-provided `with` argument always wins, values are strings (frontmatter
// is string-typed), and an arg with neither caller value nor default keeps the
// old literal-braces behavior. A malformed entry is a coded error (WD613).
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

/** Compile a page including /card.wd and return its body HTML. */
function body(pageSource, cardSource) {
  return compile({
    "site/pages/index.wd": pageSource,
    "site/_/card.wd": cardSource
  });
}

/** Compile an in-memory project and return the page's body HTML. */
function compile(files) {
  const page = compileFromMemory(files, "site/pages/index.wd", { cwd: "/proj" });
  return (page.html.match(/<main[^>]*>([\s\S]*?)<\/main>/) ?? ["", ""])[1];
}

const CARD =
  '---\ndefaults: [title="Untitled", cta="Learn more"]\n---\n\n**{ title }** — { cta }\n';

test("a caller-provided with argument always wins over the default", () => {
  const html = body('@include /card.wd with title="Pricing"', CARD);
  assert.match(html, /<strong>Pricing<\/strong>/);
  assert.doesNotMatch(html, /Untitled/);
  // Untouched args still fall back to their defaults.
  assert.match(html, /Learn more/);
});

test("the default applies when the caller passes nothing", () => {
  const html = body("@include /card.wd", CARD);
  assert.match(html, /<strong>Untitled<\/strong>/);
  assert.match(html, /Learn more/);
});

test("an arg with neither caller value nor default stays literal braces", () => {
  const html = body("@include /card.wd", "{ title } and { missing }\n");
  assert.match(html, /\{ title \} and \{ missing \}/);
});

test("defaults are scoped to the include — the page's own { title } stays literal", () => {
  const html = body("@include /card.wd\n\nPage: { title }\n", CARD);
  assert.match(html, /<strong>Untitled<\/strong>/);
  assert.match(html, /Page: \{ title \}/);
});

test("defaults values are strings, and a typed caller argument still wins", () => {
  const files = (page) => ({
    "site/pages/index.wd": page,
    "site/_/n.wd": '---\ndefaults: [count="3"]\n---\n\nCount { count }.\n'
  });
  assert.match(compile(files("@include /n.wd\n")), /Count 3\./);
  assert.match(compile(files("@include /n.wd with count=5\n")), /Count 5\./);
});

test("a single-quoted default value parses", () => {
  const html = body("@include /card.wd\n", "---\ndefaults: [cta='Go']\n---\n\n{ cta }\n");
  assert.match(html, /<p>Go<\/p>/);
});

test("a default value may contain a comma (the splitter is quote-aware)", () => {
  const html = body(
    "@include /card.wd\n",
    '---\ndefaults: [cta="Learn more, today"]\n---\n\n{ cta }\n'
  );
  assert.match(html, /Learn more, today/);
});

test("an empty defaults array is legal and defaults nothing", () => {
  const html = body("@include /card.wd\n", "---\ndefaults: []\n---\n\n{ title }\n");
  assert.match(html, /\{ title \}/);
});

// --- WD613: malformed defaults ----------------------------------------------

/** The compile error a card with the given frontmatter throws, or null. */
function defaultsError(defaultsLine) {
  try {
    body("@include /card.wd\n", `---\n${defaultsLine}\n---\n\nx\n`);
  } catch (err) {
    return /** @type {Error} */ (err);
  }
  return null;
}

test("a non-array defaults value is WD613", () => {
  const err = defaultsError('defaults: title="Untitled"');
  assert.match(err?.message, /^\[WD613\] /);
  assert.match(err?.message, /must be an inline array/);
});

test('a defaults entry without ="value" is WD613 and names the entry', () => {
  const err = defaultsError("defaults: [title]");
  assert.match(err?.message, /^\[WD613\] /);
  assert.match(err?.message, /entry "title" must look like name="value"/);
});

test("an unquoted defaults value is WD613", () => {
  const err = defaultsError("defaults: [title=Untitled]");
  assert.match(err?.message, /^\[WD613\] /);
});

test("an unterminated quote leaves a malformed entry (WD613)", () => {
  const err = defaultsError('defaults: [title="Untitled]');
  assert.match(err?.message, /^\[WD613\] /);
});
