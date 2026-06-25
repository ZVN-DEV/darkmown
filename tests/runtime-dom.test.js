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
  toggle(c, on) { on ? this.add(c) : this.remove(c); return on; }
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
  removeAttribute(name) { this.attrs.delete(name); }
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

  matches(selector) {
    // Support the comma-separated multi-selector the click handler uses
    // ("[data-wd-action],[data-wd-actions]"): match if ANY clause matches.
    return selector.split(",").some((s) => matchSelector(this, s.trim()));
  }
  // closest walks up the parent chain (including self), like the real DOM, so the
  // runtime's event handlers (input/submit/click) can resolve their owning node.
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const out = [];
    walk(this, (node) => { if (node !== this && matchSelector(node, selector)) out.push(node); });
    return out;
  }
  // <input>/<textarea>/<select> value, the surface :bind-input reads & writes.
  // Backed by an attribute so cloneNode + setAttribute("value") stay coherent.
  get value() { return this.attrs.has("value") ? this.attrs.get("value") : ""; }
  set value(v) { this.attrs.set("value", v == null ? "" : String(v)); }
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

// --- Form serialization stubs ----------------------------------------------
//
// Minimal FormData/URLSearchParams so the runtime's :form submit handler can run
// against the DOM stub. FormData walks the form's input/select/textarea
// descendants the way a browser collects "successful controls": name/value
// pairs, but a checkbox/radio contributes only when it carries a `checked`
// attribute. getAll(name) returns every value for a repeated name (the
// :checkbox-group array path). It is iterable so Object.fromEntries works.

function collectFormControls(form) {
  const pairs = [];
  for (const el of form.querySelectorAll("[name]")) {
    const tag = el.tagName;
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") continue;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !el.hasAttribute("checked")) continue;
    pairs.push([el.getAttribute("name"), el.value]);
  }
  return pairs;
}

class FormDataStub {
  constructor(form) { this._pairs = form ? collectFormControls(form) : []; }
  getAll(name) { return this._pairs.filter(([k]) => k === name).map(([, v]) => v); }
  get(name) { const hit = this._pairs.find(([k]) => k === name); return hit ? hit[1] : null; }
  append(name, value) { this._pairs.push([name, String(value)]); }
  *[Symbol.iterator]() { yield* this._pairs; }
  entries() { return this._pairs[Symbol.iterator](); }
}

class URLSearchParamsStub {
  // The runtime builds this from a FormData, then calls .toString().
  constructor(init) {
    this._pairs = [];
    if (init && typeof init[Symbol.iterator] === "function") {
      for (const [k, v] of init) this._pairs.push([k, v]);
    }
  }
  toString() {
    return this._pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }
}

// --- Sandbox harness -------------------------------------------------------

