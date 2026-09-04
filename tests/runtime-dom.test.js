import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { astOf } from "../src/compiler/expr-ast.js";

// Compile a validated expression string to the serialized AST the runtime reads
// from `data-wd-*` attributes (the compiler emits this; the runtime walks it).
const ast = (code) => JSON.stringify(astOf(code));

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
  constructor() {
    this._set = new Set();
  }
  add(c) {
    this._set.add(c);
  }
  remove(c) {
    this._set.delete(c);
  }
  contains(c) {
    return this._set.has(c);
  }
  toggle(c, on) {
    on ? this.add(c) : this.remove(c);
    return on;
  }
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
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
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
  remove() {
    if (this.parent) this.parent.removeChild(this);
  }
  cloneNode() {
    const copy = new El(this.tagName);
    for (const [k, v] of this.attrs) copy.attrs.set(k, v);
    copy._text = this._text;
    for (const child of this.children) copy.appendChild(child.cloneNode(true));
    // A <template>'s children live on .content, not .children: without this a
    // cloned loop row loses every nested branch template it was carrying.
    if (this.content)
      for (const child of this.content.children) copy.content.appendChild(child.cloneNode(true));
    return copy;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  // Recursive, like the real DOM: an element's textContent is its descendants'
  // text. Without this, reading back a branch the runtime injected via innerHTML
  // always looks empty and every branch-content assertion is vacuous.
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
  }
  set textContent(v) {
    this._text = v == null ? "" : String(v);
    this.children = [];
  }
  // Real serialize/parse. The runtime swaps an :if branch by assigning one
  // <template>'s innerHTML into a live [data-wd-if-out] node, so a stub that
  // returned "" would make WHICH branch landed unobservable by construction.
  get innerHTML() {
    return serializeChildren(this.content || this);
  }
  set innerHTML(v) {
    parseInto(this, v == null ? "" : String(v));
  }

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
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const out = [];
    walk(this, (node) => {
      if (node !== this && node.matches(selector)) out.push(node);
    });
    return out;
  }
  // <input>/<textarea>/<select> value, the surface :bind-input reads & writes.
  // Backed by an attribute so cloneNode + setAttribute("value") stay coherent.
  get value() {
    return this.attrs.has("value") ? this.attrs.get("value") : "";
  }
  set value(v) {
    this.attrs.set("value", v == null ? "" : String(v));
  }
}

class Fragment extends El {
  constructor() {
    super("#fragment");
  }
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

const VOID_TAGS = new Set([
  "AREA",
  "BASE",
  "BR",
  "COL",
  "EMBED",
  "HR",
  "IMG",
  "INPUT",
  "LINK",
  "META",
  "SOURCE",
  "TRACK",
  "WBR"
]);
const escText = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (v) => escText(v).replace(/"/g, "&quot;");
const unesc = (t) =>
  t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

function serializeChildren(node) {
  if (!node.children.length) return escText(node._text || "");
  return node.children
    .map((el) => {
      const tag = el.tagName.toLowerCase();
      const attrs = [...el.attrs]
        .map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${escAttr(v)}"`))
        .join("");
      if (VOID_TAGS.has(el.tagName)) return `<${tag}${attrs}>`;
      return `<${tag}${attrs}>${serializeChildren(el.content || el)}</${tag}>`;
    })
    .join("");
}

// Minimal HTML parser: exactly the shapes the compiler emits into branch
// templates (tags, quoted/bare attributes, void elements, nested <template>).
const TOKEN = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:.-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)(?:="([^"]*)")?/g;

function parseInto(root, html) {
  const target = root.content || root;
  target.children = [];
  target._text = "";
  const stack = [target];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(html))) {
    const [, close, tag, attrs, selfClose, text] = m;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      if (!top.children.length) top._text += unesc(text);
      continue;
    }
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new El(tag);
    for (const a of attrs.matchAll(ATTR)) el.attrs.set(a[1], a[2] === undefined ? "" : unesc(a[2]));
    top.appendChild(el);
    // A <template>'s children belong to .content, so push that as the container.
    if (!selfClose && !VOID_TAGS.has(el.tagName)) stack.push(el.content || el);
  }
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
  constructor(form) {
    this._pairs = form ? collectFormControls(form) : [];
  }
  getAll(name) {
    return this._pairs.filter(([k]) => k === name).map(([, v]) => v);
  }
  get(name) {
    const hit = this._pairs.find(([k]) => k === name);
    return hit ? hit[1] : null;
  }
  append(name, value) {
    this._pairs.push([name, String(value)]);
  }
  *[Symbol.iterator]() {
    yield* this._pairs;
  }
  entries() {
    return this._pairs[Symbol.iterator]();
  }
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
    return this._pairs
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  }
}

// --- Sandbox harness -------------------------------------------------------

function makeSandbox(rootBuilder, { withRAF = false, globals = {}, initialStore = {} } = {}) {
  const root = new El("body");
  rootBuilder(root, El);

  const listeners = {};
  const document = {
    activeElement: null,
    // <html> root, the surface :theme reflects onto via document.documentElement.
    documentElement: new El("html"),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    addEventListener: (type, fn) => {
      (listeners[type] ||= []).push(fn);
    }
  };

  // localStorage backing store; pre-seeded so a :persist/:store override can be
  // present BEFORE the runtime reads it on load.
  const store = new Map(Object.entries(initialStore));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };

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
    sandbox.requestAnimationFrame = (fn) => {
      sandbox.__rafQueue.push(fn);
      return sandbox.__rafQueue.length;
    };
    sandbox.__rafQueue = [];
  }
  // The runtime registers a `window.addEventListener("storage", …)` for cross-tab
  // :store sync; the sandbox window is the sandbox itself, so expose the same
  // listener registry there. `fire(type, target)` drives both document + window.
  sandbox.addEventListener = (type, fn) => {
    (listeners[type] ||= []).push(fn);
  };
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
      for (const fn of listeners[type] || [])
        fn({
          target,
          preventDefault() {
            defaultPrevented = true;
          }
        });
      return defaultPrevented;
    },
    get renderCount() {
      return sandbox.__renderCount || 0;
    },
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

// --- builders shared by the conditional / loop behavior tests ---------------

function el(El, tag, attrs = {}, text) {
  const node = new El(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function seedState(El, root, obj, persist) {
  const s = el(El, "script", { "data-wd-state": "" });
  if (persist) s.setAttribute("data-wd-persist", persist);
  s.textContent = JSON.stringify(obj);
  root.appendChild(s);
  return s;
}

// A global `:if` region exactly as the compiler emits it: two <template>
// branches, a live [data-wd-if-out], and the compile-time data-wd-if-active.
function ifRegion(
  El,
  { expr, key = "", path, active = "false", truthy = [], falsy = [], initial = "" }
) {
  const node = el(El, "div", { "data-wd-if": key, "data-wd-if-active": active });
  if (expr) node.setAttribute("data-wd-if-expr", expr);
  if (path) node.setAttribute("data-wd-path", path);
  const t = el(El, "template", { "data-wd-true": "" });
  for (const c of truthy) t.content.appendChild(c);
  const f = el(El, "template", { "data-wd-false": "" });
  for (const c of falsy) f.content.appendChild(c);
  const out = el(El, "div", { "data-wd-if-out": "" }, initial);
  node.appendChild(t);
  node.appendChild(f);
  node.appendChild(out);
  return { node, out };
}

// A per-row `:if` region, as emitted inside a loop row template.
function eachIfRegion(El, { expr, path, meta, truthy = [], falsy = [], initial = "" }) {
  const region = el(El, "span", { "data-wd-each-if": "" });
  if (expr) region.setAttribute("data-wd-if-expr", expr);
  if (path) region.setAttribute("data-wd-path", path);
  if (meta) region.setAttribute("data-wd-meta", meta);
  const t = el(El, "template", { "data-wd-if-true": "" });
  for (const c of truthy) t.content.appendChild(c);
  const f = el(El, "template", { "data-wd-if-false": "" });
  for (const c of falsy) f.content.appendChild(c);
  const out = el(El, "span", { "data-wd-each-if-out": "" }, initial);
  region.appendChild(t);
  region.appendChild(f);
  region.appendChild(out);
  return { region, out };
}

// A reactive loop region. Pass `key` for a top-level loop read off state, or
// `item` for a nested item-relative one (data-wd-loop-item).
function loopShell(El, { key, item, proto, empty, clauses = {} }) {
  const region = el(
    El,
    "div",
    key != null ? { "data-wd-loop": key } : { "data-wd-loop-item": item }
  );
  for (const [k, v] of Object.entries(clauses)) region.setAttribute(k, v);
  const template = el(El, "template", { "data-wd-loop-template": "" });
  template.content.appendChild(proto);
  region.appendChild(template);
  if (empty) {
    const e = el(El, "template", { "data-wd-loop-empty": "" });
    for (const c of empty) e.content.appendChild(c);
    region.appendChild(e);
  }
  const out = el(El, "ul", { "data-wd-loop-out": "" });
  region.appendChild(out);
  return { region, out };
}

const rowKeys = (out) => out.children.map((n) => n.getAttribute("data-wd-loop-key"));
const rowText = (out) => out.children.map((n) => n.textContent);

// ---------------------------------------------------------------------------
// TASK-2A.1 — keyed loop reconcile
// ---------------------------------------------------------------------------

test("reconcile reuses keyed nodes when adding an item", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, {
      initial: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" }
      ]
    }));
  });
  assert.equal(out.children.length, 2);
  const nodeA = out.children[0];
  const nodeB = out.children[1];

  h.sandbox.wd.state.items = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" }
  ];
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
    ({ out } = loopRegion(root, El, {
      initial: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
        { id: "c", name: "Gamma" }
      ]
    }));
  });
  const nodeA = out.children[0];
  const nodeC = out.children[2];

  h.sandbox.wd.state.items = [
    { id: "a", name: "Alpha" },
    { id: "c", name: "Gamma" }
  ];
  h.sandbox.wd.render();

  assert.equal(out.children.length, 2);
  assert.strictEqual(out.children[0], nodeA, "surviving node reused");
  assert.strictEqual(out.children[1], nodeC, "surviving node reused");
  assert.ok(
    !out.children.some((c) => c.getAttribute("data-wd-loop-key") === "b"),
    "orphan b removed"
  );
});

