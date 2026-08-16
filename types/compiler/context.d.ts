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
 * @property {Set<string>} fetchKeys Base state keys declared by `:fetch`, so
 *   bare `:if <key>_loading` / `:if <key>_error` regions get compile-time
 *   `role`/`aria-live` announcements.
 * @property {string[]} warnings Non-fatal authoring hints.
 * @property {number} sectionCounter Counter for auto-generated section ids.
 * @property {Map<string, number>} headingSlugs Heading-slug occurrence counts,
 *   shared across prose chunks and includes so anchor ids dedupe document-wide.
 * @property {Map<string, import("./collections.js").CollectionRow[]>} collections
 *   Collection name → entry rows, built from the router's routes and threaded in
 *   so a bare-name `@loop blog into post` resolves to its entries at build time.
 * @property {import("./context.js").Pagination | null} pagination The pagination
 *   intent a `@loop … paginate N` recorded this compile, or null. The builder
 *   reads it to multiply routes; one paginated loop per page is supported.
 * @property {Set<string>} deps Absolute paths of every source file this compile
 *   read: the page itself, every `@include` target, and every `@loop` JSON data
 *   file. The dev builder unions these (plus colocated assets) into the per-route
 *   dependency map that drives incremental rebuilds.
 * @property {Set<string>} collectionsUsed Names of the collections this compile
 *   looped, so a change to any entry of a collection rebuilds its consumers.
 * @property {import("./reader.js").Reader} reader The file reader every source
 *   read threads through — the real filesystem by default, or an in-memory map
 *   for `compileFromMemory`. Set once by `createCompilation` and reached via
 *   `ctx.comp.reader` in the directive handlers (includes, loop data).
 * @property {Symbol[]} symbols Every declared thing this compile saw, in source
 *   order, recorded by {@link recordSymbol} from the handler that parsed it.
 *   Surfaced on {@link CompiledPage} so a tool layer can answer "what is in this
 *   page?" without parsing `.wd` a second time.
 */
