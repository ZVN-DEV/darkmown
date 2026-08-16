/**
 * Whether a page's frontmatter declares an article-family `schema:` type. Used
 * by the page shell to pick `og:type` (`article` vs `website`).
 * @param {Meta} meta
 * @returns {boolean}
 */
export function isArticleSchema(meta: Meta): boolean;
/**
 * Everything the JSON-LD builders may read. Only page-derived facts: the shell's
 * already-resolved title/description/image/lang, the page's frontmatter, and the
 * absolute URL the builder resolved for it.
 * @typedef {object} SchemaInput
 * @property {Meta} meta Page frontmatter.
 * @property {string} file Source path, for compile errors.
 * @property {string} title Resolved page title.
 * @property {string} description Resolved page description ("" when absent).
 * @property {string} image Absolute social image URL ("" when absent).
 * @property {string} lang Document language.
 * @property {string} canonical Absolute canonical URL ("" when no `site_url`).
 * @property {{ name: string, url: string }[]} breadcrumbs Resolved crumb trail.
 */
/**
 * Build the page's `<script type="application/ld+json">` block, or "" when the
 * page opts into nothing. Two independent inputs feed it: the `schema:`
 * frontmatter type (or types), and a breadcrumb trail the builder resolved for a
 * nested route. Two or more nodes are emitted as a JSON array in one script,
 * which is valid JSON-LD and one fewer tag in the head.
 * @param {SchemaInput} input
 * @returns {string} The script tag, or "" when there is nothing to say.
 */
export function buildJsonLd(input: SchemaInput): string;
/**
 * @typedef {import("./context.js").Meta} Meta
 */
/**
 * The `schema:` types Darkmown knows how to populate from real page data:
 * article-family types from a page's title/description/date/author, and the two
 * site-identity types from what a home page already declares. Anything else is
 * a compile error rather than a guess. `BreadcrumbList` is not listed because it
 * is never opted into: it is derived automatically from routes that exist.
 * @type {string[]}
 */
export const SCHEMA_TYPES: string[];
/** A concrete, copyable `schema:` frontmatter line for docs and error hints. */
export const SCHEMA_EXAMPLE: "schema: BlogPosting";
/**
 * Everything the JSON-LD builders may read. Only page-derived facts: the shell's
 * already-resolved title/description/image/lang, the page's frontmatter, and the
 * absolute URL the builder resolved for it.
 */
export type SchemaInput = {
    /**
     * Page frontmatter.
     */
    meta: Meta;
    /**
     * Source path, for compile errors.
     */
    file: string;
    /**
     * Resolved page title.
     */
    title: string;
    /**
     * Resolved page description ("" when absent).
     */
    description: string;
    /**
     * Absolute social image URL ("" when absent).
     */
    image: string;
    /**
     * Document language.
     */
    lang: string;
    /**
     * Absolute canonical URL ("" when no `site_url`).
     */
    canonical: string;
    /**
     * Resolved crumb trail.
     */
    breadcrumbs: {
        name: string;
        url: string;
    }[];
};
export type Meta = import("./context.js").Meta;
