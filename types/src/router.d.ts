/**
 * @typedef {import("./compiler.js").Meta} Meta
 */
/**
 * A discovered page route: the source file, its public route path, and its
 * parsed frontmatter. `meta` is read ONCE here — the single source of truth for
 * "is this a draft" and for the downstream sitemap/RSS feeds (which never see a
 * draft, since drafts are filtered out below).
 * @typedef {object} Route
 * @property {string} file Absolute path to the source `.md`/`.wd` file.
 * @property {string} route Public route path (always trailing-slashed, e.g. `/about/`).
 * @property {Meta} meta Parsed frontmatter for the file.
 */
/**
 * Walk `routesRoot` and collect page routes, sorted and de-duplicated.
 *
 * Drafts are filtered HERE, at the one route-discovery chokepoint, so every
 * downstream consumer (the build, `routes.json`, the sitemap, the RSS feed)
 * only ever sees the post-filter list — a `draft: true` page can never leak. By
 * default drafts are excluded; pass `{ includeDrafts: true }` (`darkmown dev`
 * and `darkmown build --drafts`) to keep them. This is distinct from, and
 * orthogonal to, the permanent `.`/`-`/`_` filename hiding above: hidden names
 * are private forever; `draft:` is a toggleable, publish-when-ready gate.
 * @param {string} routesRoot Absolute path to `site/pages`.
 * @param {{ includeDrafts?: boolean }} [options]
 * @returns {Route[]}
 */
export function discoverRoutes(routesRoot: string, options?: {
    includeDrafts?: boolean;
}): Route[];
/**
 * Whether a page's frontmatter marks it a draft (`draft: true`). The scalar
 * frontmatter parser yields a boolean `true` or the string `"true"`, so accept
 * both; any other value (absent, `false`, `"false"`) is not a draft.
 * @param {Meta} meta
 * @returns {boolean}
 */
export function isDraft(meta: Meta): boolean;
/**
 * Derive a public route path from a source file path.
 * @param {string} routesRoot Absolute path to `site/pages`.
 * @param {string} file Absolute path to the source file.
 * @returns {string}
 */
export function routeFromFile(routesRoot: string, file: string): string;
/**
 * Map a public route to the `index.html` output path under `distRoot`.
 *
 * Defense in depth: routes come from `routeFromFile` walking `site/pages`, so
 * they can't normally carry traversal segments — but any future caller passing
 * an unvetted route must not be able to write outside the build output. The
 * resolved path is asserted to stay inside `distRoot`.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} route Public route path.
 * @returns {string}
 */
export function outputPathForRoute(distRoot: string, route: string): string;
export type Meta = import("./compiler.js").Meta;
/**
 * A discovered page route: the source file, its public route path, and its
 * parsed frontmatter. `meta` is read ONCE here — the single source of truth for
 * "is this a draft" and for the downstream sitemap/RSS feeds (which never see a
 * draft, since drafts are filtered out below).
 */
export type Route = {
    /**
     * Absolute path to the source `.md`/`.wd` file.
     */
    file: string;
    /**
     * Public route path (always trailing-slashed, e.g. `/about/`).
     */
    route: string;
    /**
     * Parsed frontmatter for the file.
     */
    meta: Meta;
};