test("reconcile reuses the same nodes when items are reordered", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, {
      initial: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
        { id: "c", name: "Gamma" }
      ]
    }));
  });
  const before = { a: out.children[0], b: out.children[1], c: out.children[2] };

  h.sandbox.wd.state.items = [
    { id: "c", name: "Gamma" },
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" }
  ];
  h.sandbox.wd.render();

  assert.equal(out.children.length, 3);
  assert.deepEqual(
    out.children.map((n) => n.getAttribute("data-wd-loop-key")),
    ["c", "a", "b"]
  );
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
  h.sandbox.wd.set("evil", {
    __proto__: { polluted: "yes" },
    constructor: { polluted: "yes" },
    safe: { deep: "ok" }
  });

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
  assert.equal({}.polluted, undefined);
  // And not in this realm either.
  assert.equal(Object.prototype.polluted, undefined);
});

// ---------------------------------------------------------------------------
// TASK-2A.3 — loopKeyOf collision counter (probed via the reconciler)
// ---------------------------------------------------------------------------

test("colliding loop keys get distinct effective keys via the collision counter", () => {
  let out;
  makeSandbox((root, El) => {
    // Two items with the SAME id collide on their base key.
    ({ out } = loopRegion(root, El, {
      initial: [
        { id: "dup", name: "First" },
        { id: "dup", name: "Second" }
      ]
    }));
  });

  assert.equal(out.children.length, 2, "both colliding rows render as separate nodes");
  const keys = out.children.map((n) => n.getAttribute("data-wd-loop-key"));
  assert.equal(keys[0], "dup");
  assert.equal(keys[1], "dup#1", "second collision gets a #1 suffix");
  assert.notEqual(keys[0], keys[1], "effective keys are distinct");
  assert.deepEqual(
    out.children.map((n) => n.textContent),
    ["First", "Second"]
  );
});

// ---------------------------------------------------------------------------
// TASK-2B — render coalescing
// ---------------------------------------------------------------------------

test("N rapid mutations coalesce into exactly one batched render", () => {
  let out;
  const h = makeSandbox(
    (root, El) => {
      ({ out } = loopRegion(root, El, { initial: [{ id: "a", name: "A" }] }));
    },
    { withRAF: true }
  );

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
      // AST with an unknown op tag: the walker throws, exercising the safe fallback.
      computedRegion(root, El, { key: "total", expr: JSON.stringify(["boomOp"]), initial: {} });
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
      computedRegion(root, El, { key: "total", expr: JSON.stringify(["boomOp"]), initial: {} });
    });
    warnings.length = 0; // ignore the load-time render
    h.sandbox.wd.debug = true;
    h.sandbox.wd.render();
    assert.ok(warnings.length >= 1, "a warning was emitted when debug is on");
    assert.ok(
      warnings.some((w) => String(w[0]).includes("boomOp")),
      "warning includes the offending expression (serialized AST) text"
    );
    assert.equal(h.sandbox.wd.get("total"), undefined, "safe fallback still applies under debug");
  } finally {
    console.warn = originalWarn;
  }
});

