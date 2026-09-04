// Loop-module unit contracts the runtime mirrors: the per-row key (`loopKeyOf`),
// build-time sort stability, and the coded compile error the expression-AST
// guard raises when a folded operand cannot be read back.

import assert from "node:assert/strict";
import test from "node:test";
import { astAt, loopKeyOf, serializeExprAt } from "../src/compiler/loops.js";
import { compileFromMemory } from "../src/compiler.js";

/** Compile one `.wd` body from memory and return its `<main>` HTML. */
function main(lines, extra = {}) {
  const page = compileFromMemory(
    { "site/pages/index.wd": `${lines.join("\n")}\n`, ...extra },
    "site/pages/index.wd",
    { cwd: "/proj" }
  );
  return page.html.match(/<main id="main">([\s\S]*?)<\/main>/)[1].trim();
}

// ---------------------------------------------------------------------------
// C13: the `#n` duplicate suffix can no longer collide with a real key
// ---------------------------------------------------------------------------

test("loopKeyOf escapes a literal # so a real key never collides with a duplicate", () => {
  const counts = new Map();
  // Pre-fix: the second `a` became `a#1`, which is exactly what `{id:"a#1"}`
  // serialized to. The runtime's reuse Map is keyed on this attribute, so the
  // collision grew the list by a row on every render.
  assert.equal(loopKeyOf({ id: "a" }, counts), "a");
  assert.equal(loopKeyOf({ id: "a" }, counts), "a#1");
  assert.equal(loopKeyOf({ id: "a#1" }, counts), "a##1");
  assert.notEqual(loopKeyOf({ id: "a#1" }, new Map()), "a#1");
});

test("loopKeyOf still disambiguates duplicates and falls back to id/key/JSON", () => {
  const counts = new Map();
  assert.equal(loopKeyOf({ key: "k" }, counts), "k");
  assert.equal(loopKeyOf({ key: "k" }, counts), "k#1");
  assert.equal(loopKeyOf({ key: "k" }, counts), "k#2");
  assert.equal(loopKeyOf("plain", counts), "plain");
  assert.equal(loopKeyOf({ n: 1 }, counts), '{"n":1}');
});

test("a reactive loop over duplicate-hash ids emits distinct row keys", () => {
  const html = main([
    ':state rows = [{"id":"a"},{"id":"a"},{"id":"a#1"}]',
    "",
    "@loop rows into r",
    "- { r.id }",
    "@endloop"
  ]);
  const keys = [...html.matchAll(/data-wd-loop-key="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["a", "a#1", "a##1"]);
  assert.equal(new Set(keys).size, keys.length, "row keys must be unique");
});

// ---------------------------------------------------------------------------
// C14: `desc` sort is stable
// ---------------------------------------------------------------------------

test("a desc sort keeps EQUAL rows in source order (stable, like asc)", () => {
  const files = {
    "site/_/rows.json": JSON.stringify([
      { n: "first", g: 1 },
      { n: "second", g: 1 },
      { n: "third", g: 2 }
    ])
  };
  const order = (dir) =>
    [
      ...main(
        [`@loop /rows.json into r sort by r.g ${dir}`, "- { r.n }", "@endloop"],
        files
      ).matchAll(/<li>(\w+)<\/li>/g)
    ].map((m) => m[1]);
  assert.deepEqual(order("asc"), ["first", "second", "third"]);
  // Pre-fix `(c || a.index - b.index) * dir` negated the tiebreaker along with
  // the comparator, so the equal `g: 1` pair came back reversed.
  assert.deepEqual(order("desc"), ["third", "first", "second"]);
});

// ---------------------------------------------------------------------------
// C4: an unreadable folded expression is a CODED compile error, not a raw throw
// ---------------------------------------------------------------------------

// `astAt`/`serializeExprAt` are the seam where the AST layer's INTERNAL parse
// error becomes an ordinary Darkmown compile error. The compiler's own folds no
// longer produce a fragment it cannot read (exponent notation parses, and an
// unrepresentable value folds to `null`), so the guard is exercised directly —
// the same way `matchElement` is unit-tested against its documented contract.

const ctx = { file: "/proj/site/pages/index.wd", bodyLine: 2, lineOffset: 1 };

test("astAt turns an unreadable expression into a coded WD190 with file:line", () => {
  assert.throws(
    () => astAt("this is not ) valid js", ctx, 3, '":if"'),
    (err) => {
      assert.match(err.message, /^\[WD190\]/, "the message carries the stable code");
      assert.match(err.message, /":if" expression in \/proj\/site\/pages\/index\.wd:7/);
      assert.match(err.message, /Use simpler operands/, "and a corrective suggestion");
      assert.equal(err.wd.code, "WD190");
      assert.equal(err.wd.file, "/proj/site/pages/index.wd");
      assert.equal(err.wd.line, 7);
      assert.ok(err.wd.hint.length > 0);
      return true;
    }
  );
});

test("astAt returns the parsed AST when the expression is readable", () => {
  assert.deepEqual(astAt('S("a") > 1', ctx, 0, '":if"'), [">", ["S", "a"], ["L", 1]]);
});

test("serializeExprAt is JSON.stringify(astAt(...)) and shares the coded error", () => {
  assert.equal(serializeExprAt('S("a") > 1', ctx, 0, '":if"'), '[">",["S","a"],["L",1]]');
  assert.throws(() => serializeExprAt("(1 + 2", ctx, 0, '"::: … when"'), /\[WD190\]/);
});
