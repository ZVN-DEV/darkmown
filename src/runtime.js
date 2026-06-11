const state = {};

for (const script of document.querySelectorAll("script[data-wd-state]")) {
  Object.assign(state, JSON.parse(script.textContent || "{}"));
}

function render() {
  for (const node of document.querySelectorAll("[data-wd-bind]")) {
    const key = node.getAttribute("data-wd-bind");
    node.textContent = state[key] ?? "";
  }
  for (const node of document.querySelectorAll("[data-wd-if]")) {
    const key = node.getAttribute("data-wd-if");
    const output = node.querySelector("[data-wd-if-out]");
    const template = node.querySelector(state[key] ? "template[data-wd-true]" : "template[data-wd-false]");
    output.innerHTML = template?.innerHTML || "";
  }
  for (const node of document.querySelectorAll("[data-wd-for]")) {
    const listName = node.getAttribute("data-wd-for");
    const itemName = node.getAttribute("data-wd-item");
    const output = node.querySelector("[data-wd-for-out]");
    const template = node.querySelector("template[data-wd-for-template]")?.innerHTML || "";
    const rows = Array.isArray(state[listName]) ? state[listName] : [];
    output.innerHTML = rows.map((item) => renderItem(template, itemName, item)).join("");
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
  if (op === "add") {
    state[target] = Number(state[target] ?? 0) + Number(value);
  }
  if (op === "append") state[target] = [...(Array.isArray(state[target]) ? state[target] : []), value];
  if (op === "set") state[target] = value;
  render();
});

render();

function renderItem(template, itemName, item) {
  const fragment = document.createElement("template");
  fragment.innerHTML = template;
  for (const node of fragment.content.querySelectorAll(`[data-wd-each="${itemName}"]`)) {
    node.textContent = item ?? "";
  }
  return fragment.innerHTML;
}
