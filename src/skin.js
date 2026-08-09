import crypto from "node:crypto";
import { wdError } from "./compiler/context.js";

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
  if (prop === "font" && (/^[\d.]/.test(rest[0] || "") || rest.join(" ").includes("/")))
    return "font";
  return aliases.get(prop) || prop;
}

/**
 * Derive a short, deterministic scope id from a skin's PROJECT-RELATIVE PATH.
 * Path-based (stable across content edits, unique per component file) and short
 * enough to read in the emitted CSS (`wd-7c21`). The same path always yields the
 * same id, so the CSS rewrite (builder) and the HTML stamp (page/include) agree
 * without sharing state — they just hash the same relative path. The path is
 * normalized to POSIX separators first so a build is identical on Windows.
 * @param {string} relPath Skin path relative to the project root (cwd).
 * @returns {string} The scope id, e.g. `wd-7c21`.
 */
export function scopeIdFor(relPath) {
  const posix = relPath.replaceAll("\\", "/");
  const hash = crypto.createHash("sha256").update(posix).digest("hex");
  return `wd-${hash.slice(0, 4)}`;
}

// Selectors that style the whole page, not a component subtree. In a `scoped`
// skin they are a mistake: scoping appends an attribute to the *subject* element,
// so `page`/`body`/`html`/`*`/`::selection` would either become a no-op (no
// element in the subtree carries the attribute on <body>/<html>) or silently
// fail to do what the author means. We error and point them at a global skin.
const PAGE_LEVEL_SELECTORS = new Set(["page", "*", "html", "body", "::selection"]);

/**
 * A nesting frame in the indentation stack.
 * @typedef {object} SkinFrame
 * @property {number} indent
 * @property {string | null} selector
 * @property {string} [media]
 */

/**
 * Compile indentation-based `.skin` source into CSS.
 *
 * Scoping (opt-in): when `opts.scope` is set the skin is compiled in scoped
 * mode — every selector RULE gets `[data-wd-scope="<id>"]` appended to the
 * subject of each compound selector, so the stylesheet only ever matches inside
 * the stamped subtree. Design tokens (`tokens` / `tokens dark` / `tokens [attr]`)
 * stay GLOBAL on `:root` regardless, so `var(--x)` and dark mode keep working
 * site-wide. A whole-selector `:global(.x)` escapes scoping. Page-level selectors
 * (`page`/`*`/`html`/`body`/`::selection`) are a compile error in scoped mode.
 * Without `opts.scope`, output is byte-identical to before this feature existed.
 * @param {string} source
 * @param {{ scope?: string, subjects?: Set<string> }} [opts] `scope`: the scope
 *   id enabling scoped mode. `subjects`: an optional set the compiler fills with
 *   every scoped subject token (`.card`, `h2`, `#id`) for the unused-selector
 *   warning, so the caller need not re-parse the source.
 * @returns {string}
 */
export function compileSkin(source, opts = {}) {
  const scope = opts.scope;
  const subjects = opts.subjects;
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

  // The opt-in marker: `scoped` must be the FIRST meaningful line (the filter
  // above has already dropped comments, blanks, and dividers). Anywhere else it
  // is an error — a `scoped` mid-file means the author misread the contract.
  let start = 0;
  if (scope && lines.length && lines[0].text === "scoped" && lines[0].indent === 0) {
    start = 1;
  }
  for (let i = start; i < lines.length; i++) {
    if (lines[i].text === "scoped" && lines[i].indent === 0) {
      throw wdError('"scoped" must be the first line of a .skin file', { code: "WD801" });
    }
  }

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

  for (let i = start; i < lines.length; i++) {
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
        if (scope) guardPageLevel(text, parent);
        stack.push({ indent, selector: normalizeSelector(text, parent) });
      }
      continue;
    }

    const current = stack.at(-1)?.selector || ":root";
    // A leaf with no enclosing selector lands on `:root` — a page-level write. In
    // a scoped skin that is the same mistake `guardPageLevel` rejects (and the
    // place a filtered bare `*`/`page` reset would otherwise leak through to), so
    // it errors with the same hint instead of emitting a never-matching rule.
    if (scope && current === ":root") {
      throw wdError(
        `page-level declaration "${text}" is not allowed in a scoped .skin — page-level styles belong in a global skin, not a scoped one`,
        { code: "WD802" }
      );
    }
    const media = stack.find((frame) => frame.media)?.media;
    const [prop, ...rest] = text.split(/\s+/);
    const cssProp = resolveProp(prop, rest);
    const value = rest.join(" ").replace(/\$([a-zA-Z0-9_-]+)/g, "var(--$1)");
    const subject = scope ? scopeSelector(current, scope, subjects) : current;
    const rule = `${subject} { ${cssProp}: ${value}; }`;
    css.push(media ? `${media} { ${rule} }` : rule);
  }

  // Prepend tokens ahead of selector rules. `unshift` reverses insertion order,
  // so push the overrides first to land them after the `:root` defaults.
  for (const [selector, vars] of attrVars) {
    if (vars.length) css.unshift(`${selector} {\n${vars.join("\n")}\n}`);
  }
  if (darkVars.length) {
    const body = darkVars.join("\n");
    // One `tokens dark` block powers BOTH OS-auto and a manual :theme toggle.
    // Forced `[data-theme="dark"]` is always dark; the OS-dark media query applies
    // unless the visitor forced light. Both rules reference the same tokens, so a
    // user override wins without duplicating the palette.
    css.unshift(`:root[data-theme="dark"] {\n${body}\n}`);
    css.unshift(
      `@media (prefers-color-scheme: dark) {\n:root:not([data-theme="light"]) {\n${body}\n}\n}`
    );
  }
  if (rootVars.length) css.unshift(`:root {\n${rootVars.join("\n")}\n}`);
  return css.join("\n");
}