test("wd.render is a synchronous flush for manual / external callers", () => {
  let out;
  const h = makeSandbox(
    (root, El) => {
      ({ out } = loopRegion(root, El, { initial: [{ id: "a", name: "A" }] }));
    },
    { withRAF: true }
  );

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
function clauseLoop(
  root,
  El,
  { key = "items", initial, path = "v", attrs = {}, empty = null } = {}
) {
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
  makeSandbox((root, El) => {
    ({ out } = clauseLoop(root, El, {
      initial: [
        { id: 1, v: 3 },
        { id: 2, v: 1 },
        { id: 3, v: 2 }
      ],
      attrs: { "data-wd-loop-sort": "v", "data-wd-loop-sort-dir": "asc" }
    }));
  });
  assert.deepEqual(
    out.children.map((n) => n.textContent),
    ["1", "2", "3"]
  );
});

test("runtime sorts rows descending and uses localeCompare for strings", () => {
  let out;
  makeSandbox((root, El) => {
    ({ out } = clauseLoop(root, El, {
      initial: [
        { id: 1, v: "banana" },
        { id: 2, v: "apple" },
        { id: 3, v: "cherry" }
      ],
      attrs: { "data-wd-loop-sort": "v", "data-wd-loop-sort-dir": "desc" }
    }));
  });
  assert.deepEqual(
    out.children.map((n) => n.textContent),
    ["cherry", "banana", "apple"]
  );
});

test("runtime applies reverse, then offset, then limit (pipeline order)", () => {
  let out;
  makeSandbox((root, El) => {
    ({ out } = clauseLoop(root, El, {
      initial: [
        { id: 1, v: "a" },
        { id: 2, v: "b" },
        { id: 3, v: "c" },
        { id: 4, v: "d" }
      ],
      attrs: { "data-wd-loop-reverse": "", "data-wd-loop-offset": "1", "data-wd-loop-limit": "2" }
    }));
  });
  // reverse → d c b a ; offset 1 → c b a ; limit 2 → c b
  assert.deepEqual(
    out.children.map((n) => n.textContent),
    ["c", "b"]
  );
});

test("runtime reads a state-key limit for reactive paging", () => {
  let out;
  const h = makeSandbox((root, El) => {
    const script = new El("script");
    script.setAttribute("data-wd-state", "");
    script.textContent = JSON.stringify({ pageSize: 2 });
    root.appendChild(script);
    ({ out } = clauseLoop(root, El, {
      initial: [
        { id: 1, v: "a" },
        { id: 2, v: "b" },
        { id: 3, v: "c" }
      ],
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
  makeSandbox((root, El) => {
    const script = new El("script");
    script.setAttribute("data-wd-state", "");
    script.textContent = JSON.stringify({
      team: {
        members: [
          { id: 1, v: "Ann" },
          { id: 2, v: "Bo" }
        ]
      }
    });
    root.appendChild(script);
    ({ out } = clauseLoop(root, El, { key: "team.members" }));
  });
  assert.deepEqual(
    out.children.map((n) => n.textContent),
    ["Ann", "Bo"]
  );
});

// ---------------------------------------------------------------------------
// TASK-2 (loops) — per-row meta vars + @empty
// ---------------------------------------------------------------------------

test("runtime fills per-row meta markers ($index/$number/$first/$last/$count)", () => {
  let out;
  makeSandbox((root, El) => {
    const region = new El("div");
    region.setAttribute("data-wd-loop", "items");
    const template = new El("template");
    template.setAttribute("data-wd-loop-template", "");
    const proto = new El("li");
    // a row that carries several meta markers
    const idx = new El("span");
    idx.setAttribute("data-wd-each-meta", "index");
    const num = new El("span");
    num.setAttribute("data-wd-each-meta", "number");
    const cnt = new El("span");
    cnt.setAttribute("data-wd-each-meta", "count");
    proto.appendChild(idx);
    proto.appendChild(num);
    proto.appendChild(cnt);
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
  const metas = (row) =>
    row
      .querySelectorAll("[data-wd-each-meta]")
      .map((s) => [s.getAttribute("data-wd-each-meta"), s.textContent]);
  assert.deepEqual(metas(out.children[0]), [
    ["index", "0"],
    ["number", "1"],
    ["count", "3"]
  ]);
  assert.deepEqual(metas(out.children[2]), [
    ["index", "2"],
    ["number", "3"],
    ["count", "3"]
  ]);
});

test("runtime renders the @empty template when the post-pipeline list is empty", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = clauseLoop(root, El, { initial: [], empty: "Nothing here." }));
  });
  // No rows + an empty template → the out container shows the empty content.
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].textContent, "Nothing here.");

  // Add a row → empty branch is replaced by rendered rows.
  h.sandbox.wd.state.items = [{ id: 1, v: "x" }];
  h.sandbox.wd.render();
  assert.deepEqual(
    out.children.map((n) => n.textContent),
    ["x"]
  );

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
    (root, El) =>
      fetchRegion(root, El, {
        key: "feed",
        url: "/api/feed",
        headers: "session",
        refresh: "/auth/refresh",
        session: { Authorization: "Bearer old" }
      }),
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );

  await settle();

  assert.equal(stub.count("/api/feed"), 2, "original request retried once");
  assert.equal(stub.count("/auth/refresh"), 1, "token refreshed once");
  assert.deepEqual(
    h.sandbox.wd.state.session,
    { Authorization: "Bearer new" },
    "renewed token written back to state"
  );
  const feedCalls = stub.calls.filter((c) => c.url === "/api/feed");
  assert.deepEqual(feedCalls[0].headers, { Authorization: "Bearer old" });
  assert.deepEqual(
    feedCalls[1].headers,
    { Authorization: "Bearer new" },
    "retry carried the renewed header"
  );
  assert.deepEqual(h.sandbox.wd.state.feed, [{ id: 1 }]);
  assert.equal(h.sandbox.wd.state.feed_error, null);
});

test(":fetch falls through to *_error when the token refresh fails", async () => {
  const stub = makeFetchStub({
    "/api/feed": { status: 401 },
    "/auth/refresh": { status: 500, body: { error: "nope" } }
  });
  const h = makeSandbox(
    (root, El) =>
      fetchRegion(root, El, {
        key: "feed",
        url: "/api/feed",
        headers: "session",
        refresh: "/auth/refresh",
        session: { Authorization: "Bearer old" }
      }),
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
      fetchRegion(root, El, {
        key: "a",
        url: "/api/a",
        headers: "session",
        refresh: "/auth/refresh",
        session: { Authorization: "Bearer old" }
      });
      fetchRegion(root, El, {
        key: "b",
        url: "/api/b",
        headers: "session",
        refresh: "/auth/refresh"
      });
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
    el.setAttribute("data-wd-class", JSON.stringify([["sale", astOf('(S("hot"))')]]));
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
    s.textContent = JSON.stringify({
      products: [
        { id: 1, name: "A", onSale: true },
        { id: 2, name: "B", onSale: false }
      ]
    });
    root.appendChild(s);
    const region = new El("div");
    region.setAttribute("data-wd-loop", "products");
    const template = new El("template");
    template.setAttribute("data-wd-loop-template", "");
    const proto = new El("div");
    proto.setAttribute("data-wd-each-class", JSON.stringify([["sale", astOf('I("onSale")')]]));
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
  h.sandbox.wd.state.products = [
    { id: 1, name: "A", onSale: true },
    { id: 2, name: "B", onSale: true }
  ];
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
    for (const [watch, target] of [
      ["q", "r"],
      ["r", "s"]
    ]) {
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
  assert.ok(
    warns.some((w) => /did not settle/.test(w)),
    "warns when an effect never settles"
  );
  assert.ok(h.sandbox.wd.state.n <= 11, "the settle cap bounds the runaway effect");
});

// ---------------------------------------------------------------------------
// Expression conditionals — :if a <op> b (richer conditions)
// ---------------------------------------------------------------------------

test("expression :if swaps the RENDERED branch as watched state crosses the predicate", () => {
  // Both templates carry DISTINCT content. Asserting only data-wd-if-active (as
  // this test used to) is unobservable by construction: with two EMPTY templates
  // a swap that injected the wrong branch, or no branch at all, still passes.
  let node;
  let out;
  const h = makeSandbox((root, El) => {
    seedState(El, root, { n: 3 });
    ({ node, out } = ifRegion(El, {
      expr: ast('(S("n") > 5)'),
      truthy: [el(El, "b", {}, "PLENTY")],
      falsy: [el(El, "i", {}, "SCARCE")],
      initial: "SCARCE"
    }));
    root.appendChild(node);
  });

  assert.equal(node.getAttribute("data-wd-if-active"), "false", "n=3, predicate false");
  assert.equal(out.textContent, "SCARCE", "compile-time branch left in place");

  h.sandbox.wd.state.n = 10;
  h.sandbox.wd.render();
  assert.equal(node.getAttribute("data-wd-if-active"), "true", "n=10, predicate true");
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].tagName, "B", "the TRUE template's element landed");
  assert.equal(out.children[0].textContent, "PLENTY");

  h.sandbox.wd.state.n = 1;
  h.sandbox.wd.render();
  assert.equal(node.getAttribute("data-wd-if-active"), "false", "n=1, predicate false again");
  assert.equal(out.children[0].tagName, "I", "the FALSE template's element landed");
  assert.equal(out.children[0].textContent, "SCARCE");
});

test(":if leaves an UNCHANGED branch alone (no re-injection on every render)", () => {
  let out;
  const h = makeSandbox((root, El) => {
    seedState(El, root, { n: 9 });
    const built = ifRegion(El, {
      expr: ast('(S("n") > 5)'),
      truthy: [el(El, "b", {}, "PLENTY")],
      falsy: [el(El, "i", {}, "SCARCE")],
      initial: "SCARCE"
    });
    out = built.out;
    root.appendChild(built.node);
  });
  const injected = out.children[0];
  assert.equal(injected.textContent, "PLENTY");

  // Renders that do not cross the predicate must not touch the subtree:
  // re-injecting would replace the node and destroy anything live inside it.
  h.sandbox.wd.state.other = 1;
  h.sandbox.wd.render();
  h.sandbox.wd.render();
  h.sandbox.wd.render();
  assert.strictEqual(out.children[0], injected, "branch node replaced on an unchanged render");
});

test("a long :else-if chain resolves to the deepest branch in ONE render", () => {
  // `:else if` nests one region inside the previous one's false template, so a
  // four-arm chain is four levels deep and NONE of the inner levels exist in the
  // live tree until the level above injects. renderIf recursing into what it
  // just injected is what makes the whole chain settle in a single render; the
  // repeat-pass safety net alone is capped and would leave the last arm on its
  // compile-time content until some later, unrelated render.
  let out;
  const h = makeSandbox((root, El) => {
    seedState(El, root, { a: true, b: true, c: true, d: true });
    // Each nested arm is baked "false" but reads true, so every level must
    // actually swap once its parent puts it in the tree.
    const l4 = ifRegion(El, {
      key: "d",
      active: "false",
      truthy: [el(El, "b", {}, "DEEPEST")],
      falsy: [el(El, "i", {}, "NONE")],
      initial: "NONE"
    });
    const l3 = ifRegion(El, {
      key: "c",
      active: "false",
      truthy: [l4.node],
      falsy: [el(El, "i", {}, "L3-FALSE")],
      initial: "L3-FALSE"
    });
    const l2 = ifRegion(El, {
      key: "b",
      active: "false",
      truthy: [l3.node],
      falsy: [el(El, "i", {}, "L2-FALSE")],
      initial: "L2-FALSE"
    });
    const l1 = ifRegion(El, {
      key: "a",
      active: "true",
      truthy: [el(El, "b", {}, "TOP")],
      falsy: [l2.node],
      initial: "TOP"
    });
    out = l1.out;
    root.appendChild(l1.node);
  });
  assert.equal(out.textContent, "TOP");

  h.sandbox.wd.state.a = false;
  h.sandbox.wd.render();
  assert.equal(
    out.textContent,
    "DEEPEST",
    "every arm of the chain must settle on the render that revealed it"
  );
});

test(":if fills a nested :if inside the branch it just injected (:else if desugaring)", () => {
  // `:else if` compiles to an if-region nested INSIDE the outer false template.
  // querySelectorAll cannot see into <template> content, so unless renderIf
  // recurses into what it just injected, the inner region keeps whatever the
  // compiler baked into it and can never correct itself.
  let outerOut;
  const h = makeSandbox((root, El) => {
    seedState(El, root, { n: 10, m: 1 });
    const inner = ifRegion(El, {
      expr: ast('(S("m") > 0)'),
      active: "false",
      truthy: [el(El, "b", {}, "INNER-TRUE")],
      falsy: [el(El, "i", {}, "INNER-FALSE")],
      initial: "INNER-FALSE"
    });
    const outer = ifRegion(El, {
      expr: ast('(S("n") > 5)'),
      active: "true",
      truthy: [el(El, "b", {}, "OUTER-TRUE")],
      falsy: [inner.node],
      initial: "OUTER-TRUE"
    });
    outerOut = outer.out;
    root.appendChild(outer.node);
  });
  assert.equal(outerOut.textContent, "OUTER-TRUE", "starts on the outer true branch");

  // Flip the outer predicate: the false branch (carrying the nested region) is
  // injected for the first time, and that region must be evaluated from m=1
  // rather than left on the INNER-FALSE the compiler baked into the template.
  h.sandbox.wd.state.n = 1;
  h.sandbox.wd.render();
  const nested = outerOut.querySelector("[data-wd-if]");
  assert.ok(nested, "the outer false branch was injected");
  assert.equal(nested.getAttribute("data-wd-if-active"), "true", "nested region evaluated");
  assert.equal(outerOut.querySelector("[data-wd-if-out]").textContent, "INNER-TRUE");

  h.sandbox.wd.state.m = -1;
  h.sandbox.wd.render();
  assert.equal(
    outerOut.querySelector("[data-wd-if-out]").textContent,
    "INNER-FALSE",
    "the now-live nested region keeps tracking state on later renders"
  );
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
    node.setAttribute("data-wd-if-expr", ast('(S("plan") == "pro") && (!(S("banned")))'));
    node.setAttribute("data-wd-if-active", "false");
    const out = new El("div");
    out.setAttribute("data-wd-if-out", "");
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
        for (const [val, checked] of [
          ["news", true],
          ["sales", false],
          ["beta", true]
        ]) {
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
  assert.deepEqual(
    h.sandbox.wd.state.saved,
    { id: 7, ok: true },
    "success reply written to state[key]"
  );
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
  stateScript(root, El, {
    [srcKey]: initial,
    ...(target && target !== srcKey ? { [target]: [] } : {})
  });
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
      initial: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
        { id: "c", name: "Gamma" }
      ],
      op: "remove"
    }));
  });
  assert.equal(out.children.length, 3);
  // Click the remove button inside row "b".
  const rowB = out.children[1];
  const buttonB = rowB.querySelector("[data-wd-action]");
  h.fire("click", buttonB);
  h.sandbox.wd.render();

  assert.deepEqual(
    h.sandbox.wd.state.lines.map((x) => x.id),
    ["a", "c"],
    "row b removed from source"
  );
  assert.equal(out.children.length, 2, "the rendered list dropped a row");
});

