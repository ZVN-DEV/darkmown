import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compilePage } from "../src/compiler.js";
import { createPaths } from "../src/config.js";

// ---------------------------------------------------------------------------
// Compiler grammar whitelists: :computed, @loop … where predicate, :button.
// These assert that SAFE expressions compile to the expected runtime artifacts
// and that DANGEROUS ones are rejected at compile time with actionable text.
// ---------------------------------------------------------------------------

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-grammar-"));
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function compile(lines) {
  const root = fixture();
  write(root, "site/pages/index.wd", Array.isArray(lines) ? lines.join("\n") : lines);
  return compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
}

function compileThrows(lines, re) {
  const root = fixture();
  write(root, "site/pages/index.wd", Array.isArray(lines) ? lines.join("\n") : lines);
  assert.throws(() => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)), re);
}

// --- :computed — SAFE forms compile ----------------------------------------

test(":computed compiles arithmetic, comparisons, and boolean operators safely", () => {
  const page = compile([
    ":state a = 10",
    ":state b = 3",
    ":computed sum = a + b",
    ":computed diff = a - b",
    ":computed prod = a * b",
    ":computed quot = a / b",
    ":computed modv = a % b",
    ":computed cmp = a > b && b < a || a == 10",
    ":computed neg = !cmp"
  ]);
  // Every state reference is mapped to S("key"); no bare identifiers survive.
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;a&quot;\) \+ S\(&quot;b&quot;\)"/);
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;a&quot;\) % S\(&quot;b&quot;\)"/);
  assert.match(page.html, /data-wd-computed-expr="!S\(&quot;cmp&quot;\)"/);
  // Build-time seed: 10 + 3 = 13 baked into the bound span.
  assert.match(page.html, /data-wd-computed-key="sum"[\s\S]*?"sum":13/);
  assert.equal(page.assets.runtime, true);
});

test(":computed allows string literals as a safe operand", () => {
  const page = compile([
    ':state name = "Kirby"',
    ':computed greet = name == "Kirby"'
  ]);
  // The quoted literal is preserved and the identifier is mapped to S().
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;name&quot;\) == &quot;Kirby&quot;"/);
  assert.match(page.html, /"greet":true/);
});

test(":computed resolves dotted state paths through S(key, rest)", () => {
  const page = compile([
    ':state cart = {"count": 4}',
    ":computed double = cart.count * 2"
  ]);
  assert.match(page.html, /data-wd-computed-expr="S\(&quot;cart&quot;,&quot;count&quot;\) \* 2"/);
  assert.match(page.html, /"double":8/);
});

// --- :computed — DANGEROUS forms rejected ----------------------------------

test(":computed rejects a backtick template literal", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = `${a}`"
  ], /Unsupported string syntax/);
});

test(":computed rejects a free identifier (process) not declared as state", () => {
  compileThrows(":computed x = process", /unknown state "process"/);
});

test(":computed rejects a call to a non-state name", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = alert(a)"
  ], /Function calls are not allowed/);
});

test(":computed rejects a method call on real state (x.valueOf())", () => {
  compileThrows([
    ":state x = 1",
    ":computed y = x.valueOf()"
  ], /Function calls are not allowed/);
});

test(":computed still allows grouping parens around arithmetic", () => {
  const page = compile([
    ":state a = 2",
    ":state b = 3",
    ":computed grouped = (a + b) * 2"
  ]);
  assert.match(page.html, /data-wd-computed-expr="\(S\(&quot;a&quot;\) \+ S\(&quot;b&quot;\)\) \* 2"/);
  assert.match(page.html, /"grouped":10/);
});

test(":computed rejects assignment", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = a = 5"
  ], /Assignment is not allowed/);
});

test(":computed rejects __proto__ / prototype / constructor path segments", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = a.__proto__"
  ], /not allowed in :computed/);
  compileThrows([
    ":state a = 1",
    ":computed x = a.prototype"
  ], /not allowed in :computed/);
});

test(":computed rejects stray punctuation / statement separators", () => {
  compileThrows([
    ":state a = 1",
    ":computed x = a; return a"
  ], /Unsupported syntax/);
});

