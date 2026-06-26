// ---------------------------------------------------------------------------
// Interpolation primitives: path/value resolution, state-key lookup, scalar
// parsing, and HTML escaping. These are the leaf utilities the directive
// handlers, loops, predicates, and markdown layer all build on — this module
// imports only the shared typedefs, so it sits near the root of the DAG.
// ---------------------------------------------------------------------------

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
    if (name in current.vars) return { found: true, value: current.vars[name] };
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
    throw new Error(`Path segment in "${path}" is not allowed in ${ctx.file}. Use: ${use}`);
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
    throw new Error(`Cannot interpolate the object value "{ ${expr} }" in ${ctx.file}. Interpolate a field instead — e.g. { ${expr}.title } — or iterate it with @loop ${expr} into item.`);
  }
  return String(value);
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
 * @param {string} raw
 * @returns {unknown}
 */
export function parseStateValue(raw) {
  const value = raw.trim();
  if (/^["'].*["']$/.test(value)) return stripQuotes(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  try {
    return JSON.parse(value);
  } catch {
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
    .replace(/[-_]+/g, " ")                  // hyphens/underscores → spaces
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
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
