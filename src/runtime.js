/**
 * Darkmown's tiny reactive runtime. Browser-only: it reads `data-wd-*` attributes
 * emitted by the compiler, hydrates declared state, and re-renders on changes.
 * @module runtime
 */

/**
 * A reconciled loop-row element. Carries its source row on `__wdItem` so per-row
 * button actions can resolve which row was clicked.
 * @typedef {Element & { __wdItem?: any }} WdRow
 */

/** @type {Record<string, any>} */
const state = {};
/** @type {Set<string>} */
const persistKeys = new Set();

for (const script of document.querySelectorAll("script[data-wd-state]")) {
  Object.assign(state, JSON.parse(script.textContent || "{}"));
  const persist = script.getAttribute("data-wd-persist");
  if (persist) persistKeys.add(persist);
}

for (const key of persistKeys) {
  const stored = localStorage.getItem(`wd:${key}`);
  if (stored === null) continue;
  try {
    state[key] = JSON.parse(stored);
  } catch {
    localStorage.removeItem(`wd:${key}`);
  }
}

function savePersisted() {
  for (const key of persistKeys) {
    localStorage.setItem(`wd:${key}`, JSON.stringify(state[key] ?? null));
  }
}

/**
 * Safely read a dotted path off a value, rejecting prototype-pollution segments.
 * @param {any} value
 * @param {string | null} path
 * @returns {any}
 */
function getPath(value, path) {
  if (!path) return value;
  let current = value;
  for (const segment of path.split(".")) {
    if (current == null) return undefined;
    if (segment === "constructor" || segment === "prototype" || segment === "__proto__") return undefined;
    current = current[segment];
  }
  return current;
}

const computedDefs = [...document.querySelectorAll("[data-wd-computed]")].map((node) => ({
  key: node.getAttribute("data-wd-computed-key") || "",
  expr: node.getAttribute("data-wd-computed-expr") || "",
  evaluate: new Function("S", `return (${node.getAttribute("data-wd-computed-expr")});`)
}));

/**
 * Log an expression failure when `window.wd.debug` is enabled.
 * @param {string} expr
 * @param {unknown} error
 * @returns {void}
 */
function warn(expr, error) {
  const wd = /** @type {any} */ (window).wd;
  if (wd && wd.debug) console.warn(`[wd] expression failed: ${expr}`, error);
}

/**
 * Re-evaluate all `:computed` definitions into `state`.
 * @returns {void}
 */
function recompute() {
  /** @param {string} key @param {string | null} [path] */
  const read = (key, path) => getPath(state[key], path ?? null);
  for (const def of computedDefs) {
    try {
      state[def.key] = def.evaluate(read);
    } catch (error) {
      state[def.key] = undefined;
      warn(def.expr, error);
    }
  }
}

/** @param {unknown} a @param {unknown} b @returns {boolean} */
const containsFn = (a, b) => String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase());
/** @type {Map<string, Function>} */
const predicateCache = new Map();
/**
 * @param {string} body
 * @returns {Function}
 */
function loopPredicate(body) {
  let fn = predicateCache.get(body);
  if (!fn) {
    fn = new Function("I", "S", "C", `return (${body});`);
    predicateCache.set(body, fn);
  }
  return fn;
}

/**
 * Stable per-render key for a loop row, disambiguating duplicates with `#n`.
 * @param {any} item
 * @param {Map<string, number>} counts
 * @returns {string}
 */
function loopKeyOf(item, counts) {
  const base =
    item && typeof item === "object"
      ? String(item.id ?? item.key ?? JSON.stringify(item))
      : String(item);
  const seen = counts.get(base) || 0;
  counts.set(base, seen + 1);
  return seen ? `${base}#${seen}` : base;
}

/**
 * Fill a cloned loop row node: resolve per-item `:if` regions (item- and
 * meta-driven), text binds, and per-row meta markers.
 * @param {Element} node
 * @param {any} item
 * @param {Record<string, any>} [meta] Per-row meta values (index/number/…).
 * @returns {void}
 */
