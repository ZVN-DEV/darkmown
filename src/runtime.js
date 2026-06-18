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
/** @type {Set<string>} Non-ephemeral :store names, persisted under wd:store:<name>. */
const storeKeys = new Set();

for (const script of document.querySelectorAll("script[data-wd-state]")) {
  Object.assign(state, JSON.parse(script.textContent || "{}"));
  const persist = script.getAttribute("data-wd-persist");
  if (persist) persistKeys.add(persist);
}
for (const script of document.querySelectorAll("script[data-wd-store]")) {
  const name = script.getAttribute("data-wd-store") || "";
  state[name] = JSON.parse(script.textContent || "null");
  if (!script.hasAttribute("data-wd-store-ephemeral")) storeKeys.add(name);
}

// Frozen seed snapshot, taken BEFORE localStorage overrides below, so `reset`
// deep-clones the declared value — not the last persisted one.
/** @type {Record<string, any>} */
const initials = Object.freeze(JSON.parse(JSON.stringify(state)));

for (const key of persistKeys) {
  const stored = localStorage.getItem(`wd:${key}`);
  if (stored === null) continue;
  try {
    state[key] = JSON.parse(stored);
  } catch {
    localStorage.removeItem(`wd:${key}`);
  }
}
for (const name of storeKeys) {
  const stored = localStorage.getItem(`wd:store:${name}`);
  if (stored === null) localStorage.setItem(`wd:store:${name}`, JSON.stringify(state[name] ?? null));
  else try { state[name] = JSON.parse(stored); } catch { /** keep seed */ }
}

function savePersisted() {
  for (const key of persistKeys) localStorage.setItem(`wd:${key}`, JSON.stringify(state[key] ?? null));
  for (const name of storeKeys) localStorage.setItem(`wd:store:${name}`, JSON.stringify(state[name] ?? null));
}

window.addEventListener("storage", (event) => {
  const name = event.key && event.key.startsWith("wd:store:") ? event.key.slice(9) : "";
  if (!storeKeys.has(name) || event.newValue == null) return;
  let next;
  try { next = JSON.parse(event.newValue); } catch { return; }
  if (JSON.stringify(next) === JSON.stringify(state[name])) return;
  state[name] = next;
  render();
});

/**
 * True for prototype-pollution path segments that must never be read or written.
 * Single source of truth for the rejected-key list (used by getPath + setPath).
 * @param {string} segment
 * @returns {boolean}
 */