test(":computed with no '=' is a malformed-directive error with a Use: hint", () => {
  compileThrows(":computed total", /Malformed :computed[\s\S]*Use: :computed/);
});

// --- @loop where predicate — SAFE forms -------------------------------------

test("@loop where compiles every comparison operator to a safe I()/S() expression", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, price: 5, name: "a" }]));
  write(root, "site/pages/index.wd", [
    ":state limit = 100",
    "@loop /x.json into p where p.price >= 1 and p.price <= limit and p.id != 9 and p.price > 0 and p.price < 999",
    "- { p.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  // references :state (limit) → reactive, predicate baked into the data attr.
  assert.equal(page.assets.runtime, true);
  assert.match(page.html, /I\(&quot;price&quot;\) &gt;= 1/);
  assert.match(page.html, /I\(&quot;price&quot;\) &lt;= S\(&quot;limit&quot;\)/);
  assert.match(page.html, /I\(&quot;id&quot;\) != 9/);
});

test("@loop where 'contains' compiles to the C() helper", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "Mug" }]));
  write(root, "site/pages/index.wd", [
    ':state q = "m"',
    "@loop /x.json into p where p.name contains q",
    "- { p.name }",
    "@endloop"
  ].join("\n"));
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  assert.match(page.html, /data-wd-loop-where="\(C\(I\(&quot;name&quot;\), S\(&quot;q&quot;\)\)\)"/);
});

// --- @loop where predicate — DANGEROUS forms --------------------------------

test("@loop where rejects a bare free identifier as a left operand", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1 }]));
  write(root, "site/pages/index.wd", [
    "@loop /x.json into p where evil == 1",
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /references unknown name "evil"/
  );
});

test("@loop where rejects a function call operand", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1, name: "a" }]));
  write(root, "site/pages/index.wd", [
    '@loop /x.json into p where p.name == alert(1)',
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /Unsupported operand/
  );
});

test("@loop where rejects prototype path segments on either side", () => {
  const root = fixture();
  write(root, "site/_/x.json", JSON.stringify([{ id: 1 }]));
  write(root, "site/pages/index.wd", [
    "@loop /x.json into p where p.__proto__ == 1",
    "- x",
    "@endloop"
  ].join("\n"));
  assert.throws(
    () => compilePage(path.join(root, "site/pages/index.wd"), createPaths(root)),
    /not allowed in @loop where/
  );
});

// --- :button actions — SAFE forms -------------------------------------------

test(":button compiles inc/dec/add/append/set actions to their ops", () => {
  const page = compile([
    ":state count = 0",
    ":state tags = []",
    ':state name = ""',
    ':button "Inc" -> count++',
    ':button "Dec" -> count--',
    ':button "Add5" -> count += 5',
    ':button "Tag" -> tags += "x"',
    ':button "Set" -> name = "Kirby"'
  ]);
  assert.match(page.html, /data-wd-action="inc" data-wd-target="count"/);
  assert.match(page.html, /data-wd-action="dec" data-wd-target="count"/);
  assert.match(page.html, /data-wd-action="add" data-wd-target="count" data-wd-value="5"/);
  assert.match(page.html, /data-wd-action="append" data-wd-target="tags" data-wd-value="&quot;x&quot;"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="name" data-wd-value="&quot;Kirby&quot;"/);
});

test(":button set accepts boolean, null, number, and JSON literals", () => {
  const page = compile([
    ":state flag = false",
    ":state n = 0",
    ":state obj = {}",
    ':button "On" -> flag = true',
    ':button "Off" -> flag = null',
    ':button "Num" -> n = 42',
    ':button "Obj" -> obj = {"a": 1}'
  ]);
  assert.match(page.html, /data-wd-action="set" data-wd-target="flag" data-wd-value="true"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="flag" data-wd-value="null"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="n" data-wd-value="42"/);
  assert.match(page.html, /data-wd-action="set" data-wd-target="obj" data-wd-value="\{&quot;a&quot;:1\}"/);
});

// --- :button actions — DANGEROUS / malformed forms --------------------------