function makeSandbox(rootBuilder, { withRAF = false, globals = {}, initialStore = {} } = {}) {
  const root = new El("body");
  rootBuilder(root, El);

  const listeners = {};
  const document = {
    activeElement: null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }
  };

  // localStorage backing store; pre-seeded so a :persist/:store override can be
  // present BEFORE the runtime reads it on load.
  const store = new Map(Object.entries(initialStore));
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
    queueMicrotask,
    // Form serialization the :form submit handler relies on.
    FormData: FormDataStub,
    URLSearchParams: URLSearchParamsStub
  };
  if (withRAF) {
    sandbox.requestAnimationFrame = (fn) => { sandbox.__rafQueue.push(fn); return sandbox.__rafQueue.length; };
    sandbox.__rafQueue = [];
  }
  // The runtime registers a `window.addEventListener("storage", …)` for cross-tab
  // :store sync; the sandbox window is the sandbox itself, so expose the same
  // listener registry there. `fire(type, target)` drives both document + window.
  sandbox.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
  sandbox.window = sandbox;
  // Extra globals (fetch stub, timers, Promise) for the async :fetch tests.
  Object.assign(sandbox, globals);

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
    document,
    store, // localStorage backing Map, for :persist / :store assertions
    // Dispatch an event of `type` at `target`. Returns whether a handler called
    // preventDefault() (the :form submit handler must, to suppress navigation).
    fire(type, target) {
      let defaultPrevented = false;
      for (const fn of listeners[type] || []) fn({ target, preventDefault() { defaultPrevented = true; } });
      return defaultPrevented;
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

// ---------------------------------------------------------------------------
// TASK-2 (loops) — runtime pipeline: sort / reverse / offset / limit
// ---------------------------------------------------------------------------

// Build a loop region with clause attributes. The row proto binds a path (or the
// whole item when path is null) so we can assert the rendered values + order.
function clauseLoop(root, El, { key = "items", initial, path = "v", attrs = {}, empty = null } = {}) {
  if (initial !== undefined) {
    const script = new El("script");
    script.setAttribute("data-wd-state", "");
    script.textContent = JSON.stringify({ [key]: initial });
    root.appendChild(script);
  }
  const region = new El("div");
  region.setAttribute("data-wd-loop", key);
  for (const [k, v] of Object.entries(attrs)) region.setAttribute(k, String(v));

  const template = new El("template");
  template.setAttribute("data-wd-loop-template", "");
  const proto = new El("li");
  proto.setAttribute("data-wd-each", "");
  if (path) proto.setAttribute("data-wd-path", path);
  template.content.appendChild(proto);
  region.appendChild(template);

  if (empty !== null) {
    const emptyTpl = new El("template");
    emptyTpl.setAttribute("data-wd-loop-empty", "");
    const node = new El("p");
    node.textContent = empty;
    emptyTpl.content.appendChild(node);
    region.appendChild(emptyTpl);
  }

  const out = new El("ul");
  out.setAttribute("data-wd-loop-out", "");
  region.appendChild(out);

  root.appendChild(region);
  return { region, out };
}

test("runtime sorts rows ascending by a path key", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = clauseLoop(root, El, {
      initial: [{ id: 1, v: 3 }, { id: 2, v: 1 }, { id: 3, v: 2 }],
      attrs: { "data-wd-loop-sort": "v", "data-wd-loop-sort-dir": "asc" }
    }));
  });
  assert.deepEqual(out.children.map((n) => n.textContent), ["1", "2", "3"]);
});

test("runtime sorts rows descending and uses localeCompare for strings", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = clauseLoop(root, El, {
      initial: [{ id: 1, v: "banana" }, { id: 2, v: "apple" }, { id: 3, v: "cherry" }],
      attrs: { "data-wd-loop-sort": "v", "data-wd-loop-sort-dir": "desc" }
    }));
  });
  assert.deepEqual(out.children.map((n) => n.textContent), ["cherry", "banana", "apple"]);
});

test("runtime applies reverse, then offset, then limit (pipeline order)", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = clauseLoop(root, El, {
      initial: [{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 3, v: "c" }, { id: 4, v: "d" }],
      attrs: { "data-wd-loop-reverse": "", "data-wd-loop-offset": "1", "data-wd-loop-limit": "2" }
    }));
  });
  // reverse → d c b a ; offset 1 → c b a ; limit 2 → c b
  assert.deepEqual(out.children.map((n) => n.textContent), ["c", "b"]);
});

test("runtime reads a state-key limit for reactive paging", () => {
  let out;
  const h = makeSandbox((root, El) => {
    const script = new El("script");
    script.setAttribute("data-wd-state", "");
    script.textContent = JSON.stringify({ pageSize: 2 });
    root.appendChild(script);
    ({ out } = clauseLoop(root, El, {
      initial: [{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 3, v: "c" }],
      attrs: { "data-wd-loop-limit": "key:pageSize" }
    }));
  });
  assert.equal(out.children.length, 2, "limit pageSize=2 shows two rows");

  h.sandbox.wd.state.pageSize = 3;
  h.sandbox.wd.render();
  assert.equal(out.children.length, 3, "bumping pageSize re-slices reactively");
});

test("runtime resolves a dotted loop source via getPath", () => {
  let out;
  const h = makeSandbox((root, El) => {
    const script = new El("script");
    script.setAttribute("data-wd-state", "");
    script.textContent = JSON.stringify({ team: { members: [{ id: 1, v: "Ann" }, { id: 2, v: "Bo" }] } });
    root.appendChild(script);
    ({ out } = clauseLoop(root, El, { key: "team.members" }));
  });
  assert.deepEqual(out.children.map((n) => n.textContent), ["Ann", "Bo"]);
});

// ---------------------------------------------------------------------------
// TASK-2 (loops) — per-row meta vars + @empty
// ---------------------------------------------------------------------------

