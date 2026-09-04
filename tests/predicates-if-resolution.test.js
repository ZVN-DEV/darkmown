// Two `:if` resolution invariants that had nothing to do with the condition
// itself:
//
//  C1  The state key a `:if` region binds to carries the `::: name #id` section
//      prefix, which is author text. It goes into `data-wd-if="…"` and must be
//      escaped exactly like the `id="…"` attribute two characters away.
//  C6  `LOOP_META[head]` is a lookup with an author-supplied key, so a plain
//      object literal answered for every `Object.prototype` member: `{ toString }`
//      and `:if __proto__` resolved as loop meta variables.

import assert from "node:assert/strict";
import test from "node:test";
import { LOOP_META } from "../src/compiler/context.js";
import { compileFromMemory } from "../src/compiler.js";

/** Compile one `.wd` body from memory and return its `<main>` HTML. */
function main(lines) {
  const page = compileFromMemory(
    { "site/pages/index.wd": `${lines.join("\n")}\n` },
    "site/pages/index.wd",
    { cwd: "/proj" }
  );
  return page.html.match(/<main id="main">([\s\S]*?)<\/main>/)[1].trim();
}

/** Compile and return the thrown compile error. */
function compileError(lines) {
  try {
    main(lines);
  } catch (err) {
    return err;
  }
  return null;
}

// ---------------------------------------------------------------------------
// C1: the section-scoped state key is escaped in data-wd-if
// ---------------------------------------------------------------------------

test("a section id with & is escaped in data-wd-if, matching the id attribute", () => {
  const html = main([
    "::: panel #a&b",
    ":state open = true",
    "",
    ":if open",
    "SHOWN",
    ":else",
    "HIDDEN",
    ":endif",
    ":::"
  ]);
  assert.match(html, /id="a&amp;b"/, "the id attribute was always escaped");
  // Pre-fix: `data-wd-if="a&b:open"` — a raw ampersand in an attribute, and no
  // consistency with the escaped id beside it.
  assert.match(html, /data-wd-if="a&amp;b:open"/);
  assert.doesNotMatch(html, /data-wd-if="[^"]*&(?!amp;|lt;|gt;|quot;|#39;)/);
});

test("a section id with a quote cannot break out of data-wd-if", () => {
  const html = main([
    '::: panel #a"b',
    ":state open = true",
    "",
    ":if open",
    "SHOWN",
    ":endif",
    ":::"
  ]);
  // An unescaped `"` closed the attribute early and produced broken markup with
  // a dead binding.
  assert.match(html, /data-wd-if="a&quot;b:open"/);
});

test("an ordinary section id is unchanged by the escaping", () => {
  const html = main([
    "::: panel #settings",
    ":state open = true",
    "",
    ":if open",
    "SHOWN",
    ":endif",
    ":::"
  ]);
  assert.match(html, /data-wd-if="settings:open"/);
});

// ---------------------------------------------------------------------------
// C6: LOOP_META is prototype-free, so no Object.prototype member is a meta var
// ---------------------------------------------------------------------------

test("LOOP_META has a null prototype and answers only for the five meta vars", () => {
  assert.equal(Object.getPrototypeOf(LOOP_META), null);
  assert.deepEqual(Object.keys(LOOP_META).sort(), [
    "$count",
    "$first",
    "$index",
    "$last",
    "$number"
  ]);
  // The lookups that used to succeed through the prototype chain.
  for (const member of ["toString", "valueOf", "hasOwnProperty", "constructor", "__proto__"]) {
    assert.equal(LOOP_META[member], undefined, `${member} must not resolve as a meta var`);
  }
});

test(":if toString inside a reactive loop is an undeclared name, not a meta var", () => {
  // Pre-fix `LOOP_META["toString"]` was `Object.prototype.toString` (truthy), so
  // the reactive branch emitted `data-wd-each-meta="function toString() { …" `
  // — a marker for a variable nobody declared, straight into the page.
  const err = compileError([
    ':state rows = [{"n":"a"}]',
    "",
    "@loop rows into r",
    ":if toString",
    "Y",
    ":else",
    "N",
    ":endif",
    "@endloop"
  ]);
  assert.ok(err, "an undeclared name must be a compile error");
  assert.match(err.message, /^\[WD608\]/);
  assert.match(err.message, /does not match a :state or in-scope value/);
});

test(":if __proto__ inside a reactive loop is rejected the same way", () => {
  const err = compileError([
    ':state rows = [{"n":"a"}]',
    "",
    "@loop rows into r",
    ":if __proto__",
    "Y",
    ":else",
    "N",
    ":endif",
    "@endloop"
  ]);
  assert.ok(err);
  assert.match(err.message, /^\[WD608\]/);
});

test("the five real meta vars still work inside a loop", () => {
  const html = main([
    ':state rows = [{"n":"a"},{"n":"b"}]',
    "",
    "@loop rows into r",
    ":if $first",
    "HEAD",
    ":else",
    "TAIL",
    ":endif",
    "@endloop"
  ]);
  assert.match(html, /data-wd-each-if data-wd-meta="first"/);
});

test("a meta var outside a loop is still the dedicated WD607 error", () => {
  const err = compileError([":if $first", "Y", ":else", "N", ":endif"]);
  assert.ok(err);
  assert.match(err.message, /^\[WD607\]/);
  assert.match(err.message, /uses the loop meta variable "\$first" outside a @loop/);
});