/**
 * One declared thing in a page, as the compiler saw it.
 *
 * `kind` is the directive family; `name` is what an author would call the thing
 * and is what `refs` matches on. `detail` is a short human string in the same
 * vocabulary the model writes, never a serialized AST: the tool layer's job is
 * to hand back text a model can nearly paste, and translation is where small
 * models lose.
 *
 * @typedef {object} Symbol
 * @property {"state" | "store" | "computed" | "theme" | "fetch" | "action" | "loop" | "form" | "field" | "if" | "include" | "read"} kind
 * @property {string} name The symbol's own name, or the thing it targets.
 * @property {string} [detail] Short source-shaped description, e.g. `cart append p`.
 * @property {boolean} [reactive] For loops: whether it stays reactive at runtime.
 * @property {string} [target] For actions: the state key written.
 * @property {string} [op] For actions: the validated action token.
 * @property {string} file Absolute path of the file the symbol was declared in.
 * @property {number} [endLine] For a block directive (`@loop`, `:if`), the
 *   1-based line its closer sits on, so a tool can address the whole block.
 * @property {number | null} line 1-based line in that file, or null for a read
 *   recorded by {@link recordRead} (see there for why prose reads carry no line).
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
 * @property {number} [bodyLine] 0-based file line the compiled body starts on
 *   (the frontmatter offset), so `at` reports true file line numbers.
 * @property {number} [lineOffset] 0-based body line the current `compileBody`
 *   slice starts on. Block handlers recurse with {@link nestedCtx}, so a line
 *   index inside a nested block body still maps to the true file line.
 * @property {Paths} context Resolved project paths.
 * @property {string[]} stack Include stack (real paths) for cycle detection.
 * @property {Scope} scope Static value scope chain.
 * @property {Compilation} comp Shared compilation accumulator.
 * @property {string[]} sections Active section-id scope chain.
 * @property {string | null} loopItem Name of the current reactive loop item, if any.
 * @property {string} [loopKey] State key of the list being looped, if any.
 * @property {number} [reactiveDepth] Number of enclosing REACTIVE `@loop` levels
 *   (0 at top level). The runtime reconciles at most two nested `data-wd-loop`
 *   levels — a third paints empty — so a third reactive level is rejected at
 *   compile time. Static (build-unrolled) loops flatten to markup and don't add
 *   a level, so they carry the count through without incrementing it.
 * @property {{ at: string, line: string }} [loopOpener] The current `@loop`
 *   opener's `file:line` + raw text, set when descending into a loop body so the
 *   reactive-nesting-depth error can point at the offending opener.
 * @property {boolean} [loopMeta] Inside a loop body, so `$index`/`$first`/… are valid.
 * @property {import("markdown-it").default} [md] Markdown-it instance selected for this file.
 * @property {(lines: string[], ctx: Ctx) => string} compileBody The body
 *   dispatcher, threaded through the context so block handlers (`:if`, `:::`,
 *   `:form`, `@loop`, …) recurse into nested bodies without importing the
 *   dispatcher back — the module graph stays an import-cycle-free DAG.
 * @property {(file: string, context: Paths, stack: string[], scope: Scope, comp: Compilation, sections: string[], loopItem: string | null, reactiveDepth?: number, loopOpener?: { at: string, line: string } | null) => { meta: Meta, html: string }} compileFile
 *   The per-file compile, threaded for the same reason so `@include` can
 *   compile its target file. `reactiveDepth`/`loopOpener` carry the enclosing
 *   reactive-loop nesting across the include boundary so the depth guard holds.
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
 * @property {Set<string>} deps Absolute source-file dependencies of this compile.
 * @property {Set<string>} collectionsUsed Collection names this compile looped.
 * @property {Symbol[]} symbols Every declared thing the compile saw, in
 *   source order. See {@link recordSymbol}.
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
 * @property {Set<string>} deps Absolute source-file dependencies of this compile.
 * @property {Set<string>} collectionsUsed Collection names this compile looped.
 * @property {Symbol[]} symbols Every declared thing the compile saw, in
 *   source order. See {@link recordSymbol}.
 */
/**
 * Structured, machine-readable companion to a compile error's string message.
 * The string `message` contract is unchanged; `wd` gives an AI edit-loop (or an
 * editor) the same facts without re-parsing the prose: which code, which
 * file/line, the corrective `Use:` template, and one concrete compilable
 * example line.
 * @typedef {object} WdErrorInfo
 * @property {string} code Stable error code (`WD` + three digits, e.g. `WD201`).
 *   Every code is registered in `src/errors.js` with a title, cause, and fix,
 *   and documented in `docs/errors.md`. {@link wdError} prefixes the string
 *   message with `[<code>] `, so the code is greppable from the message too.
 * @property {string} [file] Absolute path of the source file the error is in,
 *   when the throwing layer knows one (`compileSkin` is a pure string→string
 *   pass and a collection-row check names the entry route instead).
 * @property {number} [line] 1-based file line the error points at, when known
 *   (some errors — e.g. a bad `where` operand — are file-scoped only, matching
 *   the string message, which likewise omits the line there).
 * @property {string} [hint] The corrective `Use:` template (without the `Use: ` prefix).
 * @property {string} [example] One concrete, compilable directive line.
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
 * @property {number} [emptyStart] 0-based index the empty branch starts at
 *   within the loop body, so its nested errors report the true file line.
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
/**
 * Normalize CRLF/CR line endings to LF.
 *
 * Every line-structured parser in the project (frontmatter delimiters, the `.wd`
 * directive dispatcher, `.skin` indentation) tests LF-shaped text. Source files
 * authored on Windows — or checked out anywhere with git's `core.autocrlf`, the
 * default on Windows — arrive CRLF-terminated, and an un-normalized `\r` turns
 * `---` into `---\r` and silently defeats those tests. Applied at the reader
 * boundary and again at the two entry points that accept raw strings from
 * callers that bypass the reader; it is idempotent, so doubling up is free.
 * @param {string} text
 * @returns {string}
 */
