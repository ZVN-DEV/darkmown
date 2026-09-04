// `:every` and `:effect` are PAGE-LEVEL registrations.
//
// A reactive `@loop` compiles its body once into a `<template>` and the runtime
// clones that template per list item, so a timer or a watcher written inside the
// body was registered once per row — three rows meant three intervals, and a row
// removed from the list left its interval running, so one tick advanced a
// counter by the number of rows the page had EVER shown. Neither directive has a
// per-row meaning to salvage (an effect watches a top-level state key and an
// action targets one; neither can name the row), so the placement is a compile
// error, mirroring the WD202 check `declareState` has always had.
//
// A STATIC loop is deliberately still allowed: the unroll produces exactly the
// N copies the author literally wrote, they never churn, and refusing would
// break a page whose output is already correct.

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

const SHELF = JSON.stringify([{ n: 1 }, { n: 2 }, { n: 3 }]);

/** Compile one `.wd` body from memory. */
const compile = (lines, extra = {}) =>
  compileFromMemory(
    { "site/pages/index.wd": `${lines.join("\n")}\n`, ...extra },
    "site/pages/index.wd",
    { cwd: "/proj" }
  );

/** Run `fn`, and return the error it threw (asserting that it threw one). */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a compile error, got none");
}

/** How many runtime markers of `kind` the compiled page carries. */
const markers = (page, kind) => (page.html.match(new RegExp(`data-wd-${kind}`, "g")) || []).length;

// ---------------------------------------------------------------------------
// 1. Refused inside a reactive loop body
// ---------------------------------------------------------------------------

test(":every inside a reactive @loop body is WD315, at the offending line", () => {
  const error = thrown(() =>
    compile([
      ':state rows = [{ "n": 1 }]',
      ":state secs = 0",
      "",
      "@loop rows into r",
      ":every 5s -> secs++",
      "@endloop"
    ])
  );
  assert.equal(error.wd.code, "WD315");
  assert.equal(error.wd.line, 5);
  assert.match(error.message, /^\[WD315\] :every cannot be used inside a reactive @loop body/);
  assert.match(error.message, /index\.wd:5/);
  // The reason, so the author knows it is not an arbitrary restriction.
  assert.match(error.message, /every row would register its own timer\/watcher/);
  // And the way out, named concretely.
  assert.match(error.wd.hint, /declare :every once outside the loop/);
  assert.match(error.wd.hint, /at page level, or inside the ::: section/);
  assert.match(error.wd.hint, /:every 5s -> rows refetch/);
  assert.equal(error.wd.example, ":every 5s -> seconds++");
});

test(":effect inside a reactive @loop body is WD315, with its OWN hint", () => {
  const error = thrown(() =>
    compile([
      ':state rows = [{ "n": 1 }]',
      ':state q = ""',
      ":state secs = 0",
      "",
      "@loop rows into r",
      ":effect q -> secs++",
      "@endloop"
    ])
  );
  assert.equal(error.wd.code, "WD315");
  assert.equal(error.wd.line, 6);
  assert.match(error.message, /^\[WD315\] :effect cannot be used inside a reactive @loop body/);
  assert.match(error.wd.hint, /declare :effect once outside the loop/);
  assert.match(error.wd.hint, /:effect query -> rows refetch/);
  assert.equal(error.wd.example, ":effect query -> searches++");
});

test("the INNER level of a nested reactive loop is refused too", () => {
  // `ctx.loopItem` is inherited by everything nested in a reactive body, so the
  // item-relative inner loop is covered by the same test — no second guard.
  const error = thrown(() =>
    compile([
      ':state teams = [{ "ms": [{ "n": 1 }] }]',
      ":state secs = 0",
      "",
      "@loop teams into t",
      "@loop t.ms into m",
      ":every 5s -> secs++",
      "@endloop",
      "@endloop"
    ])
  );
  assert.equal(error.wd.code, "WD315");
  assert.equal(error.wd.line, 6);
});