test(":button with no '->' arrow is a malformed-directive error", () => {
  compileThrows([
    ":state count = 0",
    ':button "Bad" count++'
  ], /Malformed :button/);
});

test(":button += with a non-number value and a non-list target is rejected", () => {
  compileThrows([
    ':state name = ""',
    ':button "Bad" -> name += "x"'
  ], /requires a list state target/);
});

test(":button action targeting unknown state names the corrective :state form", () => {
  compileThrows(':button "Bad" -> ghost = 1', /unknown state "ghost"[\s\S]*Declare it first/);
});

test(":button rejects an unparseable action literal", () => {
  compileThrows([
    ":state n = 0",
    ':button "Bad" -> n = {not json}'
  ], /Unsupported action literal/);
});

// ---------------------------------------------------------------------------
// Runtime-level action ops + setPath proto-guards.
//
// The runtime is a single top-level script (no exports). We load the REAL
// src/runtime.js through node:vm against a tiny DOM stub that implements only
// what the click/setPath paths touch (closest, querySelectorAll, attributes,
// localStorage, click dispatch). This exercises the genuine setPath / action
// handler / initials code — not a copy.
// ---------------------------------------------------------------------------

import vm from "node:vm";
import { fileURLToPath } from "node:url";

const runtimeSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "runtime.js"),
  "utf8"
);

class RtEl {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
    this._text = "";
    if (this.tagName === "TEMPLATE") this.content = new RtEl("#fragment");
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  appendChild(node) {
    if (node.parent) node.parent.removeChild(node);
    node.parent = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parent = null;
    return node;
  }
  remove() { if (this.parent) this.parent.removeChild(this); }
  cloneNode() {
    const copy = new RtEl(this.tagName);
    for (const [k, v] of this.attrs) copy.attrs.set(k, v);
    copy._text = this._text;
    for (const child of this.children) copy.appendChild(child.cloneNode(true));
    return copy;
  }
  get firstElementChild() { return this.children[0] || null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v == null ? "" : String(v); this.children = []; }
  get innerHTML() { return ""; }
  set innerHTML(v) { if (!v) this.children = []; }
  matches(selector) { return rtMatch(this, selector); }
  closest(selector) {
    let node = this;
    while (node) {
      if (rtMatch(node, selector)) return node;
      node = node.parent;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (rtMatch(child, selector)) out.push(child);
        if (child.tagName !== "TEMPLATE") walk(child);
      }
    };
    walk(this);
    return out;
  }
}

