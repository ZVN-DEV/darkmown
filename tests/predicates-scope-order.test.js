// The three things every predicate resolver has to agree on:
//
//  1. RESOLUTION ORDER — reactive loop item → static scope → declared state, the
//     same order `{ }` interpolation uses. `:if` and `::: … .class when` used to
//     try static scope first, so a name bound in BOTH an enclosing static loop
//     and the reactive row folded to the outer value and hard-baked a branch.
//  2. QUOTE AWARENESS — `and`/`or` join CONDITIONS, so a literal `"cats and
//     dogs"` must not be split into two unparseable halves.
//  3. A BUILD-TIME FOLD THAT STAYS PARSEABLE — the fold splices real values into
//     the expression, so a value `JSON.stringify` cannot represent (a function)
//     has to become `null`, not the literal text `undefined`.

import assert from "node:assert/strict";
import test from "node:test";
import { evalPredicate } from "../src/compiler/predicates.js";
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

/** Capture whatever `console.warn` emits while `fn` runs. */
function warnings(fn) {
  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(" "));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return seen;
}

// ---------------------------------------------------------------------------
// C3: the reactive loop item wins over an outer static value of the same name
// ---------------------------------------------------------------------------

const NESTED = [
  "---",
  "outers: [x, y]",
  "---",
  ':state items = [{"name":"Alpha","done":true},{"name":"Beta","done":false}]',
  "",
  "@loop meta.outers into it",
  "@loop items into it",
  "::: row .ok when it.done",
  "{ it.name }",
  ":if it.done",
  "YES",
  ":else",
  "NO",
  ":endif",
  ":::",
  "@endloop",
  "@endloop"
];