test("an each-if branch inside a reactive loop is refused", () => {
  // A per-row `:if` compiles inside the row template, so its branch clones with
  // the row: the same leak, one indirection deeper.
  for (const [directive, line] of [
    [":every", ":every 5s -> secs++"],
    [":effect", ":effect q -> secs++"]
  ]) {
    const error = thrown(() =>
      compile([
        ':state rows = [{ "n": 1 }]',
        ':state q = ""',
        ":state secs = 0",
        "",
        "@loop rows into r",
        ":if r.n > 0",
        line,
        ":endif",
        "@endloop"
      ])
    );
    assert.equal(error.wd.code, "WD315", directive);
    assert.match(error.message, new RegExp(`\\[WD315\\] ${directive} cannot be used`), directive);
  }
});

test("a reactive loop inside a ::: section is still a reactive loop", () => {
  const error = thrown(() =>
    compile([
      "::: panel",
      ':state rows = [{ "n": 1 }]',
      ":state secs = 0",
      "@loop rows into r",
      ":every 5s -> secs++",
      "@endloop",
      ":::"
    ])
  );
  assert.equal(error.wd.code, "WD315");
});

// ---------------------------------------------------------------------------
// 2. Controls — every legitimate placement still compiles
// ---------------------------------------------------------------------------

test("page level still compiles, once", () => {
  const page = compile([":state secs = 0", "", ":every 5s -> secs++"]);
  assert.equal(markers(page, "every"), 1);
});

test("inside a ::: section still compiles, once", () => {
  const page = compile(["::: box", ":state secs = 0", ":every 5s -> secs++", ":::"]);
  assert.equal(markers(page, "every"), 1);
});

test(":effect at page level still compiles", () => {
  const page = compile([':state q = ""', ":state secs = 0", "", ":effect q -> secs++"]);
  assert.equal(markers(page, "effect"), 1);
});

test("a STATIC @loop over JSON still unrolls one marker per row", () => {
  // Deliberate: N copies is exactly what the source says, and a static unroll
  // never adds or removes rows, so nothing accumulates. Refusing here would
  // break a page whose output is already what the author asked for.
  const page = compile(
    [":state secs = 0", "", "@loop /d.json into r", ":every 5s -> secs++", "@endloop"],
    {
      "site/_/d.json": SHELF
    }
  );
  assert.equal(markers(page, "every"), 3);
});

test("a STATIC @loop over a frontmatter list still unrolls :effect", () => {
  const page = compile([
    "---",
    "ps: [a, b, c]",
    "---",
    ':state q = ""',
    ":state secs = 0",
    "",
    "@loop meta.ps into p",
    ":effect q -> secs++",
    "@endloop"
  ]);
  assert.equal(markers(page, "effect"), 3);
});

test("the @empty branch of a reactive loop is NOT the row template", () => {
  // The empty branch compiles once into `<template data-wd-loop-empty>`; it is
  // not cloned per row, so `ctx.loopItem` is unset there and the guard must not
  // fire. (Whether the runtime re-registers it on every toggle is the runtime's
  // question, not the placement's.)
  const page = compile([
    ":state rows = []",
    ":state secs = 0",
    "",
    "@loop rows into r",
    "- { r.n }",
    "@empty",
    ":every 5s -> secs++",
    "@endloop"
  ]);
  assert.ok(markers(page, "every") > 0, "the empty branch lost its :every");
});

test("a :button inside a reactive loop is untouched", () => {
  // Negative control for the guard's reach: it must key on these two directives,
  // not on "anything inside a reactive loop".
  const page = compile([
    ':state rows = [{ "n": 1 }]',
    ":state secs = 0",
    "",
    "@loop rows into r",
    ':button "Go" -> secs++',
    "@endloop"
  ]);
  assert.match(page.html, /data-wd-action="inc"/);
});