function fillItem(node, item, meta = {}) {
  // querySelectorAll does not descend into <template> content, so this only sees
  // the outermost regions; recursing into each injected branch fills the rest.
  for (const region of node.querySelectorAll("[data-wd-each-if]")) {
    const m = region.getAttribute("data-wd-meta");
    const value = m ? meta[m] : getPath(item, region.getAttribute("data-wd-path"));
    const output = region.querySelector("[data-wd-each-if-out]");
    if (!output) continue;
    const template = /** @type {HTMLTemplateElement | null} */ (region.querySelector(value ? "template[data-wd-if-true]" : "template[data-wd-if-false]"));
    output.innerHTML = template?.innerHTML || "";
    fillItem(output, item, meta);
  }
  const targets = node.matches("[data-wd-each]")
    ? [node, ...node.querySelectorAll("[data-wd-each]")]
    : [...node.querySelectorAll("[data-wd-each]")];
  for (const target of targets) {
    target.textContent = getPath(item, target.getAttribute("data-wd-path")) ?? "";
  }
  for (const marker of node.querySelectorAll("[data-wd-each-meta]")) {
    marker.textContent = meta[marker.getAttribute("data-wd-each-meta") || ""] ?? "";
  }
}

/**
 * Read a loop offset/limit attribute that is a literal int or a `key:<name>`
 * referencing state. Returns null when the attribute is absent.
 * @param {Element} region
 * @param {string} name
 * @returns {number | null}
 */
function loopNum(region, name) {
  const raw = region.getAttribute(name);
  if (raw == null) return null;
  return raw.startsWith("key:") ? Number(state[raw.slice(4)] ?? 0) : Number(raw);
}

/**
 * Apply sort → reverse → offset → limit to an already-filtered list, reading
 * clause config off the region. Stable; numeric vs localeCompare comparator.
 * @param {any[]} list
 * @param {Element} region
 * @returns {any[]}
 */
function pipeline(list, region) {
  const sort = region.getAttribute("data-wd-loop-sort");
  if (sort != null) {
    const dir = region.getAttribute("data-wd-loop-sort-dir") === "desc" ? -1 : 1;
    list = list.map((value, index) => ({ value, index })).sort((a, b) => {
      const av = getPath(a.value, sort || null);
      const bv = getPath(b.value, sort || null);
      const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return (c || a.index - b.index) * dir;
    }).map((w) => w.value);
  }
  if (region.hasAttribute("data-wd-loop-reverse")) list.reverse();
  const off = loopNum(region, "data-wd-loop-offset");
  if (off) list = list.slice(off);
  const lim = loopNum(region, "data-wd-loop-limit");
  if (lim != null) list = list.slice(0, lim);
  return list;
}

/**
 * Synchronously render the whole document from current `state`:
 * computed → if-regions → keyed loop reconcile → text/input binds.
 * @returns {void}
 */
