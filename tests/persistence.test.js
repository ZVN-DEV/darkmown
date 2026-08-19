// ---------------------------------------------------------------------------
// The persistence vocabulary: `persist` / `ephemeral` across :state, :store,
// :theme, and :computed.
//
// These exist because the surface used to corrupt data silently. Each handler
// stripped only its OWN token, so the other one stayed glued to the value and
// `parseStateValue`'s bare-string fallback turned it into data:
//
//   :store count = 0 persist   ->   the STRING "0 persist"
//
// which compiled green, rendered fine, and first failed at `count++` — far from
// the line that caused it. Reported from the on-device planner bench, where a
// hand-written assembler made exactly this mistake while reading the compiler
// source, and no compile error existed for a repair loop to act on.
//
// The rule these pin: the KEYWORD picks the default, the TOKEN always means what
// it says, and a value that genuinely ends in one of these words is quoted.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import test from "node:test";
import { compileFromMemory } from "../src/compiler.js";

const ENTRY = "site/pages/index.wd";
const compile = (body) => compileFromMemory({ [ENTRY]: body }, ENTRY).html;
const fails = (body) => {
  try {
    compile(body);
    return null;
  } catch (err) {
    return /** @type {any} */ (err);
  }
};

// --------------------------------------------------------------- the trap
// One assertion per corner of the matrix, because the bug was that only two of
// the four corners were reachable.

test("every keyword/token pair means what it says, and none folds into the value", () => {
  const matrix = [
    // line,                          persisted?, the value that must be seeded
    [":state count = 0", false, "0"],
    [":state count = 0 persist", true, "0"],
    [":state count = 0 ephemeral", false, "0"],
    [":store count = 0", true, "0"],
    [":store count = 0 persist", true, "0"],
    [":store count = 0 ephemeral", false, "0"]
  ];
  for (const [line, persisted, value] of matrix) {
    const html = compile(`${line}\n`);
    const script = html.match(/<script type="application\/json" data-wd-[^>]*>([^<]*)<\/script>/);
    assert.ok(script, `${line} emitted no state script`);
    // The seeded value is the whole point: "0 persist" is the corruption.
    assert.match(script[1], new RegExp(`(^|:)${value}(}|$)`), `${line} seeded ${script[1]}`);
    const isState = line.startsWith(":state");
    const marked = isState
      ? script[0].includes('data-wd-persist="count"')
      : !script[0].includes("data-wd-store-ephemeral");
    assert.equal(marked, persisted, `${line} persistence flag`);
  }
});

test('the reported repro seeds a number, not the string "0 persist"', () => {
  const html = compile(":store count = 0 persist\n");
  assert.match(html, /data-wd-store="count">0</);
  assert.doesNotMatch(html, /0 persist/);
});

test('the symmetric repro seeds a number, not the string "0 ephemeral"', () => {
  const html = compile(":state count = 0 ephemeral\n");
  assert.match(html, /\{"count":0\}/);
  assert.doesNotMatch(html, /0 ephemeral/);
});

// ------------------------------------------------------------- :theme too
// Same family, same regex shape, same trap: `:theme mode = "auto" ephemeral`
// seeded the string '"auto" ephemeral'.

test(":theme takes the same tokens and honours them", () => {
  const ephemeral = compile(':theme mode = "auto" ephemeral\n');
  assert.match(ephemeral, /data-wd-store="mode" data-wd-store-ephemeral>"auto"</);
  const persist = compile(':theme mode = "auto" persist\n');
  assert.match(persist, /data-wd-store="mode">"auto"</);
  assert.doesNotMatch(persist, /data-wd-store-ephemeral/);
});

test(":theme with no value and no token is unchanged", () => {
  assert.match(compile(":theme\n"), /data-wd-store="theme">"auto"</);
});

// ------------------------------------------------------- what must NOT move
// The escape hatch, and the words appearing as ordinary data.

test("a quoted value keeps a trailing token as text", () => {
  assert.match(compile(':state note = "0 persist"\n'), /\{"note":"0 persist"\}/);
  assert.match(compile(':store note = "0 ephemeral"\n'), /data-wd-store="note">"0 ephemeral"</);
});

test("the tokens inside JSON literals are data, not syntax", () => {
  assert.match(compile(':state list = ["persist"]\n'), /\{"list":\["persist"\]\}/);
  assert.match(compile(':store obj = {"a":"ephemeral"}\n'), /\{"a":"ephemeral"\}/);
});

test("a word that merely starts with a token is not a token", () => {
  // `persistent` must survive whole: the alternation is anchored, not a prefix.
  assert.match(compile(":state n = 5 persistent\n"), /\{"n":"5 persistent"\}/);
  assert.doesNotMatch(compile(":state n = 5 persistent\n"), /data-wd-persist/);
});

test("a multi-line literal takes the token after the closing bracket", () => {
  const html = compile(':store products = [\n  {"name": "Mug"}\n] ephemeral\n');
  assert.match(html, /data-wd-store="products" data-wd-store-ephemeral>\[\{"name":"Mug"\}\]</);
});

// ------------------------------------------------------------ WD211, :computed
// The old failure was a message that named a symbol the author never wrote and
// pointed the fix the wrong way — an LLM repair loop reading it will declare a
// state called `persist`, which compiles and is nonsense.

test(":computed with a trailing token names the real mistake, not a phantom state", () => {
  const err = fails(":state count = 0\n:computed double = count * 2 persist\n");
  assert.ok(err, "expected a compile error");
  assert.equal(err.wd.code, "WD211");
  assert.match(err.message, /derived, not stored/);
  assert.doesNotMatch(err.message, /unknown state/);
  // The old message. If this ever comes back, the repair loop breaks again.
  assert.doesNotMatch(err.message, /Declare it with :state or :fetch first/);
});

test(":computed rejects ephemeral for the same reason", () => {
  const err = fails(":state count = 0\n:computed double = count * 2 ephemeral\n");
  assert.equal(err.wd.code, "WD211");
  assert.match(err.message, /derived, not stored/);
});

test("WD211 reports file:line like the rest of the state family", () => {
  const err = fails(":state count = 0\n:computed double = count * 2 persist\n");
  assert.equal(err.wd.line, 2);
  assert.match(err.message, /index\.wd:2/);
});

test("a page that really declares state named persist still compiles", () => {
  // The check is `resolveStateKey`, the same lookup the expression walker does,
  // so a legitimate reference is never mistaken for a stray token.
  const html = compile(":state count = 1\n:state persist = 2\n:computed x = count + persist\n");
  assert.match(html, /\{"x":3\}/);
});

// -------------------------------------------------------------- WD004 hint
// The bench hit this by guessing the token went on the declaration line. The
// message has to be enough to recover from unaided.

test("WD004 says where the token goes on a multi-line literal", () => {
  const err = fails(':state products = [ persist\n  {"name": "Mug"}\n]\n');
  assert.ok(err, "expected a compile error");
  assert.equal(err.wd.code, "WD004");
  assert.match(err.message, /AFTER the closing "\]" on the last line/);
});