test("per-row :button append-row appends a CLONED copy of the row item to the target list", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = actionLoop(root, El, {
      srcKey: "menu",
      initial: [
        { id: "a", name: "Espresso" },
        { id: "b", name: "Latte" }
      ],
      op: "append-row",
      target: "cart"
    }));
  });
  const rowA = out.children[0];
  const buttonA = rowA.querySelector("[data-wd-action]");
  h.fire("click", buttonA);

  assert.equal(h.sandbox.wd.state.cart.length, 1, "one item appended to the target list");
  assert.deepEqual(
    h.sandbox.wd.state.cart[0],
    { id: "a", name: "Espresso" },
    "the clicked row item was appended"
  );
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

  assert.equal(
    h.store.get("wd:cart"),
    JSON.stringify(["apple", "pear"]),
    "mutation persisted under wd:cart"
  );
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
    constructor(cb) {
      this.cb = cb;
      this.observed = [];
      this.disconnected = false;
      instances.push(this);
    }
    observe(node) {
      this.observed.push(node);
    }
    disconnect() {
      this.disconnected = true;
    }
    // Drive an intersection for all observed nodes.
    intersect() {
      this.cb(this.observed.map((target) => ({ isIntersecting: true, target })));
    }
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
    {
      globals: {
        fetch: stub.fetch,
        setTimeout,
        clearTimeout,
        Promise,
        IntersectionObserver: io.IntersectionObserver
      }
    }
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

// ---------------------------------------------------------------------------
// 1.0 — Value layer: format pipes reformat reactive binds, loop rows, and
// computed aggregates in the real runtime (Intl/Math passed into the sandbox).
// ---------------------------------------------------------------------------

const fmtGlobals = { globals: { Intl, Math } };

function fmtStateScript(El, root, value) {
  const s = new El("script");
  s.setAttribute("data-wd-state", "");
  s.textContent = JSON.stringify(value);
  root.appendChild(s);
}

test("format pipe: a reactive money bind reformats on state change", () => {
  let span;
  const h = makeSandbox((root, El) => {
    fmtStateScript(El, root, { price: 49 });
    span = new El("span");
    span.setAttribute("data-wd-bind", "price");
    span.setAttribute("data-wd-fmt", '[["money",[]]]');
    root.appendChild(span);
  }, fmtGlobals);
  assert.equal(span.textContent, "$49.00", "initial paint formats");
  h.sandbox.wd.state.price = 99.5;
  h.sandbox.wd.render();
  assert.equal(span.textContent, "$99.50", "reformats after change");
});

test("format pipe: an aggregate sum + money bind tracks the list", () => {
  let span;
  const h = makeSandbox((root, El) => {
    fmtStateScript(El, root, { cart: [{ price: 49 }, { price: 99 }] });
    span = new El("span");
    span.setAttribute("data-wd-bind", "cart");
    span.setAttribute("data-wd-fmt", '[["sum",["price"]],["money",[]]]');
    root.appendChild(span);
  }, fmtGlobals);
  assert.equal(span.textContent, "$148.00");
  h.sandbox.wd.state.cart = [{ price: 10 }, { price: 5 }, { price: 2.5 }];
  h.sandbox.wd.render();
  assert.equal(span.textContent, "$17.50");
});

test(":computed aggregate recomputes through the A() helper", () => {
  const h = makeSandbox((root, El) => {
    fmtStateScript(El, root, { cart: [{ price: 2 }, { price: 3 }], total: 0 });
    const c = new El("span");
    c.setAttribute("data-wd-computed", "");
    c.setAttribute("data-wd-computed-key", "total");
    c.setAttribute("data-wd-computed-expr", ast('A("sum",S("cart"),"price")'));
    root.appendChild(c);
  }, fmtGlobals);
  assert.equal(h.sandbox.wd.state.total, 5, "initial aggregate");
  h.sandbox.wd.state.cart = [{ price: 10 }, { price: 20 }];
  h.sandbox.wd.render();
  assert.equal(h.sandbox.wd.state.total, 30, "recomputed");
});

test("format pipe: loop rows format their per-row value", () => {
  let out;
  makeSandbox((root, El) => {
    fmtStateScript(El, root, {
      items: [
        { id: 1, price: 49 },
        { id: 2, price: 12.5 }
      ]
    });
    const region = new El("div");
    region.setAttribute("data-wd-loop", "items");
    const tpl = new El("template");
    tpl.setAttribute("data-wd-loop-template", "");
    const proto = new El("li");
    proto.setAttribute("data-wd-each", "");
    proto.setAttribute("data-wd-path", "price");
    proto.setAttribute("data-wd-fmt", '[["money",[]]]');
    tpl.content.appendChild(proto);
    region.appendChild(tpl);
    out = new El("ul");
    out.setAttribute("data-wd-loop-out", "");
    region.appendChild(out);
    root.appendChild(region);
  }, fmtGlobals);
  assert.equal(out.children.length, 2);
  assert.equal(out.children[0].textContent, "$49.00");
  assert.equal(out.children[1].textContent, "$12.50");
});

// ---------------------------------------------------------------------------
// 1.0 — Time layer: :every runs actions on a timer and pauses while hidden.
// ---------------------------------------------------------------------------

test(":every ticks its actions, renders, and pauses when the tab is hidden", () => {
  const intervals = [];
  let nextId = 1;
  const setIntervalStub = (fn, ms) => {
    const id = nextId++;
    intervals.push({ id, fn, ms, cleared: false });
    return id;
  };
  const clearIntervalStub = (id) => {
    const it = intervals.find((x) => x.id === id);
    if (it) it.cleared = true;
  };
  let span;
  const h = makeSandbox(
    (root, El) => {
      fmtStateScript(El, root, { n: 0 });
      const ev = new El("script");
      ev.setAttribute("data-wd-every", "");
      ev.textContent = JSON.stringify({ ms: 1000, actions: [{ op: "inc", target: "n" }] });
      root.appendChild(ev);
      // A malformed marker (no ms) is skipped defensively, not started.
      const bad = new El("script");
      bad.setAttribute("data-wd-every", "");
      bad.textContent = JSON.stringify({ actions: [{ op: "inc", target: "n" }] });
      root.appendChild(bad);
      span = new El("span");
      span.setAttribute("data-wd-bind", "n");
      root.appendChild(span);
    },
    { withRAF: true, globals: { setInterval: setIntervalStub, clearInterval: clearIntervalStub } }
  );

  assert.equal(intervals.length, 1, "one interval registered on load");
  assert.equal(intervals[0].ms, 1000);

  intervals[0].fn();
  h.flushRAF();
  intervals[0].fn();
  h.flushRAF();
  assert.equal(h.sandbox.wd.state.n, 2, "two ticks ran the action twice");
  assert.equal(span.textContent, "2", "the bind re-rendered");

  // Hiding the tab clears the interval; showing it restarts.
  h.document.hidden = true;
  h.fire("visibilitychange", h.document);
  assert.ok(intervals[0].cleared, "interval cleared while hidden");

  h.document.hidden = false;
  h.fire("visibilitychange", h.document);
  assert.equal(intervals.length, 2, "interval re-registered when visible again");
});

// ---------------------------------------------------------------------------
// 1.0 — Manual theme: :theme reflects its store onto <html data-theme>.
// ---------------------------------------------------------------------------

