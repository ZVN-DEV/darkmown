// ---------------------------------------------------------------------------
// Interpolation primitives: path/value resolution, state-key lookup, scalar
// parsing, and HTML escaping. These are the leaf utilities the directive
// handlers, loops, predicates, and markdown layer all build on — it imports
// only `context.js` (which imports nothing), so it sits at the root of the DAG.
// ---------------------------------------------------------------------------

import { wdError } from "./context.js";

/**
 * @typedef {import("./context.js").Scope} Scope
 * @typedef {import("./context.js").Ctx} Ctx
 */

/**
 * Walk the scope chain for a top-level variable.
 * @param {Scope} scope
 * @param {string} name
 * @returns {{ found: true, value: unknown } | { found: false }}
 */
export function lookupVar(scope, name) {
  /** @type {Scope | null} */
  let current = scope;
  for (; current; current = current.parent) {
    // `Object.hasOwn`, never `in`: a scope frame is a plain object, so `in` also
    // answers true for every Object.prototype member. With it, `{ toString }`
    // resolved to the inherited function and rendered
    // "function toString() { [native code] }" into the page, and
    // `@include /p.wd with v={ constructor }` leaked the Object constructor into
    // the value pipeline. Own keys only — the scope holds exactly what the
    // author put there.
    if (Object.hasOwn(current.vars, name)) return { found: true, value: current.vars[name] };
  }
  return { found: false };
}

/**
 * Resolve a dotted path against the static scope chain.
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {{ found: true, value: unknown } | { found: false }}
 */
export function lookupPath(expr, ctx) {
  const segs = expr.split(".");
  const head = lookupVar(ctx.scope, segs[0]);
  if (!head.found) return { found: false };
  return { found: true, value: getPath(head.value, segs.slice(1)) };
}

/**
 * Safely read a dotted path off a value, rejecting prototype-pollution segments.
 * @param {unknown} value
 * @param {string[]} segments
 * @returns {unknown}
 */
export function getPath(value, segments) {
  /** @type {any} */
  let current = value;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (["constructor", "prototype", "__proto__"].includes(segment)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * Validate a dotted path shape, rejecting prototype-pollution segments at every
 * level. Shared by actions/loops/fetch. Throws with a corrective `Use:` hint.
 * @param {string} path Dotted path, e.g. `cart.items`.
 * @param {Ctx} ctx
 * @param {string} use Corrective suggestion for the error message.
 * @returns {string[]} The validated segments.
 */
export function validatePath(path, ctx, use) {
  const segs = path.split(".");
  if (segs.some((seg) => ["constructor", "prototype", "__proto__"].includes(seg))) {
    throw wdError(`Path segment in "${path}" is not allowed in ${ctx.file}. Use: ${use}`, {
      code: "WD002",
      file: ctx.file,
      hint: use
    });
  }
  return segs;
}

/**
 * Resolve a bare state name to its fully-qualified key, walking section scopes.
 * @param {string} name
 * @param {Ctx} ctx
 * @returns {string | null}
 */
export function resolveStateKey(name, ctx) {
  for (let i = ctx.sections.length - 1; i >= 0; i--) {
    const key = `${ctx.sections[i]}:${name}`;
    if (ctx.comp.state.has(key)) return key;
  }
  return ctx.comp.state.has(name) ? name : null;
}

/**
 * Render an interpolated value as text. Arrays join with ", " (matching the
 * documented `{ meta.tags }` behavior); a bare object is a mistake — fail
 * loudly with a fix rather than emitting "[object Object]".
 * @param {unknown} value
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {string}
 */
export function interpolateLeaf(value, expr, ctx) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") {
    throw wdError(
      `Cannot interpolate the object value "{ ${expr} }" in ${ctx.file}. Interpolate a field instead — e.g. { ${expr}.title } — or iterate it with @loop ${expr} into item.`,
      { code: "WD003", file: ctx.file }
    );
  }
  return String(value);
}

/**
 * Render the INITIAL value of a reactive binding (`data-wd-bind` /
 * `data-wd-each`) as text.
 *
 * Identical to {@link interpolateLeaf} except for arrays: the runtime paints a
 * bind by assigning to `textContent`, which coerces `["a", "b"]` with `String()`
 * to `"a,b"`, and the loop row-template fill already agrees (it escapes through
 * `String()` too). `interpolateLeaf`'s `", "` join is the STATIC contract — the
 * documented `{ meta.tags }` behavior for a value nothing will ever repaint — so
 * the two cannot share one rule. Painting the static form here made the first
 * reactive render silently rewrite `"a, b"` to `"a,b"`.
 * @param {unknown} value
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {string}
 */
