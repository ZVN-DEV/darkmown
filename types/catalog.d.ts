/**
 * The structured, machine-readable catalog of the whole `.wd` authoring surface.
 * @returns {DirectiveCatalog}
 */
export function directiveCatalog(): DirectiveCatalog;
/**
 * One page of a built site, as it appears in the generated `llms.txt` index and
 * `llms-full.txt` corpus.
 * @typedef {object} SitePage
 * @property {string} title
 * @property {string} url Absolute URL when the site declared `site_url`, else the route path.
 * @property {string} description "" when the page has no `description:`.
 * @property {string} [body] The page's source body (frontmatter stripped). Only
 *   the corpus carries it; the index omits it.
 */
/**
 * The site a generated llms file describes. Plain data, passed in by the builder
 * (the only layer that knows the routes), so this module stays a pure renderer.
 * @typedef {object} SiteCorpus
 * @property {string} title
 * @property {string} description
 * @property {string} url Site origin, or "" when the home page set no `site_url`.
 * @property {SitePage[]} pages Every emitted route, in route order.
 */
/**
 * Render the catalog as a compact llms.txt-style markdown cheatsheet — the
 * artifact an app pastes into a small model's system prompt. Generated entirely
 * from {@link directiveCatalog}, so it can never disagree with what compiles.
 *
 * When a `site` is supplied (the build always supplies one) the cheatsheet is
 * followed by an INDEX of the site's pages and a pointer to `llms-full.txt`,
 * which is the llms.txt convention: a short index, with the complete corpus one
 * fetch away.
 * @param {SiteCorpus} [site] The built site to index.
 * @returns {string}
 */
export function llmsText(site?: SiteCorpus): string;
/**
 * Render `llms-full.txt`: the COMPLETE corpus that `llms.txt` indexes. Where the
 * cheatsheet is one line per directive, this carries the full syntax template,
 * description, example, and reactivity for every one, plus every compile-error
 * code with its cause and fix: and then the full source text of every page on
 * the site. Same generator, same catalog, so index and corpus cannot disagree.
 * @param {SiteCorpus} [site] The built site whose pages form the corpus.
 * @returns {string}
 */
export function llmsFullText(site?: SiteCorpus): string;
/** The action tokens the catalog exposes — used by the drift guard. */
export const CATALOG_ACTION_TOKENS: string[];
/**
 * The same vocabulary with each token's SHAPE, for `src/grammar.js`. The GBNF
 * `action-op` rule used to be a hand-written string listing all fourteen
 * alternatives; it is now generated from this, so the grammar and the catalog
 * cannot list different ops.
 * @type {{ token: string, place: "suffix" | "infix", operand: "none" | "required" | "optional" }[]}
 */
export const CATALOG_ACTION_GRAMMAR: {
    token: string;
    place: "suffix" | "infix";
    operand: "none" | "required" | "optional";
}[];
/**
 * One page of a built site, as it appears in the generated `llms.txt` index and
 * `llms-full.txt` corpus.
 */
export type SitePage = {
    title: string;
    /**
     * Absolute URL when the site declared `site_url`, else the route path.
     */
    url: string;
    /**
     * "" when the page has no `description:`.
     */
    description: string;
    /**
     * The page's source body (frontmatter stripped). Only
     * the corpus carries it; the index omits it.
     */
    body?: string | undefined;
};
/**
 * The site a generated llms file describes. Plain data, passed in by the builder
 * (the only layer that knows the routes), so this module stays a pure renderer.
 */
export type SiteCorpus = {
    title: string;
    description: string;
    /**
     * Site origin, or "" when the home page set no `site_url`.
     */
    url: string;
    /**
     * Every emitted route, in route order.
     */
    pages: SitePage[];
};
/**
 * Whether the directive
 *   ships zero JS (static), needs the reactive runtime (reactive), or can be
 *   either depending on whether it reads `:state`/`:store` (either).
 */
export type Reactivity = "static" | "reactive" | "either";
export type DirectiveEntry = {
    /**
     * The directive token (`@loop`, `:state`, `:::`, …).
     */
    name: string;
    /**
     * A single line, or an opener with a closer.
     */
    kind: "line" | "block";
    /**
     * One-line schematic (`[…]` = optional, `<…>` = slot).
     */
    syntax: string;
    /**
     * One-line, plain-language summary.
     */
    description: string;
    /**
     * One concrete, compilable line.
     */
    example: string;
    reactive: Reactivity;
};
/**
 * A clause / action-op / pipe / operator entry.
 */
export type CatalogEntry = {
    name: string;
    syntax?: string | undefined;
    description: string;
    example?: string | undefined;
};
export type DirectiveCatalog = {
    /**
     * The installed Darkmown version.
     */
    version: string;
    /**
     * Always `.wd` — the file extension that gates directives.
     */
    format: string;
    directives: DirectiveEntry[];
    /**
     * Clauses of the `@loop` header (fixed order).
     */
    loopClauses: CatalogEntry[];
    /**
     * Per-row meta variables valid in a loop body.
     */
    loopVariables: CatalogEntry[];
    /**
     * The `:button`/`:effect`/`:every` action vocabulary.
     */
    actionOps: CatalogEntry[];
    /**
     * The `{ value | pipe }` formatter whitelist.
     */
    formatPipes: CatalogEntry[];
    /**
     * Comparison operators for `where`/`:if`/`when`.
     */
    predicateOps: CatalogEntry[];
    /**
     * Logical joiners (`and`/`or`/`not`).
     */
    predicateJoiners: string[];
    /**
     * Frontmatter keys the framework reads.
     */
    frontmatterKeys: CatalogEntry[];
    /**
     * The `schema:` JSON-LD types the compiler can populate.
     */
    schemaTypes: string[];
    /**
     * The `WDxxx` code blocks.
     */
    errorAreas: import("./errors.js").ErrorArea[];
    /**
     * Every stable compile-error
     * code, with its cause and fix. A thrown error's message starts with its code
     * (`[WD201] …`) and mirrors it on `err.wd.code`.
     */
    errors: import("./errors.js").ErrorEntry[];
};
