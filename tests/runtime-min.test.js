import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buildRuntime, MAP_FILE, MIN_FILE, SOURCE_FILE } from "../scripts/build-runtime.mjs";
import { buildSite } from "../src/builder.js";

// ---------------------------------------------------------------------------
// The shipped runtime is `src/runtime.min.js`: a COMMITTED esbuild artifact built
// from `src/runtime.js` by `scripts/build-runtime.mjs`. `darkmown build` runs on
// a consumer's machine with no bundler installed, so the minified bytes have to
// be generated here, checked in, and copied to `dist/__wd/runtime.js` verbatim.
//
// That arrangement has exactly one failure mode, and it is a silent one: someone
// edits `src/runtime.js`, does not regenerate, and every page keeps running the
// PREVIOUS runtime while the source, the docs and the size budget all describe a
// different one. These tests close it from four sides:
//
//   (a) drift      — the committed bytes must equal a fresh in-memory build
//   (b) emission   — what buildSite writes must equal the committed bytes
//   (c) execution  — the MINIFIED file must actually boot and render
//   (d) sourcemap  — the map must resolve from where the file is served
//
// (c) matters on its own: (a) and (b) would stay green for a minifier that
// produced perfectly consistent, perfectly broken output. Unit tests otherwise
// only ever load `src/runtime.js` (tests/runtime-dom.test.js), so without this
// the first thing to execute the bytes users download would be the e2e job.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const REBUILD = "run `npm run build:runtime` and commit the result";

// --- (a) the committed artifact is not stale -------------------------------

test("the committed runtime.min.js is byte-identical to a fresh build of runtime.js", async () => {
  const fresh = await buildRuntime();
  const committed = fs.readFileSync(MIN_FILE, "utf8");

  assert.equal(
    committed,
    fresh.js,
    `src/runtime.min.js is stale — src/runtime.js has changed since it was generated. ${REBUILD}.`
  );
});

test("the committed sourcemap is byte-identical to a fresh build too", async () => {
  // The map carries `sourcesContent`, i.e. the whole of src/runtime.js. A map
  // that lags the source turns every minified stack trace into a lie about
  // which line failed, which is worse than having no map at all.
  const fresh = await buildRuntime();
  const committed = fs.readFileSync(MAP_FILE, "utf8");

  assert.equal(committed, fresh.map, `src/runtime.min.js.map is stale. ${REBUILD}.`);
});

test("the build is deterministic — the same source builds the same bytes twice", async () => {
  // Determinism is what makes (a) a guard rather than a coin flip: if esbuild
  // varied run to run, the drift test would fail on innocent PRs and everyone
  // would learn to ignore it.
  const [first, second] = [await buildRuntime(), await buildRuntime()];
  assert.equal(first.js, second.js);
  assert.equal(first.map, second.map);
});

// --- (b) the builder emits exactly those bytes -----------------------------