test(":theme reflects its store onto <html data-theme>, clearing on auto", () => {
  const h = makeSandbox((root, El) => {
    fmtStateScript(El, root, { theme: "dark" });
    const marker = new El("span");
    marker.setAttribute("data-wd-theme", "theme");
    root.appendChild(marker);
  });
  const html = h.document.documentElement;
  assert.equal(html.getAttribute("data-theme"), "dark", "forced dark on load");

  h.sandbox.wd.state.theme = "light";
  h.sandbox.wd.render();
  assert.equal(html.getAttribute("data-theme"), "light", "switches to light");

  h.sandbox.wd.state.theme = "auto";
  h.sandbox.wd.render();
  assert.equal(html.getAttribute("data-theme"), null, "auto clears the attribute (follow OS)");
});

// ---------------------------------------------------------------------------
// 1.0 — Reactive sort: a loop re-sorts live as a state column/direction changes.
// ---------------------------------------------------------------------------

test("reactive sort re-orders rows as the sort column and direction change", () => {
  let out;
  const h = makeSandbox((root, El) => {
    fmtStateScript(El, root, { sortKey: "", sortDir: "asc" });
    const built = loopRegion(root, El, {
      initial: [
        { id: "b", name: "Beta" },
        { id: "a", name: "Alpha" },
        { id: "c", name: "Gamma" }
      ]
    });
    built.region.setAttribute("data-wd-loop-sort", "key:sortKey");
    built.region.setAttribute("data-wd-loop-sort-dir", "key:sortDir");
    out = built.out;
  });
  const names = () => out.children.map((c) => c.textContent);

  // No column chosen yet → original order preserved.
  assert.deepEqual(names(), ["Beta", "Alpha", "Gamma"]);

  h.sandbox.wd.state.sortKey = "name";
  h.sandbox.wd.render();
  assert.deepEqual(names(), ["Alpha", "Beta", "Gamma"], "ascending by name");

  h.sandbox.wd.state.sortDir = "desc";
  h.sandbox.wd.render();
  assert.deepEqual(names(), ["Gamma", "Beta", "Alpha"], "descending by name");
});

// ---------------------------------------------------------------------------
// 1.0 — Escape hatch: wd.subscribe(key, cb) bridges colocated .js "behaviors".
// ---------------------------------------------------------------------------

test("wd.subscribe primes the callback, fires on settled changes, and unsubscribes", () => {
  const h = makeSandbox((root, El) => {
    fmtStateScript(El, root, { n: 0 });
  });
  const seen = [];
  const off = h.sandbox.wd.subscribe("n", (v) => seen.push(v));
  assert.deepEqual(seen, [0], "primed with the current value");

  h.sandbox.wd.state.n = 5;
  h.sandbox.wd.render();
  assert.deepEqual(seen, [0, 5], "fired on change");

  h.sandbox.wd.render(); // no change → no extra notification
  assert.deepEqual(seen, [0, 5]);

  off();
  h.sandbox.wd.state.n = 9;
  h.sandbox.wd.render();
  assert.deepEqual(seen, [0, 5], "silent after unsubscribe");
});

test("a throwing subscriber is caught (prime and on change), never fatal", () => {
  const h = makeSandbox((root, El) => {
    fmtStateScript(El, root, { n: 0 });
  });
  h.sandbox.wd.debug = true;
  assert.doesNotThrow(() =>
    h.sandbox.wd.subscribe("n", () => {
      throw new Error("boom");
    })
  );
  assert.doesNotThrow(() => {
    h.sandbox.wd.state.n = 1;
    h.sandbox.wd.render();
  });
});

// ===========================================================================
// TASK-R — runtime behavior backfill for the 2026-09-04 audit findings.
//
// Every test here fails against the pre-fix runtime for a REASON, not because
// a marker attribute changed: each asserts the rendered result a user would
// see, or a DOM operation count, rather than the bookkeeping around it.
// ===========================================================================

// --- R1: directives that only become live when an :if branch opens ---------
//
// The five node-backed directives were registered once at load with
// document.querySelectorAll, which does not descend into <template> content.
// One inside an unopened :if branch was invisible forever: the computed never
// computed, the fetch issued no request, the effect never fired, the timer
// never ticked, the theme never reflected.

test(":computed and :theme inside an :if branch start working when the branch opens", () => {
  let out;
  const h = makeSandbox((root, El) => {
    seedState(El, root, { open: false, price: 21, mode: "dark" });
    const computed = el(El, "span", {
      "data-wd-computed": "",
      "data-wd-computed-key": "total",
      "data-wd-computed-expr": ast('S("price") * 2')
    });
    const theme = el(El, "span", { "data-wd-theme": "mode", hidden: "" });
    const built = ifRegion(El, {
      key: "open",
      truthy: [computed, theme, el(El, "span", { "data-wd-bind": "total" })],
      falsy: [],
      initial: ""
    });
    out = built.out;
    root.appendChild(built.node);
  });

  assert.equal(h.sandbox.wd.state.total, undefined, "nothing in the closed branch runs");
  assert.equal(h.document.documentElement.getAttribute("data-theme"), null);

  h.sandbox.wd.state.open = true;
  h.sandbox.wd.render();

  assert.equal(h.sandbox.wd.state.total, 42, ":computed in the opened branch computed");
  assert.equal(
    out.querySelector("[data-wd-bind]").textContent,
    "42",
    "and its value reached the bind in the SAME render"
  );
  assert.equal(
    h.document.documentElement.getAttribute("data-theme"),
    "dark",
    ":theme in the opened branch reflected"
  );

  // It keeps tracking state afterwards, like one that was live all along.
  h.sandbox.wd.state.price = 5;
  h.sandbox.wd.render();
  assert.equal(h.sandbox.wd.state.total, 10);
});

test(":fetch, :effect and :every inside an :if branch start when the branch opens", async () => {
  const stub = makeFetchStub({ "/api/feed": { status: 200, body: [{ id: 1 }] } });
  const intervals = [];
  let nextId = 1;
  const h = makeSandbox(
    (root, El) => {
      seedState(El, root, { open: false, n: 0, hit: 0 });
      const fetchNode = el(El, "span", {
        "data-wd-fetch": "",
        "data-wd-fetch-key": "feed",
        "data-wd-fetch-url": "/api/feed"
      });
      const effect = el(El, "script", { "data-wd-effect": "" });
      effect.textContent = JSON.stringify({
        watch: "n",
        actions: [{ op: "set", target: "hit", value: 1 }]
      });
      const every = el(El, "script", { "data-wd-every": "" });
      every.textContent = JSON.stringify({ ms: 500, actions: [{ op: "inc", target: "n" }] });
      const built = ifRegion(El, { key: "open", truthy: [fetchNode, effect, every], initial: "" });
      root.appendChild(built.node);
    },
    {
      globals: {
        fetch: stub.fetch,
        setTimeout,
        clearTimeout,
        Promise,
        setInterval: (fn, ms) => {
          const id = nextId++;
          intervals.push({ id, fn, ms, cleared: false });
          return id;
        },
        clearInterval: (id) => {
          const it = intervals.find((x) => x.id === id);
          if (it) it.cleared = true;
        }
      }
    }
  );

  assert.equal(stub.calls.length, 0, "closed branch issued no request");
  assert.equal(intervals.length, 0, "closed branch started no timer");

  h.sandbox.wd.state.open = true;
  h.sandbox.wd.render();
  await settle();

  assert.equal(stub.count("/api/feed"), 1, ":fetch ran once the branch opened");
  assert.deepEqual(h.sandbox.wd.state.feed, [{ id: 1 }]);
  assert.equal(intervals.length, 1, ":every registered its timer");
  assert.equal(intervals[0].ms, 500);

  // The timer ticks, and the :effect watching `n` sees the change.
  intervals[0].fn();
  assert.equal(h.sandbox.wd.state.n, 1);
  h.sandbox.wd.render();
  assert.equal(h.sandbox.wd.state.hit, 1, ":effect in the opened branch fired");
});

test("a directive is claimed once, so re-opening a branch does not double-register", async () => {
  const stub = makeFetchStub({ "/api/feed": { status: 200, body: [1] } });
  const h = makeSandbox(
    (root, El) => {
      seedState(El, root, { open: true });
      const fetchNode = el(El, "span", {
        "data-wd-fetch": "",
        "data-wd-fetch-key": "feed",
        "data-wd-fetch-url": "/api/feed"
      });
      const built = ifRegion(El, { key: "open", active: "true", truthy: [fetchNode], initial: "" });
      // The compile-time paint already has the branch open, so the node is live
      // from the first scan; flipping away and back injects a NEW node, which is
      // a new registration, not a duplicate of the old one.
      built.out.appendChild(fetchNode.cloneNode(true));
      root.appendChild(built.node);
    },
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );
  await settle();
  const afterBoot = stub.count("/api/feed");
  assert.equal(afterBoot, 1, "one live fetch node, one request");

  // Several renders with no structural change must not re-run it.
  h.sandbox.wd.render();
  h.sandbox.wd.render();
  await settle();
  assert.equal(stub.count("/api/feed"), afterBoot, "re-renders do not re-fire a claimed :fetch");
});