test("runtime fills per-row meta markers ($index/$number/$first/$last/$count)", () => {
  let out;
  const h = makeSandbox((root, El) => {
    const region = new El("div");
    region.setAttribute("data-wd-loop", "items");
    const template = new El("template");
    template.setAttribute("data-wd-loop-template", "");
    const proto = new El("li");
    // a row that carries several meta markers
    const idx = new El("span"); idx.setAttribute("data-wd-each-meta", "index");
    const num = new El("span"); num.setAttribute("data-wd-each-meta", "number");
    const cnt = new El("span"); cnt.setAttribute("data-wd-each-meta", "count");
    proto.appendChild(idx); proto.appendChild(num); proto.appendChild(cnt);
    template.content.appendChild(proto);
    region.appendChild(template);
    const outEl = new El("ul");
    outEl.setAttribute("data-wd-loop-out", "");
    region.appendChild(outEl);
    const script = new El("script");
    script.setAttribute("data-wd-state", "");
    script.textContent = JSON.stringify({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    root.appendChild(script);
    root.appendChild(region);
    out = outEl;
  });
  const metas = (row) => row.querySelectorAll("[data-wd-each-meta]").map((s) => [s.getAttribute("data-wd-each-meta"), s.textContent]);
  assert.deepEqual(metas(out.children[0]), [["index", "0"], ["number", "1"], ["count", "3"]]);
  assert.deepEqual(metas(out.children[2]), [["index", "2"], ["number", "3"], ["count", "3"]]);
});

test("runtime renders the @empty template when the post-pipeline list is empty", () => {
  let out, region;
  const h = makeSandbox((root, El) => {
    ({ out, region } = clauseLoop(root, El, { initial: [], empty: "Nothing here." }));
  });
  // No rows + an empty template → the out container shows the empty content.
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].textContent, "Nothing here.");

  // Add a row → empty branch is replaced by rendered rows.
  h.sandbox.wd.state.items = [{ id: 1, v: "x" }];
  h.sandbox.wd.render();
  assert.deepEqual(out.children.map((n) => n.textContent), ["x"]);

  // Remove all rows again → empty branch returns.
  h.sandbox.wd.state.items = [];
  h.sandbox.wd.render();
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].textContent, "Nothing here.");
});

// ---------------------------------------------------------------------------
// :fetch refresh= — 401 token-refresh lifecycle (Component B)
// ---------------------------------------------------------------------------

// Programmable fetch stub: routes map a URL to a single response or a queue of
// responses (successive calls advance, last one repeats). Each call is recorded.
function makeFetchStub(routes) {
  const calls = [];
  const fetch = (url, init) => {
    calls.push({ url, init, headers: init && init.headers });
    const r = routes[url];
    const resp = Array.isArray(r) ? (r.length > 1 ? r.shift() : r[0]) : r;
    const status = resp.status;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(resp.body ?? null))
    });
  };
  return { fetch, calls, count: (url) => calls.filter((c) => c.url === url).length };
}

