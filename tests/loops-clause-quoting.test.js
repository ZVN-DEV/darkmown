// `@loop` clause detection is quote-aware.
//
// The clause tail is parsed by peeling `sortable` / `paginate N` / `limit N` /
// `offset N` / `reverse` / `sort by …` off it with plain regexes, and whatever
// survives must be `where …`. None of that could tell a real clause from the
// same word inside a `where` STRING LITERAL:
//
//   where p.t contains "we sort by hand"   → [WD102] Malformed @loop clause
//   where p.t contains "please reverse it" → [WD102] Malformed @loop clause
//   where p.t contains "a sortable b"      → [WD108] sortable cannot combine …
//   where p.t contains "a paginate 5 b"    → [WD110] paginate requires a collection
//
// and a REAL trailing clause after such a string was rejected too, so the whole
// header became unusable. Same defect, same remedy, as the quote-aware `and`/`or`
// split in predicates.js.

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

const ROWS = JSON.stringify([
  { t: "we sort by hand", n: 1 },
  { t: "they say we sort by hand", n: 2 },
  { t: "please reverse it", n: 3 },
  { t: "a sortable b", n: 4 },
  { t: "a paginate 5 b", n: 5 },
  { t: "a limit 5 b", n: 6 },
  { t: "another limit 5 c", n: 7 },
  { t: "an offset 5 x", n: 8 },
  { t: "plain", n: 9 }
]);

/** Compile `@loop /r.json into p <tail>` over ROWS and return the matched `n`s. */
function rows(tail) {
  const page = compileFromMemory(
    {
      "site/pages/index.wd": `@loop /r.json into p ${tail}\n- { p.n }\n@endloop\n`,
      "site/_/r.json": ROWS
    },
    "site/pages/index.wd",
    { cwd: "/proj" }
  );
  const main = page.html.match(/<main id="main">([\s\S]*?)<\/main>/)[1];
  return [...main.matchAll(/<li>(\d+)<\/li>/g)].map((m) => Number(m[1]));
}

/** The compile error `@loop /r.json into p <tail>` throws, or null. */
function loopError(tail) {
  try {
    rows(tail);
  } catch (err) {
    return err;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A clause keyword inside a quoted operand is TEXT, not a clause
// ---------------------------------------------------------------------------

test('where … contains "we sort by hand" is a string comparison, not a sort clause', () => {
  // Pre-fix: [WD102] Malformed @loop clause — the out-of-order check searched the
  // whole `where` remainder for ` sort by `, quotes and all.
  assert.deepEqual(rows('where p.t contains "we sort by hand"'), [1, 2]);
});

test('where … contains "please reverse it" is a string comparison, not a reverse clause', () => {
  // Pre-fix: [WD102] Malformed @loop clause.
  assert.deepEqual(rows('where p.t contains "please reverse it"'), [3]);
});

test('where … contains "a sortable b" no longer peels a sortable flag', () => {
  // Pre-fix: [WD108] sortable cannot combine with where/… — `sortable` was peeled
  // out of the MIDDLE of the string (position-independent search), which both
  // mangled the predicate and set the flag.
  assert.deepEqual(rows('where p.t contains "a sortable b"'), [4]);
});

test('where … contains "a paginate 5 b" no longer peels a paginate clause', () => {
  // Pre-fix: [WD110] paginate requires a collection source.
  assert.deepEqual(rows('where p.t contains "a paginate 5 b"'), [5]);
});

test('where … contains "a limit 5 b" keeps the limit inside the string', () => {
  assert.deepEqual(rows('where p.t contains "a limit 5 b"'), [6]);
});

test('where … contains "an offset 5 x" keeps the offset inside the string', () => {
  assert.deepEqual(rows('where p.t contains "an offset 5 x"'), [8]);
});

test("a single-quoted operand carrying a clause keyword is protected too", () => {
  // Pre-fix: [WD102] Malformed @loop clause.
  assert.deepEqual(rows("where p.t contains 'we sort by hand'"), [1, 2]);
});

test("a quoted keyword joined by and/or still splits only at the real joiner", () => {
  // Pre-fix: [WD102] — the quoted ` sort by ` tripped the out-of-order check.
  assert.deepEqual(rows('where p.t contains "we sort by hand" and p.n > 1'), [2]);
});

// ---------------------------------------------------------------------------
// CONTROLS: a REAL clause after a quoted operand still parses and still applies
// ---------------------------------------------------------------------------

test("a real trailing sort by after a quoted where operand parses AND sorts", () => {
  // Pre-fix: [WD102] — the quoted ` sort by ` tripped the out-of-order check
  // before the real clause was ever considered. Both directions are asserted so
  // the test proves the clause was APPLIED, not merely accepted.
  assert.deepEqual(rows('where p.t contains "we sort by hand" sort by p.n desc'), [2, 1]);
  assert.deepEqual(rows('where p.t contains "we sort by hand" sort by p.n asc'), [1, 2]);
});

test("a real trailing reverse after a quoted where operand parses AND reverses", () => {
  // Pre-fix: [WD102].
  assert.deepEqual(rows('where p.t contains "we sort by hand" reverse'), [2, 1]);
});

test("a real trailing limit after a quoted where operand parses AND limits", () => {
  assert.deepEqual(rows('where p.t contains "limit 5"'), [6, 7]);
  assert.deepEqual(rows('where p.t contains "limit 5" limit 1'), [6]);
  // Pre-fix: [WD102] — a quoted ` sort by ` in front of a real `limit`.
  assert.deepEqual(rows('where p.t contains "we sort by hand" limit 1'), [1]);
});

test("a real trailing offset after a quoted where operand parses AND offsets", () => {
  // Pre-fix: [WD102].
  assert.deepEqual(rows('where p.t contains "we sort by hand" offset 1'), [2]);
});

// ---------------------------------------------------------------------------
// CONTROLS: unquoted clause keywords are still parsed / still rejected
// ---------------------------------------------------------------------------

test("clauses written out of order are still rejected", () => {
  const err = loopError("sort by p.n where p.n > 0");
  assert.ok(err, "an out-of-order header must still fail");
  assert.match(err.message, /^\[WD102\]/);
  assert.match(err.message, /Malformed @loop clause/);
});

test("a real sortable alongside where is still rejected", () => {
  const err = loopError("where p.n > 0 sortable");
  assert.ok(err);
  assert.match(err.message, /^\[WD108\]/);
});

test("a real paginate on a non-collection source is still rejected", () => {
  const err = loopError("paginate 2");
  assert.ok(err);
  assert.match(err.message, /^\[WD110\]/);
});

test("the ordinary unquoted clause tail is unaffected", () => {
  assert.deepEqual(rows("where p.n > 6 sort by p.n desc offset 1 limit 1"), [8]);
  assert.deepEqual(rows("where p.n < 3 reverse"), [2, 1]);
});