function renderNow() {
  recompute();
  for (const node of document.querySelectorAll("[data-wd-if]")) {
    const value = getPath(state[node.getAttribute("data-wd-if") || ""], node.getAttribute("data-wd-path"));
    const active = String(Boolean(value));
    if (node.getAttribute("data-wd-if-active") === active) continue;
    node.setAttribute("data-wd-if-active", active);
    const output = node.querySelector("[data-wd-if-out]");
    if (!output) continue;
    const template = /** @type {HTMLTemplateElement | null} */ (node.querySelector(value ? "template[data-wd-true]" : "template[data-wd-false]"));
    output.innerHTML = template?.innerHTML || "";
  }

  for (const region of document.querySelectorAll("[data-wd-loop]")) {
    const key = region.getAttribute("data-wd-loop");
    const data = region.getAttribute("data-wd-loop-data");
    // Source may be a dotted path (e.g. team.members) read off state via getPath.
    const dot = key ? key.indexOf(".") : -1;
    const rows = key ? (dot < 0 ? state[key] : getPath(state[key.slice(0, dot)], key.slice(dot + 1))) : (data ? JSON.parse(data) : []);
    const template = /** @type {HTMLTemplateElement | null} */ (region.querySelector("template[data-wd-loop-template]"));
    const out = region.querySelector("[data-wd-loop-out]");
    if (!template || !out) continue;
    let list = Array.isArray(rows) ? rows.slice() : [];
    const where = region.getAttribute("data-wd-loop-where");
    if (where) {
      const predicate = loopPredicate(where);
      list = list.filter((/** @type {any} */ item) => {
        try {
          return predicate((/** @type {string | null} */ path) => getPath(item, path), (/** @type {string} */ k, /** @type {string} */ r) => getPath(state[k], r || ""), containsFn);
        } catch (error) {
          warn(where, error);
          return false;
        }
      });
    }
    list = pipeline(list, region);

    // Empty branch: clone the [data-wd-loop-empty] template into the output.
    const emptyTpl = /** @type {HTMLTemplateElement | null} */ (region.querySelector("template[data-wd-loop-empty]"));
    if (!list.length && emptyTpl) {
      if (out.getAttribute("data-wd-empty") !== "1") {
        out.textContent = "";
        for (const child of [...emptyTpl.content.children]) out.appendChild(child.cloneNode(true));
        out.setAttribute("data-wd-empty", "1");
      }
      continue;
    }
    if (out.getAttribute("data-wd-empty") === "1") { out.textContent = ""; out.removeAttribute("data-wd-empty"); }

    /** @type {Map<string, WdRow>} */
    const existing = new Map();
    for (const child of [...out.children]) {
      existing.set(child.getAttribute("data-wd-loop-key") || "", /** @type {WdRow} */ (child));
    }
    /** @type {Map<string, number>} */
    const counts = new Map();
    /** @type {Set<string>} */
    const used = new Set();
    const count = list.length;
    for (let i = 0; i < count; i++) {
      const item = list[i];
      const key = loopKeyOf(item, counts);
      let node = existing.get(key);
      if (!node || used.has(key)) {
        node = /** @type {WdRow} */ (template.content.firstElementChild?.cloneNode(true));
        if (!node) continue;
        node.setAttribute("data-wd-loop-key", key);
      }
      used.add(key);
      fillItem(node, item, { index: i, number: i + 1, first: i === 0, last: i === count - 1, count });
      node.__wdItem = item; // let per-row actions resolve which row was clicked
      out.appendChild(node);
    }
    for (const [key, node] of existing) {
      if (!used.has(key)) node.remove();
    }
  }

  for (const node of document.querySelectorAll("[data-wd-bind]")) {
    node.textContent = getPath(state[node.getAttribute("data-wd-bind") || ""], node.getAttribute("data-wd-path")) ?? "";
  }

  for (const input of document.querySelectorAll("[data-wd-bind-input]")) {
    if (document.activeElement !== input) /** @type {HTMLInputElement} */ (input).value = state[input.getAttribute("data-wd-bind-input") || ""] ?? "";
  }
}

// Coalesce rapid state mutations into one render on the next tick. Each scheduled
// pass always reads the latest state, so the final update is never dropped.
const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : queueMicrotask;
let scheduled = false;
function render() {
  if (scheduled) return;
  scheduled = true;
  schedule(() => {
    scheduled = false;
    renderNow();
  });
}

document.addEventListener("input", (event) => {
  const input = /** @type {HTMLInputElement | null} */ (/** @type {Element} */ (event.target)?.closest("[data-wd-bind-input]"));
  if (!input) return;
  state[input.getAttribute("data-wd-bind-input") || ""] = input.value;
  savePersisted();
  render();
});

// The clicked button's row: the nearest reconciled loop node carries its item.
/**
 * Resolve the loop source and row item for a clicked element, if inside a loop.
 * @param {Element} el
 * @returns {{ srcKey: string | null, item: any } | null}
 */