// Drain microtasks across a few macrotask ticks so the whole async fetch chain
// (request → 401 → refresh POST → write-back → retry → settle) completes.
async function settle(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function fetchRegion(root, El, { key, url, headers, refresh, session }) {
  if (session !== undefined) {
    const s = new El("script");
    s.setAttribute("data-wd-state", "");
    s.textContent = JSON.stringify({ [headers]: session });
    root.appendChild(s);
  }
  const span = new El("span");
  span.setAttribute("data-wd-fetch", "");
  span.setAttribute("data-wd-fetch-key", key);
  span.setAttribute("data-wd-fetch-url", url);
  if (headers) span.setAttribute("data-wd-fetch-headers", headers);
  if (refresh) span.setAttribute("data-wd-fetch-refresh", refresh);
  root.appendChild(span);
  return span;
}

test(":fetch renews the token on a 401, writes it back, and retries once", async () => {
  const stub = makeFetchStub({
    "/api/feed": [{ status: 401 }, { status: 200, body: [{ id: 1 }] }],
    "/auth/refresh": { status: 200, body: { Authorization: "Bearer new" } }
  });
  const h = makeSandbox(
    (root, El) => fetchRegion(root, El, { key: "feed", url: "/api/feed", headers: "session", refresh: "/auth/refresh", session: { Authorization: "Bearer old" } }),
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );

  await settle();

  assert.equal(stub.count("/api/feed"), 2, "original request retried once");
  assert.equal(stub.count("/auth/refresh"), 1, "token refreshed once");
  assert.deepEqual(h.sandbox.wd.state.session, { Authorization: "Bearer new" }, "renewed token written back to state");
  const feedCalls = stub.calls.filter((c) => c.url === "/api/feed");
  assert.deepEqual(feedCalls[0].headers, { Authorization: "Bearer old" });
  assert.deepEqual(feedCalls[1].headers, { Authorization: "Bearer new" }, "retry carried the renewed header");
  assert.deepEqual(h.sandbox.wd.state.feed, [{ id: 1 }]);
  assert.equal(h.sandbox.wd.state.feed_error, null);
});

test(":fetch falls through to *_error when the token refresh fails", async () => {
  const stub = makeFetchStub({
    "/api/feed": { status: 401 },
    "/auth/refresh": { status: 500, body: { error: "nope" } }
  });
  const h = makeSandbox(
    (root, El) => fetchRegion(root, El, { key: "feed", url: "/api/feed", headers: "session", refresh: "/auth/refresh", session: { Authorization: "Bearer old" } }),
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );

  await settle();

  assert.equal(stub.count("/auth/refresh"), 1, "one refresh attempt");
  assert.match(String(h.sandbox.wd.state.feed_error), /HTTP 401/, "surfaces the original 401");
  assert.equal(h.sandbox.wd.state.feed ?? null, null);
});

test("concurrent 401s share a single token refresh, then each retries", async () => {
  const stub = makeFetchStub({
    "/api/a": [{ status: 401 }, { status: 200, body: { who: "a" } }],
    "/api/b": [{ status: 401 }, { status: 200, body: { who: "b" } }],
    "/auth/refresh": { status: 200, body: { Authorization: "Bearer new" } }
  });
  const h = makeSandbox(
    (root, El) => {
      fetchRegion(root, El, { key: "a", url: "/api/a", headers: "session", refresh: "/auth/refresh", session: { Authorization: "Bearer old" } });
      fetchRegion(root, El, { key: "b", url: "/api/b", headers: "session", refresh: "/auth/refresh" });
    },
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );

  await settle();

  assert.equal(stub.count("/auth/refresh"), 1, "single-flight: one shared refresh for both 401s");
  assert.deepEqual(h.sandbox.wd.state.a, { who: "a" });
  assert.deepEqual(h.sandbox.wd.state.b, { who: "b" });
});

// ---------------------------------------------------------------------------
// Reactive styling — .class when <predicate> (Component C)
// ---------------------------------------------------------------------------

test("data-wd-class toggles a global state-driven class on render", () => {
  let el;
  const h = makeSandbox((root, El) => {
    const s = new El("script");
    s.setAttribute("data-wd-state", "");
    s.textContent = JSON.stringify({ hot: false });
    root.appendChild(s);
    el = new El("div");
    el.setAttribute("data-wd-class", JSON.stringify([["sale", '(S("hot"))']]));
    root.appendChild(el);
  });

  assert.equal(el.classList.contains("sale"), false, "off when state is falsy");
  h.sandbox.wd.state.hot = true;
  h.sandbox.wd.render();
  assert.equal(el.classList.contains("sale"), true, "on when state flips truthy");
  h.sandbox.wd.state.hot = false;
  h.sandbox.wd.render();
  assert.equal(el.classList.contains("sale"), false, "off again");
});

test("loop-row data-wd-each-class reacts to item fields", () => {
  let out;
  const h = makeSandbox((root, El) => {
    const s = new El("script");
    s.setAttribute("data-wd-state", "");
    s.textContent = JSON.stringify({ products: [{ id: 1, name: "A", onSale: true }, { id: 2, name: "B", onSale: false }] });
    root.appendChild(s);
    const region = new El("div");
    region.setAttribute("data-wd-loop", "products");
    const template = new El("template");
    template.setAttribute("data-wd-loop-template", "");
    const proto = new El("div");
    proto.setAttribute("data-wd-each-class", JSON.stringify([["sale", 'I("onSale")']]));
    const span = new El("span");
    span.setAttribute("data-wd-each", "");
    span.setAttribute("data-wd-path", "name");
    proto.appendChild(span);
    template.content.appendChild(proto);
    region.appendChild(template);
    out = new El("ul");
    out.setAttribute("data-wd-loop-out", "");
    region.appendChild(out);
    root.appendChild(region);
  });

  assert.equal(out.children[0].classList.contains("sale"), true, "row 0 onSale → class on");
  assert.equal(out.children[1].classList.contains("sale"), false, "row 1 not onSale → class off");

  // Flip item 2 onSale; the reused row's class reacts.
  h.sandbox.wd.state.products = [{ id: 1, name: "A", onSale: true }, { id: 2, name: "B", onSale: true }];
  h.sandbox.wd.render();
  assert.equal(out.children[1].classList.contains("sale"), true, "row 1 now onSale → class on");
});

// ---------------------------------------------------------------------------
// Effects — :effect <state> -> <actions> (Component D)
// ---------------------------------------------------------------------------

function effectSandbox(rootBuilder, warns) {
  return makeSandbox(rootBuilder, {
    globals: { console: { warn: (...a) => warns.push(a.join(" ")), log() {}, error() {} } }
  });
}

test(":effect runs its action only when the watched state changes", () => {
  const warns = [];
  const h = effectSandbox((root, El) => {
    const s = new El("script");
    s.setAttribute("data-wd-state", "");
    s.textContent = JSON.stringify({ q: "", hits: 0 });
    root.appendChild(s);
    const fx = new El("script");
    fx.setAttribute("data-wd-effect", "");
    fx.textContent = JSON.stringify({ watch: "q", actions: [{ op: "inc", target: "hits" }] });
    root.appendChild(fx);
  }, warns);

  assert.equal(h.sandbox.wd.state.hits, 0, "no fire on initial load");
  h.sandbox.wd.state.q = "a";
  h.sandbox.wd.render();
  assert.equal(h.sandbox.wd.state.hits, 1, "watched change fires the effect");
  h.sandbox.wd.render();
  assert.equal(h.sandbox.wd.state.hits, 1, "no re-fire without a further change");
});

test(":effect cascades settle within the pass cap", () => {
  const warns = [];
  const h = effectSandbox((root, El) => {
    const s = new El("script");
    s.setAttribute("data-wd-state", "");
    s.textContent = JSON.stringify({ q: "", r: 0, s: 0 });
    root.appendChild(s);
    for (const [watch, target] of [["q", "r"], ["r", "s"]]) {
      const fx = new El("script");
      fx.setAttribute("data-wd-effect", "");
      fx.textContent = JSON.stringify({ watch, actions: [{ op: "inc", target }] });
      root.appendChild(fx);
    }
  }, warns);

  h.sandbox.wd.state.q = "x";
  h.sandbox.wd.render();
  assert.equal(h.sandbox.wd.state.r, 1, "q→r effect fired");
  assert.equal(h.sandbox.wd.state.s, 1, "r→s effect cascaded and settled");
  assert.equal(warns.length, 0, "no settle warning for a terminating cascade");
});

test(":effect that never settles stops at the cap and warns", () => {
  const warns = [];
  const h = effectSandbox((root, El) => {
    const s = new El("script");
    s.setAttribute("data-wd-state", "");
    s.textContent = JSON.stringify({ n: 0 });
    root.appendChild(s);
    const fx = new El("script");
    fx.setAttribute("data-wd-effect", "");
    fx.textContent = JSON.stringify({ watch: "n", actions: [{ op: "inc", target: "n" }] });
    root.appendChild(fx);
  }, warns);

  h.sandbox.wd.state.n = 1;
  h.sandbox.wd.render();
  assert.ok(warns.some((w) => /did not settle/.test(w)), "warns when an effect never settles");
  assert.ok(h.sandbox.wd.state.n <= 11, "the settle cap bounds the runaway effect");
});

// ---------------------------------------------------------------------------
// Expression conditionals — :if a <op> b (richer conditions)
// ---------------------------------------------------------------------------

test("expression :if toggles its active branch as watched state crosses the predicate", () => {
  let node;
  const h = makeSandbox((root, El) => {
    const s = new El("script");
    s.setAttribute("data-wd-state", "");
    s.textContent = JSON.stringify({ n: 3 });
    root.appendChild(s);
    node = new El("div");
    node.setAttribute("data-wd-if", "");
    node.setAttribute("data-wd-if-expr", '(S("n") > 5)');
    node.setAttribute("data-wd-if-active", "false");
    const tTrue = new El("template"); tTrue.setAttribute("data-wd-true", "");
    const tFalse = new El("template"); tFalse.setAttribute("data-wd-false", "");
    const out = new El("div"); out.setAttribute("data-wd-if-out", "");
    node.appendChild(tTrue); node.appendChild(tFalse); node.appendChild(out);
    root.appendChild(node);
  });

  assert.equal(node.getAttribute("data-wd-if-active"), "false", "n=3 → predicate false");
  h.sandbox.wd.state.n = 10;
  h.sandbox.wd.render();
  assert.equal(node.getAttribute("data-wd-if-active"), "true", "n=10 → predicate true");
  h.sandbox.wd.state.n = 1;
  h.sandbox.wd.render();
  assert.equal(node.getAttribute("data-wd-if-active"), "false", "n=1 → predicate false again");
});

test("expression :if supports == and a negated operand", () => {
  let node;
  const h = makeSandbox((root, El) => {
    const s = new El("script");
    s.setAttribute("data-wd-state", "");
    s.textContent = JSON.stringify({ plan: "free", banned: false });
    root.appendChild(s);
    node = new El("div");
    node.setAttribute("data-wd-if", "");
    node.setAttribute("data-wd-if-expr", '(S("plan") == "pro") && (!(S("banned")))');
    node.setAttribute("data-wd-if-active", "false");
    const out = new El("div"); out.setAttribute("data-wd-if-out", "");
    node.appendChild(out);
    root.appendChild(node);
  });

  assert.equal(node.getAttribute("data-wd-if-active"), "false", "plan=free → false");
  h.sandbox.wd.state.plan = "pro";
  h.sandbox.wd.render();
  assert.equal(node.getAttribute("data-wd-if-active"), "true", "plan=pro & not banned → true");
  h.sandbox.wd.state.banned = true;
  h.sandbox.wd.render();
  assert.equal(node.getAttribute("data-wd-if-active"), "false", "banned → false");
});

// ===========================================================================
// TASK-3B — runtime-behavior backfill for shipped-but-runtime-untested features.
// Each section drives the REAL src/runtime.js event handlers via the harness
// `fire(type, target)` dispatcher, asserting one solid behavior per feature.
// ===========================================================================

// ---------------------------------------------------------------------------
// TASK-3B.1 — :bind two-way (runtime.js input handler ~470 + reflect-back ~420)
// ---------------------------------------------------------------------------

function stateScript(root, El, obj, attrs = {}) {
  const s = new El("script");
  s.setAttribute("data-wd-state", "");
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  s.textContent = JSON.stringify(obj);
  root.appendChild(s);
  return s;
}

test(":bind input event updates state.q (input → state)", () => {
  let input;
  const h = makeSandbox((root, El) => {
    stateScript(root, El, { q: "" });
    input = new El("input");
    input.setAttribute("data-wd-bind-input", "q");
    root.appendChild(input);
  });

  input.value = "hello";
  h.fire("input", input);

  assert.equal(h.sandbox.wd.state.q, "hello", "input event wrote the field value into state.q");
});

test(":bind reflects a programmatic state change back into input.value when not focused", () => {
  let input;
  const h = makeSandbox((root, El) => {
    stateScript(root, El, { q: "seed" });
    input = new El("input");
    input.setAttribute("data-wd-bind-input", "q");
    root.appendChild(input);
  });

  // On load the seed should already be reflected.
  assert.equal(input.value, "seed", "initial seed reflected into the input");

  // Not focused (document.activeElement !== input) → state change reflects back.
  h.sandbox.wd.set("q", "fromState");
  h.sandbox.wd.render();
  assert.equal(input.value, "fromState", "unfocused input mirrors the new state value");
});

test(":bind does NOT overwrite a focused input's value on render", () => {
  let input;
  const h = makeSandbox((root, El) => {
    stateScript(root, El, { q: "seed" });
    input = new El("input");
    input.setAttribute("data-wd-bind-input", "q");
    root.appendChild(input);
  });
  // Simulate the user focused & mid-typing: activeElement is the input.
  h.document.activeElement = input;
  input.value = "user-typing";
  h.sandbox.wd.state.q = "fromState";
  h.sandbox.wd.render();
  assert.equal(input.value, "user-typing", "focused input is left untouched by render");
});

// ---------------------------------------------------------------------------
// TASK-3B.2 — :form into name submit capture (runtime.js submit handler ~552)
// ---------------------------------------------------------------------------

// Build a <form data-wd-form="key"> with the given field-building callback.
function formRegion(root, El, { key, action = null, method = null, build }) {
  stateScript(root, El, { [key]: null });
  const form = new El("form");
  form.setAttribute("data-wd-form", key);
  if (action) form.setAttribute("action", action);
  if (method) form.setAttribute("method", method);
  build(form, El);
  root.appendChild(form);
  return form;
}

function textInput(form, El, name, value) {
  const i = new El("input");
  i.setAttribute("type", "text");
  i.setAttribute("name", name);
  i.value = value;
  form.appendChild(i);
  return i;
}

test(":form (no action) submit collects field values into state[name]", () => {
  let form;
  const h = makeSandbox((root, El) => {
    form = formRegion(root, El, {
      key: "profile",
      build: (f, E) => {
        textInput(f, E, "name", "Ada");
        textInput(f, E, "city", "London");
      }
    });
  });

  const prevented = h.fire("submit", form);
  assert.equal(prevented, true, "submit default is prevented (no real navigation)");
  assert.deepEqual(h.sandbox.wd.state.profile, { name: "Ada", city: "London" });
});

test(":form :checkbox group collects every checked value as an ARRAY (getAll)", () => {
  let form;
  const h = makeSandbox((root, El) => {
    form = formRegion(root, El, {
      key: "prefs",
      build: (f, E) => {
        // The compiler wraps a :checkbox group in a div[data-wd-multi="name"]
        // with <input type=checkbox name=topics value=…> controls.
        const group = new E("div");
        group.setAttribute("data-wd-multi", "topics");
        for (const [val, checked] of [["news", true], ["sales", false], ["beta", true]]) {
          const cb = new E("input");
          cb.setAttribute("type", "checkbox");
          cb.setAttribute("name", "topics");
          cb.value = val;
          if (checked) cb.setAttribute("checked", "");
          group.appendChild(cb);
        }
        f.appendChild(group);
      }
    });
  });

  h.fire("submit", form);
  assert.deepEqual(
    h.sandbox.wd.state.prefs.topics,
    ["news", "beta"],
    "only the checked checkboxes are collected, as an array"
  );
});

// ---------------------------------------------------------------------------
// TASK-3B.3 — :form action+into round-trip (runtime.js submit handler ~573)
// ---------------------------------------------------------------------------

test(":form action posts and lands a JSON reply into state[key] on success", async () => {
  const stub = makeFetchStub({ "/api/save": { status: 200, body: { id: 7, ok: true } } });
  let form;
  const h = makeSandbox(
    (root, El) => {
      form = formRegion(root, El, {
        key: "saved",
        action: "/api/save",
        method: "post",
        build: (f, E) => textInput(f, E, "name", "Ada")
      });
    },
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );

  h.fire("submit", form);
  await settle();

  assert.equal(stub.count("/api/save"), 1, "the form POSTed once");
  assert.deepEqual(h.sandbox.wd.state.saved, { id: 7, ok: true }, "success reply written to state[key]");
  assert.equal(h.sandbox.wd.state.saved_error, null, "no error flag on success");
});

test(":form action writes state[key+'_error'] on a failure response", async () => {
  const stub = makeFetchStub({ "/api/save": { status: 500, body: { error: "boom" } } });
  let form;
  const h = makeSandbox(
    (root, El) => {
      form = formRegion(root, El, {
        key: "saved",
        action: "/api/save",
        method: "post",
        build: (f, E) => textInput(f, E, "name", "Ada")
      });
    },
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );

  h.fire("submit", form);
  await settle();

  assert.match(String(h.sandbox.wd.state.saved_error), /HTTP 500/, "failure surfaces as *_error");
  assert.equal(h.sandbox.wd.state.saved ?? null, null, "no success value on failure");
});

// ---------------------------------------------------------------------------
// TASK-3B.4 — per-row append-row / remove (runtime.js applyAction ~522-535)
// ---------------------------------------------------------------------------

// A loop region whose row proto carries a button with the given per-row action.
function actionLoop(root, El, { srcKey, initial, op, target }) {
  stateScript(root, El, { [srcKey]: initial, ...(target && target !== srcKey ? { [target]: [] } : {}) });
  const region = new El("div");
  region.setAttribute("data-wd-loop", srcKey);
  const template = new El("template");
  template.setAttribute("data-wd-loop-template", "");
  const proto = new El("li");
  const label = new El("span");
  label.setAttribute("data-wd-each", "");
  label.setAttribute("data-wd-path", "name");
  proto.appendChild(label);
  const button = new El("button");
  button.setAttribute("data-wd-action", op);
  if (target) button.setAttribute("data-wd-target", target);
  proto.appendChild(button);
  template.content.appendChild(proto);
  region.appendChild(template);
  const out = new El("ul");
  out.setAttribute("data-wd-loop-out", "");
  region.appendChild(out);
  root.appendChild(region);
  return { region, out };
}

test("per-row :button remove deletes the exact clicked row from the looped source", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = actionLoop(root, El, {
      srcKey: "lines",
      initial: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }],
      op: "remove"
    }));
  });
  assert.equal(out.children.length, 3);
  // Click the remove button inside row "b".
  const rowB = out.children[1];
  const buttonB = rowB.querySelector("[data-wd-action]");
  h.fire("click", buttonB);
  h.sandbox.wd.render();

  assert.deepEqual(h.sandbox.wd.state.lines.map((x) => x.id), ["a", "c"], "row b removed from source");
  assert.equal(out.children.length, 2, "the rendered list dropped a row");
});

