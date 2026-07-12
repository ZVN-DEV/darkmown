// Unit + parity tests for the compiled-expression AST layer (src/compiler/expr-ast.js).
//
// Since 2.1 the compiler re-parses its OWN validated expression fragments (the JS
// over I()/S()/C()/A() that predicates.js and compileComputedExpr already produce
// and fully validate) into a compact serialized AST, which the runtime WALKS with
// no `new Function` — so reactive pages run under a strict CSP with no unsafe-eval.
//
// The PARITY battery is the load-bearing guarantee: for a wide range of compiled
// expressions and inputs, walking the AST must produce byte-identical results to
// the prior `new Function`-over-I/S/C/A evaluation — including the fiddly cases
// (NaN, null, loose ==, string coercion, &&/|| short-circuit, dotted paths).

import assert from "node:assert/strict";
import test from "node:test";
import { astOf, evalAst, serializeExpr } from "../src/compiler/expr-ast.js";
import { FORMATTERS } from "../src/compiler/format.js";

// getPath used by the OLD-style evaluator, mirroring the compiler's segment reader.
function getPath(value, segs) {
  let cur = value;
  for (const s of segs) {
    if (cur == null) return undefined;
    if (s === "__proto__" || s === "constructor" || s === "prototype") return undefined;
    cur = cur[s];
  }
  return cur;
}
const contains = (a, b) =>
  String(a ?? "")
    .toLowerCase()
    .includes(String(b ?? "").toLowerCase());
const AGG = (name, list, field) =>
  FORMATTERS[name] ? FORMATTERS[name](list, field == null ? [] : [field]) : undefined;

// The pre-2.1 evaluator: build a `new Function` over the same I/S/C/A readers.
function oldEval(code, state, item) {
  const I = (p) => getPath(item, p ? p.split(".") : []);
  const S = (k, r) => getPath(state[k], r ? r.split(".") : []);
  return new Function("I", "S", "C", "A", `return (${code});`)(I, S, contains, AGG);
}
// The new evaluator: walk the AST parsed from the same validated code.
const newEval = (code, state, item) =>
  evalAst(astOf(code), item, { state: new Map(Object.entries(state)) });

const EXPRS = [
  'S("a") + S("b")',
  'S("a") % S("b")',
  '!S("cmp")',
  'S("name") == "Kirby"',
  'S("name") != "Kirby"',
  'S("cart","count") * 2',
  '(S("a") + S("b")) * 2',
  'S("base") + S("seats")*8 + S("analytics")*25 + S("sso")*50',
  'A("sum",S("cart"),"price")',
  'A("count",S("cart"))',
  'A("avg",S("cart"),"price")',
  'A("min",S("cart"),"price")',
  'A("max",S("cart"),"price")',
  'S("subtotal") * 1.08',
  'S("stars") >= 3',
  'S("stars") <= 3',
  'S("slide") + 1',
  'S("x") - 3',
  '-S("a") + 5',
  'S("a") / S("b")',
  '(I("price") >= 1)',
  '(I("price") <= S("limit"))',
  '(I("id") != 9)',
  '(I("id") == 9)',
  '(C(I("name"), S("q")))',
  '(I("qty") > -3)',
  '(I("qty") < 3)',
  '(!(S("flag")))',
  '(I("a") == "x") && (I("b") > 1)',
  '(S("a") > 1) || (I("b") < 2)',
  '(I("a") == null)',
  '(S("v") != "hi") || (I("n") >= 2)',
  'S("a") && S("b") || S("c")',
  'S("a") < S("b") == S("c")',
  'S("t") == true',
  'S("t") == false'
];

