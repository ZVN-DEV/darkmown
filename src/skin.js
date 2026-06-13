const aliases = new Map([
  ["radius", "border-radius"],
  ["shadow", "box-shadow"],
  ["font", "font-family"],
  ["bg", "background"]
]);

// `font` is aliased to font-family for the common `font <stack>` case, but the
// real CSS `font` shorthand (`font 16px/1.4 system-ui`) must pass through. If
// the value looks like a shorthand (leads with a size or contains `/`), keep it.
function resolveProp(prop, rest) {
  if (prop === "font" && (/^[\d.]/.test(rest[0] || "") || rest.join(" ").includes("/"))) return "font";
  return aliases.get(prop) || prop;
}

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
      // At-rules (@media, @supports) wrap rules instead of extending selectors:
      // carry the outer selector through so nested selectors combine normally.
      if (text.startsWith("@")) {
        stack.push({ indent, selector: parent ?? null, media: text });
      } else {
        stack.push({ indent, selector: normalizeSelector(text, parent) });
      }
      continue;
    }

    const current = stack.at(-1)?.selector || ":root";
    const media = stack.find((frame) => frame.media)?.media;
    const [prop, ...rest] = text.split(/\s+/);
    const cssProp = resolveProp(prop, rest);
    const value = rest.join(" ").replace(/\$([a-zA-Z0-9_-]+)/g, "var(--$1)");
    const rule = `${current} { ${cssProp}: ${value}; }`;
    css.push(media ? `${media} { ${rule} }` : rule);
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