test("per-row :button append-row appends a CLONED copy of the row item to the target list", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = actionLoop(root, El, {
      srcKey: "menu",
      initial: [{ id: "a", name: "Espresso" }, { id: "b", name: "Latte" }],
      op: "append-row",
      target: "cart"
    }));
  });
  const rowA = out.children[0];
  const buttonA = rowA.querySelector("[data-wd-action]");
  h.fire("click", buttonA);

  assert.equal(h.sandbox.wd.state.cart.length, 1, "one item appended to the target list");
  assert.deepEqual(h.sandbox.wd.state.cart[0], { id: "a", name: "Espresso" }, "the clicked row item was appended");
  assert.notStrictEqual(
    h.sandbox.wd.state.cart[0],
    h.sandbox.wd.state.menu[0],
    "appended item is a CLONE, not a shared reference"
  );
});

// ---------------------------------------------------------------------------
// TASK-3B.5 — :state … persist (runtime.js ~20-54)
// ---------------------------------------------------------------------------

test(":state persist writes the mutated value to localStorage['wd:cart']", () => {
  const h = makeSandbox((root, El) => {
    stateScript(root, El, { cart: ["seed"] }, { "data-wd-persist": "cart" });
  });
  // A mutation through the public setter triggers savePersisted().
  h.sandbox.wd.set("cart", ["apple", "pear"]);

  assert.equal(h.store.get("wd:cart"), JSON.stringify(["apple", "pear"]), "mutation persisted under wd:cart");
});

