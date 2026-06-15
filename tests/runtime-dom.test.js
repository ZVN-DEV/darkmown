import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// ---------------------------------------------------------------------------
// First browser-side tests for src/runtime.js.
//
// Why this approach: the runtime is a single top-level script (no exports) that
// runs `document.querySelectorAll(...)` the moment it loads and exposes its
// surface on `window.wd`. We do NOT add jsdom (the project keeps zero
// devDependencies). Instead we hand-roll the minimal DOM subset the runtime
// actually touches and load the *real* runtime.js source through node:vm. That
// exercises the genuine reconciler / getPath / scheduling code — not a copy —
// so behavior and gzipped size are unchanged.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = fs.readFileSync(path.join(here, "..", "src", "runtime.js"), "utf8");

// --- Minimal DOM stub ------------------------------------------------------

class ClassList {
  constructor() { this._set = new Set(); }
  add(c) { this._set.add(c); }
  remove(c) { this._set.delete(c); }
  contains(c) { return this._set.has(c); }
}

class El {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parent = null;
    this._text = "";
    this.classList = new ClassList();
    // <template> content is a fragment whose firstElementChild is the row proto.
    if (this.tagName === "TEMPLATE") this.content = new Fragment();
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
    const copy = new El(this.tagName);
    for (const [k, v] of this.attrs) copy.attrs.set(k, v);
    copy._text = this._text;
    for (const child of this.children) copy.appendChild(child.cloneNode(true));
    return copy;
  }
  get firstElementChild() { return this.children[0] || null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v == null ? "" : String(v); this.children = []; }
  // innerHTML is only ever assigned "" or template.innerHTML in render(); the
  // loop reconcile path under test never relies on HTML parsing, so empty-string
  // clears children and that is all the runtime needs here.
  get innerHTML() { return ""; }
  set innerHTML(v) { if (!v) this.children = []; }

  matches(selector) { return matchSelector(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    walk(this, (node) => { if (node !== this && matchSelector(node, selector)) out.push(node); });
    return out;
  }
}

class Fragment extends El {
  constructor() { super("#fragment"); }
}

function walk(node, fn) {
  for (const child of node.children) {
    fn(child);
    // Mirror real DOM: querySelectorAll does NOT descend into <template> content.
    if (child.tagName !== "TEMPLATE") walk(child, fn);
  }
}

// Supports the selector shapes runtime.js uses: "[attr]", "[attr=val]",
// "tag[attr]", "tag[attr=val]". One simple compound, good enough for the runtime.
function matchSelector(node, selector) {
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

// --- Sandbox harness -------------------------------------------------------

function makeSandbox(rootBuilder, { withRAF = false } = {}) {
  const root = new El("body");
  rootBuilder(root, El);

  const listeners = {};
  const document = {
    activeElement: null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }
  };

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };

  let renderCount = 0;
  const sandbox = {
    document,
    localStorage,
    console,
    JSON,
    structuredClone,
    Object,
    Array,
    Number,
    String,
    Map,
    Set,
    Boolean,
    Function,
    queueMicrotask
  };
  if (withRAF) {
    sandbox.requestAnimationFrame = (fn) => { sandbox.__rafQueue.push(fn); return sandbox.__rafQueue.length; };
    sandbox.__rafQueue = [];
  }
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  // Instrument renderNow by wrapping the source: count flushes without changing logic.
  const instrumented = runtimeSource.replace(
    "function renderNow() {",
    "function renderNow() { window.__renderCount = (window.__renderCount || 0) + 1;"
  );
  vm.runInContext(instrumented, sandbox);

  return {
    root,
    sandbox,
    fire(type, target) {
      for (const fn of listeners[type] || []) fn({ target, preventDefault() {} });
    },
    get renderCount() { return sandbox.__renderCount || 0; },
    flushRAF() {
      const q = sandbox.__rafQueue || [];
      sandbox.__rafQueue = [];
      for (const fn of q) fn();
    }
  };
}

// Build a reactive @loop region matching what the compiler emits.
function loopRegion(root, El, { key = "items", initial } = {}) {
  if (initial !== undefined) {
    const stateScript = new El("script");
    stateScript.setAttribute("data-wd-state", "");
    stateScript.textContent = JSON.stringify({ [key]: initial });
    root.appendChild(stateScript);
  }

  const region = new El("div");
  region.setAttribute("data-wd-loop", key);

  const template = new El("template");
  template.setAttribute("data-wd-loop-template", "");
  const proto = new El("li");
  proto.setAttribute("data-wd-each", "");
  proto.setAttribute("data-wd-path", "name");
  template.content.appendChild(proto);
  region.appendChild(template);

  const out = new El("ul");
  out.setAttribute("data-wd-loop-out", "");
  region.appendChild(out);

  root.appendChild(region);
  return { region, out };
}

