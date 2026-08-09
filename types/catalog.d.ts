// Public type surface for the `@zvndev/darkmown/catalog` subpath — the
// machine-readable description of the whole `.wd` authoring surface, and its
// llms.txt rendering. Mirrors the JSDoc in `src/catalog.js`.

/**
 * Whether a directive ships zero JS (`static`), needs the reactive runtime
 * (`reactive`), or can be either depending on whether it reads
 * `:state`/`:store` (`either`).
 */
export type Reactivity = "static" | "reactive" | "either";

/** One public directive: what it looks like, what it does, and one example. */
export type DirectiveEntry = {
    /** The directive token (`@loop`, `:state`, `:::`, …). */
    name: string;
    /** A single line, or an opener with a closer. */
    kind: "line" | "block";
    /** One-line schematic (`[…]` = optional, `<…>` = slot). */
    syntax: string;
    /** One-line, plain-language summary. */
    description: string;
    /** One concrete, compilable line. */
    example: string;
    reactive: Reactivity;
};

/** A `@loop` clause, loop variable, action op, format pipe, or operator entry. */
export type CatalogEntry = {
    name: string;
    syntax?: string | undefined;
    description: string;
    example?: string | undefined;
};

/** The whole authoring surface, as data. */
export type DirectiveCatalog = {
    /** The installed Darkmown version. */
    version: string;
    /** Always `.wd` — the file extension that gates directives. */
    format: string;
    directives: DirectiveEntry[];
    /** Clauses of the `@loop` header (fixed order). */
    loopClauses: CatalogEntry[];
    /** Per-row meta variables valid in a loop body. */
    loopVariables: CatalogEntry[];
    /** The `:button`/`:effect`/`:every` action vocabulary. */
    actionOps: CatalogEntry[];
    /** The `{ value | pipe }` formatter whitelist. */
    formatPipes: CatalogEntry[];
    /** Comparison operators for `where`/`:if`/`when`. */
    predicateOps: CatalogEntry[];
    /** Logical joiners (`and`/`or`/`not`). */
    predicateJoiners: string[];
};

/**
 * The structured, machine-readable catalog of the whole `.wd` authoring surface.
 * @returns {DirectiveCatalog}
 */
export function directiveCatalog(): DirectiveCatalog;

/**
 * Render the catalog as a compact llms.txt-style markdown cheatsheet — the
 * artifact an app pastes into a small model's system prompt. Generated entirely
 * from {@link directiveCatalog}, so it can never disagree with what compiles.
 * @returns {string}
 */
export function llmsText(): string;

/** The action tokens the catalog exposes — used by the drift guard. */
export const CATALOG_ACTION_TOKENS: string[];
