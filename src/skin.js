const aliases = new Map([
  ["radius", "border-radius"],
  ["shadow", "box-shadow"],
  ["font", "font-family"],
  ["bg", "background"]
]);

export function compileSkin(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const stack = [];
  const css = [];
  let tokenIndent = null;
  const rootVars = [];

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("//")) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const text = raw.trim();

    if (text === "tokens") {
      tokenIndent = indent;
      continue;
    }

    if (tokenIndent !== null && indent > tokenIndent && !looksLikeSelector(text)) {
      const [name, ...rest] = text.split(/\s+/);
      rootVars.push(`  --${name}: ${rest.join(" ")};`);
      continue;
    }

    if (tokenIndent !== null && indent <= tokenIndent) tokenIndent = null;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();

    if (looksLikeSelector(text)) {
      const parent = stack.at(-1)?.selector;
      const selector = normalizeSelector(text, parent);
      stack.push({ indent, selector });
      continue;
    }

    const current = stack.at(-1)?.selector || ":root";
    const [prop, ...rest] = text.split(/\s+/);
    const cssProp = aliases.get(prop) || prop;
    const value = rest.join(" ").replace(/\$([a-zA-Z0-9_-]+)/g, "var(--$1)");
    css.push(`${current} { ${cssProp}: ${value}; }`);
  }

  if (rootVars.length) css.unshift(`:root {\n${rootVars.join("\n")}\n}`);
  return css.join("\n");
}

function looksLikeSelector(text) {
  if (/^[.#&]/.test(text)) return true;
  return text === "page" || /^[a-z][a-z0-9_-]*(?::[a-z0-9_-]+)?$/i.test(text);
}

function normalizeSelector(text, parent) {
  const selector = text === "page" ? "body" : text;
  if (!parent || parent === ":root") return selector;
  if (selector.startsWith("&")) return selector.replace("&", parent);
  return `${parent} ${selector}`;
}