test(":state persist — an existing localStorage value overrides the declared seed on init", () => {
  const h = makeSandbox(
    (root, El) => {
      stateScript(root, El, { cart: ["seed-only"] }, { "data-wd-persist": "cart" });
    },
    { initialStore: { "wd:cart": JSON.stringify(["restored", "from", "storage"]) } }
  );
  assert.deepEqual(
    h.sandbox.wd.state.cart,
    ["restored", "from", "storage"],
    "persisted value wins over the seed at init time"
  );
});

// ---------------------------------------------------------------------------
// TASK-3B.6 — :fetch when=visible (runtime.js ~720-732)
// ---------------------------------------------------------------------------

// A controllable IntersectionObserver stub: records observed nodes and lets the
// test fire intersection manually. Exposes the latest instance for the test.
function makeIOStub() {
  const instances = [];
  class IntersectionObserver {
    constructor(cb) { this.cb = cb; this.observed = []; this.disconnected = false; instances.push(this); }
    observe(node) { this.observed.push(node); }
    disconnect() { this.disconnected = true; }
    // Drive an intersection for all observed nodes.
    intersect() { this.cb(this.observed.map((target) => ({ isIntersecting: true, target }))); }
  }
  return { IntersectionObserver, instances };
}

test(":fetch when=visible does NOT fetch until its IntersectionObserver intersects", async () => {
  const stub = makeFetchStub({ "/api/lazy": { status: 200, body: { loaded: true } } });
  const io = makeIOStub();
  const h = makeSandbox(
    (root, El) => {
      const span = new El("span");
      span.setAttribute("data-wd-fetch", "");
      span.setAttribute("data-wd-fetch-key", "lazy");
      span.setAttribute("data-wd-fetch-url", "/api/lazy");
      span.setAttribute("data-wd-fetch-when", "visible");
      root.appendChild(span);
    },
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise, IntersectionObserver: io.IntersectionObserver } }
  );

  await settle();
  assert.equal(stub.count("/api/lazy"), 0, "no fetch before the node becomes visible");
  assert.equal(io.instances.length, 1, "an IntersectionObserver was created for the lazy node");

  // Now the node scrolls into view.
  io.instances[0].intersect();
  await settle();

  assert.equal(stub.count("/api/lazy"), 1, "fetch ran exactly once after intersection");
  assert.ok(io.instances[0].disconnected, "observer disconnected after firing (one-shot)");
  assert.deepEqual(h.sandbox.wd.state.lazy, { loaded: true }, "lazy fetch result landed in state");
});