// --- R2: a nested @loop revealed by a per-row :if --------------------------

function teamsFixture(root, El, { open }) {
  const innerProto = el(El, "b", { "data-wd-each": "", "data-wd-path": "who" });
  const inner = loopShell(El, { item: "members", proto: innerProto });
  // The compiler paints the inner rows into the branch template, so on the
  // reveal render they are LIVE nodes the outer row's passes can reach.
  for (const [key, who] of [
    ["m1", "Ann"],
    ["m2", "Amy"]
  ]) {
    inner.out.appendChild(
      el(El, "b", { "data-wd-each": "", "data-wd-path": "who", "data-wd-loop-key": key }, who)
    );
  }
  const cond = eachIfRegion(El, { path: "open", truthy: [inner.region], falsy: [] });
  const proto = el(El, "li");
  proto.appendChild(el(El, "span", { "data-wd-each": "", "data-wd-path": "name" }));
  proto.appendChild(cond.region);
  const outer = loopShell(El, { key: "teams", proto });
  seedState(El, root, {
    teams: [
      {
        id: "t1",
        name: "TEAM A",
        open,
        members: [
          { id: "m1", who: "Ann" },
          { id: "m2", who: "Amy" }
        ]
      }
    ]
  });
  root.appendChild(outer.region);
  return outer.out;
}

test("a nested @loop revealed by a per-row :if renders the INNER rows, not the outer value", () => {
  let out;
  const h = makeSandbox((root, El) => {
    out = teamsFixture(root, El, { open: false });
  });
  assert.equal(out.children.length, 1);
  assert.equal(out.children[0].querySelector("[data-wd-loop-item]"), null, "branch is closed");

  h.sandbox.wd.state.teams[0].open = true;
  h.sandbox.wd.render();

  const innerRows = out.children[0].querySelector("[data-wd-loop-out]").children;
  assert.deepEqual(
    innerRows.map((n) => n.textContent),
    ["Ann", "Amy"],
    "inner rows keep their own values on the very render that revealed them"
  );
});

test("a nested @loop revealed by a per-row :if reconciles on the SAME render", () => {
  let out;
  const h = makeSandbox((root, El) => {
    out = teamsFixture(root, El, { open: false });
  });
  h.sandbox.wd.state.teams[0].open = true;
  h.sandbox.wd.state.teams[0].members = [{ id: "m3", who: "Zed" }];
  h.sandbox.wd.render();
  const innerOut = out.children[0].querySelector("[data-wd-loop-out]");
  assert.deepEqual(
    innerOut.children.map((n) => n.textContent),
    ["Zed"],
    "the revealed inner loop reconciled against current state, not the baked paint"
  );
});

// --- R3 / R4: global :if and .class when on a row the reconcile just cloned -

function badgeRowFixture(root, El, items) {
  const cond = ifRegion(El, {
    key: "open",
    active: "false",
    truthy: [el(El, "b", {}, "OPEN")],
    falsy: [el(El, "i", {}, "SHUT")],
    initial: "SHUT"
  });
  const proto = el(El, "li");
  proto.appendChild(el(El, "span", { "data-wd-each": "", "data-wd-path": "name" }));
  proto.appendChild(cond.node);
  proto.appendChild(
    el(El, "em", {
      "data-wd-class": JSON.stringify([["hot", JSON.parse(ast('(S("temp") > 30)'))]])
    })
  );
  const loop = loopShell(El, { key: "items", proto });
  seedState(El, root, { open: true, temp: 40, items });
  root.appendChild(loop.region);
  return loop.out;
}

test("a global :if inside a loop row is resolved on a row the reconcile just cloned", () => {
  let out;
  const h = makeSandbox((root, El) => {
    out = badgeRowFixture(root, El, [{ id: "one", name: "one" }]);
  });
  const branchText = (row) => row.querySelector("[data-wd-if-out]").textContent;
  assert.equal(branchText(out.children[0]), "OPEN", "the first cloned row is corrected too");

  h.sandbox.wd.state.items = [
    { id: "one", name: "one" },
    { id: "two", name: "two" }
  ];
  h.sandbox.wd.render();
  assert.equal(out.children.length, 2);
  assert.equal(
    branchText(out.children[1]),
    "OPEN",
    "a NEW row must not keep the compile-time branch baked into its template"
  );
  assert.equal(
    out.children[1].querySelector("[data-wd-if]").getAttribute("data-wd-if-active"),
    "true"
  );
});

test("a `.class when` inside a loop row is applied to a row the reconcile just cloned", () => {
  let out;
  const h = makeSandbox((root, El) => {
    out = badgeRowFixture(root, El, [{ id: "one", name: "one" }]);
  });
  const hot = (row) => row.querySelector("[data-wd-class]").classList.contains("hot");
  assert.equal(hot(out.children[0]), true);

  h.sandbox.wd.state.items = [
    { id: "one", name: "one" },
    { id: "two", name: "two" }
  ];
  h.sandbox.wd.render();
  assert.equal(hot(out.children[1]), true, "a NEW row missed the class pass and stayed unstyled");

  // And it still tracks state afterwards, in both directions.
  h.sandbox.wd.state.temp = 5;
  h.sandbox.wd.render();
  assert.deepEqual(out.children.map(hot), [false, false]);
});

// --- R9: a per-row :if must not re-inject an unchanged branch ---------------

test("a per-row :if leaves an unchanged branch alone across renders", () => {
  let out;
  const h = makeSandbox((root, El) => {
    const cond = eachIfRegion(El, {
      path: "open",
      truthy: [el(El, "b", {}, "YES")],
      falsy: [el(El, "i", {}, "NO")]
    });
    const proto = el(El, "li");
    proto.appendChild(cond.region);
    const loop = loopShell(El, { key: "items", proto });
    seedState(El, root, { tick: 0, items: [{ id: "a", open: true }] });
    root.appendChild(loop.region);
    out = loop.out;
  });
  const branchOut = () => out.children[0].querySelector("[data-wd-each-if-out]");
  const injected = branchOut().children[0];
  assert.equal(injected.textContent, "YES");

  h.sandbox.wd.state.tick = 1;
  h.sandbox.wd.render();
  h.sandbox.wd.render();
  assert.strictEqual(branchOut().children[0], injected, "unchanged per-row branch was re-injected");

  // A real flip still swaps.
  h.sandbox.wd.state.items = [{ id: "a", open: false }];
  h.sandbox.wd.render();
  assert.equal(branchOut().children[0].textContent, "NO");
});

// --- R5: no DOM churn for rows that are already in place -------------------

function countAppends(out) {
  const real = out.appendChild.bind(out);
  const seen = { n: 0 };
  out.appendChild = (node) => {
    seen.n++;
    return real(node);
  };
  return seen;
}

test("a render that does not change the list performs ZERO row moves", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, {
      initial: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
        { id: "c", name: "Gamma" }
      ]
    }));
  });
  const appends = countAppends(out);

  // Any state change anywhere on the page used to detach and re-insert EVERY
  // row (appendChild is a remove-then-insert), blurring the focused field and
  // resetting scroll.
  h.sandbox.wd.state.unrelated = 1;
  h.sandbox.wd.render();
  h.sandbox.wd.render();
  assert.equal(appends.n, 0, "unchanged rows were detached and re-inserted");
});

test("appending an item moves only the new row", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, {
      initial: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" }
      ]
    }));
  });
  const appends = countAppends(out);
  h.sandbox.wd.state.items = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" }
  ];
  h.sandbox.wd.render();
  assert.equal(appends.n, 1, "only the appended row should move");
  assert.deepEqual(rowKeys(out), ["a", "b", "c"]);
});

test("a reorder still lands every row in the right final order", () => {
  // The prefix-stable skip must never trade correctness for fewer moves.
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, {
      initial: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
        { id: "d", name: "D" }
      ]
    }));
  });
  const before = Object.fromEntries(
    out.children.map((n) => [n.getAttribute("data-wd-loop-key"), n])
  );
  for (const order of [
    ["b", "c", "a", "d"],
    ["d", "c", "b", "a"],
    ["a", "d", "b", "c"],
    ["c", "a", "d", "b"]
  ]) {
    h.sandbox.wd.state.items = order.map((id) => ({ id, name: id.toUpperCase() }));
    h.sandbox.wd.render();
    assert.deepEqual(rowKeys(out), order, `order ${order.join(",")}`);
    for (const id of order) {
      assert.strictEqual(before[id], out.children[order.indexOf(id)], `node ${id} reused`);
    }
  }
});

// --- R6 / R13: persistence must never take the page down -------------------

const throwingStorage = () => ({
  getItem() {
    throw new Error("storage blocked");
  },
  setItem() {
    throw new Error("storage blocked");
  },
  removeItem() {
    throw new Error("storage blocked");
  }
});

