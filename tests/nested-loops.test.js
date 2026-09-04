import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { compilePage } from "../src/compiler.js";

// ---------------------------------------------------------------------------
// TASK-1A — nested REACTIVE loops (one level).
//
// A reactive @loop (source is :state/:store/:fetch) may contain an inner
// reactive @loop over a field of the outer row. The compiler emits an
// item-relative region (data-wd-loop-item="<path>"); the runtime fills it inside
// fillItem against the enclosing row, reusing the same reconcile path.
//
// Compiler assertions run directly. Runtime assertions reuse the node:vm + DOM
// stub harness pattern from tests/runtime-dom.test.js (the project keeps zero
// devDependencies, so no jsdom). The stub here additionally clones <template>
// content on cloneNode and implements closest — both faithful to real DOM and
// exercised only by the nested-loop path.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeSource = fs.readFileSync(path.join(here, "..", "src", "runtime.js"), "utf8");

// --- Compiler fixtures -----------------------------------------------------

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wd-nested-"));
}
function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
const createPaths = (root) => ({
  root,
  pages: path.join(root, "site/pages"),
  shared: path.join(root, "site/_"),
  site: path.join(root, "site"),
  dist: path.join(root, "dist"),
  skins: path.join(root, "site/skins")
});

const GROUPS =
  '[{"id":1,"name":"A","items":[{"id":11,"label":"x"},{"id":12,"label":"y"}]},{"id":2,"name":"B","items":[{"id":21,"label":"z"}]}]';

function compileNested(body) {
  const root = fixture();
  write(root, "site/pages/index.wd", body);
  const page = compilePage(path.join(root, "site/pages/index.wd"), createPaths(root));
  fs.rmSync(root, { recursive: true, force: true });
  return page;
}

test("compiler emits an item-relative region for a nested reactive loop", () => {
  const page = compileNested(
    [
      `:state groups = ${GROUPS}`,
      "@loop groups into g",
      "**{ g.name }**",
      "@loop g.items into it",
      "- { it.label }",
      "@endloop",
      "@endloop"
    ].join("\n")
  );

  assert.equal(page.assets.runtime, true, "a reactive nested loop pulls in the runtime");
  // Outer region is a normal global loop keyed on `groups`.
  assert.match(page.html, /data-wd-loop="groups"/);
  // Inner region uses the distinct item-relative marker carrying the relative path.
  assert.match(page.html, /data-wd-loop-item="items"/);
  // The inner region keeps its own pristine row template (binds the inner item).
  assert.match(
    page.html,
    /data-wd-loop-item="items"><template data-wd-loop-template><li><span data-wd-each data-wd-path="label"><\/span><\/li><\/template>/
  );
  // Inner output starts empty (the runtime fills it on first render).
  assert.match(page.html, /<ul data-wd-loop-out><\/ul><\/div>/);
  // The inner `it.label` markers are NOT clobbered by the outer initial paint.
  assert.ok(
    !/data-wd-path="label">x</.test(page.html),
    "inner template stays unfilled at build time"
  );
});