export function normalizeNewlines(text: string): string;
/**
 * @param {import("./reader.js").Reader} reader The source reader for this
 *   compile (fs-backed by default; in-memory for `compileFromMemory`).
 * @returns {Compilation}
 */
export function createCompilation(reader: import("./reader.js").Reader): Compilation;
/**
 * Record one declared thing as the handler that owns it parses it.
 *
 * This is the compiler telling a tool layer what is in a page, rather than a
 * tool layer parsing `.wd` a second time. A shadow parser drifts, and the day it
 * disagrees with `compilePage` it tells a model something true about a file that
 * will not compile.
 *
 * Called from the `handle*` functions, where the 0-based `index` is live, so
 * every symbol carries a real `file:line`. Include bodies share the parent's
 * `Compilation` but compile under their own `ctx.file`, so attribution stays
 * correct with no extra plumbing.
 *
 * @param {Ctx} ctx
 * @param {number} index 0-based line index into the current body slice.
 * @param {Omit<Symbol, "file" | "line">} sym
 * @returns {Symbol} The pushed record, so a caller whose reactive/static decision
 *   happens in a later branch can stamp it rather than duplicate that logic.
 */
export function recordSymbol(ctx: Ctx, index: number, sym: Omit<Symbol, "file" | "line">): Symbol;
/**
 * Record where a block directive CLOSES, so a tool layer can address the whole
 * construct rather than only its opening line.
 *
 * Measured need, not speculation: with only the opener line recorded, the 1.5B
 * targeted a `@loop` for replacement and swapped out its header, leaving the
 * `@endloop` behind. That produced `[WD010] Stray "@endloop"` as the single
 * most common compile failure of the round-4 tool run. A `@loop` is three or
 * more lines and a tool has to be able to say so.
 *
 * The dispatcher owns this because only it has the block's extent, from
 * `scanBlock`/`scanConditional`. `at` is the index the block handler's own
 * symbol was pushed to; nested symbols recorded while compiling the body land
 * after it and are left alone.
 *
 * @param {Ctx} ctx
 * @param {number} at Index into `ctx.comp.symbols` the block handler wrote to.
 * @param {number} endIndex 0-based body index of the closing line.
 * @returns {void}
 */
export function stampBlockEnd(ctx: Ctx, at: number, endIndex: number): void;
/**
 * Record that a page READS a state key through an interpolation.
 *
 * Deliberately line-less. Prose is rendered a chunk at a time by markdown-it, so
 * no 0-based body `index` is in scope at the point a `{ name }` binding resolves,
 * and threading one through the markdown layer would mean tracking source
 * positions inside a renderer that does not care about them.
 *
 * Instead the compiler records the two things only it can know: that the
 * expression resolved to this state key, and the exact expression text. The tool
 * layer locates the line by searching the file for that compiler-supplied
 * string, which is a substring search for a known needle rather than a second
 * parser. Duplicates (a static loop re-renders its body once per row) are the
 * caller's to fold.
 *
 * @param {Ctx} ctx
 * @param {string} key Resolved state key.
 * @param {string} expr The binding expression as authored, e.g. `cart | count`.
 * @returns {void}
 */
export function recordRead(ctx: Ctx, key: string, expr: string): void;
/**
 * @param {Scope | null} parent
 * @param {Record<string, unknown>} [vars]
 * @returns {Scope}
 */
export function createScope(parent: Scope | null, vars?: Record<string, unknown>): Scope;
/**
 * Format a source location as `file:line` (1-based) for compile errors. Keeps the
 * file path intact so existing message matchers still pass, while pointing at the
 * directive's (or unclosed opener's) line. `index` is 0-based into the current
 * `compileBody` slice; `ctx.lineOffset` (where that slice starts in the body,
 * accumulated by {@link nestedCtx} as block handlers recurse) and `ctx.bodyLine`
 * (the frontmatter offset) shift it back to the true file line.
 * @param {Pick<Ctx, "file" | "bodyLine" | "lineOffset">} ctx
 * @param {number} index 0-based line index into the current body slice.
 * @returns {string}
 */
