// A directive keyword ALONE on a line.
//
// Every dispatcher in `compileBody` matches `^:keyword\s`, so a line that is
// just `:state` matched none of them and fell through to prose — and because
// the `KNOWN_DIRECTIVE` warning list accepted `(?:\s|$)`, the "that looks like a
// directive" warning was suppressed too. The result was the worst possible
// outcome for an author (and for an AI edit loop): the literal text `:state`
// appeared on the page, silently, with the framework saying nothing.
//
// A bare directive is now handed to that directive's OWN handler with an empty
// body, so it throws that directive's coded malformed error with that
// directive's `Use:` hint — one owner per hint, no second copy to drift.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { directiveCatalog } from "../src/catalog.js";
import { compileFromMemory } from "../src/compiler.js";

/** Compile one `.wd` body from memory. */
const compile = (body) =>
  compileFromMemory({ "site/pages/index.wd": `${body}\n` }, "site/pages/index.wd", {
    cwd: "/proj"
  });

/** Run `fn`, and return the error it threw (asserting that it threw one). */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a compile error, got none");
}

// The three directives that are MEANINGFUL bare, and so must stay accepted:
// `:::` opens (and closes) a container, `:theme` declares the default theme
// store, and `:carousel` opens a carousel with no autoplay.
const VALID_BARE = new Set([":::", ":theme", ":carousel"]);

// Derived from the catalog rather than hand-listed, so a directive added later
// is covered the day it ships instead of the day someone remembers this file.
const NEEDS_ARGUMENTS = directiveCatalog()
  .directives.map((d) => d.name)
  .filter((name) => !VALID_BARE.has(name));

test("the bare-directive family is the whole catalog minus the three valid bare forms", () => {
  // Guards the derivation itself: if the catalog shrank, the loop below would
  // pass while testing nothing.
  assert.equal(NEEDS_ARGUMENTS.length, directiveCatalog().directives.length - 3);
  assert.ok(NEEDS_ARGUMENTS.length >= 22, `family too small: ${NEEDS_ARGUMENTS.length}`);
  for (const name of [":state", ":store", ":input", "@loop", ":button", ":if"]) {
    assert.ok(NEEDS_ARGUMENTS.includes(name), `${name} missing from the family`);
  }
});

for (const name of NEEDS_ARGUMENTS) {
  test(`a bare "${name}" is a compile error with its own coded Use: hint`, () => {
    const error = thrown(() => compile(name));
    // 1. It is a Darkmown error, not a TypeError from an unguarded handler.
    assert.match(error.message, /^\[WD\d{3}\]/, `uncoded error for ${name}: ${error.message}`);
    assert.match(error.wd.code, /^WD\d{3}$/);
    // 2. It points at the offending line.
    // compileFromMemory resolves cwd on the host, so Windows reports D:\proj\...
    assert.equal(error.wd.file, path.resolve("/proj", "site/pages/index.wd"));
    // 3. It tells the author what the line should have looked like. The hint is
    //    the directive's own, so it can never drift from what compiles.
    assert.ok(
      typeof error.wd.hint === "string" && error.wd.hint.length > 10,
      `${name} threw without a corrective hint: ${error.message}`
    );
    assert.ok(
      error.wd.hint.includes(name) || error.message.includes(`${name} `),
      `${name}'s hint does not name the directive: ${error.wd.hint}`
    );
  });
}

test("trailing whitespace after the keyword is still bare", () => {
  // The regression is about a MISSING argument, and `":state   "` has none.
  assert.equal(thrown(() => compile(":state   ")).wd.code, "WD201");
  assert.equal(thrown(() => compile(":button\t")).wd.code, "WD301");
});

test("the three valid bare forms still compile", () => {
  // Negative control for the guard: if it fired on every keyword-only line, the
  // assertions above would prove nothing about the family being the right one.
  assert.match(compile("::: card\ninside\n:::").html, /<div class="card">/);
  assert.match(compile(":theme").html, /data-wd-theme|data-theme/);
  assert.match(compile(":carousel\n::: slide\na\n:::\n:endcarousel").html, /data-wd-carousel/);
});

test("an INDENTED bare directive is still prose", () => {
  // The dispatch has always been unindented-only (an indented `:state` inside a
  // list item is text), and the guard must not widen that.
  const html = compile("- item\n  :state").html;
  assert.match(html, /:state/);
});

test("a bare directive inside a fenced code block is still code", () => {
  const html = compile("```wd\n:state\n```").html;
  assert.match(html, /<code[^>]*>[\s\S]*:state/);
});

test("a keyword-shaped line that is NOT a directive still only warns", () => {
  // `warnUnknownDirective` owns typos; the bare guard must not steal them and
  // turn a warning into a hard failure.
  const page = compile(":stat");
  assert.match(page.html, /:stat/);
  assert.ok(
    page.warnings.some((w) => w.includes(":stat")),
    `expected a warning, got ${JSON.stringify(page.warnings)}`
  );
});