test("the runtime boots with localStorage completely blocked", () => {
  let span;
  const h = makeSandbox(
    (root, El) => {
      seedState(El, root, { count: 2 }, "count");
      span = el(El, "span", { "data-wd-bind": "count" });
      root.appendChild(span);
    },
    { globals: { localStorage: throwingStorage() } }
  );
  assert.ok(h.sandbox.wd, "window.wd must exist even when storage is unavailable");
  assert.equal(h.sandbox.wd.state.count, 2, "declared seed survives");
  assert.equal(span.textContent, "2", "the page rendered");
});

test("a storage write failure inside a click never stops the render", () => {
  let span;
  let button;
  const h = makeSandbox(
    (root, El) => {
      seedState(El, root, { count: 0 }, "count");
      span = el(El, "span", { "data-wd-bind": "count" });
      button = el(El, "button", { "data-wd-action": "inc", "data-wd-target": "count" });
      root.appendChild(span);
      root.appendChild(button);
    },
    { globals: { localStorage: throwingStorage() } }
  );
  h.fire("click", button);
  h.sandbox.wd.render();
  assert.equal(h.sandbox.wd.state.count, 1, "state advanced");
  assert.equal(span.textContent, "1", "and the DOM followed — no silent freeze");
});

test("a corrupt :store value self-heals instead of being kept forever", () => {
  let span;
  const h = makeSandbox(
    (root, El) => {
      const s = el(El, "script", { "data-wd-store": "cart" });
      s.textContent = JSON.stringify(["seed"]);
      root.appendChild(s);
      span = el(El, "span", { "data-wd-bind": "cart" });
      root.appendChild(span);
    },
    { initialStore: { "wd:store:cart": "{not json" } }
  );
  assert.deepEqual(h.sandbox.wd.state.cart, ["seed"], "seed kept");
  assert.equal(
    h.store.has("wd:store:cart"),
    false,
    "the unparseable entry must be dropped, exactly as :persist drops one"
  );
});

// --- R7 / R11: refetch debounce must not lose a pending node ---------------

function fakeTimers() {
  const timers = [];
  let nextId = 1;
  return {
    timers,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      const t = timers.find((x) => x.id === id);
      if (t) t.cleared = true;
    },
    runPending() {
      for (const t of timers) {
        if (!t.cleared && !t.ran) {
          t.ran = true;
          t.fn();
        }
      }
    }
  };
}

function depFetchNode(El, root, { key, url, deps }) {
  const span = el(El, "span", {
    "data-wd-fetch": "",
    "data-wd-fetch-key": key,
    "data-wd-fetch-url": url,
    "data-wd-fetch-deps": deps
  });
  root.appendChild(span);
  return span;
}

test("two dep changes inside one debounce window refetch BOTH nodes", async () => {
  const stub = makeFetchStub({
    "/a?q=1": { status: 200, body: "a1" },
    "/a?q=2": { status: 200, body: "a2" },
    "/b?r=1": { status: 200, body: "b1" },
    "/b?r=2": { status: 200, body: "b2" }
  });
  const clock = fakeTimers();
  const h = makeSandbox(
    (root, El) => {
      seedState(El, root, { q: 1, r: 1 });
      depFetchNode(El, root, { key: "a", url: "/a?q={q}", deps: "q" });
      depFetchNode(El, root, { key: "b", url: "/b?r={r}", deps: "r" });
    },
    {
      globals: {
        fetch: stub.fetch,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        Promise
      }
    }
  );
  await settle();
  assert.equal(stub.count("/a?q=1"), 1);
  assert.equal(stub.count("/b?r=1"), 1);

  // Two mutations in quick succession: the second RESTARTS the debounce. The
  // first node's snapshot has already advanced, so dropping it here would lose
  // its refetch permanently rather than merely delaying it.
  h.sandbox.wd.set("q", 2);
  h.sandbox.wd.set("r", 2);
  clock.runPending();
  await settle();

  assert.equal(stub.count("/a?q=2"), 1, "the node queued by the FIRST mutation still refetched");
  assert.equal(stub.count("/b?r=2"), 1, "the node queued by the second refetched");
});

test("wd.set triggers a dependent refetch, like the click and input handlers do", async () => {
  const stub = makeFetchStub({
    "/a?q=1": { status: 200, body: "one" },
    "/a?q=9": { status: 200, body: "nine" }
  });
  const clock = fakeTimers();
  const h = makeSandbox(
    (root, El) => {
      seedState(El, root, { q: 1 });
      depFetchNode(El, root, { key: "a", url: "/a?q={q}", deps: "q" });
    },
    {
      globals: {
        fetch: stub.fetch,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        Promise
      }
    }
  );
  await settle();

  // `wd.set` is the documented escape hatch colocated .js behaviors write
  // through (src/behaviors/sortable.js uses nothing else).
  h.sandbox.wd.set("q", 9);
  clock.runPending();
  await settle();
  assert.equal(stub.count("/a?q=9"), 1, "wd.set must be able to trigger a refetch");
  assert.equal(h.sandbox.wd.state.a, "nine");
});

// --- R8: :form needs the same in-flight guard :fetch already has -----------

function deferredFetch() {
  const pending = [];
  const fetch = (url, init) =>
    new Promise((resolve) => {
      pending.push({
        url,
        init,
        reply(status, body) {
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: () => Promise.resolve(JSON.stringify(body))
          });
        }
      });
    });
  return { fetch, pending };
}

test("a slow earlier :form submit cannot overwrite a newer reply", async () => {
  const net = deferredFetch();
  let form;
  const h = makeSandbox(
    (root, El) => {
      form = formRegion(root, El, {
        key: "contact",
        action: "/api/contact",
        build: (f, E) => textInput(f, E, "name", "x")
      });
    },
    { globals: { fetch: net.fetch, setTimeout, clearTimeout, Promise } }
  );

  h.fire("submit", form);
  h.fire("submit", form);
  assert.equal(net.pending.length, 2, "both submits went out");

  // The NEWER request answers first, then the stale one lands late.
  net.pending[1].reply(200, { ok: "second" });
  await settle();
  net.pending[0].reply(200, { ok: "first" });
  await settle();

  assert.deepEqual(
    h.sandbox.wd.state.contact,
    { ok: "second" },
    "the superseded submit wrote over the newer reply"
  );
});

test("a new :form submit clears the previous attempt's error immediately", async () => {
  const net = deferredFetch();
  let form;
  let errSpan;
  const h = makeSandbox(
    (root, El) => {
      form = formRegion(root, El, {
        key: "contact",
        action: "/api/contact",
        build: (f, E) => textInput(f, E, "name", "x")
      });
      errSpan = el(El, "span", { "data-wd-bind": "contact_error" });
      form.parent.appendChild(errSpan);
    },
    { globals: { fetch: net.fetch, setTimeout, clearTimeout, Promise } }
  );

  h.fire("submit", form);
  net.pending[0].reply(500, { bad: true });
  await settle();
  assert.match(String(h.sandbox.wd.state.contact_error), /HTTP 500/);
  h.sandbox.wd.render();
  assert.match(errSpan.textContent, /HTTP 500/, "the error is on screen");

  // Retrying must not leave the previous failure visible while it is in flight.
  h.fire("submit", form);
  assert.equal(h.sandbox.wd.state.contact_error, null, "stale error cleared on the new submit");
  await settle(1); // the submit handler renders through the normal batched path
  assert.equal(errSpan.textContent, "", "and cleared on screen too");
});

// --- R10: duplicate keys ---------------------------------------------------

test("duplicate rows render as distinct nodes and the list does not grow", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = loopRegion(root, El, {
      initial: [
        { id: "a", name: "one" },
        { id: "a", name: "two" },
        { id: "a#1", name: "literal" },
        { id: "a", name: "three" }
      ]
    }));
  });
  assert.deepEqual(rowKeys(out), ["a", "a#1", "a##1", "a#2"]);
  assert.deepEqual(rowText(out), ["one", "two", "literal", "three"]);
  assert.equal(new Set(out.children).size, 4, "four distinct nodes");

  const snapshot = out.children.slice();
  for (let i = 0; i < 5; i++) h.sandbox.wd.render();
  assert.equal(out.children.length, 4, "the list must not grow on repeated renders");
  assert.deepEqual(out.children, snapshot, "and every node is reused");
  assert.deepEqual(rowText(out), ["one", "two", "literal", "three"]);
});

// --- R12: :effect / :every action values must be cloned per fire -----------

test(":every append pushes a DISTINCT object on every tick", () => {
  const intervals = [];
  let nextId = 1;
  const h = makeSandbox(
    (root, El) => {
      seedState(El, root, { log: [] });
      const every = el(El, "script", { "data-wd-every": "" });
      every.textContent = JSON.stringify({
        ms: 100,
        actions: [{ op: "append", target: "log", value: { at: 1 } }]
      });
      root.appendChild(every);
    },
    {
      globals: {
        setInterval: (fn, ms) => {
          const id = nextId++;
          intervals.push({ id, fn, ms });
          return id;
        },
        clearInterval: () => {}
      }
    }
  );
  intervals[0].fn();
  intervals[0].fn();
  const log = h.sandbox.wd.state.log;
  assert.equal(log.length, 2);
  assert.notStrictEqual(log[0], log[1], "both ticks pushed the SAME object reference");
  // The consequence that matters: `remove` filters by identity, so a shared
  // reference means deleting one line deletes them all.
  log[0].at = 99;
  assert.equal(log[1].at, 1, "mutating one entry must not change the other");
});