const STATES = [
  {
    a: 1,
    b: 2,
    cmp: 0,
    name: "Kirby",
    cart: { count: 3, 0: { price: 5 }, 1: { price: 7 } },
    base: 10,
    seats: 2,
    analytics: 1,
    sso: 0,
    subtotal: 100,
    stars: 3,
    slide: 0,
    x: 5,
    limit: 5,
    q: "ir",
    flag: true,
    v: "hi",
    c: 0,
    t: true
  },
  {
    a: 0,
    b: 0,
    cmp: 1,
    name: "X",
    cart: [{ price: 1.5 }, { price: 2.5 }],
    base: 0,
    seats: 0,
    analytics: 0,
    sso: 0,
    subtotal: 0,
    stars: 0,
    slide: 9,
    x: -2,
    limit: 0,
    q: "",
    flag: false,
    v: "no",
    c: 5,
    t: false
  },
  {
    a: NaN,
    b: 3,
    cmp: null,
    name: null,
    cart: null,
    base: 5,
    seats: 1,
    analytics: 2,
    sso: 1,
    subtotal: 50,
    stars: 5,
    slide: -1,
    x: 0,
    limit: 100,
    q: "z",
    flag: 0,
    v: null,
    c: 1,
    t: 1
  },
  {
    a: "7",
    b: "2",
    cmp: "",
    name: "kirby",
    cart: [],
    base: 1,
    seats: 9,
    analytics: 1,
    sso: 1,
    subtotal: 12.34,
    stars: 2,
    slide: 100,
    x: 1000,
    limit: -5,
    q: "KIR",
    flag: 1,
    v: "",
    c: undefined,
    t: "true"
  }
];
const ITEMS = [
  { price: 1, id: 9, name: "Widget", qty: 5, a: "x", b: 2, n: 3 },
  { price: 0.5, id: 1, name: "gadget", qty: -3, a: "y", b: 0, n: 1 },
  { price: 100, id: 9, name: "", qty: 0, a: null, b: 5, n: 2 },
  undefined
];

test("PARITY: walking the AST matches the pre-2.1 new Function evaluation exactly", () => {
  let checks = 0;
  for (const code of EXPRS) {
    for (const st of STATES) {
      for (const it of ITEMS) {
        let o;
        let e;
        let oErr = false;
        let eErr = false;
        try {
          o = oldEval(code, st, it);
        } catch {
          oErr = true;
        }
        try {
          e = newEval(code, st, it);
        } catch {
          eErr = true;
        }
        checks++;
        const bothNaN =
          typeof o === "number" && typeof e === "number" && Number.isNaN(o) && Number.isNaN(e);
        assert.ok(
          oErr === eErr && (oErr || Object.is(o, e) || bothNaN),
          `parity mismatch for "${code}" (state a=${st.a}, item=${it && it.name}): old=${
            oErr ? "ERR" : o
          } new=${eErr ? "ERR" : e}`
        );
      }
    }
  }
  assert.ok(checks > 400, `expected a broad battery, ran ${checks}`);
});

// --- Leaf / literal node coverage ------------------------------------------

test("astOf parses every literal kind into an inert L node", () => {
  const st = { obj: 1, arr: 1 };
  assert.deepEqual(astOf("42"), ["L", 42]);
  assert.deepEqual(astOf("3.14"), ["L", 3.14]);
  assert.deepEqual(astOf(".5"), ["L", 0.5]);
  assert.deepEqual(astOf("true"), ["L", true]);
  assert.deepEqual(astOf("false"), ["L", false]);
  assert.deepEqual(astOf("null"), ["L", null]);
  assert.deepEqual(astOf('"hi"'), ["L", "hi"]);
  assert.deepEqual(astOf('"a\\"b"'), ["L", 'a"b'], "escaped quote inside a string literal");
  // Object / array literals (from a static-scope fold) parse as inert data nodes,
  // including strings that themselves contain braces/brackets.
  assert.deepEqual(astOf('{"a":1,"b":"}"}'), ["L", { a: 1, b: "}" }]);
  assert.deepEqual(astOf('[1,"]",{"z":2}]'), ["L", [1, "]", { z: 2 }]]);
  assert.equal(evalAst(astOf("42"), undefined, { state: new Map() }), 42);
  assert.equal(evalAst(astOf('"hi"'), undefined, { state: new Map(Object.entries(st)) }), "hi");
});