// ---------------------------------------------------------------------------
// TASK-2A.1 — keyed loop reconcile
// ---------------------------------------------------------------------------

test("reconcile reuses keyed nodes when adding an item", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, { initial: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }] }));
  });
  assert.equal(out.children.length, 2);
  const nodeA = out.children[0];
  const nodeB = out.children[1];

  h.sandbox.wd.state.items = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }];
  h.sandbox.wd.render();

  assert.equal(out.children.length, 3);
  assert.strictEqual(out.children[0], nodeA, "node a reused, not rebuilt");
  assert.strictEqual(out.children[1], nodeB, "node b reused, not rebuilt");
  assert.equal(out.children[2].getAttribute("data-wd-loop-key"), "c");
  assert.equal(out.children[2].textContent, "Gamma");
});

test("reconcile removes the orphan node when an item is deleted", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, { initial: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }] }));
  });
  const nodeA = out.children[0];
  const nodeC = out.children[2];

  h.sandbox.wd.state.items = [{ id: "a", name: "Alpha" }, { id: "c", name: "Gamma" }];
  h.sandbox.wd.render();

  assert.equal(out.children.length, 2);
  assert.strictEqual(out.children[0], nodeA, "surviving node reused");
  assert.strictEqual(out.children[1], nodeC, "surviving node reused");
  assert.ok(!out.children.some((c) => c.getAttribute("data-wd-loop-key") === "b"), "orphan b removed");
});

test("reconcile reuses the same nodes when items are reordered", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, { initial: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }] }));
  });
  const before = { a: out.children[0], b: out.children[1], c: out.children[2] };

  h.sandbox.wd.state.items = [{ id: "c", name: "Gamma" }, { id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];
  h.sandbox.wd.render();

  assert.equal(out.children.length, 3);
  assert.deepEqual(out.children.map((n) => n.getAttribute("data-wd-loop-key")), ["c", "a", "b"]);
  assert.strictEqual(out.children[0], before.c, "node c reused in new position");
  assert.strictEqual(out.children[1], before.a, "node a reused in new position");
  assert.strictEqual(out.children[2], before.b, "node b reused in new position");
});

// ---------------------------------------------------------------------------
// TASK-2A.2 — getPath security
// ---------------------------------------------------------------------------

test("getPath rejects __proto__ / constructor / prototype and does not pollute Object.prototype", () => {
  const h = makeSandbox((root, El) => {
    loopRegion(root, El, { initial: [{ id: "x", name: "X" }] });
  });

  // wd.get reads through state[key]; nest a payload and resolve via the loop's
  // getPath-driven binds. Easiest direct probe: write state then read a poisoned path.
  h.sandbox.wd.set("evil", { __proto__: { polluted: "yes" }, constructor: { polluted: "yes" }, safe: { deep: "ok" } });

  // Drive getPath through a freshly added bind node reading a dangerous path.
  const root = h.root;
  const probe = new El("span");
  probe.setAttribute("data-wd-bind", "evil");
  probe.setAttribute("data-wd-path", "__proto__.polluted");
  root.appendChild(probe);

  const probe2 = new El("span");
  probe2.setAttribute("data-wd-bind", "evil");
  probe2.setAttribute("data-wd-path", "constructor.polluted");
  root.appendChild(probe2);

  const probe3 = new El("span");
  probe3.setAttribute("data-wd-bind", "evil");
  probe3.setAttribute("data-wd-path", "safe.deep");
  root.appendChild(probe3);

  h.sandbox.wd.render();

  assert.equal(probe.textContent, "", "__proto__ segment yields undefined -> empty text");
  assert.equal(probe2.textContent, "", "constructor segment yields undefined -> empty text");
  assert.equal(probe3.textContent, "ok", "safe path still resolves");

  // Prototype is not polluted in the sandbox realm.
  assert.equal(({}).polluted, undefined);
  // And not in this realm either.
  assert.equal(Object.prototype.polluted, undefined);
});

// ---------------------------------------------------------------------------
// TASK-2A.3 — loopKeyOf collision counter (probed via the reconciler)
// ---------------------------------------------------------------------------