const unsafeKey = (segment) => segment === "__proto__" || segment === "constructor" || segment === "prototype";

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
    if (unsafeKey(segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Safely write a value at a dotted path, creating plain objects for missing
 * intermediates and rejecting prototype-pollution segments at every level.
 * @param {any} obj
 * @param {string} path
 * @param {any} value
 * @returns {void}
 */
function setPath(obj, path, value) {
  const segs = path.split(".");
  const last = segs.pop() || "";
  let cur = obj;
  for (const seg of segs) {
    if (unsafeKey(seg)) return;
    if (cur[seg] == null || typeof cur[seg] !== "object") cur[seg] = {};
    cur = cur[seg];
  }
  if (unsafeKey(last)) return;
  cur[last] = value;
}

/**
 * Empty for fetch purposes: null/undefined, an empty array, or an object with
 * no own keys. Drives the `name_empty` lifecycle flag.
 * @param {any} v
 * @returns {boolean}
 */
function isEmpty(v) {
  return v == null || (typeof v === "object" && (Array.isArray(v) ? v.length : Object.keys(v).length) === 0);
}

/**
 * Shared HTTP→JSON core for `:fetch` and the round-trip `:form`. Sends the
 * request, throws on non-2xx, and parses the body as JSON (falling back to a
 * `{status,body}` wrapper for non-JSON responses). Unifying both callers keeps
 * the runtime under budget.
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function httpJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    const err = /** @type {Error & { status?: number }} */ (new Error(`HTTP ${response.status}`));
    err.status = response.status; // lets the :fetch lifecycle single out a 401 for token refresh
    throw err;
  }
  try { return JSON.parse(text); } catch { return { status: response.status, body: text }; }
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
 * Toggle reactive `.class when <predicate>` bindings on an element. `raw` is the
 * JSON `[[name, body], …]` from data-wd-class (global, item undefined) or
 * data-wd-each-class (per loop row); each body is the same I()/S()/C()
 * expression the loop `where` uses.
 * @param {Element} el
 * @param {string | null} raw
 * @param {any} item Loop item for each-class; undefined for a global class.
 * @returns {void}
 */
function classToggle(el, raw, item) {
  if (!raw) return;
  /** @type {[string, string][]} */
  let pairs;
  try { pairs = JSON.parse(raw); } catch { return; }
  for (const [name, body] of pairs) {
    let on = false;
    try { on = Boolean(loopPredicate(body)((/** @type {string} */ p) => getPath(item, p), (/** @type {string} */ k, /** @type {string} */ r) => getPath(state[k], r || ""), containsFn)); }
    catch (error) { warn(body, error); }
    el.classList.toggle(name, on);
  }
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
  // querySelectorAll skips <template> content, so this sees only the outermost
  // regions; recursing into each injected branch fills the rest.
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
  const classNodes = node.matches("[data-wd-each-class]") ? [node, ...node.querySelectorAll("[data-wd-each-class]")] : [...node.querySelectorAll("[data-wd-each-class]")];
  for (const el of classNodes) classToggle(el, el.getAttribute("data-wd-each-class"), item);
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

  // Reactive styling: toggle state-driven `.class when …` bindings. Loop-row
  // bindings (data-wd-each-class) are handled per item inside fillItem.
  for (const el of document.querySelectorAll("[data-wd-class]")) classToggle(el, el.getAttribute("data-wd-class"), undefined);

  for (const region of document.querySelectorAll("[data-wd-loop]")) {
    const key = region.getAttribute("data-wd-loop");
    const data = region.getAttribute("data-wd-loop-data");
    /** Source may be a dotted path (e.g. team.members) read off state via getPath. */
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
      node.__wdItem = item; /** let per-row actions resolve which row was clicked */
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

  runEffects(); // side effects run last, against fully settled state
}

/** @typedef {{ watch: string, actions: { op: string, target?: string, value?: any }[], last: string }} Effect */
/** @type {Effect[]} */
const effects = [...document.querySelectorAll("script[data-wd-effect]")].map((node) => {
  const def = JSON.parse(node.textContent || "{}");
  return { watch: def.watch, actions: def.actions || [], last: JSON.stringify(getPath(state, def.watch) ?? null) };
});
let effectDepth = 0;
/**
 * After a render, fire any `:effect` whose watched state changed, running its
 * actions through the shared action runner. If that mutates state, re-render and
 * re-check; a settle cap of 10 passes guards against effect→effect loops.
 * @returns {void}
 */
function runEffects() {
  if (!effects.length) return;
  let changed = false;
  for (const fx of effects) {
    const now = JSON.stringify(getPath(state, fx.watch) ?? null);
    if (now === fx.last) continue;
    fx.last = now;
    for (const a of fx.actions) applyAction(null, a.op, a.target || "", a.value);
    changed = true;
  }
  if (!changed) { effectDepth = 0; return; }
  if (++effectDepth >= 10) { effectDepth = 0; console.warn("effect did not settle"); return; }
  renderNow(); // reflect the effect's state changes, then re-check
}

/**
 * Coalesce rapid state mutations into one render on the next tick. Each scheduled
 * pass always reads the latest state, so the final update is never dropped.
 */
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
  checkRefetch();
});

/**
 * Resolve the loop source and row item for a clicked element, if inside a loop.
 * The clicked button's row is the nearest reconciled loop node; it carries its item.
 * @param {Element | null} el Null for effect-driven actions (no clicked row).
 * @returns {{ srcKey: string | null, item: any } | null}
 */
function clickedRow(el) {
  if (!el) return null; // effect-driven actions have no clicked row → row ops no-op
  const row = /** @type {WdRow | null} */ (el.closest("[data-wd-loop-key]"));
  const region = el.closest("[data-wd-loop]");
  if (!row || !region) return null;
  return { srcKey: region.getAttribute("data-wd-loop"), item: row.__wdItem };
}