test("compiler keeps the inner region out of the global [data-wd-loop] pass", () => {
  const page = compileNested(
    [
      `:state groups = ${GROUPS}`,
      "@loop groups into g",
      "@loop g.items into it",
      "- { it.label }",
      "@endloop",
      "@endloop"
    ].join("\n")
  );
  // Exactly one global data-wd-loop="..." region (the outer one); the inner one
  // is data-wd-loop-item, so the runtime's document-wide loop query skips it.
  const globalLoops = (page.html.match(/data-wd-loop="/g) || []).length;
  assert.equal(globalLoops, 1, "only the outer loop is a global region");
  assert.match(page.html, /data-wd-loop-item="items"/);
});

test("compiler carries the inner loop's where clause onto the item-relative region", () => {
  const page = compileNested(
    [
      `:state groups = ${GROUPS}`,
      "@loop groups into g",
      '@loop g.items into it where it.label != "y"',
      "- { it.label }",
      "@endloop",
      "@endloop"
    ].join("\n")
  );
  assert.match(page.html, /data-wd-loop-item="items"[^>]*data-wd-loop-where=/);
});

test("compiler rejects a prototype-pollution segment in a nested loop source", () => {
  assert.throws(
    () =>
      compileNested(
        [
          `:state groups = ${GROUPS}`,
          "@loop groups into g",
          "@loop g.constructor into it",
          "- { it.label }",
          "@endloop",
          "@endloop"
        ].join("\n")
      ),
    /not allowed/
  );
});

// --- Runtime DOM stub ------------------------------------------------------

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
    // Real DOM deep-clones <template> content too; the nested-loop path relies on
    // an inner row template surviving a clone of its enclosing outer row.
    if (this.content)
      for (const child of this.content.children) copy.content.appendChild(child.cloneNode(true));
    return copy;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get textContent() {
    return this._text;
  }
  set textContent(v) {
    this._text = v == null ? "" : String(v);
    this.children = [];
  }
  get innerHTML() {
    return "";
  }
  set innerHTML(v) {
    if (!v) this.children = [];
  }
  matches(selector) {
    // Comma-separated multi-selectors, like the real DOM: the runtime uses them
    // (the seed-script hydrate, the scan claim), and a stub that quietly matched
    // nothing would make the whole boot silently do nothing.
    return selector.split(",").some((s) => matchSelector(this, s.trim()));
  }
  closest(selector) {
    for (let n = this; n; n = n.parent) if (n.matches && n.matches(selector)) return n;
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
}

class Fragment extends El {
  constructor() {
    super("#fragment");
  }
}

function walk(node, fn) {
  for (const child of node.children) {
    fn(child);
    if (child.tagName !== "TEMPLATE") walk(child, fn);
  }
}

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

function makeSandbox(rootBuilder) {
  const root = new El("body");
  rootBuilder(root, El);

  const listeners = {};
  const document = {
    activeElement: null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    addEventListener: (type, fn) => {
      (listeners[type] ||= []).push(fn);
    }
  };
  const store = new Map();
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
    queueMicrotask
  };
  sandbox.addEventListener = (type, fn) => {
    (listeners[type] ||= []).push(fn);
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(runtimeSource, sandbox);
  return { root, sandbox };
}

// Build the nested loop region the compiler emits for:
//   @loop groups into g  /  **{ g.name }**  /  @loop g.items into it  / - { it.label }
// Outer rows hold a name bind + an inner data-wd-loop-item="items" region whose
// own template binds `label`. The inner out starts empty (runtime fills it).
function nestedRegion(root, El, groups) {
  const script = new El("script");
  script.setAttribute("data-wd-state", "");
  script.textContent = JSON.stringify({ groups });
  root.appendChild(script);

  const region = new El("div");
  region.setAttribute("data-wd-loop", "groups");

  // Outer row template proto.
  const outerTpl = new El("template");
  outerTpl.setAttribute("data-wd-loop-template", "");
  const outerProto = new El("div");
  outerProto.setAttribute("data-wd-loop-piece", "");
  const name = new El("strong");
  name.setAttribute("data-wd-each", "");
  name.setAttribute("data-wd-path", "name");
  outerProto.appendChild(name);

  // Inner item-relative region (pristine; out empty).
  const inner = new El("div");
  inner.setAttribute("data-wd-loop-item", "items");
  const innerTpl = new El("template");
  innerTpl.setAttribute("data-wd-loop-template", "");
  const innerProto = new El("li");
  innerProto.setAttribute("data-wd-each", "");
  innerProto.setAttribute("data-wd-path", "label");
  innerTpl.content.appendChild(innerProto);
  inner.appendChild(innerTpl);
  const innerOut = new El("ul");
  innerOut.setAttribute("data-wd-loop-out", "");
  inner.appendChild(innerOut);
  outerProto.appendChild(inner);

  outerTpl.content.appendChild(outerProto);
  region.appendChild(outerTpl);

  const out = new El("div");
  out.setAttribute("data-wd-loop-out", "");
  region.appendChild(out);

  root.appendChild(region);
  return { region, out };
}

// Read the inner loop's rendered labels for the outer row at `index`.
function innerLabels(outerRow) {
  const innerOut = outerRow
    .querySelector("[data-wd-loop-item]")
    .querySelector("[data-wd-loop-out]");
  return innerOut.children.map((li) => li.textContent);
}

test("runtime renders inner reactive loop rows from the outer item", () => {
  let out;
  makeSandbox((root, El) => {
    ({ out } = nestedRegion(root, El, [
      {
        id: 1,
        name: "A",
        items: [
          { id: 11, label: "x" },
          { id: 12, label: "y" }
        ]
      },
      { id: 2, name: "B", items: [{ id: 21, label: "z" }] }
    ]));
  });

  assert.equal(out.children.length, 2, "two outer rows");
  assert.equal(out.children[0].querySelector("[data-wd-each]").textContent, "A");
  assert.equal(out.children[1].querySelector("[data-wd-each]").textContent, "B");
  assert.deepEqual(
    innerLabels(out.children[0]),
    ["x", "y"],
    "inner rows come from the first outer item"
  );
  assert.deepEqual(
    innerLabels(out.children[1]),
    ["z"],
    "inner rows come from the second outer item"
  );
});

test("runtime reconciles inner rows when inner state changes (and reuses outer rows)", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = nestedRegion(root, El, [{ id: 1, name: "A", items: [{ id: 11, label: "x" }] }]));
  });
  const outerRowBefore = out.children[0];
  const innerOutBefore = outerRowBefore
    .querySelector("[data-wd-loop-item]")
    .querySelector("[data-wd-loop-out]");
  const firstLi = innerOutBefore.children[0];
  assert.deepEqual(innerLabels(out.children[0]), ["x"]);

  // Append an inner item to the existing group.
  h.sandbox.wd.state.groups = [
    {
      id: 1,
      name: "A",
      items: [
        { id: 11, label: "x" },
        { id: 13, label: "w" }
      ]
    }
  ];
  h.sandbox.wd.render();

  assert.strictEqual(out.children[0], outerRowBefore, "outer row reused (keyed reconcile)");
  assert.deepEqual(innerLabels(out.children[0]), ["x", "w"], "inner loop picked up the new item");
  assert.strictEqual(innerOutBefore.children[0], firstLi, "existing inner row reused, not rebuilt");
});