function rtMatch(node, selector) {
  // Native DOM supports comma groups (e.g. "[a],[b]"); match any branch.
  if (selector.includes(",")) return selector.split(",").some((s) => rtMatch(node, s.trim()));
  const m = selector.match(/^([a-zA-Z#]+)?(?:\[([^\]=]+)(?:=([^\]]+))?\])?$/);
  if (!m) return false;
  const [, tag, attr, val] = m;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (attr) {
    if (!node.attrs.has(attr)) return false;
    if (val !== undefined && node.attrs.get(attr) !== val.replace(/^["']|["']$/g, "")) return false;
  }
  return true;
}

// A pending fetch call recorded by the stub: the requested URL plus resolve/
// reject hooks the harness drives to settle responses in a chosen ORDER.
// @typedef {{ url: string, resolve(body:any):void, fail(err:any):void }} PendingFetch

// Build a sandbox around the real runtime. `seeds` becomes a data-wd-state
// script; `persisted` pre-loads localStorage to test the persist-override path.
// `fetches` declares <… data-wd-fetch> marker nodes (one per entry) so the real
// startFetch lifecycle runs on load; the returned `fetchStub` drives responses.
function rtSandbox({ seeds = {}, persisted = {}, stores = {}, ephemeral = {}, fetches = [] } = {}) {
  const root = new RtEl("body");
  const stateScript = new RtEl("script");
  stateScript.setAttribute("data-wd-state", "");
  stateScript.textContent = JSON.stringify(seeds);
  root.appendChild(stateScript);
  // Each :store renders its own <script data-wd-store="name"> seed.
  for (const [name, value] of Object.entries({ ...stores, ...ephemeral })) {
    const s = new RtEl("script");
    s.setAttribute("data-wd-store", name);
    if (name in ephemeral) s.setAttribute("data-wd-store-ephemeral", "");
    s.textContent = JSON.stringify(value);
    root.appendChild(s);
  }
  // Each fetch marker carries the data-wd-fetch-* attributes the runtime reads.
  for (const f of fetches) {
    const node = new RtEl("div");
    node.setAttribute("data-wd-fetch", "");
    for (const [k, v] of Object.entries(f)) node.setAttribute("data-wd-fetch-" + k, String(v));
    root.appendChild(node);
  }

  const listeners = {};
  const document = {
    activeElement: null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }
  };
  const store = new Map(Object.entries(persisted).map(([k, v]) => [k, JSON.stringify(v)]));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  // Controllable fetch stub: every call appends a PendingFetch the test settles
  // by index. Returns a Response-like { ok, status, text() } so the real
  // httpJson core (fetch → text → JSON.parse) runs unchanged.
  /** @type {PendingFetch[]} */
  const calls = [];
  const fetchStub = (url) => new Promise((res, rej) => {
    calls.push({
      url,
      resolve: (body) => res({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) }),
      fail: (err) => rej(err instanceof Error ? err : new Error(String(err)))
    });
  });
  // Timer stub: collect callbacks so the harness can flush retries/debounces
  // deterministically (delay ignored). clearTimeout cancels by id.
  const timers = new Map();
  let timerId = 0;
  const setTimeout = (fn) => { const id = ++timerId; timers.set(id, fn); return id; };
  const clearTimeout = (id) => timers.delete(id);
  const sandbox = {
    document, localStorage, console, JSON, structuredClone,
    Object, Array, Number, String, Map, Set, Boolean, Function, Promise,
    Error, encodeURIComponent, fetch: fetchStub, setTimeout, clearTimeout, queueMicrotask
  };
  // The runtime registers `window.addEventListener("storage", …)` for cross-tab
  // :store sync; the sandbox window is the sandbox itself, so collect listeners
  // here too. `fireStorage(key, newValue)` drives that handler.
  sandbox.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(runtimeSource, sandbox);

  // Pump the microtask queue enough times for the runtime's chained awaits
  // (fetch → text → JSON.parse → render) to fully settle before assertions.
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

  return {
    root,
    state: sandbox.wd.state,
    store,
    // Recorded fetch calls (oldest first); each has .url/.resolve/.fail.
    fetchCalls: calls,
    // Settle a recorded fetch by index, then let its .then/.catch chain run.
    async resolveFetch(i, body) { calls[i].resolve(body); await flush(); },
    async failFetch(i, err) { calls[i].fail(err); await flush(); },
    // Run every queued timer callback (retries, debounces), then flush.
    async runTimers() {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
      await flush();
    },
    // Drain pending microtasks so runtime promise chains settle before asserts.
    flush,
    // Simulate another tab writing localStorage: dispatch a `storage` event.
    fireStorage(key, newValue) {
      for (const fn of listeners.storage || []) fn({ key, newValue });
    },
    // Append an action button under an optional parent (e.g. a loop row), click it.
    click(op, target, value, { parent } = {}) {
      const btn = new RtEl("button");
      btn.setAttribute("data-wd-action", op);
      if (target != null) btn.setAttribute("data-wd-target", target);
      if (value !== undefined) btn.setAttribute("data-wd-value", JSON.stringify(value));
      (parent || root).appendChild(btn);
      for (const fn of listeners.click || []) fn({ target: btn, preventDefault() {} });
      btn.remove();
    },
    // Click a button carrying a `;`-sequence JSON array of {op,target,value}.
    clickSeq(seq) {
      const btn = new RtEl("button");
      btn.setAttribute("data-wd-actions", JSON.stringify(seq));
      root.appendChild(btn);
      for (const fn of listeners.click || []) fn({ target: btn, preventDefault() {} });
      btn.remove();
    },
    render() { sandbox.wd.render(); }
  };
}

// State objects live in the vm realm, so their Array/Object prototypes differ
// from this realm's — `assert.deepEqual` (strict) would reject them on prototype
// identity. Compare by value via a JSON round-trip, which is what we care about.
function eq(actual, expected, msg) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
}

// --- setPath proto-guards ---------------------------------------------------

test("setPath creates nested objects and overwrites without polluting the prototype", () => {
  const h = rtSandbox({ seeds: { obj: {} } });
  // Dotted set walks/creates intermediate objects.
  h.click("set", "obj.a.b", 1);
  eq(h.state.obj, { a: { b: 1 } });
  // Overwrite an existing leaf.
  h.click("set", "obj.a.b", 2);
  assert.equal(h.state.obj.a.b, 2);
});

test("setPath (via dotted set action) rejects __proto__ / constructor / prototype segments", () => {
  const h = rtSandbox({ seeds: { obj: {} } });
  h.click("set", "obj.__proto__.polluted", "yes");
  h.click("set", "__proto__.polluted", "yes");
  h.click("set", "obj.constructor.polluted", "yes");
  h.click("set", "obj.prototype.polluted", "yes");
  assert.equal(({}).polluted, undefined, "Object.prototype must not be polluted");
  assert.equal(Object.prototype.polluted, undefined);
});

// --- expanded action ops ----------------------------------------------------

test("sub op decrements by a numeric amount", () => {
  const h = rtSandbox({ seeds: { n: 10 } });
  h.click("sub", "n", 3);
  assert.equal(h.state.n, 7);
});

test("toggle op flips a boolean", () => {
  const h = rtSandbox({ seeds: { flag: false } });
  h.click("toggle", "flag");
  assert.equal(h.state.flag, true);
  h.click("toggle", "flag");
  assert.equal(h.state.flag, false);
});

test("prepend op adds to the front of a list", () => {
  const h = rtSandbox({ seeds: { list: ["b"] } });
  h.click("prepend", "list", "a");
  eq(h.state.list, ["a", "b"]);
});

test("member-toggle op adds when absent and removes by value when present", () => {
  const h = rtSandbox({ seeds: { tags: [] } });
  h.click("member-toggle", "tags", "x");
  eq(h.state.tags, ["x"]);
  h.click("member-toggle", "tags", "x");
  eq(h.state.tags, []);
});

test("remove-value op removes all matching values from a list", () => {
  const h = rtSandbox({ seeds: { list: ["a", "b", "a"] } });
  h.click("remove-value", "list", "a");
  eq(h.state.list, ["b"]);
});

test("clear op empties arrays to [] and objects to {}", () => {
  const h = rtSandbox({ seeds: { arr: [1, 2], obj: { a: 1 } } });
  h.click("clear", "arr");
  eq(h.state.arr, []);
  h.click("clear", "obj");
  eq(h.state.obj, {});
});

test("merge op shallow-merges another state key", () => {
  const h = rtSandbox({ seeds: { a: { x: 1, y: 2 }, b: { y: 9, z: 3 } } });
  h.click("merge", "a", "b");
  eq(h.state.a, { x: 1, y: 9, z: 3 });
});

test("merge op shallow-merges an inline JSON object literal", () => {
  const h = rtSandbox({ seeds: { a: { x: 1 } } });
  h.click("merge", "a", { y: 2 });
  eq(h.state.a, { x: 1, y: 2 });
});

test("delete op removes an object key", () => {
  const h = rtSandbox({ seeds: { obj: { a: 1, b: 2 } } });
  h.click("delete", "obj", "a");
  eq(h.state.obj, { b: 2 });
});

test("reset op restores the declared seed even after a persisted override", () => {
  // Declared seed is 1, but localStorage seeded a stale 99 via persist.
  const h = rtSandbox({ seeds: { count: 1 }, persisted: {} });
  h.click("inc", "count");
  h.click("inc", "count");
  assert.equal(h.state.count, 3);
  h.click("reset", "count");
  assert.equal(h.state.count, 1, "reset returns to the declared seed value");
});

test("reset deep-clones the seed so mutating after reset doesn't corrupt initials", () => {
  const h = rtSandbox({ seeds: { obj: { items: [1, 2] } } });
  h.click("clear", "obj");
  h.click("reset", "obj");
  eq(h.state.obj, { items: [1, 2] });
  // Mutate the reset value; a second reset must still yield the pristine seed.
  h.state.obj.items.push(99);
  h.click("reset", "obj");
  eq(h.state.obj, { items: [1, 2] }, "initials snapshot is immutable");
});

test("dotted targets work for inc and set", () => {
  const h = rtSandbox({ seeds: { cart: { count: 0 }, user: { name: "" } } });
  h.click("inc", "cart.count");
  assert.equal(h.state.cart.count, 1);
  h.click("set", "user.name", "Kirby");
  assert.equal(h.state.user.name, "Kirby");
});

test("reset on a dotted target restores the declared seed leaf (not undefined)", () => {
  const h = rtSandbox({ seeds: { cart: { count: 5, items: ["a"] } } });
  h.click("inc", "cart.count");
  assert.equal(h.state.cart.count, 6);
  h.click("reset", "cart.count");
  assert.equal(h.state.cart.count, 5, "dotted reset walks initials to the seed leaf");
  assert.deepEqual(h.state.cart.items, ["a"], "sibling keys untouched");
});

test("existing ops (inc/dec/add/append/set) keep working unchanged", () => {
  const h = rtSandbox({ seeds: { n: 0, tags: [], name: "" } });
  h.click("inc", "n");
  h.click("add", "n", 4);
  h.click("dec", "n");
  assert.equal(h.state.n, 4);
  h.click("append", "tags", "z");
  eq(h.state.tags, ["z"]);
  h.click("set", "name", "Ada");
  assert.equal(h.state.name, "Ada");
});

test("a ;-separated action sequence applies in order then renders once", () => {
  const h = rtSandbox({ seeds: { cart: [], count: 0 } });
  h.clickSeq([
    { op: "append", target: "cart", value: "item" },
    { op: "inc", target: "count" }
  ]);
  eq(h.state.cart, ["item"]);
  assert.equal(h.state.count, 1);
});

// ---------------------------------------------------------------------------
// :store — runtime hydration, persistence, cross-tab sync, reset-to-seed
// ---------------------------------------------------------------------------

test("store hydrates from its seed and writes wd:store:<name> when absent", () => {
  const h = rtSandbox({ stores: { cart: [] } });
  eq(h.state.cart, []);
  assert.equal(h.store.get("wd:store:cart"), "[]", "seeds localStorage on first load");
});

test("store hydrates from an existing wd:store:<name> over the seed", () => {
  const h = rtSandbox({ stores: { cart: [] }, persisted: { "wd:store:cart": ["x"] } });
  eq(h.state.cart, ["x"], "stored value wins over the declared seed");
});

test("mutating a store writes back to wd:store:<name>", () => {
  const h = rtSandbox({ stores: { cart: [] } });
  h.click("append", "cart", "sticker");
  eq(h.state.cart, ["sticker"]);
  eq(JSON.parse(h.store.get("wd:store:cart")), ["sticker"], "persisted after mutation");
});

test("ephemeral store is in-memory only — never touches localStorage", () => {
  const h = rtSandbox({ ephemeral: { draft: "hi" } });
  assert.equal(h.state.draft, "hi");
  assert.equal(h.store.has("wd:store:draft"), false, "no seed written");
  h.click("set", "draft", "edited");
  assert.equal(h.store.has("wd:store:draft"), false, "no write-back");
});

test("reset returns a persisted store to its DECLARED seed, not its stored value", () => {
  const h = rtSandbox({ stores: { cart: [] }, persisted: { "wd:store:cart": ["old"] } });
  eq(h.state.cart, ["old"]);
  h.click("reset", "cart");
  eq(h.state.cart, [], "reset restores the declared seed");
});

test("a storage event from another tab updates the store and re-renders", () => {
  const h = rtSandbox({ stores: { cart: [] } });
  h.fireStorage("wd:store:cart", JSON.stringify(["fromTabA"]));
  eq(h.state.cart, ["fromTabA"], "cross-tab value applied");
});

test("a storage event for an unknown / ephemeral key is ignored", () => {
  const h = rtSandbox({ ephemeral: { draft: "" }, stores: { cart: [] } });
  h.fireStorage("wd:store:draft", JSON.stringify("leak"));
  assert.equal(h.state.draft, "", "ephemeral store not synced cross-tab");
  h.fireStorage("wd:other", JSON.stringify(1));
  // Unrelated keys do not throw and do not write state.
  assert.equal(h.state["wd:other"], undefined);
});

test("a storage event whose value equals current state is a no-op (echo guard)", () => {
  const h = rtSandbox({ stores: { cart: [] } });
  h.click("append", "cart", "a");
  // Re-broadcasting the identical value must not throw or change anything.
  h.fireStorage("wd:store:cart", JSON.stringify(["a"]));
  eq(h.state.cart, ["a"]);
});

// ---------------------------------------------------------------------------
// :fetch lifecycle — generation guard (stale-write race), URL encoding,
// retry budget, empty detection, and the malformed cross-tab parse guard.
// Driven against the REAL startFetch via the controllable fetch/timer stubs.
// ---------------------------------------------------------------------------

test("a slow older fetch never overwrites a newer one (generation guard)", async () => {
  // One marker → fetches on load (gen 1). A refetch supersedes it (gen 2).
  const h = rtSandbox({ fetches: [{ key: "data", url: "/api" }] });
  assert.equal(h.fetchCalls.length, 1, "initial load fired one request");
  h.click("refetch", "data"); // bumps the node's generation, fires a 2nd request
  assert.equal(h.fetchCalls.length, 2, "refetch fired a second request");
  // Settle the NEWER request first, then the OLDER one LAST.
  await h.resolveFetch(1, { v: "new" });
  await h.resolveFetch(0, { v: "old" });
  eq(h.state.data, { v: "new" }, "stale older response was discarded");
});

test("a malformed cross-tab storage value does not throw and leaves state unchanged", () => {
  const h = rtSandbox({ stores: { cart: ["keep"] } });
  // Corrupt/foreign value for a known store key — must be swallowed, not thrown.
  assert.doesNotThrow(() => h.fireStorage("wd:store:cart", "{not json"));
  eq(h.state.cart, ["keep"], "state unchanged after a bad parse");
});

test("a dynamic URL dependency is percent-encoded into the request URL", async () => {
  const h = rtSandbox({
    seeds: { q: "a/b&c" },
    fetches: [{ key: "search", url: "/api?term={q}", deps: "q" }]
  });
  await h.flush();
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0].url, "/api?term=a%2Fb%26c", "slash and ampersand encoded");
});

test("retry=2 performs exactly three attempts before setting name_error", async () => {
  const h = rtSandbox({ fetches: [{ key: "data", url: "/api", retry: 2 }] });
  assert.equal(h.fetchCalls.length, 1, "attempt 1 on load");
  await h.failFetch(0, "boom");
  await h.runTimers();
  assert.equal(h.fetchCalls.length, 2, "attempt 2 after first retry");
  await h.failFetch(1, "boom");
  await h.runTimers();
  assert.equal(h.fetchCalls.length, 3, "attempt 3 after second retry");
  await h.failFetch(2, "boom");
  await h.runTimers();
  assert.equal(h.fetchCalls.length, 3, "no fourth attempt — retry budget exhausted");
  assert.ok(h.state.data_error, "name_error set after the final failure");
  assert.equal(h.state.data_loading, false, "loading cleared on terminal error");
});

test("an empty-object response sets name_empty = true", async () => {
  const h = rtSandbox({ fetches: [{ key: "data", url: "/api" }] });
  await h.resolveFetch(0, {});
  eq(h.state.data, {}, "value stored");
  assert.equal(h.state.data_empty, true, "isEmpty({}) drives the empty flag");
  assert.equal(h.state.data_loading, false);
  assert.equal(h.state.data_error, null);
});
