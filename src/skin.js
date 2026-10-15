import crypto from "node:crypto";
import { wdError } from "./compiler/context.js";

// Concrete, compilable skins for the at-rule error hints + the error registry
// (src/errors.js). Multi-line because both at-rules are block constructs; a
// test in tests/skin-atrules.test.js compiles each verbatim.
export const FONT_FACE_EXAMPLE = '@font-face\n  font-family "Newsreader"';
export const KEYFRAMES_EXAMPLE = "@keyframes fade-in\n  to\n    opacity 1";

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
 *
 * `@font-face` and `@keyframes <name>` are self-contained at-rule blocks: their
 * indented children are descriptors / keyframe selectors (never page
 * selectors), they are ALWAYS global (never scope-stamped, same contract as
 * `tokens`), and their declaration values use the same alias/`$token` pipeline.
 * @param {string} source
 * @param {{ scope?: string, subjects?: Set<string>, file?: string }} [opts]
 *   `scope`: the scope id enabling scoped mode. `subjects`: an optional set the
 *   compiler fills with every scoped subject token (`.card`, `h2`, `#id`) for
 *   the unused-selector warning, so the caller need not re-parse the source.
 *   `file`: the skin's path, threaded into author-facing errors so they report
 *   `file:line` (the builder always passes it; a bare call reports `on line N`).
 * @returns {string}
 */
