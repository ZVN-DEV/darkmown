const state = {};
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
  key: node.getAttribute("data-wd-computed-key"),
  evaluate: new Function("S", `return (${node.getAttribute("data-wd-computed-expr")});`)
}));

function recompute() {
  const read = (key, path) => getPath(state[key], path);
  for (const def of computedDefs) {
    try {
      state[def.key] = def.evaluate(read);
    } catch {
      state[def.key] = undefined;
    }
  }
}

const containsFn = (a, b) => String(a ?? "").toLowerCase().includes(String(b ?? "").toLowerCase());
const predicateCache = new Map();
function loopPredicate(body) {
  let fn = predicateCache.get(body);
  if (!fn) {
    fn = new Function("I", "S", "C", `return (${body});`);
    predicateCache.set(body, fn);
  }
  return fn;
}

function loopKeyOf(item, counts) {
  const base =
    item && typeof item === "object"
      ? String(item.id ?? item.key ?? JSON.stringify(item))
      : String(item);
  const seen = counts.get(base) || 0;
  counts.set(base, seen + 1);
  return seen ? `${base}#${seen}` : base;
}

function fillItem(node, item) {
  // querySelectorAll does not descend into <template> content, so this only sees
  // the outermost regions; recursing into each injected branch fills the rest.
  for (const region of node.querySelectorAll("[data-wd-each-if]")) {
    const value = getPath(item, region.getAttribute("data-wd-path"));
    const output = region.querySelector("[data-wd-each-if-out]");
    const template = region.querySelector(value ? "template[data-wd-if-true]" : "template[data-wd-if-false]");
    output.innerHTML = template?.innerHTML || "";
    fillItem(output, item);
  }
  const targets = node.matches("[data-wd-each]")
    ? [node, ...node.querySelectorAll("[data-wd-each]")]
    : [...node.querySelectorAll("[data-wd-each]")];
  for (const target of targets) {
    target.textContent = getPath(item, target.getAttribute("data-wd-path")) ?? "";
  }
}

function render() {
  recompute();
  for (const node of document.querySelectorAll("[data-wd-if]")) {
    const value = getPath(state[node.getAttribute("data-wd-if")], node.getAttribute("data-wd-path"));
    const active = String(Boolean(value));
    if (node.getAttribute("data-wd-if-active") === active) continue;
    node.setAttribute("data-wd-if-active", active);
    const output = node.querySelector("[data-wd-if-out]");
    const template = node.querySelector(value ? "template[data-wd-true]" : "template[data-wd-false]");
    output.innerHTML = template?.innerHTML || "";
  }

  for (const region of document.querySelectorAll("[data-wd-loop]")) {
    const key = region.getAttribute("data-wd-loop");
    const data = region.getAttribute("data-wd-loop-data");
    const rows = key ? state[key] : (data ? JSON.parse(data) : []);
    const template = region.querySelector("template[data-wd-loop-template]");
    const out = region.querySelector("[data-wd-loop-out]");
    if (!template || !out) continue;
    let list = Array.isArray(rows) ? rows : [];
    const where = region.getAttribute("data-wd-loop-where");
    if (where) {
      const predicate = loopPredicate(where);
      list = list.filter((item) =>
        predicate((path) => getPath(item, path), (k, r) => getPath(state[k], r || ""), containsFn)
      );
    }

    const existing = new Map();
    for (const child of [...out.children]) {
      existing.set(child.getAttribute("data-wd-loop-key"), child);
    }
    const counts = new Map();
    const used = new Set();
    for (const item of list) {
      const key = loopKeyOf(item, counts);
      let node = existing.get(key);
      if (!node || used.has(key)) {
        node = template.content.firstElementChild.cloneNode(true);
        node.setAttribute("data-wd-loop-key", key);
      }
      used.add(key);
      fillItem(node, item);
      node.__wdItem = item; // let per-row actions resolve which row was clicked
      out.appendChild(node);
    }
    for (const [key, node] of existing) {
      if (!used.has(key)) node.remove();
    }
  }

  for (const node of document.querySelectorAll("[data-wd-bind]")) {
    node.textContent = getPath(state[node.getAttribute("data-wd-bind")], node.getAttribute("data-wd-path")) ?? "";
  }

  for (const input of document.querySelectorAll("[data-wd-bind-input]")) {
    if (document.activeElement !== input) input.value = state[input.getAttribute("data-wd-bind-input")] ?? "";
  }
}

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-wd-bind-input]");
  if (!input) return;
  state[input.getAttribute("data-wd-bind-input")] = input.value;
  savePersisted();
  render();
});

// The clicked button's row: the nearest reconciled loop node carries its item.
function clickedRow(el) {
  const row = el.closest("[data-wd-loop-key]");
  const region = el.closest("[data-wd-loop]");
  if (!row || !region) return null;
  return { srcKey: region.getAttribute("data-wd-loop"), item: row.__wdItem };
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-wd-action]");
  if (!action) return;
  const op = action.getAttribute("data-wd-action");
  const target = action.getAttribute("data-wd-target");
  const rawValue = action.getAttribute("data-wd-value");
  const value = rawValue === null ? undefined : JSON.parse(rawValue);

  if (op === "inc") state[target] = Number(state[target] ?? 0) + 1;
  if (op === "dec") state[target] = Number(state[target] ?? 0) - 1;
  if (op === "add") state[target] = Number(state[target] ?? 0) + Number(value);
  if (op === "append") state[target] = [...(Array.isArray(state[target]) ? state[target] : []), value];
  if (op === "set") state[target] = value;
  if (op === "remove") {
    const row = clickedRow(action);
    if (row && row.srcKey) state[row.srcKey] = (Array.isArray(state[row.srcKey]) ? state[row.srcKey] : []).filter((x) => x !== row.item);
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
  const form = event.target.closest("[data-wd-form]");
  if (!form) return;
  event.preventDefault();
  const key = form.getAttribute("data-wd-form");
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
    body: new URLSearchParams(new FormData(form)).toString()
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

function startFetch(node) {
  const key = node.getAttribute("data-wd-fetch-key");
  fetch(node.getAttribute("data-wd-fetch-url"))
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

window.wd = {
  state,
  get: (key) => state[key],
  set: (key, value) => {
    state[key] = value;
    savePersisted();
    render();
  },
  render
};

render();