test("colliding loop keys get distinct effective keys via the collision counter", () => {
  let out;
  const h = makeSandbox((root, El) => {
    // Two items with the SAME id collide on their base key.
    ({ out } = loopRegion(root, El, { initial: [{ id: "dup", name: "First" }, { id: "dup", name: "Second" }] }));
  });

  assert.equal(out.children.length, 2, "both colliding rows render as separate nodes");
  const keys = out.children.map((n) => n.getAttribute("data-wd-loop-key"));
  assert.equal(keys[0], "dup");
  assert.equal(keys[1], "dup#1", "second collision gets a #1 suffix");
  assert.notEqual(keys[0], keys[1], "effective keys are distinct");
  assert.deepEqual(out.children.map((n) => n.textContent), ["First", "Second"]);
});

// ---------------------------------------------------------------------------
// TASK-2B — render coalescing
// ---------------------------------------------------------------------------

test("N rapid mutations coalesce into exactly one batched render", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, { initial: [{ id: "a", name: "A" }] }));
  }, { withRAF: true });

  const base = h.renderCount; // initial synchronous renderNow on load

  // Five synchronous mutations via the batched setter.
  for (let i = 0; i < 5; i++) {
    h.sandbox.wd.set("items", [{ id: "a", name: `A${i}` }]);
  }
  assert.equal(h.renderCount, base, "no render flushed yet — all batched onto the frame");

  h.flushRAF();
  assert.equal(h.renderCount, base + 1, "exactly one render flushed for five mutations");
  // Final state wins.
  assert.equal(out.children[0].textContent, "A4", "the last update is the one rendered");
});

test("batched scheduler falls back to queueMicrotask when requestAnimationFrame is absent", async () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, { initial: [{ id: "a", name: "A" }] }));
  }); // no RAF in sandbox

  const base = h.renderCount;
  h.sandbox.wd.set("items", [{ id: "a", name: "Z" }]);
  h.sandbox.wd.set("items", [{ id: "a", name: "Final" }]);

  // Microtask not yet drained.
  assert.equal(h.renderCount, base, "render deferred to a microtask");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.renderCount, base + 1, "exactly one microtask-batched render");
  assert.equal(out.children[0].textContent, "Final");
});

// ---------------------------------------------------------------------------
// TASK-2C — dev-only warnings stay silent in production
// ---------------------------------------------------------------------------

function computedRegion(root, El, { key, expr, initial }) {
  const stateScript = new El("script");
  stateScript.setAttribute("data-wd-state", "");
  stateScript.textContent = JSON.stringify(initial || {});
  root.appendChild(stateScript);

  const node = new El("div");
  node.setAttribute("data-wd-computed", "");
  node.setAttribute("data-wd-computed-key", key);
  node.setAttribute("data-wd-computed-expr", expr);
  root.appendChild(node);
  return node;
}

test("failing computed expressions stay SILENT in production (no wd.debug)", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const h = makeSandbox((root, El) => {
      // Expression throws: reads a method off undefined.
      computedRegion(root, El, { key: "total", expr: "S('missing').nope.boom()", initial: {} });
    });
    // production: no debug flag set -> no console noise, safe fallback applies.
    assert.equal(warnings.length, 0, "no warnings emitted in production mode");
    assert.equal(h.sandbox.wd.get("total"), undefined, "safe undefined fallback preserved");
  } finally {
    console.warn = originalWarn;
  }
});

test("failing computed expressions warn (with expression text) when wd.debug is on", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const h = makeSandbox((root, El) => {
      computedRegion(root, El, { key: "total", expr: "S('missing').nope.boom()", initial: {} });
    });
    warnings.length = 0; // ignore the load-time render
    h.sandbox.wd.debug = true;
    h.sandbox.wd.render();
    assert.ok(warnings.length >= 1, "a warning was emitted when debug is on");
    assert.ok(
      warnings.some((w) => String(w[0]).includes("S('missing').nope.boom()")),
      "warning includes the offending expression text"
    );
    assert.equal(h.sandbox.wd.get("total"), undefined, "safe fallback still applies under debug");
  } finally {
    console.warn = originalWarn;
  }
});

test("wd.render is a synchronous flush for manual / external callers", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, { initial: [{ id: "a", name: "A" }] }));
  }, { withRAF: true });

  const base = h.renderCount;
  h.sandbox.wd.state.items = [{ id: "a", name: "Sync" }];
  h.sandbox.wd.render();
  assert.equal(h.renderCount, base + 1, "wd.render flushes immediately, not via RAF");
  assert.equal(out.children[0].textContent, "Sync");
});