test("astOf builds the reader nodes S / I / C / A in both arities", () => {
  assert.deepEqual(astOf('S("k")'), ["S", "k"]);
  assert.deepEqual(astOf('S("k","a.b")'), ["S", "k", "a.b"]);
  assert.deepEqual(astOf('I("path")'), ["I", "path"]);
  assert.deepEqual(astOf('I("")'), ["I", ""]);
  assert.deepEqual(astOf('C(I("n"), S("q"))'), ["C", ["I", "n"], ["S", "q"]]);
  assert.deepEqual(astOf('A("sum",S("l"))'), ["A", "sum", ["S", "l"]]);
  assert.deepEqual(astOf('A("sum",S("l"),"f")'), ["A", "sum", ["S", "l"], "f"]);
});

test("evalAst walks every operator and reader node", () => {
  const comp = {
    state: new Map(Object.entries({ a: 6, b: 4, list: [{ p: 2 }, { p: 3 }], s: "Hello" }))
  };
  const ev = (code) => evalAst(astOf(code), { q: 5 }, comp);
  assert.equal(ev('S("a") + S("b")'), 10);
  assert.equal(ev('S("a") - S("b")'), 2);
  assert.equal(ev('S("a") * S("b")'), 24);
  assert.equal(ev('S("a") / S("b")'), 1.5);
  assert.equal(ev('S("a") % S("b")'), 2);
  assert.equal(ev('-S("a")'), -6);
  assert.equal(ev('!S("a")'), false);
  assert.equal(ev('S("a") > S("b")'), true);
  assert.equal(ev('S("a") < S("b")'), false);
  assert.equal(ev('S("a") >= 6'), true);
  assert.equal(ev('S("a") <= 6'), true);
  assert.equal(ev('S("a") == 6'), true);
  assert.equal(ev('S("a") != 6'), false);
  assert.equal(ev('S("a") > 5 && S("b") < 5'), true);
  assert.equal(ev('S("a") > 100 || S("b") == 4'), true);
  assert.equal(ev('C(S("s"), "ell")'), true);
  assert.equal(ev('A("sum",S("list"),"p")'), 5);
  assert.equal(ev('A("count",S("list"))'), 2);
  assert.equal(ev('I("q") + 1'), 6);
  // An unknown aggregate name folds to undefined (matches the runtime AGG helper).
  assert.equal(evalAst(["A", "bogus", ["L", [1]]], undefined, comp), undefined);
});

// --- Error paths: every throw is exercised ---------------------------------

test("astOf rejects anything outside the closed grammar (hard errors)", () => {
  assert.throws(() => astOf("|| <"), /unexpected/);
  assert.throws(() => astOf("(1 + 2"), /expected \)/);
  assert.throws(() => astOf("1 2"), /trailing input/);
  assert.throws(() => astOf('S("a"'), /expected \) closing call/);
  assert.throws(() => astOf("nope(1)"), /unknown call "nope"/);
  assert.throws(() => astOf("bare"), /unexpected identifier "bare"/);
  assert.throws(() => astOf("@"), /unexpected "@"/);
  assert.throws(() => astOf(""), /unexpected/);
});

test("evalAst throws on an op tag outside the closed vocabulary", () => {
  assert.throws(() => evalAst(["zzz", 1, 2], undefined, { state: new Map() }), /unknown op "zzz"/);
});

test("serializeExpr is JSON.stringify(astOf(code))", () => {
  assert.equal(serializeExpr('S("a") + 1'), JSON.stringify(["+", ["S", "a"], ["L", 1]]));
});

// --- Zero-arg call branch (astOf is a pure function; not compiler-emitted) --

test("astOf handles a call with no arguments (empty-arg branch)", () => {
  assert.deepEqual(astOf("C()"), ["C", undefined, undefined]);
});