export function at(ctx: Pick<Ctx, "file" | "bodyLine" | "lineOffset">, index: number): string;
/**
 * The 1-based true file line for a body-slice `index` — the numeric half of
 * {@link at}, exposed so {@link wdError} can populate the structured `wd.line`.
 * @param {Pick<Ctx, "bodyLine" | "lineOffset">} ctx
 * @param {number} index 0-based line index into the current body slice.
 * @returns {number}
 */
export function lineOf(ctx: Pick<Ctx, "bodyLine" | "lineOffset">, index: number): number;
/**
 * Build a compile `Error` carrying a structured {@link WdErrorInfo} on `err.wd`
 * — so an AI edit-loop (or an editor) gets code/file/line/hint/example without
 * re-parsing the prose. The string message is the caller's text prefixed with
 * the stable `[WDxxx]` code, so a user can search the code straight out of the
 * terminal; everything after the prefix (the `file:line`, the corrective `Use:`
 * template, the concrete `e.g.` example) is unchanged.
 *
 * Every author-facing compile error is built here, so no error can ship without
 * a code. See `src/errors.js` for the registry and the numbering scheme.
 * @param {string} message The user-facing error text, without the code prefix.
 * @param {WdErrorInfo} wd The structured mirror (its `code` becomes the prefix).
 * @returns {Error & { wd: WdErrorInfo }}
 */
export function wdError(message: string, wd: WdErrorInfo): Error & {
    wd: WdErrorInfo;
};
/**
 * The compile context for a nested block body that starts `start` lines into the
 * current slice. The offset accumulates, so errors inside arbitrarily nested
 * blocks (`::: container`, `:form`, `@loop`, `:if`, `:carousel`) still report
 * the true file line through {@link at}.
 * @template {Pick<Ctx, "lineOffset">} T
 * @param {T} ctx
 * @param {number} start 0-based index the nested body starts at in the current slice.
 * @returns {T}
 */
export function nestedCtx<T extends Pick<Ctx, "lineOffset">>(ctx: T, start: number): T;
export const pageIncludeExtensions: string[];
/** @type {Record<string, string>} */
export const LOOP_META: Record<string, string>;
export type Paths = import("../config.js").Paths;
/**
 * Frontmatter values are scalars or inline arrays of scalars.
 */
export type FrontmatterValue = string | number | boolean | null | Array<string | number | boolean | null>;
/**
 * Parsed page frontmatter, keyed by field name.
 */
export type Meta = Record<string, FrontmatterValue>;
/**
 * Collected output assets for a compiled document.
 */
export type Assets = {
    /**
     * Public hrefs of compiled skin stylesheets.
     */
    skins: Set<string>;
    /**
     * Public hrefs of colocated page scripts.
     */
    scripts: Set<string>;
    /**
     * Source path → public href for emitted assets.
     */
    files: Map<string, string>;
    /**
     * Whether the reactive runtime is required.
     */
    runtime: boolean;
    /**
     * Names of framework behavior modules this page
     * needs (`slider` is compile-time only and never appears here; `sortable`,
     * `carousel` each emit a pay-for-what-you-use `/__wd/behaviors/<name>.js`).
     */
    behaviors: Set<string>;
    /**
     * Whether the page has a build-time-highlighted code
     * block, so the framework highlight stylesheet (`/__wd/highlight.css`) is
     * emitted and linked — pay-for-what-you-use, zero JS.
     */
    hasCode: boolean;
    /**
     * Source paths of colocated `.skin` files
     * that opted into scoping (`scoped` first line). The builder emits these with
     * the scope attribute and runs the unused-selector warning against the stamped
     * subtree; the HTML stamp uses them to scope the matching page/include subtree.
     */
    scopedSkins: Set<string>;
};
/**
 * The pagination intent a `@loop … paginate N` records during compile, so the
 * builder can multiply routes (page 1 at the listing route, 2+ at
 * `/<route>/page/<n>/`). `total` is the post-`where`/`sort` page count for the
 * collection the loop drew from.
 */
