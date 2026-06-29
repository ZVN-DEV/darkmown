// ---------------------------------------------------------------------------
// Shared types + tiny helpers threaded through every compiler module.
//
// The compiler is split along its natural seams (frontmatter, body parser,
// directive handlers, loop pipeline, predicates, interpolation, includes,
// markdown, page shell). This module holds the typedefs and the small helpers
// that the rest of the modules lean on, so the dependency graph stays a clean
// DAG with this file at the root (it imports nothing of its own).
// ---------------------------------------------------------------------------

/**
 * @typedef {import("../config.js").Paths} Paths
 */

/**
 * Frontmatter values are scalars or inline arrays of scalars.
 * @typedef {string | number | boolean | null | Array<string | number | boolean | null>} FrontmatterValue
 */

/**
 * Parsed page frontmatter, keyed by field name.
 * @typedef {Record<string, FrontmatterValue>} Meta
 */

/**
 * Collected output assets for a compiled document.
 * @typedef {object} Assets
 * @property {Set<string>} skins Public hrefs of compiled skin stylesheets.
 * @property {Set<string>} scripts Public hrefs of colocated page scripts.
 * @property {Map<string, string>} files Source path → public href for emitted assets.
 * @property {boolean} runtime Whether the reactive runtime is required.
 * @property {Set<string>} behaviors Names of framework behavior modules this page
 *   needs (`slider` is compile-time only and never appears here; `sortable`,
 *   `carousel` each emit a pay-for-what-you-use `/__wd/behaviors/<name>.js`).
 * @property {boolean} hasCode Whether the page has a build-time-highlighted code
 *   block, so the framework highlight stylesheet (`/__wd/highlight.css`) is
 *   emitted and linked — pay-for-what-you-use, zero JS.
 * @property {Set<string>} scopedSkins Source paths of colocated `.skin` files
 *   that opted into scoping (`scoped` first line). The builder emits these with
 *   the scope attribute and runs the unused-selector warning against the stamped
 *   subtree; the HTML stamp uses them to scope the matching page/include subtree.
 */

/**
 * The pagination intent a `@loop … paginate N` records during compile, so the
 * builder can multiply routes (page 1 at the listing route, 2+ at
 * `/<route>/page/<n>/`). `total` is the post-`where`/`sort` page count for the
 * collection the loop drew from.
 * @typedef {object} Pagination
 * @property {number} perPage Rows per page (the `paginate N` value).
 * @property {number} total Total page count (≥ 1).
 * @property {string} collection Collection name the loop paginated.
 */

/**
 * Per-document compilation accumulator shared across includes/sections.
 * @typedef {object} Compilation
 * @property {Assets} assets
 * @property {Map<string, unknown>} state Declared state keys → initial values.
 * @property {Set<string>} stores Page-global store names (a subset of state keys).
 * @property {string[]} warnings Non-fatal authoring hints.
 * @property {number} sectionCounter Counter for auto-generated section ids.
 * @property {Map<string, import("./collections.js").CollectionRow[]>} collections
 *   Collection name → entry rows, built from the router's routes and threaded in
 *   so a bare-name `@loop blog into post` resolves to its entries at build time.
 * @property {import("./context.js").Pagination | null} pagination The pagination
 *   intent a `@loop … paginate N` recorded this compile, or null. The builder
 *   reads it to multiply routes; one paginated loop per page is supported.
 */

/**
 * A lexical scope chain for static interpolation values (include args, loop vars).
 * @typedef {object} Scope
 * @property {Scope | null} parent
 * @property {Record<string, unknown>} vars
 */

/**
 * Per-file compile context threaded through the directive handlers.
 * @typedef {object} Ctx
 * @property {string} file Absolute path to the file being compiled.
 * @property {Paths} context Resolved project paths.
 * @property {string[]} stack Include stack (real paths) for cycle detection.
 * @property {Scope} scope Static value scope chain.
 * @property {Compilation} comp Shared compilation accumulator.
 * @property {string[]} sections Active section-id scope chain.
 * @property {string | null} loopItem Name of the current reactive loop item, if any.
 * @property {string} [loopKey] State key of the list being looped, if any.
 * @property {boolean} [loopMeta] Inside a loop body, so `$index`/`$first`/… are valid.
 * @property {import("markdown-it").default} [md] Markdown-it instance selected for this file.
 */

