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
export function lookupVar(scope: Scope, name: string): {
    found: true;
    value: unknown;
} | {
    found: false;
};
/**
 * Resolve a dotted path against the static scope chain.
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {{ found: true, value: unknown } | { found: false }}
 */
export function lookupPath(expr: string, ctx: Ctx): {
    found: true;
    value: unknown;
} | {
    found: false;
};
/**
 * Safely read a dotted path off a value, rejecting prototype-pollution segments.
 * @param {unknown} value
 * @param {string[]} segments
 * @returns {unknown}
 */
export function getPath(value: unknown, segments: string[]): unknown;
/**
 * Validate a dotted path shape, rejecting prototype-pollution segments at every
 * level. Shared by actions/loops/fetch. Throws with a corrective `Use:` hint.
 * @param {string} path Dotted path, e.g. `cart.items`.
 * @param {Ctx} ctx
 * @param {string} use Corrective suggestion for the error message.
 * @returns {string[]} The validated segments.
 */
export function validatePath(path: string, ctx: Ctx, use: string): string[];
/**
 * Resolve a bare state name to its fully-qualified key, walking section scopes.
 * @param {string} name
 * @param {Ctx} ctx
 * @returns {string | null}
 */
export function resolveStateKey(name: string, ctx: Ctx): string | null;
/**
 * Render an interpolated value as text. Arrays join with ", " (matching the
 * documented `{ meta.tags }` behavior); a bare object is a mistake — fail
 * loudly with a fix rather than emitting "[object Object]".
 * @param {unknown} value
 * @param {string} expr
 * @param {Ctx} ctx
 * @returns {string}
 */
export function interpolateLeaf(value: unknown, expr: string, ctx: Ctx): string;
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
export function interpolateBound(value: unknown, expr: string, ctx: Ctx): string;
/**
 * JSON-encode a value for an inline `<script>`, escaping `<` to stay HTML-safe.
 * @param {unknown} value
 * @returns {string}
 */
export function safeScriptJson(value: unknown): string;
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
export function parseStateValue(raw: string, where?: string): unknown;
/**
 * @param {string} raw
 * @returns {string | number | boolean}
 */
export function parseScalar(raw: string): string | number | boolean;
/**
 * @param {string} [value]
 * @returns {string}
 */
export function stripQuotes(value?: string): string;
/**
 * Turn a field name / state key into a human-readable accessible name, e.g.
 * `quest` → "Quest", `user-name` → "User name", `firstName` → "First name".
 * Hyphens, underscores, and camelCase boundaries become spaces; the first letter
 * is capitalized. Used to auto-derive aria-label on generated form inputs.
 * @param {string} name
 * @returns {string}
 */
export function humanizeName(name: string): string;
/**
 * True for a value that must never be applied to a bound `href`/`src`.
 * @param {unknown} value
 * @returns {boolean}
 */
export function unsafeUrlValue(value: unknown): boolean;
/**
 * Escape a value for safe inclusion in HTML text and attribute contexts.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value: unknown): string;
/**
 * Reverse {@link escapeHtml}. Used by the loop initial-paint fill to read a
 * `data-wd-fmt` attribute (HTML-escaped JSON) back into pipe stages at build
 * time — the browser does the same decode for the runtime via getAttribute.
 * `&amp;` is decoded last so `&amp;lt;` round-trips to `&lt;`, not `<`.
 * @param {string} value
 * @returns {string}
 */
export function unescapeHtml(value: string): string;
export type Scope = import("./context.js").Scope;
export type Ctx = import("./context.js").Ctx;