export type Pagination = {
    /**
     * Rows per page (the `paginate N` value).
     */
    perPage: number;
    /**
     * Total page count (≥ 1).
     */
    total: number;
    /**
     * Collection name the loop paginated.
     */
    collection: string;
};
/**
 * Per-document compilation accumulator shared across includes/sections.
 */
export type Compilation = {
    assets: Assets;
    /**
     * Declared state keys → initial values.
     */
    state: Map<string, unknown>;
    /**
     * Page-global store names (a subset of state keys).
     */
    stores: Set<string>;
    /**
     * Base state keys declared by `:fetch`, so
     * bare `:if <key>_loading` / `:if <key>_error` regions get compile-time
     * `role`/`aria-live` announcements.
     */
    fetchKeys: Set<string>;
    /**
     * Non-fatal authoring hints.
     */
    warnings: string[];
    /**
     * Counter for auto-generated section ids.
     */
    sectionCounter: number;
    /**
     * Heading-slug occurrence counts,
     * shared across prose chunks and includes so anchor ids dedupe document-wide.
     */
    headingSlugs: Map<string, number>;
    /**
     *   Collection name → entry rows, built from the router's routes and threaded in
     *   so a bare-name `@loop blog into post` resolves to its entries at build time.
     */
    collections: Map<string, import("./collections.js").CollectionRow[]>;
    /**
     * The pagination
     * intent a `@loop … paginate N` recorded this compile, or null. The builder
     * reads it to multiply routes; one paginated loop per page is supported.
     */
    pagination: import("./context.js").Pagination | null;
    /**
     * Absolute paths of every source file this compile
     * read: the page itself, every `@include` target, and every `@loop` JSON data
     * file. The dev builder unions these (plus colocated assets) into the per-route
     * dependency map that drives incremental rebuilds.
     */
    deps: Set<string>;
    /**
     * Names of the collections this compile
     * looped, so a change to any entry of a collection rebuilds its consumers.
     */
    collectionsUsed: Set<string>;
    /**
     * The file reader every source
     * read threads through — the real filesystem by default, or an in-memory map
     * for `compileFromMemory`. Set once by `createCompilation` and reached via
     * `ctx.comp.reader` in the directive handlers (includes, loop data).
     */
    reader: import("./reader.js").Reader;
    /**
     * Every declared thing this compile saw, in source
     * order, recorded by {@link recordSymbol} from the handler that parsed it.
     * Surfaced on {@link CompiledPage} so a tool layer can answer "what is in this
     * page?" without parsing `.wd` a second time.
     */
    symbols: Symbol[];
};
/**
 * One declared thing in a page, as the compiler saw it.
 *
 * `kind` is the directive family; `name` is what an author would call the thing
 * and is what `refs` matches on. `detail` is a short human string in the same
 * vocabulary the model writes, never a serialized AST: the tool layer's job is
 * to hand back text a model can nearly paste, and translation is where small
 * models lose.
 */
export type Symbol = {
    kind: "state" | "store" | "computed" | "theme" | "fetch" | "action" | "loop" | "form" | "field" | "if" | "include" | "read";
    /**
     * The symbol's own name, or the thing it targets.
     */
    name: string;
    /**
     * Short source-shaped description, e.g. `cart append p`.
     */
    detail?: string | undefined;
    /**
     * For loops: whether it stays reactive at runtime.
     */
    reactive?: boolean | undefined;
    /**
     * For actions: the state key written.
     */
    target?: string | undefined;
    /**
     * For actions: the validated action token.
     */
    op?: string | undefined;
    /**
     * Absolute path of the file the symbol was declared in.
     */
    file: string;
    /**
     * For a block directive (`@loop`, `:if`), the
     * 1-based line its closer sits on, so a tool can address the whole block.
     */
    endLine?: number | undefined;
    /**
     * 1-based line in that file, or null for a read
     * recorded by {@link recordRead} (see there for why prose reads carry no line).
     */
    line: number | null;
};
/**
 * A lexical scope chain for static interpolation values (include args, loop vars).
 */
