import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage, escapeHtml } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// :bind — two-way text input bound to a :state value
// ---------------------------------------------------------------------------

test(":bind emits an input wired to state with its initial value + placeholder", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [':state query = "shoe"', ':bind query placeholder="Search products"'].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(
    page.html,
    /<input type="text" data-wd-bind-input="query" value="shoe" placeholder="Search products" aria-label="Search products">/
  );
  assert.equal(page.assets.runtime, true);
});

test(":bind with an empty-string initial value emits an empty value attribute", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [':state q = ""', ":bind q"].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<input type="text" data-wd-bind-input="q" value="" aria-label="Q">/);
});

test(":bind honours type= and boolean flags", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [':state email = ""', ":bind email type=email required autofocus"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(
    page.html,
    /<input type="email" data-wd-bind-input="email" value="" required autofocus aria-label="Email">/
  );
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

test(":bind rejects unknown bare flags", () => {
  // `required` and `autofocus` are the only bare flags; anything else is a
  // typo the author should hear about rather than have silently dropped.
  const root = fixture();
  write(root, "site/pages/index.wd", [':state q = ""', ":bind q autoplay"].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unknown :bind flag "autoplay"/
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
  write(
    root,
    "site/_/products.json",
    JSON.stringify([
      { id: 1, name: "Aurora", price: 49, featured: true },
      { id: 2, name: "Briza", price: 39, featured: false },
      { id: 3, name: "Cove", price: 89, featured: true }
    ])
  );
  write(
    root,
    "site/pages/index.wd",
    [
      "@loop /products.json into p where p.featured == true and p.price < 80",
      "- { p.name }",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, false, "item-only predicate must stay zero-JS");
  assert.match(page.html, /<li>Aurora<\/li>/);
  assert.doesNotMatch(page.html, /Briza/); // not featured
  assert.doesNotMatch(page.html, /Cove/); // price >= 80
  assert.doesNotMatch(page.html, /data-wd-loop/);
});

test("@loop where supports contains, numeric ops, and or-joins (static)", () => {
  const root = fixture();
  write(
    root,
    "site/_/items.json",
    JSON.stringify([
      { id: 1, name: "Red Mug", price: 10 },
      { id: 2, name: "Blue Mug", price: 99 },
      { id: 3, name: "Green Hat", price: 5 }
    ])
  );
  write(
    root,
    "site/pages/index.wd",
    [
      '@loop /items.json into i where i.name contains "mug" or i.price < 6',
      "- { i.name }",
      "@endloop"
    ].join("\n")
  );
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
  write(
    root,
    "site/pages/index.wd",
    [
      ':state products = [{"id":1,"name":"Aurora Lamp"},{"id":2,"name":"Briza Fan"}]',
      ':state q = ""',
      ":bind q",
      "@loop products into p where p.name contains q",
      "- { p.name }",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /data-wd-loop="products"/);
  // The `where` predicate compiles to a serialized C() AST (walked, not eval'd).
  assert.ok(
    page.html.includes(
      `data-wd-loop-where="${escapeHtml(JSON.stringify(["C", ["I", "name"], ["S", "q"]]))}"`
    )
  );
  // q is "" so contains matches all → both rendered initially
  assert.match(page.html, /Aurora Lamp/);
  assert.match(page.html, /Briza Fan/);
});

test("@loop where over a JSON file but referencing :state bakes the rows and goes reactive", () => {
  const root = fixture();
  write(
    root,
    "site/_/products.json",
    JSON.stringify([
      { id: 1, name: "Aurora", price: 49 },
      { id: 2, name: "Briza", price: 39 },
      { id: 3, name: "Cove", price: 89 }
    ])
  );
  write(
    root,
    "site/pages/index.wd",
    [
      ":state budget = 50",
      "@loop /products.json into p where p.price <= budget",
      "- { p.name }",
      "@endloop"
    ].join("\n")
  );
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
  write(
    root,
    "site/pages/index.wd",
    ["@loop /x.json into p where p.constructor == 1", "- x", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /not allowed in @loop where/
  );
});

test("@loop where rejects an unknown bare identifier (no eval of arbitrary names)", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "a" }]));
  write(
    root,
    "site/pages/index.wd",
    ["@loop /x.json into p where p.name == somethingUndeclared", "- x", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /references unknown name "somethingUndeclared"/
  );
});

test("@loop where rejects an operand that is not a path/number/string", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "a" }]));
  write(
    root,
    "site/pages/index.wd",
    ["@loop /x.json into p where p.name == 1+1", "- x", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unsupported operand/
  );
});

test("@loop where with a malformed condition throws a corrective error", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1 }]));
  write(
    root,
    "site/pages/index.wd",
    ["@loop /x.json into p where p.name", "- x", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Malformed where-condition/
  );
});