/**
 * Apply one parsed action `{op,target,value}` against state. Targets are dotted
 * paths read via getPath / written via setPath; a bare name is a 1-segment path.
 * @param {Element | null} action The clicked element (for loop-row resolution); null for effects.
 * @param {string} op
 * @param {string} target
 * @param {any} value
 * @returns {void}
 */
function applyAction(action, op, target, value) {
  /** @param {any} v */
  const put = (v) => setPath(state, target, v);
  const cur = getPath(state, target);
  const arr = () => (Array.isArray(cur) ? cur : []);
  if (op === "inc") put(Number(cur ?? 0) + 1);
  if (op === "dec") put(Number(cur ?? 0) - 1);
  if (op === "add") put(Number(cur ?? 0) + Number(value));
  if (op === "sub") put(Number(cur ?? 0) - Number(value));
  if (op === "toggle") put(!cur);
  if (op === "set") put(value);
  if (op === "append") put([...arr(), value]);
  if (op === "prepend") put([value, ...arr()]);
  if (op === "member-toggle") put(arr().includes(value) ? arr().filter((/** @type {any} */ x) => x !== value) : [...arr(), value]);
  if (op === "remove-value") put(arr().filter((/** @type {any} */ x) => x !== value));
  if (op === "clear") put(Array.isArray(cur) ? [] : {});
  if (op === "merge") put({ ...(cur && typeof cur === "object" ? cur : {}), ...(typeof value === "string" ? getPath(state, value) : value) });
  if (op === "delete") { if (cur && typeof cur === "object") { delete cur[value]; put(cur); } }
  if (op === "reset") put(structuredClone(getPath(initials, target)));
  if (op === "refetch") { const n = document.querySelector(`[data-wd-fetch-key="${target}"]`); if (n) startFetch(n); }
  if (op === "remove") {
    const row = clickedRow(action);
    if (row && row.srcKey) state[row.srcKey] = (Array.isArray(state[row.srcKey]) ? state[row.srcKey] : []).filter((/** @type {any} */ x) => x !== row.item);
  }
  if (op === "append-row") {
    const row = clickedRow(action);
    // Clone so each appended line is a distinct object — else a shared ref
    // means a later remove (filter !== ref) deletes both lines.
    if (row && row.item !== undefined) {
      const copy = row.item && typeof row.item === "object" ? structuredClone(row.item) : row.item;
      put([...arr(), copy]);
    }
  }
}