export type Scope = {
    parent: Scope | null;
    vars: Record<string, unknown>;
};
/**
 * Per-file compile context threaded through the directive handlers.
 */
export type Ctx = {
    /**
     * Absolute path to the file being compiled.
     */
    file: string;
    /**
     * 0-based file line the compiled body starts on
     * (the frontmatter offset), so `at` reports true file line numbers.
     */
    bodyLine?: number | undefined;
    /**
     * 0-based body line the current `compileBody`
     * slice starts on. Block handlers recurse with {@link nestedCtx}, so a line
     * index inside a nested block body still maps to the true file line.
     */
    lineOffset?: number | undefined;
    /**
     * Resolved project paths.
     */
    context: Paths;
    /**
     * Include stack (real paths) for cycle detection.
     */
    stack: string[];
    /**
     * Static value scope chain.
     */
    scope: Scope;
    /**
     * Shared compilation accumulator.
     */
    comp: Compilation;
    /**
     * Active section-id scope chain.
     */
    sections: string[];
    /**
     * Name of the current reactive loop item, if any.
     */
    loopItem: string | null;
    /**
     * State key of the list being looped, if any.
     */
    loopKey?: string | undefined;
    /**
     * Number of enclosing REACTIVE `@loop` levels
     * (0 at top level). The runtime reconciles at most two nested `data-wd-loop`
     * levels — a third paints empty — so a third reactive level is rejected at
     * compile time. Static (build-unrolled) loops flatten to markup and don't add
     * a level, so they carry the count through without incrementing it.
     */
    reactiveDepth?: number | undefined;
    /**
     * The current `@loop`
     * opener's `file:line` + raw text, set when descending into a loop body so the
     * reactive-nesting-depth error can point at the offending opener.
     */
    loopOpener?: {
        at: string;
        line: string;
    } | undefined;
    /**
     * Inside a loop body, so `$index`/`$first`/… are valid.
     */
    loopMeta?: boolean | undefined;
    /**
     * Markdown-it instance selected for this file.
     */
    md?: import("markdown-it").default | undefined;
    /**
     * The body
     * dispatcher, threaded through the context so block handlers (`:if`, `:::`,
     * `:form`, `@loop`, …) recurse into nested bodies without importing the
     * dispatcher back — the module graph stays an import-cycle-free DAG.
     */
    compileBody: (lines: string[], ctx: Ctx) => string;
    /**
     *   The per-file compile, threaded for the same reason so `@include` can
     *   compile its target file. `reactiveDepth`/`loopOpener` carry the enclosing
     *   reactive-loop nesting across the include boundary so the depth guard holds.
     */
    compileFile: (file: string, context: Paths, stack: string[], scope: Scope, comp: Compilation, sections: string[], loopItem: string | null, reactiveDepth?: number, loopOpener?: {
        at: string;
        line: string;
    } | null) => {
        meta: Meta;
        html: string;
    };
};
/**
 * A compiled page document.
 */
export type CompiledDocument = {
    meta: Meta;
    html: string;
    assets: Assets;
    warnings: string[];
    /**
     * The pagination intent a paginated
     * `@loop` recorded, or null. The builder reads it to multiply routes.
     */
    pagination: Pagination | null;
    /**
     * Absolute source-file dependencies of this compile.
     */
    deps: Set<string>;
    /**
     * Collection names this compile looped.
     */
    collectionsUsed: Set<string>;
    /**
     * Every declared thing the compile saw, in
     * source order. See {@link recordSymbol}.
     */
    symbols: Symbol[];
};
/**
 * A compiled page: the document plus its full HTML shell.
 */