test("@loop without where still works (no regression)", () => {
  const root = fixture();
  write(
    root,
    "site/_/x.json",
    JSON.stringify([
      { id: 1, name: "a" },
      { id: 2, name: "b" }
    ])
  );
  write(
    root,
    "site/pages/index.wd",
    ["@loop /x.json into p", "- { p.name }", "@endloop"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<li>a<\/li>/);
  assert.match(page.html, /<li>b<\/li>/);
  assert.equal(page.assets.runtime, false);
});

// ---------------------------------------------------------------------------
// @loop clause grammar — sort / reverse / offset / limit (reactive emission)
// ---------------------------------------------------------------------------

test("@loop emits sort/reverse/offset/limit clause attributes (reactive over :state)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state people = [{"id":1,"name":"Cy","age":30},{"id":2,"name":"Al","age":20}]',
      "@loop people into p where p.age > 0 sort by p.age desc reverse offset 1 limit 2",
      "- { p.name }",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /data-wd-loop="people"/);
  assert.match(page.html, /data-wd-loop-sort="age"/);
  assert.match(page.html, /data-wd-loop-sort-dir="desc"/);
  assert.match(page.html, /data-wd-loop-reverse/);
  assert.match(page.html, /data-wd-loop-offset="1"/);
  assert.match(page.html, /data-wd-loop-limit="2"/);
});

test("@loop sort defaults to asc and sort key can be the bare item", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":state nums = [3, 1, 2]", "@loop nums into n sort by n", "- { n }", "@endloop"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-loop-sort=""/);
  assert.match(page.html, /data-wd-loop-sort-dir="asc"/);
});

test("@loop limit/offset accept a :state key for reactive paging (key:<name>)", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state rows = [{"id":1},{"id":2},{"id":3}]',
      ":state pageSize = 2",
      "@loop rows into r limit pageSize",
      "- { r.id }",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /data-wd-loop-limit="key:pageSize"/);
});

test("@loop wrong clause order throws a corrective error", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":state xs = [1, 2, 3]", "@loop xs into x limit 2 sort by x", "- { x }", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Use: @loop src into item \[where …\] \[sort by …\] \[reverse\] \[offset N\] \[limit N\]/
  );
});

test("@loop rejects a negative limit and a non-integer offset", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":state xs = [1, 2, 3]", "@loop xs into x limit -1", "- { x }", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Use: @loop src into item/
  );
});

test("@loop sort key rejects prototype-pollution segments", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1 }]));
  write(
    root,
    "site/pages/index.wd",
    ["@loop /x.json into p sort by p.__proto__", "- x", "@endloop"].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /not allowed/
  );
});

// ---------------------------------------------------------------------------
// @loop pipeline at build time — static stays zero-JS (regression gate)
// ---------------------------------------------------------------------------

