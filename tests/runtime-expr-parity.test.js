// Drift guard for the SECOND expression evaluator.
//
// `src/compiler/expr-ast.js` walks a compiled AST at build time; `src/runtime.js`
// carries a hand-written copy of the same walker, and that copy is the one that
// runs in a user's browser. `tests/expr-ast.test.js` proves the COMPILER's walker
// matches real JS semantics — nothing compared the two walkers to each other, so
// a whole family of runtime mutations (a disabled `%`, `<=` narrowed to `<`, `!=`
// tightened to `!==`, a unary minus that does nothing, a case-sensitive
// `contains`, a dotted state read that returns the whole object) left the suite
// green. This file closes that: the SAME EXPRS x STATES x ITEMS battery is run
// through BOTH evaluators and every result must be `Object.is`-identical.
//
// Modelled on tests/format-parity.test.js, which already does this for the
// formatter twins.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { astOf, evalAst as compilerEval } from "../src/compiler/expr-ast.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = `${fs.readFileSync(path.join(here, "..", "src", "runtime.js"), "utf8")}\nglobalThis.__evalAst = evalAst;`;

/** Boot the REAL runtime against an empty document and hand back its evaluator. */
function loadRuntimeEval() {
  const emptyDoc = {
    activeElement: null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  };
  const sandbox = {
    document: emptyDoc,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console,
    JSON,
    Intl,
    Math,
    Number,
    String,
    Object,
    Array,
    Boolean,
    Date,
    Function,
    structuredClone,
    queueMicrotask,
    addEventListener: () => {},
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(runtimeSource, sandbox);
  const live = sandbox.wd.state;
  return {
    /** Point the runtime's live `state` at this case's values, then evaluate. */
    run(ast, st, item) {
      for (const k of Object.keys(live)) delete live[k];
      Object.assign(live, st);
      return sandbox.__evalAst(ast, item);
    }
  };
}

// The compiler battery, plus the cases that were provably unguarded: `%` on both
// readers, an UPPERCASE needle (the only shape that can see a lost toLowerCase),
// unary minus, same-precedence chains (associativity), a loose `!=` that a strict
// `!==` would flip, and dotted state reads (which a "return the whole object"
// mutation breaks).
const EXPRS = [
  'S("a") + S("b")',
  'S("a") % S("b")',
  'S("x") % 3',
  'I("qty") % 2',
  '!S("cmp")',
  'S("name") == "Kirby"',
  'S("name") != "Kirby"',
  'S("a") != 7',
  'S("c") != null',
  'S("c") == null',
  'S("cart","count") * 2',
  'S("cart","count")',
  'S("deep","a.b") + 1',
  'S("deep","a.b.c")',
  '(S("a") + S("b")) * 2',
  'S("base") + S("seats")*8 + S("analytics")*25 + S("sso")*50',
  'A("sum",S("cart"),"price")',
  'A("count",S("cart"))',
  'A("avg",S("cart"),"price")',
  'A("min",S("cart"),"price")',
  'A("max",S("cart"),"price")',
  'A("join",S("cart"),"price")',
  'S("subtotal") * 1.08',
  'S("stars") >= 3',
  'S("stars") <= 3',
  'S("stars") > 3',
  'S("stars") < 3',
  'S("slide") + 1',
  'S("x") - 3',
  '-S("a") + 5',
  '-I("price")',
  '(-S("x")) * 2',
  '-S("a") - -S("b")',
  'S("a") - S("b") - S("c")',
  'S("a") / S("b") / S("c")',
  'S("a") - S("b") + S("c")',
  'S("a") / S("b") * S("c")',
  'S("a") / S("b")',
  '(I("price") >= 1)',
  '(I("price") <= S("limit"))',
  '(I("id") != 9)',
  '(I("id") == 9)',
  '(C(I("name"), S("q")))',
  '(C(I("name"), "WID"))',
  '(C(S("name"), "KIR"))',
  '(C(S("name"), "kir"))',
  '(C(S("v"), S("q")))',
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
  'S("t") == false',
  // A whole-object item read, so a mutation that returns the container instead of
  // the resolved leaf shows up here as well as on the dotted state reads above.
  'I("nested") == null'
];

const STATES = [
  {
    a: 1,
    b: 2,
    cmp: 0,
    name: "Kirby",
    cart: { count: 3, 0: { price: 5 }, 1: { price: 7 } },
    deep: { a: { b: 7 } },
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
    deep: { a: { b: 0 } },
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
    deep: null,
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
    deep: { a: { b: "3" } },
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
  },
  {
    a: 7,
    b: 3,
    cmp: "x",
    name: "KIRBY",
    cart: [{ price: 10 }],
    deep: { a: { b: -4 } },
    base: 2,
    seats: 3,
    analytics: 0,
    sso: 0,
    subtotal: 7.5,
    stars: 4,
    slide: 2,
    x: -7,
    limit: 3,
    q: "IR",
    flag: "no",
    v: "HI",
    c: "0",
    t: 0
  }
];

const ITEMS = [
  { price: 1, id: 9, name: "Widget", qty: 5, a: "x", b: 2, n: 3, nested: { z: 1 } },
  { price: 0.5, id: 1, name: "gadget", qty: -3, a: "y", b: 0, n: 1, nested: null },
  { price: 100, id: 9, name: "", qty: 0, a: null, b: 5, n: 2, nested: {} },
  { price: -6, id: "9", name: "WIDGET", qty: 7, a: "x", b: "1", n: 0, nested: [] },
  undefined
];

/** Evaluate through one walker, capturing a throw as a comparable outcome. */
function outcome(fn) {
  try {
    return { value: fn() };
  } catch (error) {
    return { threw: String(error && error.message) };
  }
}

test("PARITY: the runtime's evalAst matches the compiler's on every expression", () => {
  const runtime = loadRuntimeEval();
  let checks = 0;
  for (const code of EXPRS) {
    const ast = astOf(code);
    for (const st of STATES) {
      for (const item of ITEMS) {
        const a = outcome(() => runtime.run(ast, st, item));
        const b = outcome(() => compilerEval(ast, item, { state: new Map(Object.entries(st)) }));
        const where = `${code}\n  state=${JSON.stringify(st)}\n  item=${JSON.stringify(item)}`;
        assert.equal("threw" in a, "threw" in b, `throw-parity mismatch for ${where}`);
        if ("threw" in a) {
          checks++;
          continue;
        }
        assert.ok(
          Object.is(a.value, b.value),
          `runtime ${JSON.stringify(a.value) ?? String(a.value)} !== compiler ${JSON.stringify(b.value) ?? String(b.value)} for ${where}`
        );
        checks++;
      }
    }
  }
  // A silent battery collapse (an empty EXPRS, a skipped loop) would otherwise
  // pass; pin the count so the guard cannot become vacuous.
  assert.equal(checks, EXPRS.length * STATES.length * ITEMS.length);
  assert.ok(checks > 1000, `battery too small to be a real guard: ${checks}`);
});

test("PARITY: both walkers reject an unknown op tag rather than falling through", () => {
  const runtime = loadRuntimeEval();
  assert.throws(() => runtime.run(["boomOp"], {}, undefined), /unknown op/);
  assert.throws(() => compilerEval(["boomOp"], undefined, { state: new Map() }), /unknown op/);
});

test("PARITY: both walkers refuse prototype-pollution segments in a dotted read", () => {
  const runtime = loadRuntimeEval();
  for (const code of [
    'S("deep","constructor")',
    'S("deep","__proto__")',
    'I("nested.__proto__")'
  ]) {
    const ast = astOf(code);
    const st = { deep: { a: 1 } };
    assert.equal(runtime.run(ast, st, { nested: { z: 1 } }), undefined, code);
    assert.equal(
      compilerEval(ast, { nested: { z: 1 } }, { state: new Map(Object.entries(st)) }),
      undefined,
      code
    );
  }
});