test(":effect append pushes a DISTINCT object on every fire", () => {
  const h = makeSandbox((root, El) => {
    seedState(El, root, { n: 0, log: [] });
    const fx = el(El, "script", { "data-wd-effect": "" });
    fx.textContent = JSON.stringify({
      watch: "n",
      actions: [{ op: "append", target: "log", value: { at: 1 } }]
    });
    root.appendChild(fx);
  });
  h.sandbox.wd.state.n = 1;
  h.sandbox.wd.render();
  h.sandbox.wd.state.n = 2;
  h.sandbox.wd.render();
  const log = h.sandbox.wd.state.log;
  assert.equal(log.length, 2);
  assert.notStrictEqual(log[0], log[1]);
});

// --- R14 + sort behavior ---------------------------------------------------

function sortLoop(root, El, { items, sort, dir }) {
  const proto = el(El, "li", { "data-wd-each": "", "data-wd-path": "name" });
  const clauses = { "data-wd-loop-sort": sort };
  if (dir) clauses["data-wd-loop-sort-dir"] = dir;
  const loop = loopShell(El, { key: "items", proto, clauses });
  seedState(El, root, { items });
  root.appendChild(loop.region);
  return loop.out;
}

test("numeric sort compares NUMBERS, not their string forms", () => {
  let out;
  makeSandbox((root, El) => {
    out = sortLoop(root, El, {
      sort: "n",
      items: [
        { id: "c", n: 100, name: "hundred" },
        { id: "a", n: 9, name: "nine" },
        { id: "b", n: 10, name: "ten" }
      ]
    });
  });
  // A localeCompare fallback would order these 10, 100, 9.
  assert.deepEqual(rowText(out), ["nine", "ten", "hundred"]);
});

test("sort is STABLE for tied keys, ascending and descending alike", () => {
  const items = [
    { id: "a", n: 1, name: "a" },
    { id: "b", n: 1, name: "b" },
    { id: "c", n: 0, name: "c" },
    { id: "d", n: 1, name: "d" },
    { id: "e", n: 0, name: "e" }
  ];
  let asc;
  makeSandbox((root, El) => {
    asc = sortLoop(root, El, { sort: "n", items });
  });
  assert.deepEqual(rowText(asc), ["c", "e", "a", "b", "d"], "ties keep source order ascending");

  let desc;
  makeSandbox((root, El) => {
    desc = sortLoop(root, El, { sort: "n", dir: "desc", items });
  });
  // The tiebreaker must NOT be negated along with the comparator: descending by
  // key, but ties still in source order.
  assert.deepEqual(rowText(desc), ["a", "b", "d", "c", "e"], "ties keep source order descending");
});

// --- @loop where at runtime ------------------------------------------------

test("@loop where filters at runtime and re-filters when state changes", () => {
  let out;
  const h = makeSandbox((root, El) => {
    const proto = el(El, "li", { "data-wd-each": "", "data-wd-path": "name" });
    const loop = loopShell(El, {
      key: "items",
      proto,
      clauses: { "data-wd-loop-where": ast('(I("price") <= S("limit"))') }
    });
    seedState(El, root, {
      limit: 10,
      items: [
        { id: "a", price: 5, name: "cheap" },
        { id: "b", price: 50, name: "dear" },
        { id: "c", price: 10, name: "edge" }
      ]
    });
    root.appendChild(loop.region);
    out = loop.out;
  });
  assert.deepEqual(rowText(out), ["cheap", "edge"], "where applied on the first render");

  h.sandbox.wd.state.limit = 100;
  h.sandbox.wd.render();
  assert.deepEqual(rowText(out), ["cheap", "dear", "edge"], "predicate re-read from state");

  h.sandbox.wd.state.limit = 4;
  h.sandbox.wd.render();
  assert.deepEqual(rowText(out), [], "and back down to nothing");
});

// --- $last on a reactive re-render -----------------------------------------

test("$last moves to the new final row when the list grows", () => {
  let out;
  const h = makeSandbox((root, El) => {
    const proto = el(El, "li");
    proto.appendChild(el(El, "span", { "data-wd-each-meta": "last" }));
    const loop = loopShell(El, { key: "items", proto });
    seedState(El, root, { items: [{ id: "a" }, { id: "b" }] });
    root.appendChild(loop.region);
    out = loop.out;
  });
  const lasts = () =>
    out.children.map((row) => row.querySelector("[data-wd-each-meta]").textContent);
  assert.deepEqual(lasts(), ["false", "true"]);

  h.sandbox.wd.state.items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  h.sandbox.wd.render();
  assert.deepEqual(lasts(), ["false", "false", "true"], "the old last row must stop being last");

  h.sandbox.wd.state.items = [{ id: "a" }];
  h.sandbox.wd.render();
  assert.deepEqual(lasts(), ["true"]);
});

// --- setPath prototype guard on the FINAL segment --------------------------

test("setPath refuses __proto__ / constructor / prototype as the FINAL segment", () => {
  let button;
  const h = makeSandbox((root, El) => {
    seedState(El, root, { cfg: {} });
    button = el(El, "button", { "data-wd-actions": "[]" });
    root.appendChild(button);
  });

  // Only the middle-segment shape was covered before; a bare final segment is
  // the shape `Object.assign`-style pollution actually uses.
  for (const target of ["__proto__", "constructor", "prototype", "cfg.__proto__"]) {
    button.setAttribute(
      "data-wd-actions",
      JSON.stringify([{ op: "set", target, value: { polluted: true } }])
    );
    h.fire("click", button);
  }
  h.sandbox.wd.render();

  assert.equal({}.polluted, undefined, "Object.prototype must not be polluted");
  assert.equal(h.sandbox.wd.state.polluted, undefined, "no key leaked through the prototype");
  assert.deepEqual(h.sandbox.wd.state.cfg, {}, "nested final segment rejected too");
  assert.equal(Object.hasOwn(h.sandbox.wd.state, "__proto__"), false);
});

// --- :fetch request shape ---------------------------------------------------

test("a GET :fetch sends no request body, even with a body key configured", async () => {
  const stub = makeFetchStub({ "/api/thing": { status: 200, body: { ok: 1 } } });
  makeSandbox(
    (root, El) => {
      seedState(El, root, { payload: { a: 1 } });
      root.appendChild(
        el(El, "span", {
          "data-wd-fetch": "",
          "data-wd-fetch-key": "thing",
          "data-wd-fetch-url": "/api/thing",
          "data-wd-fetch-body": "payload"
        })
      );
    },
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );
  await settle();
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].init.method, "GET");
  assert.equal("body" in stub.calls[0].init, false, "a GET with a body is a protocol error");
});

test("a POST :fetch does send the configured body", async () => {
  const stub = makeFetchStub({ "/api/thing": { status: 200, body: { ok: 1 } } });
  makeSandbox(
    (root, El) => {
      seedState(El, root, { payload: { a: 1 } });
      root.appendChild(
        el(El, "span", {
          "data-wd-fetch": "",
          "data-wd-fetch-key": "thing",
          "data-wd-fetch-url": "/api/thing",
          "data-wd-fetch-method": "POST",
          "data-wd-fetch-body": "payload"
        })
      );
    },
    { globals: { fetch: stub.fetch, setTimeout, clearTimeout, Promise } }
  );
  await settle();
  assert.equal(stub.calls[0].init.body, JSON.stringify({ a: 1 }));
});

test("the :fetch abort timer is cleared once the request settles", async () => {
  const stub = makeFetchStub({ "/api/thing": { status: 200, body: { ok: 1 } } });
  const cleared = [];
  let nextId = 1;
  const live = new Set();
  makeSandbox(
    (root, El) => {
      root.appendChild(
        el(El, "span", {
          "data-wd-fetch": "",
          "data-wd-fetch-key": "thing",
          "data-wd-fetch-url": "/api/thing",
          "data-wd-fetch-timeout": "5000"
        })
      );
    },
    {
      globals: {
        fetch: stub.fetch,
        Promise,
        AbortController: class {
          constructor() {
            this.signal = { aborted: false };
          }
          abort() {
            this.signal.aborted = true;
            throw new Error("the abort timer fired on a request that had already settled");
          }
        },
        setTimeout: (fn, ms) => {
          const id = nextId++;
          live.add(id);
          // Only the abort timer is long; settle() needs the real one.
          if (ms >= 1000) return id;
          return setTimeout(fn, ms);
        },
        clearTimeout: (id) => {
          cleared.push(id);
          live.delete(id);
          clearTimeout(id);
        }
      }
    }
  );
  await settle();
  assert.equal(stub.calls.length, 1);
  assert.ok(cleared.length >= 1, "the abort timer must be cleared on success");
  assert.equal(live.size, 0, "no abort timer left armed after the response landed");
});