test("runtime reconciles inner loops when outer rows are added or removed", () => {
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = nestedRegion(root, El, [
      { id: 1, name: "A", items: [{ id: 11, label: "x" }] },
      { id: 2, name: "B", items: [{ id: 21, label: "z" }] }
    ]));
  });
  assert.equal(out.children.length, 2);

  // Drop the first group, add a third with two items.
  h.sandbox.wd.state.groups = [
    {
      id: 2,
      name: "B",
      items: [
        { id: 21, label: "z" },
        { id: 22, label: "q" }
      ]
    },
    { id: 3, name: "C", items: [{ id: 31, label: "m" }] }
  ];
  h.sandbox.wd.render();

  assert.equal(out.children.length, 2, "outer count tracks the new list");
  assert.deepEqual(
    out.children.map((r) => r.querySelector("[data-wd-each]").textContent),
    ["B", "C"]
  );
  assert.deepEqual(
    innerLabels(out.children[0]),
    ["z", "q"],
    "reused B row's inner loop re-reconciled"
  );
  assert.deepEqual(innerLabels(out.children[1]), ["m"], "new C row's inner loop rendered");
});

test("runtime does not let the outer pass overwrite inner row text", () => {
  // The outer item has no `label`; if the outer text pass touched inner rows it
  // would blank them. They must keep their own item's label.
  let out;
  const h = makeSandbox((root, El) => {
    ({ out } = nestedRegion(root, El, [
      {
        id: 1,
        name: "A",
        items: [
          { id: 11, label: "x" },
          { id: 12, label: "y" }
        ]
      }
    ]));
  });
  // Force a second render so the outer pass runs with inner rows already live.
  h.sandbox.wd.render();
  assert.deepEqual(
    innerLabels(out.children[0]),
    ["x", "y"],
    "inner labels survive the outer text pass"
  );
});
