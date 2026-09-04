// Drift guard for the loop-row key function, which exists TWICE: the compiler
// bakes `data-wd-loop-key` into the initial paint (src/compiler/loops.js) and the
// runtime recomputes it on every reconcile (src/runtime.js). The runtime's
// `existing` Map is keyed on that attribute, so the two must agree exactly or a
// row is never matched to its node — the list then grows by one node per render,
// unbounded.
//
// The specific bug this pins: the `#n` duplicate suffix used to be appended to a
// raw key, so a REAL key of "a#1" collided with the first duplicate of "a". Both
// sides now escape every literal `#` as `##` first, which puts the suffix in a
// namespace no author key can reach.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loopKeyOf as compilerKeyOf } from "../src/compiler.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = `${fs.readFileSync(path.join(here, "..", "src", "runtime.js"), "utf8")}\nglobalThis.__loopKeyOf = loopKeyOf;`;

/** Boot the REAL runtime against an empty document and hand back its key function. */
function loadRuntimeKeyOf() {
  const sandbox = {
    document: {
      activeElement: null,
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: () => {}
    },
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
    Map,
    Set,
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
  return sandbox.__loopKeyOf;
}

// One ORDERED list, walked with a single shared counts Map on each side — the
// duplicate suffix only exists relative to what came before it.
const ROWS = [
  "a",
  "a",
  "a",
  "a#1",
  "a##1",
  { id: "a#1" },
  { id: "a" },
  { key: "a#1" },
  { key: "b" },
  { id: "#" },
  { id: "##" },
  { name: "no id or key" },
  { name: "no id or key" },
  { id: 0 },
  { id: false },
  { id: null, key: "fallback" },
  0,
  1,
  1,
  -3,
  1.5,
  null,
  undefined,
  true,
  "",
  "",
  "b#2#3"
];

test("PARITY: compiler and runtime derive byte-identical loop keys", () => {
  const runtimeKeyOf = loadRuntimeKeyOf();
  const runtimeCounts = new Map();
  const compilerCounts = new Map();
  const seen = [];
  for (const row of ROWS) {
    const fromRuntime = runtimeKeyOf(row, runtimeCounts);
    const fromCompiler = compilerKeyOf(row, compilerCounts);
    assert.equal(
      fromRuntime,
      fromCompiler,
      `key mismatch for ${JSON.stringify(row) ?? String(row)}`
    );
    seen.push(fromRuntime);
  }
  assert.equal(seen.length, ROWS.length);
});

test("a real `a#1` key never collides with the first duplicate of `a`", () => {
  const runtimeKeyOf = loadRuntimeKeyOf();
  for (const keyOf of [runtimeKeyOf, compilerKeyOf]) {
    const counts = new Map();
    const first = keyOf("a", counts); // "a"
    const dup = keyOf("a", counts); // the duplicate suffix
    const literal = keyOf("a#1", counts); // an author key that LOOKS like the suffix
    assert.equal(first, "a");
    assert.equal(dup, "a#1");
    assert.equal(literal, "a##1");
    assert.notEqual(dup, literal, "the duplicate suffix collided with a real key");
  }
});

test("every key in a list is distinct, so no row can shadow another", () => {
  const runtimeKeyOf = loadRuntimeKeyOf();
  for (const keyOf of [runtimeKeyOf, compilerKeyOf]) {
    const counts = new Map();
    const keys = ROWS.map((row) => keyOf(row, counts));
    assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys.join(" | ")}`);
  }
});
