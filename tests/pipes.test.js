// Integration tests for the value layer: format pipes `{ value | name:arg }` and
// `:computed` aggregates. Exercises the real compiler — build-time folding (stays
// zero-JS) vs reactive emission (data-wd-fmt + runtime), loop rows, and errors.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileDocument, escapeHtml } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

/** Write a page (+ optional shelf files) and compile it. Returns { html, assets }. */
function compile(body, { shelf = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-pipes-"));
  fs.mkdirSync(path.join(root, "site/pages"), { recursive: true });
  fs.mkdirSync(path.join(root, "site/_"), { recursive: true });
  for (const [name, content] of Object.entries(shelf)) {
    fs.writeFileSync(path.join(root, "site/_", name), content);
  }
  const pageFile = path.join(root, "site/pages/index.wd");
  fs.writeFileSync(pageFile, body);
  const warn = console.warn;
  console.warn = () => {};
  try {
    return compileDocument(pageFile, createPaths(root));
  } finally {
    console.warn = warn;
  }
}

test("static value + pipe folds to a literal and ships zero JS", () => {
  const doc = compile(`---
amount: 49
---
Total: { meta.amount | money }`);
  assert.match(doc.html, /Total: \$49\.00/);
  assert.equal(doc.assets.runtime, false, "a static fold must not pull in the runtime");
  assert.doesNotMatch(doc.html, /data-wd-fmt/);
});

test("static loop over JSON folds each row's pipe at build time (zero JS)", () => {
  const doc = compile(`@loop /products.json into p\n- { p.name } — { p.price | money }\n@endloop`, {
    shelf: {
      "products.json": JSON.stringify([
        { name: "Aurora", price: 49 },
        { name: "Briza", price: 12.5 }
      ])
    }
  });
  assert.match(doc.html, /Aurora — \$49\.00/);
  assert.match(doc.html, /Briza — \$12\.50/);
  assert.equal(doc.assets.runtime, false);
});

test("reactive state + pipe emits data-wd-fmt, a formatted initial paint, and the runtime", () => {
  const doc = compile(`:state price = 49\n\nNow: { price | money }`);
  assert.equal(doc.assets.runtime, true);
  const m = doc.html.match(/<span data-wd-bind="price" data-wd-fmt="([^"]*)">([^<]*)<\/span>/);
  assert.ok(m, "expected a formatted bind span");
  assert.equal(m[2], "$49.00", "initial paint is formatted");
  assert.match(m[1], /money/);
});

test("aggregate pipe sums a list then formats it", () => {
  const doc = compile(
    `:store cart = [{"price":49},{"price":99}]\n\nTotal: { cart | sum:"price" | money }`
  );
  assert.equal(doc.assets.runtime, true);
  const m = doc.html.match(/<span data-wd-bind="cart" data-wd-fmt="([^"]*)">([^<]*)<\/span>/);
  assert.ok(m, "expected an aggregate bind span on cart");
  assert.equal(m[2], "$148.00");
});

test("reactive loop row formats a per-row value with data-wd-each + data-wd-fmt", () => {
  const doc = compile(
    `:state items = [{"id":1,"price":49},{"id":2,"price":12.5}]\n\n@loop items into it\n- { it.price | money }\n@endloop`
  );
  assert.equal(doc.assets.runtime, true);
  // Initial paint fills the first row's template string with the formatted value.
  assert.match(doc.html, /data-wd-each data-wd-path="price" data-wd-fmt="[^"]*">\$49\.00</);
});

test(":computed aggregate sum(list, field) drives a derived total", () => {
  const doc = compile(
    `:store cart = [{"price":49},{"price":99},{"price":2}]\n:computed total = sum(cart, price)\n\n@loop cart into c\nx\n@endloop\nTotal: { total | money }`
  );
  // build-time initial value of `total` is 150 → $150.00
  const m = doc.html.match(/<span data-wd-bind="total" data-wd-fmt="[^"]*">([^<]*)<\/span>/);
  assert.ok(m);
  assert.equal(m[1], "$150.00");
  // the compiled expression uses the whitelisted A() aggregate node, not a raw call
  assert.ok(
    doc.html.includes(
      `data-wd-computed-expr="${escapeHtml(JSON.stringify(["A", "sum", ["S", "cart"], "price"]))}"`
    )
  );
});

test(":computed count(list) and a threshold :if compose", () => {
  const doc = compile(
    `:store cart = [{"price":49}]\n:computed total = sum(cart, price)\n\n:if total >= 50\nFree shipping unlocked\n:else\nAdd more\n:endif`
  );
  assert.equal(doc.assets.runtime, true);
  assert.match(doc.html, /data-wd-if-expr/);
});

test("pipes work on loop meta — { $number | pluralize }", () => {
  const doc = compile(
    `:state rows = [{"id":1},{"id":2}]\n\n@loop rows into r\n{ $number | pluralize:"row" }\n@endloop`
  );
  assert.match(doc.html, /data-wd-each-meta="number" data-wd-fmt="[^"]*"/);
});

test("unknown formatter is a compile error with a corrective list", () => {
  assert.throws(
    () => compile(`:state x = 1\n\n{ x | bogus }`),
    /Unknown formatter "bogus".*Available: money, number/s
  );
});

test(":computed aggregate over a prototype-pollution path is a compile error", () => {
  assert.throws(
    () => compile(`:state cart = []\n:computed t = sum(cart.__proto__, x)`),
    /not allowed in :computed sum/
  );
});

test(":computed aggregate over unknown state is a compile error", () => {
  assert.throws(() => compile(`:computed t = sum(nope, price)`), /references unknown state "nope"/);
});

test("pipes never collide with inline-attrs {.class} or plain prose braces", () => {
  const doc = compile(`[Go](/start){.btn}\n\nLiteral { not_a_binding } stays text.`);
  assert.match(doc.html, /class="btn"/);
  assert.match(doc.html, /\{ not_a_binding \}/);
  assert.equal(doc.assets.runtime, false);
});