export function compileSkin(source, opts = {}) {
  const scope = opts.scope;
  const subjects = opts.subjects;
  const file = opts.file;
  const lines = source
    .replace(/\r\n?/g, "\n")
    // Strip /* … */ block comments (any span), KEEPING their newlines so the
    // `line` recorded below stays the true file line even past a multi-line
    // comment.
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
    .split("\n")
    .map((raw, index) => ({
      indent: (raw.match(/^\s*/)?.[0] ?? "").length,
      text: raw.trim(),
      line: index + 1
    }))
    .filter(({ text }) => {
      if (!text || text.startsWith("//")) return false;
      // Decorative divider lines (----, ====, * * *, ~~~) carry no rule and would
      // otherwise parse as a bogus selector/declaration. Anything with a letter or
      // digit is real content; punctuation-only lines are skipped.
      return /[A-Za-z0-9]/.test(text);
    });

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

    // `@font-face` / `@keyframes` are self-contained at-rule BLOCKS, not
    // selector wrappers like `@media`/`@supports`: their indented children are
    // font descriptors / keyframe selectors, so the generic "wrap nested rules"
    // path would mangle them (`@font-face { :root { … } }`). The whole subtree
    // is consumed here and the loop resumes after it. Like `tokens`, both are
    // ALWAYS global — a `scoped` skin never stamps them — and their values run
    // through the same declaration pipeline (aliases, `$token` refs).
    const atRule = /^@(font-face|keyframes)(?:\s+(.+))?$/.exec(text);
    if (atRule) {
      const media = stack.find((frame) => frame.media)?.media;
      const block = collectAtRule(atRule[1], atRule[2], lines, i, file);
      css.push(media ? `${media} {\n${block.css}\n}` : block.css);
      i = block.end;
      continue;
    }

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

// A keyframe selector: `from`, `to`, a percentage (`50%`), or a comma list of
// those (`50%, 75%`). Anything else inside `@keyframes` is an authoring error,
// never a declaration or an element selector.
const KEYFRAME_SELECTOR = /^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*$/;

/**
 * An author-facing at-rule error, routed through `wdError` like every other
 * compile error: it carries a registered WD8xx code (src/errors.js), the true
 * source line, and a corrective `Use:` hint. The file is named when the caller
 * threaded one (the builder always does); a bare `compileSkin` call has no
 * path, so the location falls back to `on line N`.
 * @param {string} summary What is wrong, naming the offending text.
 * @param {import("./compiler/context.js").WdErrorInfo} wd The structured mirror;
 *   `code` is required (every at-rule error is registered in src/errors.js).
 * @returns {Error & { wd: import("./compiler/context.js").WdErrorInfo }}
 */
function skinError(summary, wd) {
  const where = wd.file ? ` in ${wd.file}:${wd.line}` : ` on line ${wd.line}`;
  return wdError(`${summary}${where}. Use: ${wd.hint}`, wd);
}

/**
 * One declaration line (`prop value`, space-separated, no colon/semicolon)
 * rendered as `prop: value;` through the shared pipeline: property aliases
 * (`radius`, `bg`, `font`) resolve and `$token` refs become `var(--token)`.
 * @param {string} text
 * @returns {string}
 */
function declaration(text) {
  const [prop, ...rest] = text.split(/\s+/);
  const cssProp = resolveProp(prop, rest);
  const value = rest.join(" ").replace(/\$([a-zA-Z0-9_-]+)/g, "var(--$1)");
  return `${cssProp}: ${value};`;
}

/**
 * Compile one `@font-face`/`@keyframes` subtree into a self-contained,
 * always-global at-rule block.
 *
 * `@font-face` children are declarations (descriptors); nesting is invalid.
 * `@keyframes <name>` children are keyframe selectors (`from`, `to`, `50%`,
 * `50%, 75%`), each with its own indented declarations; a keyframe selector is
 * validated against KEYFRAME_SELECTOR so it can never be misread as a
 * declaration or an element selector, and declarations cannot nest further.
 * Every rejection is a coded WD8xx error pointing at the offending line.
 * @param {string} kind `font-face` or `keyframes`.
 * @param {string | undefined} rest Text after the at-rule keyword (the
 *   keyframes name; invalid on `@font-face`).
 * @param {{ indent: number, text: string, line: number }[]} lines Preprocessed
 *   skin lines, each carrying its true 1-based file line.
 * @param {number} start Index of the at-rule line.
 * @param {string | undefined} file The skin's path, when the caller knows it.
 * @returns {{ css: string, end: number }} `end` = last consumed line index.
 */
function collectAtRule(kind, rest, lines, start, file) {
  const indent = lines[start].indent;

  if (kind === "font-face") {
    if (rest)
      throw skinError(`@font-face takes no name, got "${rest}"`, {
        code: "WD804",
        file,
        line: lines[start].line,
        hint: `write the descriptors indented beneath a bare @font-face line — e.g. font-family "Newsreader"`,
        example: FONT_FACE_EXAMPLE
      });
    /** @type {string[]} */
    const decls = [];
    let i = start;
    while (i + 1 < lines.length && lines[i + 1].indent > indent) {
      i++;
      if (i + 1 < lines.length && lines[i + 1].indent > lines[i].indent)
        throw skinError(
          `@font-face only takes declarations — "${lines[i].text}" opens a nested block, which is not valid inside @font-face`,
          {
            code: "WD804",
            file,
            line: lines[i].line,
            hint: `keep every @font-face child a flat prop value declaration — e.g. font-family "Newsreader"`,
            example: FONT_FACE_EXAMPLE
          }
        );
      decls.push(`  ${declaration(lines[i].text)}`);
    }
    if (!decls.length)
      throw skinError("@font-face has no declarations", {
        code: "WD804",
        file,
        line: lines[start].line,
        hint: `indent its descriptors beneath it — e.g. font-family "Newsreader"`,
        example: FONT_FACE_EXAMPLE
      });
    return { css: `@font-face {\n${decls.join("\n")}\n}`, end: i };
  }

  if (!rest)
    throw skinError("@keyframes needs a name", {
      code: "WD805",
      file,
      line: lines[start].line,
      hint: "@keyframes <name> — e.g. @keyframes fade-in",
      example: KEYFRAMES_EXAMPLE
    });
  if (!/^-?[A-Za-z_][\w-]*$/.test(rest))
    throw skinError(`invalid @keyframes name "${rest}"`, {
      code: "WD805",
      file,
      line: lines[start].line,
      hint: "name it with a plain CSS identifier — e.g. @keyframes fade-in",
      example: KEYFRAMES_EXAMPLE
    });
  /** @type {string[]} */
  const stops = [];
  let i = start;
  while (i + 1 < lines.length && lines[i + 1].indent > indent) {
    i++;
    const selector = lines[i].text;
    const selectorLine = lines[i].line;
    const selectorIndent = lines[i].indent;
    if (!KEYFRAME_SELECTOR.test(selector))
      throw skinError(`"${selector}" is not a keyframe selector in @keyframes ${rest}`, {
        code: "WD806",
        file,
        line: selectorLine,
        hint: "use from, to, or a percentage (50%, or a list like 50%, 75%)",
        example: KEYFRAMES_EXAMPLE
      });
    /** @type {string[]} */
    const decls = [];
    while (i + 1 < lines.length && lines[i + 1].indent > selectorIndent) {
      i++;
      if (i + 1 < lines.length && lines[i + 1].indent > lines[i].indent)
        throw skinError(
          `@keyframes declarations cannot nest — "${lines[i].text}" opens a block inside keyframe "${selector}"`,
          {
            code: "WD807",
            file,
            line: lines[i].line,
            hint: "keep each keyframe's declarations flat, one level beneath its selector — e.g. opacity 1",
            example: KEYFRAMES_EXAMPLE
          }
        );
      decls.push(`    ${declaration(lines[i].text)}`);
    }
    if (!decls.length)
      throw skinError(`keyframe "${selector}" in @keyframes ${rest} has no declarations`, {
        code: "WD807",
        file,
        line: selectorLine,
        hint: "indent the declarations beneath the keyframe selector — e.g. opacity 1",
        example: KEYFRAMES_EXAMPLE
      });
    stops.push(`  ${selector} {\n${decls.join("\n")}\n  }`);
  }
  if (!stops.length)
    throw skinError(`@keyframes ${rest} has no keyframe selectors`, {
      code: "WD807",
      file,
      line: lines[start].line,
      hint: "indent from/to/percentage blocks beneath it — e.g. from",
      example: KEYFRAMES_EXAMPLE
    });
  return { css: `@keyframes ${rest} {\n${stops.join("\n")}\n}`, end: i };
}