export type CompiledPage = {
    meta: Meta;
    html: string;
    assets: Assets;
    warnings: string[];
    /**
     * The pagination intent a paginated
     * `@loop` recorded, or null. The builder reads it to multiply routes.
     */
    pagination: Pagination | null;
    /**
     * Absolute source-file dependencies of this compile.
     */
    deps: Set<string>;
    /**
     * Collection names this compile looped.
     */
    collectionsUsed: Set<string>;
    /**
     * Every declared thing the compile saw, in
     * source order. See {@link recordSymbol}.
     */
    symbols: Symbol[];
};
/**
 * Structured, machine-readable companion to a compile error's string message.
 * The string `message` contract is unchanged; `wd` gives an AI edit-loop (or an
 * editor) the same facts without re-parsing the prose: which code, which
 * file/line, the corrective `Use:` template, and one concrete compilable
 * example line.
 */
export type WdErrorInfo = {
    /**
     * Stable error code (`WD` + three digits, e.g. `WD201`).
     * Every code is registered in `src/errors.js` with a title, cause, and fix,
     * and documented in `docs/errors.md`. {@link wdError} prefixes the string
     * message with `[<code>] `, so the code is greppable from the message too.
     */
    code: string;
    /**
     * Absolute path of the source file the error is in,
     * when the throwing layer knows one (`compileSkin` is a pure string→string
     * pass and a collection-row check names the entry route instead).
     */
    file?: string | undefined;
    /**
     * 1-based file line the error points at, when known
     * (some errors — e.g. a bad `where` operand — are file-scoped only, matching
     * the string message, which likewise omits the line there).
     */
    line?: number | undefined;
    /**
     * The corrective `Use:` template (without the `Use: ` prefix).
     */
    hint?: string | undefined;
    /**
     * One concrete, compilable directive line.
     */
    example?: string | undefined;
};
/**
 * A compiled `@loop … where` predicate.
 */
export type Predicate = {
    /**
     * Safe JS boolean expression over `I()`/`S()`/`C()`.
     */
    body: string;
    /**
     * Whether the predicate reads declared state.
     */
    refsState: boolean;
};
/**
 * A loop offset/limit argument: a non-negative integer literal or a state key.
 */
export type NumArg = {
    kind: "literal";
    value: number;
} | {
    kind: "key";
    value: string;
};
/**
 * Loop clause configuration shared by the static and reactive paths.
 */
export type LoopOpts = {
    where: Predicate | null;
    /**
     * A literal item field + asc/desc, or a `:state`/`:store` key for either (reactive, clickable-header sort).
     */
    sort: {
        key: string;
        keyKind: "literal" | "key";
        dir: string;
        dirKind: "literal" | "key";
    } | null;
    reverse: boolean;
    offset: NumArg | null;
    limit: NumArg | null;
    /**
     * Empty-branch body lines, if any.
     */
    empty: string[] | null;
    /**
     * 0-based index the empty branch starts at
     * within the loop body, so its nested errors report the true file line.
     */
    emptyStart?: number | undefined;
    /**
     * Whether offset/limit reference state.
     */
    clauseRefsState: boolean;
    /**
     * Drag-to-reorder the underlying :state/:store list
     * (the `sortable` clause). Only valid on a plain reactive state-key loop.
     */
    sortable: boolean;
    /**
     * Rows-per-page for a `paginate N` clause, or
     * null. Only valid on a collection loop; multiplies the listing into static
     * pages (page 1 at the route, 2+ at `/<route>/page/<n>/`) and exposes a `page`
     * pager to the template scope.
     */
    paginate: number | null;
};
/**
 * A parsed `:button` action.
 */
export type Action = {
    /**
     * Runtime operation (inc/dec/add/sub/append/prepend/set/toggle/member-toggle/remove/remove-value/clear/merge/delete/reset/append-row).
     */
    op: string;
    /**
     * State key (possibly dotted) the action mutates.
     */
    target: string;
    /**
     * Literal value for value-carrying ops.
     */
    value?: unknown;
};