test("buildSite emits /__wd/runtime.js as the committed minified file, with its map", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-runtime-min-"));
  try {
    const page = path.join(root, "site", "pages", "index.wd");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(
      page,
      ["---", "title: Min", "---", "", ':state greeting = "world"', "", "Hello { greeting }"].join(
        "\n"
      )
    );

    buildSite(root);

    const emitted = path.join(root, "dist", "__wd", "runtime.js");
    assert.ok(fs.existsSync(emitted), "a reactive page must emit /__wd/runtime.js");
    assert.equal(
      fs.readFileSync(emitted, "utf8"),
      fs.readFileSync(MIN_FILE, "utf8"),
      "dist/__wd/runtime.js must be src/runtime.min.js byte for byte — pages must not " +
        "receive a differently-derived runtime from the one the size budget measures."
    );

    const emittedMap = `${emitted}.map`;
    assert.ok(fs.existsSync(emittedMap), "the sourcemap must be emitted next to the runtime");
    assert.equal(fs.readFileSync(emittedMap, "utf8"), fs.readFileSync(MAP_FILE, "utf8"));

    // The comment inside the emitted file has to resolve against the emitted
    // map's URL — same directory, `runtime.js.map`, which is the name it was
    // just written under.
    assert.match(fs.readFileSync(emitted, "utf8"), /\n\/\/# sourceMappingURL=runtime\.js\.map\n$/);
    assert.equal(path.basename(emittedMap), "runtime.js.map");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a static page still ships no runtime and no stray sourcemap", () => {
  // Negative control for the emission above: the map must ride WITH the runtime,
  // never on its own. A `/__wd/runtime.js.map` on a zero-JS page would be a
  // 74 KB leak of the framework source onto a page that runs none of it.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wd-runtime-min-static-"));
  try {
    const page = path.join(root, "site", "pages", "index.md");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(page, ["---", "title: Static", "---", "", "Just prose."].join("\n"));

    buildSite(root);

    assert.equal(fs.existsSync(path.join(root, "dist", "__wd", "runtime.js")), false);
    assert.equal(fs.existsSync(path.join(root, "dist", "__wd", "runtime.js.map")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- (d) the sourcemap resolves from where the file is served --------------

test("the minified runtime points at a map that resolves under /__wd/", () => {
  const min = fs.readFileSync(MIN_FILE, "utf8");

  // Served as /__wd/runtime.js, so a RELATIVE `runtime.js.map` resolves to
  // /__wd/runtime.js.map — the name emitRuntime writes it under. The committed
  // file is named `.min.js`; the comment deliberately is not.
  assert.match(min, /\n\/\/# sourceMappingURL=runtime\.js\.map\n$/);
  assert.equal(min.match(/sourceMappingURL/g).length, 1, "exactly one sourcemap comment");
  assert.doesNotMatch(
    min,
    /sourceMappingURL=data:/,
    "the map must stay EXTERNAL — an inline " +
      "data: map would land inside the file the gzip budget measures"
  );

  const map = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  assert.equal(map.version, 3);
  assert.equal(map.file, "runtime.js", "the map names the script as the browser sees it");
  assert.ok(map.mappings.length > 0, "an empty mappings string is a map that maps nothing");

  // The original text travels inside the map, so devtools needs no extra fetch
  // and the browser can show real source for a minified frame.
  assert.equal(map.sourcesContent.length, 1);
  assert.equal(
    map.sourcesContent[0],
    fs.readFileSync(SOURCE_FILE, "utf8"),
    `the embedded source is not the current src/runtime.js. ${REBUILD}.`
  );

  // A source whose URL resolves to the generated script's own URL is ambiguous
  // in devtools — the map must not claim /__wd/runtime.js is its own original.
  assert.equal(map.sources.length, 1);
  assert.doesNotMatch(map.sources[0], /^runtime\.js$/);
});

// --- (c) the minified bytes actually run -----------------------------------
//
// A deliberately small DOM stub: only what the runtime touches on the path
// state → bind → render. tests/runtime-dom.test.js owns the exhaustive DOM
// harness (against the readable source); this one exists to prove the MINIFIED
// bytes boot, resolve state, paint a binding, and expose `window.wd` with its
// public surface intact — i.e. that minification did not rename or drop
// anything the compiler's output or a colocated `.js` behavior depends on.

class StubEl {
  /**
   * @param {string} tag
   * @param {Record<string, string>} [attrs]
   * @param {string} [text]
   */
  constructor(tag, attrs = {}, text = "") {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.textContent = text;
    this.children = [];
  }
  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
  hasAttribute(name) {
    return this.attrs.has(name);
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  removeAttribute(name) {
    this.attrs.delete(name);
  }
  matches(selector) {
    return matchesSelector(this, selector);
  }
  querySelectorAll(selector) {
    return this.children.filter((el) => matchesSelector(el, selector));
  }
}

// `script[data-wd-state]`, `[data-wd-bind]`, `[data-wd-fetch],[data-wd-effect]` —
// an optional tag name plus one or more presence-only attribute clauses, OR'd
// across a comma list. That is the entire selector vocabulary the runtime uses
// for its document-wide queries.
function matchesSelector(el, selector) {
  return selector.split(",").some((group) => {
    const parts = group.trim().match(/^([a-zA-Z][\w-]*)?((?:\[[\w-]+\])*)$/);
    if (!parts) throw new Error(`stub selector not supported: ${group}`);
    const [, tag, attrs] = parts;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    return [...attrs.matchAll(/\[([\w-]+)\]/g)].every(([, name]) => el.hasAttribute(name));
  });
}

/**
 * Boot a runtime source string against a stub document holding `nodes`.
 * @param {string} source
 * @param {StubEl[]} nodes
 */
function boot(source, nodes) {
  /** @type {Record<string, ((event: any) => void)[]>} */
  const listeners = {};
  /** @type {(() => void)[]} */
  const frames = [];
  const document = {
    hidden: false,
    activeElement: null,
    documentElement: new StubEl("html"),
    querySelectorAll: (selector) => nodes.filter((el) => matchesSelector(el, selector)),
    querySelector: (selector) => nodes.find((el) => matchesSelector(el, selector)) ?? null,
    addEventListener: (type, fn) => {
      (listeners[type] ||= []).push(fn);
    }
  };
  const sandbox = {
    document,
    console,
    JSON,
    Object,
    Math,
    Date,
    Array,
    String,
    Number,
    Boolean,
    Set,
    Map,
    Promise,
    Error,
    isNaN,
    parseFloat,
    parseInt,
    encodeURIComponent,
    // 2.7.0 boot path: seeds are structuredClone'd for the reset baseline, and
    // from-url keys read/write the address bar (no such keys in these fixtures, so
    // the location/history stubs only need to exist).
    structuredClone,
    URLSearchParams,
    location: { search: "", pathname: "/", hash: "" },
    history: { state: null, replaceState: () => {} },
    queueMicrotask,
    requestAnimationFrame: (/** @type {() => void} */ fn) => frames.push(fn),
    addEventListener: (/** @type {string} */ type, /** @type {(e: any) => void} */ fn) => {
      (listeners[type] ||= []).push(fn);
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "runtime.min.js" });
  return {
    wd: sandbox.wd,
    listeners,
    flush() {
      const queued = frames.splice(0);
      for (const fn of queued) fn();
    }
  };
}

/** The markup a `:state greeting = "world"` + `{ greeting }` page compiles to. */
function bindingFixture() {
  const seed = new StubEl("script", { "data-wd-state": "" }, '{"greeting":"world"}');
  const bind = new StubEl("span", { "data-wd-bind": "greeting" }, "world");
  return { nodes: [seed, bind], bind };
}

test("the MINIFIED runtime boots, hydrates state, and paints a binding", () => {
  const { nodes, bind } = bindingFixture();
  bind.textContent = "STALE"; // must be overwritten by the runtime's first render
  const harness = boot(fs.readFileSync(MIN_FILE, "utf8"), nodes);

  assert.equal(bind.textContent, "world", "boot must run an initial render, not wait for an event");
  assert.equal(harness.wd.get("greeting"), "world");
});

test("the MINIFIED runtime re-renders on wd.set and notifies subscribers", () => {
  const { nodes, bind } = bindingFixture();
  const harness = boot(fs.readFileSync(MIN_FILE, "utf8"), nodes);

  /** @type {any[]} */
  const seen = [];
  const off = harness.wd.subscribe("greeting", (value) => seen.push(value));
  assert.deepEqual(seen, ["world"], "subscribe fires immediately with the current value");

  harness.wd.set("greeting", "darkmown");
  harness.flush(); // the render is scheduled on a frame, exactly as in a browser

  assert.equal(bind.textContent, "darkmown");
  assert.deepEqual(seen, ["world", "darkmown"]);

  off();
  harness.wd.set("greeting", "again");
  harness.flush();
  assert.equal(bind.textContent, "again");
  assert.deepEqual(seen, ["world", "darkmown"], "unsubscribe must actually stop the callbacks");
});

test("minification preserves the public window.wd surface", () => {
  // esbuild renames locals freely; these names are CONTRACT. `wd.subscribe` is
  // documented as the bridge for colocated `.js` behaviors, `wd.set`/`wd.get`
  // are the escape hatch, and src/behaviors/sortable.js writes through them.
  const { nodes } = bindingFixture();
  const { wd } = boot(fs.readFileSync(MIN_FILE, "utf8"), nodes);

  assert.deepEqual(Object.keys(wd).sort(), ["debug", "get", "render", "set", "state", "subscribe"]);
  for (const name of ["get", "set", "subscribe", "render"]) {
    assert.equal(typeof wd[name], "function", `window.wd.${name} must survive minification`);
  }
  assert.equal(wd.debug, false);
  assert.equal(wd.state.greeting, "world");
});

test("the same fixture behaves identically on the readable source", () => {
  // Differential control. Without it, an assertion above that is simply wrong
  // (or vacuous) would look like a minifier bug when someone eventually hits it.
  // Source and minified must agree, or one of the two is broken.
  const minified = bindingFixture();
  const readable = bindingFixture();
  const minHarness = boot(fs.readFileSync(MIN_FILE, "utf8"), minified.nodes);
  const srcHarness = boot(fs.readFileSync(SOURCE_FILE, "utf8"), readable.nodes);

  minHarness.wd.set("greeting", "parity");
  srcHarness.wd.set("greeting", "parity");
  minHarness.flush();
  srcHarness.flush();

  assert.equal(minified.bind.textContent, readable.bind.textContent);
  assert.deepEqual(Object.keys(minHarness.wd).sort(), Object.keys(srcHarness.wd).sort());
});

// --- the size gate measures the file that ships ----------------------------

test(".size-snapshot.json measures the minified artifact, not the readable source", () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(repoRoot, ".size-snapshot.json"), "utf8"));
  assert.equal(
    snapshot.runtime.file,
    "src/runtime.min.js",
    "the budget must be denominated in the bytes users download"
  );
  assert.ok(fs.existsSync(path.join(repoRoot, snapshot.runtime.file)));
});
