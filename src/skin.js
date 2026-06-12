const aliases = new Map([
  ["radius", "border-radius"],
  ["shadow", "box-shadow"],
  ["font", "font-family"],
  ["bg", "background"]
]);

export function compileSkin(source) {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((raw) => raw.trim() && !raw.trim().startsWith("//"))
    .map((raw) => ({ indent: raw.match(/^\s*/)[0].length, text: raw.trim() }));

  const stack = [];
  const css = [];
  let tokenIndent = null;
  const rootVars = [];

  for (let i = 0; i < lines.length; i++) {
    const { indent, text } = lines[i];
    // Structure decides meaning: a line opens a block (selector) exactly when
    // the next line is indented deeper. Everything else is a declaration.
    const opensBlock = i + 1 < lines.length && lines[i + 1].indent > indent;

    if (text === "tokens" && opensBlock) {
      tokenIndent = indent;
      continue;
    }

    if (tokenIndent !== null && indent > tokenIndent) {
      const [name, ...rest] = text.split(/\s+/);
      rootVars.push(`  --${name}: ${rest.join(" ")};`);
      continue;
    }

    if (tokenIndent !== null && indent <= tokenIndent) tokenIndent = null;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();

    if (opensBlock) {
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

function normalizeSelector(text, parent) {
  const selector = text === "page" ? "body" : text;
  if (!parent || parent === ":root") return selector;
  return selector
    .split(",")
    .map((part) => {
      const clean = part.trim();
      return clean.startsWith("&") ? clean.replace("&", parent) : `${parent} ${clean}`;
    })
    .join(", ");
}