/**
 * A compiled page document.
 * @typedef {object} CompiledDocument
 * @property {Meta} meta
 * @property {string} html
 * @property {Assets} assets
 * @property {string[]} warnings
 * @property {Pagination | null} pagination The pagination intent a paginated
 *   `@loop` recorded, or null. The builder reads it to multiply routes.
 */

/**
 * A compiled page: the document plus its full HTML shell.
 * @typedef {object} CompiledPage
 * @property {Meta} meta
 * @property {string} html
 * @property {Assets} assets
 * @property {string[]} warnings
 * @property {Pagination | null} pagination The pagination intent a paginated
 *   `@loop` recorded, or null. The builder reads it to multiply routes.
 */

/**
 * A compiled `@loop … where` predicate.
 * @typedef {object} Predicate
 * @property {string} body Safe JS boolean expression over `I()`/`S()`/`C()`.
 * @property {boolean} refsState Whether the predicate reads declared state.
 */

/**
 * A loop offset/limit argument: a non-negative integer literal or a state key.
 * @typedef {{ kind: "literal", value: number } | { kind: "key", value: string }} NumArg
 */

/**
 * Loop clause configuration shared by the static and reactive paths.
 * @typedef {object} LoopOpts
 * @property {Predicate | null} where
 * @property {{ key: string, keyKind: "literal" | "key", dir: string, dirKind: "literal" | "key" } | null} sort A literal item field + asc/desc, or a `:state`/`:store` key for either (reactive, clickable-header sort).
 * @property {boolean} reverse
 * @property {NumArg | null} offset
 * @property {NumArg | null} limit
 * @property {string[] | null} empty Empty-branch body lines, if any.
 * @property {boolean} clauseRefsState Whether offset/limit reference state.
 * @property {boolean} sortable Drag-to-reorder the underlying :state/:store list
 *   (the `sortable` clause). Only valid on a plain reactive state-key loop.
 * @property {number | null} paginate Rows-per-page for a `paginate N` clause, or
 *   null. Only valid on a collection loop; multiplies the listing into static
 *   pages (page 1 at the route, 2+ at `/<route>/page/<n>/`) and exposes a `page`
 *   pager to the template scope.
 */

/**
 * A parsed `:button` action.
 * @typedef {object} Action
 * @property {string} op Runtime operation (inc/dec/add/sub/append/prepend/set/toggle/member-toggle/remove/remove-value/clear/merge/delete/reset/append-row).
 * @property {string} target State key (possibly dotted) the action mutates.
 * @property {unknown} [value] Literal value for value-carrying ops.
 */

// Page-include extensions are the only two file types `@include` will pull in.
export const pageIncludeExtensions = [".md", ".wd"];

// Reserved per-row meta variables, mapped to their runtime marker token. Shared
// by the body parser, the `:if` handler, and prose interpolation.
/** @type {Record<string, string>} */
export const LOOP_META = {
  $index: "index",
  $number: "number",
  $first: "first",
  $last: "last",
  $count: "count"
};

/** @returns {Compilation} */
export function createCompilation() {
  return {
    assets: {
      skins: new Set(),
      scripts: new Set(),
      files: new Map(),
      runtime: false,
      behaviors: new Set(),
      hasCode: false,
      scopedSkins: new Set()
    },
    state: new Map(),
    stores: new Set(),
    warnings: [],
    sectionCounter: 0,
    collections: new Map(),
    pagination: null
  };
}

/**
 * @param {Scope | null} parent
 * @param {Record<string, unknown>} [vars]
 * @returns {Scope}
 */
export function createScope(parent, vars = {}) {
  return { parent, vars: { ...vars } };
}

/**
 * Format a source location as `file:line` (1-based) for compile errors. Keeps the
 * file path intact so existing message matchers still pass, while pointing at the
 * directive's (or unclosed opener's) line.
 * @param {string} file
 * @param {number} index 0-based line index.
 * @returns {string}
 */
export function at(file, index) {
  return `${file}:${index + 1}`;
}