test(":if inside a reactive loop binds to the ROW, not an outer static value", () => {
  const html = main(NESTED);
  // Pre-fix `it` resolved to the outer static string "x", folded to false, and
  // baked `NO` into every row with no `data-wd-each-if` at all — so the runtime
  // could never correct it.
  assert.match(html, /<span data-wd-each-if data-wd-path="done">/);
  const painted = [...html.matchAll(/<span data-wd-each-if-out><p>(YES|NO)<\/p><\/span>/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(painted, ["YES", "NO", "YES", "NO"]);
});

test(".class when inside a reactive loop binds to the ROW, not an outer static value", () => {
  const html = main(NESTED);
  // A row-bound class is a `data-wd-each-class` over `I("done")`. Pre-fix the
  // predicate folded static-false and the class was silently dropped.
  assert.match(
    html,
    /data-wd-each-class="\[\[&quot;ok&quot;,\[&quot;I&quot;,&quot;done&quot;\]\]\]"/
  );
});

test("a static value is still resolved when it is NOT the loop item name", () => {
  const html = main([
    "---",
    "flag: true",
    "---",
    ':state items = [{"name":"Alpha"}]',
    "",
    "@loop items into it",
    ":if meta.flag",
    "ON",
    ":else",
    "OFF",
    ":endif",
    "@endloop"
  ]);
  // Still folded at build time (no each-if region) because `meta` is static.
  assert.doesNotMatch(html, /data-wd-each-if/);
  assert.match(html, /<p>ON<\/p>/);
});

test("outside a reactive loop a static scope value still folds at build time", () => {
  const html = main([
    "---",
    "shown: true",
    "---",
    ":state shown = false",
    "",
    ":if meta.shown",
    "SCOPE",
    ":else",
    "STATE",
    ":endif"
  ]);
  assert.match(html, /<p>SCOPE<\/p>/);
  assert.doesNotMatch(html, /data-wd-if=/, "a build-known condition stays zero-JS");
});

// ---------------------------------------------------------------------------
// C12: `and`/`or` split only at top level, never inside a quoted operand
// ---------------------------------------------------------------------------

const PETS = {
  "site/_/pets.json": JSON.stringify([
    { name: "cats and dogs" },
    { name: "cats or dogs" },
    { name: "fish" }
  ])
};

test('@loop where accepts a quoted operand containing " and "', () => {
  const html = main(
    ['@loop /pets.json into p where p.name contains "cats and dogs"', "- { p.name }", "@endloop"],
    PETS
  );
  assert.match(html, /<li>cats and dogs<\/li>/);
  assert.doesNotMatch(html, /<li>fish<\/li>/);
});

test('@loop where accepts a quoted operand containing " or "', () => {
  const html = main(
    ['@loop /pets.json into p where p.name contains "cats or dogs"', "- { p.name }", "@endloop"],
    PETS
  );
  assert.match(html, /<li>cats or dogs<\/li>/);
  assert.doesNotMatch(html, /<li>fish<\/li>/);
});

test("a real top-level and/or still splits into two conditions", () => {
  const html = main(
    [
      '@loop /pets.json into p where p.name contains "cats" and p.name contains "dogs"',
      "- { p.name }",
      "@endloop"
    ],
    PETS
  );
  assert.match(html, /<li>cats and dogs<\/li>/);
  assert.match(html, /<li>cats or dogs<\/li>/);
  assert.doesNotMatch(html, /<li>fish<\/li>/);
});

test('a :if / .class when predicate accepts a quoted " and " too', () => {
  const html = main([
    ':state label = "cats and dogs"',
    "",
    ':if label == "cats and dogs"',
    "MATCH",
    ":else",
    "MISS",
    ":endif"
  ]);
  assert.match(html, /<div data-wd-if-out><p>MATCH<\/p><\/div>/);
});

test("a single-quoted operand containing a joiner is also protected", () => {
  const html = main(
    ["@loop /pets.json into p where p.name contains 'cats and dogs'", "- { p.name }", "@endloop"],
    PETS
  );
  assert.match(html, /<li>cats and dogs<\/li>/);
});

// ---------------------------------------------------------------------------
// C4: the build-time fold stays inside the AST grammar
// ---------------------------------------------------------------------------

test("an exponent-notation static operand compiles instead of throwing", () => {
  // `JSON.stringify(1e21)` is `1e+21`, which the AST re-parser used to reject
  // with a raw uncoded `expr-ast: …` Error.
  const html = main(
    [
      ":state open = true",
      "",
      "@loop /nums.json into row",
      "::: card .big when row.v > 1 and open",
      "hi",
      ":::",
      "@endloop"
    ],
    { "site/_/nums.json": '[{"v": 1e21}, {"v": 1e-7}]' }
  );
  assert.match(html, /data-wd-class=/);
  assert.doesNotMatch(html, /undefined/);
});

test("a static operand JSON.stringify cannot represent folds to null, not `undefined`", () => {
  // `meta.hasOwnProperty` reaches Object.prototype's function through the plain
  // frontmatter object. `JSON.stringify` returns undefined for a function, and
  // splicing that into the expression produced the bare word `undefined` — which
  // is outside the closed grammar, so the AST re-parse threw a raw uncoded
  // `expr-ast: unexpected identifier "undefined"` Error with no file and no line.
  const html = main([
    "---",
    "title: T",
    "---",
    ":if meta.hasOwnProperty == null",
    "NULLED",
    ":else",
    "OTHER",
    ":endif"
  ]);
  assert.match(html, /<p>NULLED<\/p>/);
});

test("the build-time evaluation warning names the construct that failed", () => {
  const ctx = { file: "guard.wd", comp: { state: new Map() } };
  const [loopWarning] = warnings(() => evalPredicate("this is not ) valid js", undefined, ctx));
  assert.match(loopWarning, /^@loop where predicate/);
  assert.match(loopWarning, /treating the row as excluded/);

  const [ifWarning] = warnings(() =>
    evalPredicate("this is not ) valid js", undefined, ctx, '":if"')
  );
  // Pre-fix a failing `:if` was reported as an "@loop where predicate … treating
  // the row as excluded", pointing the author at a loop they never wrote.
  assert.match(ifWarning, /^":if" predicate/);
  assert.match(ifWarning, /treating it as false/);
  assert.doesNotMatch(ifWarning, /@loop/);
});