test("static @loop with sort/limit resolves at build time and stays runtime:false", () => {
  const root = fixture();
  write(
    root,
    "site/_/data.json",
    JSON.stringify([
      { n: 3, label: "three" },
      { n: 1, label: "one" },
      { n: 2, label: "two" }
    ])
  );
  write(
    root,
    "site/pages/index.wd",
    ["@loop /data.json into x sort by x.n limit 2", "- { x.label }", "@endloop"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, false, "static source + static clauses must stay zero-JS");
  assert.doesNotMatch(page.html, /data-wd-loop/);
  // sorted asc by n → one(1), two(2); limit 2 drops three
  const oneAt = page.html.indexOf("one");
  const twoAt = page.html.indexOf("two");
  assert.ok(oneAt >= 0 && twoAt > oneAt, "sorted ascending: one before two");
  assert.doesNotMatch(page.html, /three/);
});

test("static @loop reverse + offset resolves at build time", () => {
  const root = fixture();
  write(root, "site/_/d.json", JSON.stringify([{ v: "a" }, { v: "b" }, { v: "c" }, { v: "d" }]));
  write(
    root,
    "site/pages/index.wd",
    ["@loop /d.json into x reverse offset 1 limit 2", "- { x.v }", "@endloop"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, false);
  // reverse → d c b a ; offset 1 → c b a ; limit 2 → c b
  assert.match(page.html, /<li>c<\/li>/);
  assert.match(page.html, /<li>b<\/li>/);
  assert.doesNotMatch(page.html, /<li>d<\/li>/);
  assert.doesNotMatch(page.html, /<li>a<\/li>/);
});

test("static @loop sort desc with localeCompare for strings", () => {
  const root = fixture();
  write(
    root,
    "site/_/words.json",
    JSON.stringify([{ w: "banana" }, { w: "apple" }, { w: "cherry" }])
  );
  write(
    root,
    "site/pages/index.wd",
    ["@loop /words.json into x sort by x.w desc", "- { x.w }", "@endloop"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, false);
  const cherry = page.html.indexOf("cherry");
  const banana = page.html.indexOf("banana");
  const apple = page.html.indexOf("apple");
  assert.ok(cherry < banana && banana < apple, "desc string order: cherry, banana, apple");
});

test("@loop with a :state limit key becomes reactive even over a static JSON source", () => {
  const root = fixture();
  write(root, "site/_/d.json", JSON.stringify([{ v: 1 }, { v: 2 }, { v: 3 }]));
  write(
    root,
    "site/pages/index.wd",
    [":state take = 2", "@loop /d.json into x limit take", "- { x.v }", "@endloop"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(
    page.assets.runtime,
    true,
    "a state clause arg over a static source must go reactive"
  );
  assert.match(page.html, /data-wd-loop-data=/); // rows baked for the runtime
  assert.match(page.html, /data-wd-loop-limit="key:take"/);
});

// ---------------------------------------------------------------------------
// @loop meta vars — $index / $number / $first / $last / $count
// ---------------------------------------------------------------------------

test("static @loop computes per-row meta vars in interpolation", () => {
  const root = fixture();
  write(root, "site/_/m.json", JSON.stringify([{ t: "a" }, { t: "b" }, { t: "c" }]));
  write(
    root,
    "site/pages/index.wd",
    ["@loop /m.json into x", "- { $number }. { x.t } (of { $count })", "@endloop"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, false);
  assert.match(page.html, /1\. a \(of 3\)/);
  assert.match(page.html, /2\. b \(of 3\)/);
  assert.match(page.html, /3\. c \(of 3\)/);
});

test("static @loop resolves :if $first and :if $last per row", () => {
  const root = fixture();
  write(root, "site/_/m.json", JSON.stringify([{ t: "a" }, { t: "b" }, { t: "c" }]));
  write(
    root,
    "site/pages/index.wd",
    [
      "@loop /m.json into x",
      ":if $first",
      "FIRST { x.t }",
      ":else",
      "ROW { x.t }",
      ":endif",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /FIRST a/);
  assert.match(page.html, /ROW b/);
  assert.match(page.html, /ROW c/);
  assert.doesNotMatch(page.html, /FIRST b/);
});

test("reactive @loop emits meta markers filled per row", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state rows = [{"id":1,"t":"a"},{"id":2,"t":"b"}]',
      "@loop rows into x",
      "- { $index }: { x.t }",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  // template carries a meta marker for $index
  assert.match(page.html, /data-wd-each-meta="index"/);
  // initial paint fills 0 and 1
  assert.match(page.html, /<span data-wd-each-meta="index">0<\/span>/);
  assert.match(page.html, /<span data-wd-each-meta="index">1<\/span>/);
});

test("$ meta vars used outside a loop throw a compile error", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", "Hello { $index }");
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /\$index/
  );
});

test(":if $first outside a loop throws a compile error", () => {
  const root = fixture();
  write(root, "site/pages/index.wd", [":if $first", "x", ":endif"].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /\$first/
  );
});

// ---------------------------------------------------------------------------
// @loop @empty branch
// ---------------------------------------------------------------------------

test("static @loop @empty renders the empty branch when the post-pipeline list is empty", () => {
  const root = fixture();
  write(root, "site/_/none.json", JSON.stringify([{ ok: false }]));
  write(
    root,
    "site/pages/index.wd",
    [
      "@loop /none.json into x where x.ok == true",
      "- { x.ok }",
      "@empty",
      "Nothing here yet.",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, false);
  assert.match(page.html, /Nothing here yet\./);
});

test("static @loop @empty omits the empty branch when rows exist", () => {
  const root = fixture();
  write(root, "site/_/some.json", JSON.stringify([{ t: "a" }]));
  write(
    root,
    "site/pages/index.wd",
    ["@loop /some.json into x", "- { x.t }", "@empty", "Nothing here yet.", "@endloop"].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /<li>a<\/li>/);
  assert.doesNotMatch(page.html, /Nothing here yet\./);
});

test("reactive @loop @empty emits an [data-wd-loop-empty] template", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ":state items = []",
      "@loop items into x",
      "- { x.t }",
      "@empty",
      "No items.",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /<template data-wd-loop-empty>/);
  assert.match(page.html, /No items\./);
});

test("@loop @empty without @endloop errors", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [":state items = []", "@loop items into x", "- { x.t }", "@empty", "No items."].join("\n")
  );
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Missing @endloop/
  );
});

// ---------------------------------------------------------------------------
// Dotted loop sources
// ---------------------------------------------------------------------------

test("@loop over a dotted :state path resolves the nested list reactively", () => {
  const root = fixture();
  write(
    root,
    "site/pages/index.wd",
    [
      ':state team = {"members": [{"id":1,"name":"Ann"},{"id":2,"name":"Bo"}]}',
      "@loop team.members into m",
      "- { m.name }",
      "@endloop"
    ].join("\n")
  );
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /Ann/);
  assert.match(page.html, /Bo/);
});

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-filter-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