/**
 * Reject page-level selectors in a scoped skin. Checks the AUTHORED selector
 * text (before `page`→`body` rewrite) so `page` is caught by name. Each
 * comma-separated part is inspected; a bare top-level selector (no parent) that
 * is one of the page-level set, or a top-level `::selection`, errors with a hint
 * pointing the author at a global skin.
 * @param {string} text Raw selector line.
 * @param {string | null | undefined} parent Enclosing selector, if nested.
 * @returns {void}
 */
function guardPageLevel(text, parent) {
  // Only TOP-LEVEL selectors are page-level mistakes — `.card *` (a descendant
  // wildcard inside a component) is fine, so the check applies when there is no
  // parent selector chain (`:root` is the implicit root, treated as none).
  if (parent && parent !== ":root") return;
  for (const part of text.split(",")) {
    const clean = part.trim();
    if (PAGE_LEVEL_SELECTORS.has(clean)) {
      throw wdError(
        `page-level selector "${clean}" is not allowed in a scoped .skin — page-level styles belong in a global skin, not a scoped one`,
        { code: "WD803" }
      );
    }
  }
}

/**
 * Append the scope attribute to a resolved selector list (post `&`-nesting).
 * Each comma-separated compound selector gets `[data-wd-scope="<id>"]` on its
 * SUBJECT (rightmost simple selector), inserted BEFORE any trailing
 * pseudo-class/element so the result stays valid CSS (`.card[…]:hover`, never
 * `.card:hover[…]`). A whole-selector `:global(.x)` unwraps to a plain `.x` with
 * NO attribute — the documented escape hatch (whole-selector only this release).
 * @param {string} selectorList Resolved selector list (may contain commas).
 * @param {string} scope Scope id.
 * @param {Set<string>} [subjects] Optional sink for subject tokens (warning).
 * @returns {string}
 */
function scopeSelector(selectorList, scope, subjects) {
  return selectorList
    .split(",")
    .map((part) => {
      const clean = part.trim();
      // Whole-selector `:global(.toast)` → `.toast`, unscoped. Descendant
      // `:global` (`.card :global(.x)`) is intentionally NOT supported yet.
      const global = clean.match(/^:global\(\s*(.+?)\s*\)$/);
      if (global) return global[1];
      // The subject is the last whitespace-delimited compound. Combinators
      // (`>`, `+`, `~`) stand as their own tokens, so the subject is whatever
      // follows the final combinator/descendant gap.
      const tokens = clean.split(/\s+/);
      const subjectIndex = tokens.length - 1;
      const lead = tokens.slice(0, subjectIndex);
      const subject = tokens[subjectIndex];
      // Split the subject into its base (tag/class/id, plus attribute selectors)
      // and any trailing pseudo `:hover` / `::before`. The attribute slots in at
      // the base/pseudo seam: `.card::before` → `.card[scope]::before`.
      const seam = subject.search(/::?[a-zA-Z-]/);
      const base = seam === -1 ? subject : subject.slice(0, seam);
      const pseudo = seam === -1 ? "" : subject.slice(seam);
      if (subjects) subjects.add(subjectBase(base));
      const scoped = `${base}[data-wd-scope="${scope}"]${pseudo}`;
      return [...lead, scoped].join(" ");
    })
    .join(", ");
}

/**
 * Reduce a scoped subject base to the single token the unused-selector warning
 * checks against the stamped subtree: the leading `.class`, `#id`, or bare tag,
 * dropping any chained attribute selectors (`a[href]` → `a`). Returns `""` for a
 * subject that has no checkable token (a bare attribute selector), which the
 * caller treats as "always present" (never warns).
 * @param {string} base
 * @returns {string}
 */
function subjectBase(base) {
  const m = base.match(/^([.#]?[A-Za-z_][\w-]*)/);
  return m ? m[1] : "";
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
  if (!m) return null;
  // The value is quoted on the way out, but the NAME lands in the selector
  // verbatim — so it must be validated, not just captured. Without this an
  // input like `tokens [{=v]` emitted `:root[{="v"]`, whose stray brace
  // unbalances the stylesheet and makes a CSS parser swallow every rule that
  // follows it. Anything that is not a plain CSS identifier falls through to
  // the caller's `:root` fallback. (Found by tests/fuzz-skin.test.js.)
  if (!/^[A-Za-z_-][\w-]*$/.test(m[1])) return null;
  return `[${m[1]}="${m[2]}"]`;
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