function clickedRow(el) {
  const row = /** @type {WdRow | null} */ (el.closest("[data-wd-loop-key]"));
  const region = el.closest("[data-wd-loop]");
  if (!row || !region) return null;
  return { srcKey: region.getAttribute("data-wd-loop"), item: row.__wdItem };
}

document.addEventListener("click", (event) => {
  const action = /** @type {Element} */ (event.target)?.closest("[data-wd-action]");
  if (!action) return;
  const op = action.getAttribute("data-wd-action");
  const target = action.getAttribute("data-wd-target") || "";
  const rawValue = action.getAttribute("data-wd-value");
  const value = rawValue === null ? undefined : JSON.parse(rawValue);

  if (op === "inc") state[target] = Number(state[target] ?? 0) + 1;
  if (op === "dec") state[target] = Number(state[target] ?? 0) - 1;
  if (op === "add") state[target] = Number(state[target] ?? 0) + Number(value);
  if (op === "append") state[target] = [...(Array.isArray(state[target]) ? state[target] : []), value];
  if (op === "set") state[target] = value;
  if (op === "remove") {
    const row = clickedRow(action);
    if (row && row.srcKey) state[row.srcKey] = (Array.isArray(state[row.srcKey]) ? state[row.srcKey] : []).filter((/** @type {any} */ x) => x !== row.item);
  }
  if (op === "append-row") {
    const row = clickedRow(action);
    // Clone the row so each appended line is a distinct object — otherwise adding
    // the same source row twice yields two identical references and a later
    // remove (filter by !== ref) would delete both lines.
    if (row && row.item !== undefined) {
      const copy = row.item && typeof row.item === "object" ? structuredClone(row.item) : row.item;
      state[target] = [...(Array.isArray(state[target]) ? state[target] : []), copy];
    }
  }
  savePersisted();
  render();
});

document.addEventListener("submit", (event) => {
  const form = /** @type {HTMLFormElement | null} */ (/** @type {Element} */ (event.target)?.closest("[data-wd-form]"));
  if (!form) return;
  event.preventDefault();
  const key = form.getAttribute("data-wd-form") || "";
  const action = form.getAttribute("action");

  if (!action) {
    state[key] = Object.fromEntries(new FormData(form));
    savePersisted();
    render();
    return;
  }

  fetch(action, {
    method: form.getAttribute("method") || "post",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(/** @type {any} */ (new FormData(form))).toString()
  })
    .then(async (response) => {
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        value = { status: response.status, body: text };
      }
      state[key] = value;
      state[`${key}_error`] = null;
      savePersisted();
      render();
    })
    .catch((error) => {
      state[`${key}_error`] = String(error);
      render();
    });
});

/**
 * Kick off a `:fetch` request and write the result (or error) into state.
 * @param {Element} node
 * @returns {void}
 */
function startFetch(node) {
  const key = node.getAttribute("data-wd-fetch-key") || "";
  fetch(node.getAttribute("data-wd-fetch-url") || "")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((value) => {
      state[key] = value;
      state[`${key}_error`] = null;
      render();
    })
    .catch((error) => {
      state[`${key}_error`] = String(error);
      render();
    });
}

for (const node of document.querySelectorAll("[data-wd-fetch]")) {
  if (node.getAttribute("data-wd-fetch-when") === "visible" && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      startFetch(node);
    });
    observer.observe(node);
  } else {
    startFetch(node);
  }
}

// Public escape hatch on `window.wd`. Set `window.wd.debug = true` to log failing
// computed/where expressions to the console.
/** @type {any} */ (window).wd = {
  state,
  debug: false,
  /** @param {string} key */
  get: (key) => state[key],
  /** @param {string} key @param {any} value */
  set: (key, value) => {
    state[key] = value;
    savePersisted();
    render();
  },
  render: renderNow
};

renderNow();
