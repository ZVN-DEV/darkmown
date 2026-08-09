/**
 * @typedef {import("./context.js").Paths} Paths
 * @typedef {import("./context.js").Assets} Assets
 * @typedef {import("./context.js").Compilation} Compilation
 */
/**
 * Read a `.skin` file's first meaningful line (skipping `//` line comments,
 * `/* … *\/` block comments, blanks, and decorative dividers — the same skip
 * rules `compileSkin` applies) to decide whether it opts into scoping. A skin
 * scopes its selectors ONLY when that first line is exactly `scoped`; otherwise
 * it is global and untouched. This is the single source for "is this skin
 * scoped + what is its id", so the CSS rewrite (builder) and the HTML stamp
 * (page/include) always agree on both.
 * @param {string} skinPath Absolute path to the colocated `.skin` file.
 * @param {string} cwd Project root, for the path-based scope id.
 * @param {import("./reader.js").Reader} reader Source reader for the skin file.
 * @returns {{ scoped: boolean, scopeId: string }}
 */
export function scopeInfoForSkin(skinPath: string, cwd: string, reader: import("./reader.js").Reader): {
    scoped: boolean;
    scopeId: string;
};
/**
 * The scope info for a page/include's OWN colocated `.skin` sibling, or null
 * when there is no sibling skin. Used by the HTML stamp sites: a route's own
 * scoped skin → stamp the page body; an include's scoped skin → stamp the
 * returned subtree. Resolution mirrors `collectColocatedAssets` (same stem,
 * `.skin` extension).
 * @param {string} file Absolute path to the page/include source file.
 * @param {Paths} context
 * @param {import("./reader.js").Reader} reader Source reader for the skin file.
 * @returns {{ scoped: boolean, scopeId: string } | null}
 */
export function scopedSkinFor(file: string, context: Paths, reader: import("./reader.js").Reader): {
    scoped: boolean;
    scopeId: string;
} | null;
/**
 * Stamp `data-wd-scope="<id>"` onto every opening tag of a subtree — the HTML
 * half of compile-time scoped styles, mirroring {@link enhanceImages}: a
 * compile-time post-pass over assembled HTML, zero runtime JS. Every element
 * start tag that doesn't already carry a scope attribute gets one, so the scoped
 * stylesheet (whose selectors end in `[data-wd-scope="<id>"]`) matches inside
 * this subtree and nowhere else. Void/self-closing tags are stamped too (the
 * attribute is valid on any element). Closing tags, comments, doctype, and the
 * `<!`/`<?` families are left alone. A tag that ALREADY has a `data-wd-scope`
 * (e.g. a nested include with its own scope) keeps its own — first stamp wins.
 *
 * Raw-text / escapable-raw-text elements (`script`, `style`, `textarea`,
 * `title`) are special-cased: their OPENING tag is stamped (valid), but their
 * BODY is left byte-intact — `<`/`>` inside a `<script>` are JavaScript, not
 * markup, so stamping there would corrupt the content. A small tokenizer walks
 * tag-by-tag (quote-aware in attribute lists) and, on entering a raw-text
 * element, copies through verbatim until the matching close tag.
 * @param {string} html Subtree HTML to scope.
 * @param {string} scopeId Scope id (from {@link import("../skin.js").scopeIdFor}).
 * @returns {string}
 */
export function stampScope(html: string, scopeId: string): string;
/**
 * Register a page's colocated `.skin`/`.js` siblings as emitted assets.
 * @param {string} file
 * @param {Paths} context
 * @param {Assets} assets
 * @param {import("./reader.js").Reader} reader Source reader for sibling probing.
 * @returns {void}
 */
export function collectColocatedAssets(file: string, context: Paths, assets: Assets, reader: import("./reader.js").Reader): void;
/**
 * Resolve an include spec to an absolute path inside `site/pages` or `site/_`.
 * @param {string} spec Include target (may be quoted).
 * @param {string} fromFile File requesting the include.
 * @param {Paths} context
 * @param {boolean} allowAny Allow non-page extensions (e.g. JSON for `@loop`).
 * @param {string} loc Source location (`file:line`) for the error messages, so
 *   an unresolved/out-of-sandbox include reports the directive's line. Callers
 *   with a line index pass `at(ctx, index)`; pass `fromFile` for the file-only
 *   message.
 * @param {import("./reader.js").Reader} reader Source reader for existence
 *   probing, threaded from `ctx.comp.reader`.
 * @returns {string}
 */
export function resolveInclude(spec: string, fromFile: string, context: Paths, allowAny: boolean, loc: string, reader: import("./reader.js").Reader): string;
/**
 * @param {string} file
 * @param {Paths} context
 * @returns {boolean}
 */
export function isAllowedInclude(file: string, context: Paths): boolean;
/**
 * Warn when a plain `.md` file contains `.wd`-only syntax that stays inert.
 * @param {string} body
 * @param {string} file
 * @param {Compilation} comp
 * @returns {void}
 */
export function scanMarkdownHints(body: string, file: string, comp: Compilation): void;
export type Paths = import("./context.js").Paths;
export type Assets = import("./context.js").Assets;
export type Compilation = import("./context.js").Compilation;
