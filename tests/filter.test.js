import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// :bind — two-way text input bound to a :state value
// ---------------------------------------------------------------------------

test(":bind emits an input wired to state with its initial value + placeholder", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state query = "shoe"',
    ':bind query placeholder="Search products"'
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<input type="text" data-wd-bind-input="query" value="shoe" placeholder="Search products">/);
  assert.equal(page.assets.runtime, true);
});

test(":bind with an empty-string initial value emits an empty value attribute", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [':state q = ""', ":bind q"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<input type="text" data-wd-bind-input="q" value="" >/);
});

test(":bind honours type= and boolean flags", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [':state email = ""', ':bind email type=email required autofocus'].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<input type="email" data-wd-bind-input="email" value="" required autofocus>/);
});

test(":bind escapes a malicious initial value", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [':state q = "\\"><script>x</script>"', ":bind q"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.doesNotMatch(page.html, /value=""><script/); // raw quote did not break out of the attribute
  assert.match(page.html, /&gt;&lt;script&gt;x&lt;\/script&gt;/); // angle brackets neutralised
});

test(":bind on undeclared state throws with a corrective suggestion", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", ":bind nope");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /:bind nope .* no matching state\. Declare it first: :state nope = ""/
  );
});

test(":bind rejects unknown attributes", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [':state q = ""', ':bind q onclick="evil()"'].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unknown :bind attribute "onclick"/
  );
});

// ---------------------------------------------------------------------------
// @loop … where — static filtering (item-only predicate, stays zero-JS)
// ---------------------------------------------------------------------------

test("@loop where over a JSON file with an item-only predicate filters at build time and stays static", () => {
  const root = fixture();
  write(root, "site/_/products.json", JSON.stringify([
    { id: 1, name: "Aurora", price: 49, featured: true },
    { id: 2, name: "Briza", price: 39, featured: false },
    { id: 3, name: "Cove", price: 89, featured: true }
  ]));
  write(root, "site/pages/index.wd", [
    "@loop /products.json into p where p.featured == true and p.price < 80",
    "- { p.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, false, "item-only predicate must stay zero-JS");
  assert.match(page.html, /<li>Aurora<\/li>/);
  assert.doesNotMatch(page.html, /Briza/); // not featured
  assert.doesNotMatch(page.html, /Cove/); // price >= 80
  assert.doesNotMatch(page.html, /data-wd-loop/);
});

test("@loop where supports contains, numeric ops, and or-joins (static)", () => {
  const root = fixture();
  write(root, "site/_/items.json", JSON.stringify([
    { id: 1, name: "Red Mug", price: 10 },
    { id: 2, name: "Blue Mug", price: 99 },
    { id: 3, name: "Green Hat", price: 5 }
  ]));
  write(root, "site/pages/index.wd", [
    '@loop /items.json into i where i.name contains "mug" or i.price < 6',
    "- { i.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /Red Mug/);
  assert.match(page.html, /Blue Mug/);
  assert.match(page.html, /Green Hat/); // price < 6
  assert.equal(page.assets.runtime, false);
});

// ---------------------------------------------------------------------------
// @loop … where — reactive filtering (predicate reads :state)
// ---------------------------------------------------------------------------

test("@loop where over :state with a state-referencing predicate is reactive", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [
    ':state products = [{"id":1,"name":"Aurora Lamp"},{"id":2,"name":"Briza Fan"}]',
    ':state q = ""',
    ":bind q",
    "@loop products into p where p.name contains q",
    "- { p.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /data-wd-loop="products"/);
  assert.match(page.html, /data-wd-loop-where="\(C\(I\(&quot;name&quot;\), S\(&quot;q&quot;\)\)\)"/);
  // q is "" so contains matches all → both rendered initially
  assert.match(page.html, /Aurora Lamp/);
  assert.match(page.html, /Briza Fan/);
});

test("@loop where over a JSON file but referencing :state bakes the rows and goes reactive", () => {
  const root = fixture();
  write(root, "site/_/products.json", JSON.stringify([
    { id: 1, name: "Aurora", price: 49 },
    { id: 2, name: "Briza", price: 39 },
    { id: 3, name: "Cove", price: 89 }
  ]));
  write(root, "site/pages/index.wd", [
    ":state budget = 50",
    "@loop /products.json into p where p.price <= budget",
    "- { p.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true, "state-referencing predicate must go reactive");
  assert.match(page.html, /data-wd-loop=""/); // no state key — baked source
  assert.match(page.html, /data-wd-loop-data=/); // rows baked for the runtime
  // initial paint filtered by budget=50 → Aurora(49) + Briza(39), not Cove(89)
  assert.match(page.html, /Aurora/);
  assert.match(page.html, /Briza/);
  assert.doesNotMatch(page.html, /<li[^>]*>Cove/);
});

// ---------------------------------------------------------------------------
// @loop … where — whitelist / security
// ---------------------------------------------------------------------------

test("@loop where rejects prototype-pollution path segments", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1 }]));
  write(root, "site/pages/index.wd", [
    "@loop /x.json into p where p.constructor == 1",
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /not allowed in @loop where/
  );
});

test("@loop where rejects an unknown bare identifier (no eval of arbitrary names)", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "a" }]));
  write(root, "site/pages/index.wd", [
    "@loop /x.json into p where p.name == somethingUndeclared",
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /references unknown name "somethingUndeclared"/
  );
});

test("@loop where rejects an operand that is not a path/number/string", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "a" }]));
  write(root, "site/pages/index.wd", [
    "@loop /x.json into p where p.name == 1+1",
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unsupported operand/
  );
});

test("@loop where with a malformed condition throws a corrective error", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1 }]));
  write(root, "site/pages/index.wd", [
    "@loop /x.json into p where p.name",
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Malformed where-condition/
  );
});

test("@loop without where still works (no regression)", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "a" }, { id: 2, name: "b" }]));
  write(root, "site/pages/index.wd", ["@loop /x.json into p", "- { p.name }", "@endloop"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<li>a<\/li>/);
  assert.match(page.html, /<li>b<\/li>/);
  assert.equal(page.assets.runtime, false);
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-filter-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