export function interpolateBound(value, expr, ctx) {
  return Array.isArray(value) ? String(value) : interpolateLeaf(value, expr, ctx);
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

/**
 * JSON-encode a value for an inline `<script>`, escaping `<` to stay HTML-safe.
 * @param {unknown} value
 * @returns {string}
 */
export function safeScriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/**
 * Parse a `:state`/`:store`/`:theme` value: quoted string, boolean, null, number,
 * or JSON literal — falling back to the bare string. Multi-line array/object
 * literals are joined into one line before reaching here (see `joinValueDirective`
 * in body.js), so a value that opens a `[`/`{` but won't parse is genuinely
 * unbalanced (a missing `]`/`}`) and throws, rather than being stored verbatim as
 * the partial string `"["` — the silent-corruption footgun this guard replaces.
 * @param {string} raw
 * @param {string} [where] `file:line` for the error message.
 * @returns {unknown}
 */
export function parseStateValue(raw, where) {
  const value = raw.trim();
  if (/^["'].*["']$/.test(value)) return stripQuotes(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value);
  } catch {
    if (/^[[{]/.test(value)) {
      const open = value[0];
      const close = open === "[" ? "]" : "}";
      const shown = value.length > 60 ? `${value.slice(0, 57)}…` : value;
      throw wdError(
        `Unbalanced JSON value "${shown}"${where ? ` in ${where}` : ""}: this opens "${open}" but ` +
          `never closes it. :state/:store/:theme accept a multi-line array/object, but the literal ` +
          `must balance (a "${close}" is missing) with no blank lines inside it. ` +
          `A persist/ephemeral token goes AFTER the closing "${close}" on the last line, ` +
          `not on the declaration line. Quote it for literal bracket text (e.g. = "[draft]").`,
        { code: "WD004" }
      );
    }
    return value;
  }
}

/**
 * @param {string} raw
 * @returns {string | number | boolean}
 */
export function parseScalar(raw) {
  const trimmed = raw.trim();
  if (/^["']/.test(trimmed)) return stripQuotes(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

/**
 * @param {string} [value]
 * @returns {string}
 */
export function stripQuotes(value) {
  return value?.replace(/^["']|["']$/g, "") ?? "";
}

/**
 * Turn a field name / state key into a human-readable accessible name, e.g.
 * `quest` → "Quest", `user-name` → "User name", `firstName` → "First name".
 * Hyphens, underscores, and camelCase boundaries become spaces; the first letter
 * is capitalized. Used to auto-derive aria-label on generated form inputs.
 * @param {string} name
 * @returns {string}
 */
export function humanizeName(name) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // split camelCase
    .replace(/[-_]+/g, " ") // hyphens/underscores → spaces
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

// ---------------------------------------------------------------------------
// A BOUND href/src CARRIES A VALUE THE COMPILER NEVER SEES.
//
// `validateFetchUrl` and markdown-it's `validateLink` both vet a URL the AUTHOR
// wrote. A reactive attribute binding (`[go]({ url })`) is different: the
// compiler only sees the seed, and every later value arrives at runtime from
// state, a form field, or a fetched payload. So the scheme check has to run
// where the value lands, and it has to run in BOTH places — here for the
// build-time paint, and again in `src/runtime.js` for every repaint.
//
// Control characters are stripped before the test because browsers strip tab,
// newline and carriage return out of a URL attribute before resolving it, so
// `java\tscript:alert(1)` is a live `javascript:` URL to the browser and must be
// one to this guard too. Whitespace is stripped along with them, which only
// makes the test stricter. `tests/attr-binding.test.js` runs the same table
// through the compiler and the runtime so the two cannot drift.
// ---------------------------------------------------------------------------

/**
 * True for a value that must never be applied to a bound `href`/`src`.
 * @param {unknown} value
 * @returns {boolean}
 */
export function unsafeUrlValue(value) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — browsers strip these out of a URL, so the guard must too.
  return /^(javascript|data|vbscript):/i.test(String(value).replace(/[\u0000-\u0020\u007F]+/g, ""));
}

/**
 * Escape a value for safe inclusion in HTML text and attribute contexts.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Reverse {@link escapeHtml}. Used by the loop initial-paint fill to read a
 * `data-wd-fmt` attribute (HTML-escaped JSON) back into pipe stages at build
 * time — the browser does the same decode for the runtime via getAttribute.
 * `&amp;` is decoded last so `&amp;lt;` round-trips to `&lt;`, not `<`.
 * @param {string} value
 * @returns {string}
 */
export function unescapeHtml(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}