document.addEventListener("click", (event) => {
  const action = /** @type {Element} */ (event.target)?.closest("[data-wd-action],[data-wd-actions]");
  if (!action) return;
  const seq = action.getAttribute("data-wd-actions");
  if (seq) {
    for (const a of JSON.parse(seq)) applyAction(action, a.op, a.target || "", a.value);
  } else {
    const rawValue = action.getAttribute("data-wd-value");
    applyAction(action, action.getAttribute("data-wd-action") || "", action.getAttribute("data-wd-target") || "", rawValue === null ? undefined : JSON.parse(rawValue));
  }
  savePersisted();
  render();
  checkRefetch();
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

  httpJson(action, {
    method: form.getAttribute("method") || "post",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(/** @type {any} */ (new FormData(form))).toString()
  })
    .then((value) => {
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
 * Run the full `:fetch` lifecycle for a marker node: interpolate the URL from
 * state, skip when a dependency is empty, flip `*_loading`, fetch with an
 * AbortController timeout + flat retry, then write value/`*_empty` or `*_error`.
 * @param {FetchNode} node
 * @returns {void}
 */
function startFetch(node) {
  // Per-node generation token: a refetch bumps it; superseded writes bail.
  const gen = node.__wdGen = (node.__wdGen || 0) + 1;
  /** @returns {boolean} stale once a newer fetch superseded this one */
  const dead = () => gen !== node.__wdGen;
  /** @param {string} n @returns {string} */
  const g = (n) => node.getAttribute("data-wd-fetch-" + n) || "";
  const key = g("key");
  /** @param {string} s @param {any} v */
  const set = (s, v) => { state[key + s] = v; render(); };
  let missing = false;
  const url = g("url").replace(/\{\s*([\w$.]+)\s*\}/g, (_, p) => {
    const v = getPath(state, p);
    if (v == null || v === "") missing = true;
    return encodeURIComponent(String(v ?? ""));
  });
  if (missing) return set("_loading", false);

  const headers = g("headers");
  const body = g("body");
  const refresh = g("refresh");
  const method = g("method") || "GET";
  const timeout = Number(g("timeout"));
  let tries = Number(g("retry"));
  let refreshed = false; // a token refresh + retry happens at most once per request
  state[key + "_error"] = null;
  set("_loading", true);

  /** @param {any} error */
  const fail = (error) => { state[key + "_error"] = String(error); set("_loading", false); };

  const attempt = () => {
    /** @type {RequestInit} */
    const init = { method };
    if (headers) init.headers = state[headers] || {};
    if (body && method !== "GET") init.body = JSON.stringify(state[body] ?? null);
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    if (ctrl) init.signal = ctrl.signal;
    const timer = timeout && ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
    httpJson(url, init).then((value) => {
      clearTimeout(timer);
      if (dead()) return;
      state[key] = value;
      state[key + "_empty"] = isEmpty(value);
      state[key + "_error"] = null;
      set("_loading", false);
    }).catch((error) => {
      clearTimeout(timer);
      if (dead()) return;
      const is401 = error && error.status === 401;
      // Layer 2: a 401 with a refresh URL renews the token once, then retries.
      if (is401 && refresh && headers && !refreshed) {
        refreshed = true;
        return void refreshToken(refresh, headers).then((ok) => {
          if (dead()) return;
          ok ? attempt() : fail(error);
        });
      }
      if (is401 && refreshed) return void fail(error); // a second 401 after refresh → give up
      if (tries-- > 0) return void setTimeout(attempt, 200);
      fail(error);
    });
  };
  attempt();
}

/** @type {Map<string, Promise<boolean>>} In-flight token refreshes, keyed by URL. */
const refreshFlights = new Map();
/**
 * Single-flight token refresh: POST the current header state to `refreshUrl`,
 * and on a 2xx JSON reply write the returned headers object back into the
 * `headersKey` state (persisting if it is a `:store`). Concurrent 401s sharing a
 * refresh URL await the same request, then each retries its own fetch.
 * @param {string} refreshUrl
 * @param {string} headersKey
 * @returns {Promise<boolean>} whether the token was renewed
 */
function refreshToken(refreshUrl, headersKey) {
  const inflight = refreshFlights.get(refreshUrl);
  if (inflight) return inflight;
  const flight = httpJson(refreshUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state[headersKey] ?? {})
  }).then((value) => {
    if (value && typeof value === "object") {
      state[headersKey] = value; // the new headers shape, e.g. { Authorization: "Bearer …" }
      savePersisted();
      return true;
    }
    return false;
  }).catch(() => false).finally(() => refreshFlights.delete(refreshUrl));
  refreshFlights.set(refreshUrl, flight);
  return flight;
}

/** A fetch marker carrying its last dependency snapshot for refetch diffing and
 * a generation token so a superseded in-flight response/retry bails on write. */
/** @typedef {Element & { __wdSnap?: string, __wdGen?: number }} FetchNode */
/** @type {FetchNode[]} */
const fetchNodes = [...document.querySelectorAll("[data-wd-fetch]")];
/** @param {FetchNode} node @returns {string} */
const depSnapshot = (node) => (node.getAttribute("data-wd-fetch-deps") || "").split(",").filter(Boolean).map((d) => JSON.stringify(getPath(state, d))).join("|");

/** @type {any} */
let refetchTimer = 0;
/**
 * After a mutation render, debounce-refetch any fetch node whose URL deps
 * changed. Snapshots live on the node, so no extra bookkeeping structure.
 * @returns {void}
 */
function checkRefetch() {
  /** @type {FetchNode[]} */
  const due = [];
  for (const node of fetchNodes) {
    const snap = depSnapshot(node);
    if (snap && snap !== node.__wdSnap) { node.__wdSnap = snap; due.push(node); }
  }
  if (!due.length) return;
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => { for (const node of due) startFetch(node); }, 150);
}

for (const node of fetchNodes) {
  node.__wdSnap = depSnapshot(node);
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

/**
 * Public escape hatch on `window.wd`. Set `window.wd.debug = true` to log failing
 * computed/where expressions to the console.
 */
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
