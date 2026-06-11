const state = {};

for (const script of document.querySelectorAll("script[data-wd-state]")) {
  Object.assign(state, JSON.parse(script.textContent || "{}"));
}

function getPath(value, path) {
  if (!path) return value;
  let current = value;
  for (const segment of path.split(".")) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
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
  const targets = node.matches("[data-wd-each]")
    ? [node, ...node.querySelectorAll("[data-wd-each]")]
    : [...node.querySelectorAll("[data-wd-each]")];
  for (const target of targets) {
    target.textContent = getPath(item, target.getAttribute("data-wd-path")) ?? "";
  }
}

function render() {
  for (const node of document.querySelectorAll("[data-wd-if]")) {
    const value = getPath(state[node.getAttribute("data-wd-if")], node.getAttribute("data-wd-path"));
    const output = node.querySelector("[data-wd-if-out]");
    const template = node.querySelector(value ? "template[data-wd-true]" : "template[data-wd-false]");
    output.innerHTML = template?.innerHTML || "";
  }

  for (const region of document.querySelectorAll("[data-wd-loop]")) {
    const rows = state[region.getAttribute("data-wd-loop")];
    const template = region.querySelector("template[data-wd-loop-template]");
    const out = region.querySelector("[data-wd-loop-out]");
    if (!template || !out) continue;
    const list = Array.isArray(rows) ? rows : [];

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
      out.appendChild(node);
    }
    for (const [key, node] of existing) {
      if (!used.has(key)) node.remove();
    }
  }

  for (const node of document.querySelectorAll("[data-wd-bind]")) {
    node.textContent = getPath(state[node.getAttribute("data-wd-bind")], node.getAttribute("data-wd-path")) ?? "";
  }
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
  render();
});

render();
