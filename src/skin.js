const aliases = new Map([
  ["radius", "border-radius"],
  ["shadow", "box-shadow"],
  ["font", "font-family"],
  ["bg", "background"]
]);

// `font` is aliased to font-family for the common `font <stack>` case, but the
// real CSS `font` shorthand (`font 16px/1.4 system-ui`) must pass through. If
// the value looks like a shorthand (leads with a size or contains `/`), keep it.
/**
 * @param {string} prop
 * @param {string[]} rest
 * @returns {string}
 */
function resolveProp(prop, rest) {
  if (prop === "font" && (/^[\d.]/.test(rest[0] || "") || rest.join(" ").includes("/"))) return "font";
  return aliases.get(prop) || prop;
}

/**
 * A nesting frame in the indentation stack.
 * @typedef {object} SkinFrame
 * @property {number} indent
 * @property {string | null} selector
 * @property {string} [media]
 */

/**
 * Compile indentation-based `.skin` source into CSS.
 * @param {string} source
 * @returns {string}
 */
export function compileSkin(source) {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "") // strip /* … */ block comments (any span)
    .split("\n")
    .filter((raw) => {
      const t = raw.trim();
      if (!t || t.startsWith("//")) return false;
      // Decorative divider lines (----, ====, * * *, ~~~) carry no rule and would
      // otherwise parse as a bogus selector/declaration. Anything with a letter or
      // digit is real content; punctuation-only lines are skipped.
      return /[A-Za-z0-9]/.test(t);
    })
    .map((raw) => ({ indent: (raw.match(/^\s*/)?.[0] ?? "").length, text: raw.trim() }));

  /** @type {SkinFrame[]} */
  const stack = [];
  /** @type {string[]} */
  const css = [];
  /** @type {number | null} */
  let tokenIndent = null;
  /** @type {string[]} */
  let tokenVars = [];
  /** @type {string[]} */
  const rootVars = [];
  /** @type {string[]} */
  const darkVars = [];
  // Manual-toggle variants: `tokens [data-theme=dark]` collects custom
  // properties under an attribute-scoped `:root` so a `:store theme` toggle can
  // flip them with no JS beyond writing the attribute.
  /** @type {Map<string, string[]>} */
  const attrVars = new Map();

  for (let i = 0; i < lines.length; i++) {
    const { indent, text } = lines[i];
    // Structure decides meaning: a line opens a block (selector) exactly when
    // the next line is indented deeper. Everything else is a declaration.
    const opensBlock = i + 1 < lines.length && lines[i + 1].indent > indent;

    // `tokens` opens a design-token block emitting `:root { --name: value }`.
    // An optional modifier picks a variant: `tokens dark` collects into a
    // `prefers-color-scheme: dark` override (OS-driven), while a bracketed
    // `tokens [data-theme=dark]` scopes the override to a `:root` attribute for
    // manual toggling. Both reuse the same `--name` properties.
    // Capture the whole modifier (`.+`, not `\S+`) so a malformed bracketed
    // modifier with internal spaces (`[data-theme=dark extra]`) is still routed
    // to normalizeAttr's null fail-safe rather than slipping through as a bogus
    // `tokens …` selector.
    const tokenMatch = /^tokens(?:\s+(.+))?$/.exec(text);
    if (tokenMatch && opensBlock) {
      tokenIndent = indent;
      const modifier = tokenMatch[1];
      if (!modifier) {
        tokenVars = rootVars;
      } else if (modifier === "dark") {
        tokenVars = darkVars;
      } else if (modifier.startsWith("[") && modifier.endsWith("]")) {
        const attr = normalizeAttr(modifier);
        if (attr) {
          const selector = `:root${attr}`;
          tokenVars = attrVars.get(selector) ?? [];
          attrVars.set(selector, tokenVars);
        } else {
          tokenVars = rootVars; // malformed `[…]` modifier → fall back to default :root tokens
        }
      } else {
        tokenVars = rootVars;
      }
      continue;
    }

    if (tokenIndent !== null && indent > tokenIndent) {
      const [name, ...rest] = text.split(/\s+/);
      tokenVars.push(`  --${name}: ${rest.join(" ")};`);
      continue;
    }

    if (tokenIndent !== null && indent <= tokenIndent) tokenIndent = null;
    while (stack.length && (stack.at(-1)?.indent ?? -1) >= indent) stack.pop();

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

  // Prepend tokens ahead of selector rules. `unshift` reverses insertion order,
  // so push the overrides first to land them after the `:root` defaults.
  for (const [selector, vars] of attrVars) {
    if (vars.length) css.unshift(`${selector} {\n${vars.join("\n")}\n}`);
  }
  if (darkVars.length) {
    css.unshift(`@media (prefers-color-scheme: dark) {\n:root {\n${darkVars.join("\n")}\n}\n}`);
  }
  if (rootVars.length) css.unshift(`:root {\n${rootVars.join("\n")}\n}`);
  return css.join("\n");
}

/**
 * Normalize a bracketed token modifier into a valid attribute selector,
 * quoting the value so `[data-theme=dark]` becomes `[data-theme="dark"]`.
 * Returns null for a malformed modifier (`[]`, `[a=b c]`, injection-shaped
 * input) so the caller can fall back to default `:root` tokens instead of
 * emitting a junk selector.
 * @param {string} bracketed
 * @returns {string | null}
 */
function normalizeAttr(bracketed) {
  const m = bracketed.match(/^\[\s*([^\]=\s]+)\s*=\s*"?([^\]"]*)"?\s*\]$/);
  return m ? `[${m[1]}="${m[2]}"]` : null;
}

/**
 * Combine a selector with its parent (handles `&` nesting and comma lists).
 * @param {string} text
 * @param {string | null | undefined} parent
 * @returns {string}
 */
function normalizeSelector(text, parent) {
  const selector = text === "page" ? "body" : text;
  if (!parent || parent === ":root") return selector;
  return selector
    .split(",")
    .map((/** @type {string} */ part) => {
      const clean = part.trim();
      return clean.startsWith("&") ? clean.replace("&", parent) : `${parent} ${clean}`;
    })
    .join(", ");
}
