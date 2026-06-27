// Drift guard: the runtime carries its own compact copy of the formatter math
// (src/runtime.js `FMT`) so the reactive path can re-format in the browser. This
// test loads the REAL runtime source in a vm, exposes its `FMT`, and asserts it
// is behaviorally identical to the compiler's `FORMATTERS` (src/compiler/format.js)
// across a battery of inputs — so a static fold and a live update can never diverge.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { FORMATTER_NAMES, FORMATTERS } from "../src/compiler/format.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource =
  fs.readFileSync(path.join(here, "..", "src", "runtime.js"), "utf8") + "\nglobalThis.__FMT = FMT;";

/** Run the runtime in a minimal sandbox (empty document) and return its FMT table. */
function loadRuntimeFMT() {
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
  return sandbox.__FMT;
}

test("runtime FMT and compiler FORMATTERS expose the same formatter names", () => {
  const FMT = loadRuntimeFMT();
  assert.deepEqual(Object.keys(FMT).sort(), FORMATTER_NAMES.slice().sort());
});

test("runtime FMT and compiler FORMATTERS agree on every formatter", () => {
  const FMT = loadRuntimeFMT();
  /** @type {[string, any, any[]][]} */
  const cases = [
    ["money", 49, []],
    ["money", 1234.5, ["EUR"]],
    ["money", "junk", []],
    ["number", 1234567, []],
    ["number", 5.6789, [2]],
    ["percent", 0.42, []],
    ["percent", 0.1234, [1]],
    ["round", 2.5, []],
    ["round", 5.6789, [2]],
    ["date", "2026-06-27T12:00:00Z", ["short"]],
    ["date", "2026-06-27T12:00:00Z", ["medium"]],
    ["time", "2026-06-27T12:00:00Z", ["short"]],
    ["datetime", "2026-01-02T03:04:00Z", []],
    ["date", "not a date", []],
    ["upper", "hi", []],
    ["lower", "HI", []],
    ["capitalize", "hello world", []],
    ["truncate", "the quick brown fox", [9]],
    ["truncate", "short", [9]],
    ["trim", "  x  ", []],
    ["pluralize", 1, ["item"]],
    ["pluralize", 3, ["item"]],
    ["pluralize", 2, ["person", "people"]],
    ["default", "", ["—"]],
    ["default", null, ["—"]],
    ["default", "value", ["—"]],
    ["sum", [{ price: 49 }, { price: 99 }, { price: 12.5 }], ["price"]],
    ["avg", [{ p: 2 }, { p: 4 }], ["p"]],
    ["min", [{ p: 5 }, { p: 1 }], ["p"]],
    ["max", [{ p: 5 }, { p: 1 }], ["p"]],
    ["count", [1, 2, 3], []],
    ["sum", [1, 2, 3], []],
    ["join", [{ n: "a" }, { n: "b" }], [" / ", "n"]]
  ];
  for (const [name, value, args] of cases) {
    assert.equal(
      FMT[name](value, args),
      FORMATTERS[name](value, args),
      `mismatch: ${name}(${JSON.stringify(value)}, ${JSON.stringify(args)})`
    );
  }
});
