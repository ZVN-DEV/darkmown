/**
 * Compile the whole site under `cwd` into `dist`, returning the route manifest.
 *
 * The build is always 100% static, CDN-cacheable HTML. Backend `api/*.js`
 * functions are NOT compiled — they are the host's concern. `target` only
 * decides the small amount of host glue Darkmown emits alongside the static
 * output: the default (`vercel`/anything) leaves `api/` for the platform to pick
 * up natively; `cloudflare` emits a `dist/_worker.js/` module that routes
 * `/api/*` to those same functions and serves everything else as a static asset.
 *
 * @param {string} [cwd] Project working directory (defaults to `process.cwd()`).
 * @param {{ target?: string, includeDrafts?: boolean, depMap?: boolean, changed?: string[], quietFeedHints?: boolean }} [options]
 *   `target: "cloudflare"` emits the Pages worker. `includeDrafts: true` keeps
 *   `draft: true` pages in the build + feeds (dev / `build --drafts`); default
 *   excludes them at route discovery so feeds never see a draft. `depMap: true`
 *   (dev builds) writes the per-route dependency map to `dist/.wd-dev-deps.json`.
 *   `changed` (project-relative paths, dev only; implies `depMap`) attempts an
 *   incremental rebuild of just the affected routes, falling back to a full
 *   rebuild on ANY uncertainty — a stale page is worse than a slow rebuild.
 * @returns {BuildResult}
 */
export function buildSite(cwd?: string, options?: {
    target?: string;
    includeDrafts?: boolean;
    depMap?: boolean;
    changed?: string[];
    quietFeedHints?: boolean;
}): BuildResult;
/**
 * Strip developer comments from the runtime before it ships. The source keeps
 * full JSDoc type annotations (for `checkJs` + `.d.ts`) and explanatory comments
 * so it stays readable; the browser downloads neither. This keeps the shipped
 * runtime lean and the gzip budget honest (measured against what users receive),
 * WITHOUT minifying — identifiers, structure, and whitespace are all preserved.
 *
 * Two passes, each conservative: `/** ... *\/` JSDoc blocks, then whole-line
 * `//` comments (a line that is nothing but a comment). Trailing `//` after code
 * and `//` inside strings/URLs are deliberately left untouched, so no string
 * literal is ever harmed.
 * @param {string} source
 * @returns {string}
 */
export function stripRuntimeComments(source: string): string;
/**
 * Render the Cloudflare Pages `_headers` file from the route manifest.
 *
 * Cloudflare applies every matching block in order; when blocks set the same
 * header, the later block wins. So we emit the catch-all `/*` first (baseline
 * security headers + the reactive CSP, which since 2.1 is eval-free and satisfies
 * every page), then one block per static route that re-states the same eval-free
 * CSP as defense-in-depth. Reactive routes need no override — the catch-all
 * already carries the eval-free CSP.
 *
 * Clean URLs mean a route like `/docs/` is served at both `/docs` and `/docs/`,
 * so each static route emits a path glob (`/docs`, `/docs/*`) that covers both.
 * @param {RouteManifestEntry[]} manifest
 * @returns {string}
 */
export function renderCloudflareHeaders(manifest: RouteManifestEntry[]): string;
/**
 * @typedef {import("./config.js").Paths} Paths
 * @typedef {import("./compiler.js").Assets} Assets
 * @typedef {import("./compiler.js").Meta} Meta
 * @typedef {import("./router.js").Route} Route
 */
/**
 * A built route entry written to `dist/routes.json`.
 * @typedef {object} RouteManifestEntry
 * @property {string} route Public route path.
 * @property {string} file Source file path, relative to cwd, POSIX-separated.
 * @property {{ skins: string[], scripts: string[], runtime: boolean }} assets
 */
/**
 * One source route's record in the dev dependency map (`dist/.wd-dev-deps.json`),
 * written by dev builds so a later `--changed` build can rebuild only the routes
 * whose dependency graph contains the changed file.
 * @typedef {object} DepMapEntry
 * @property {string} file Source file, project-relative, POSIX-separated.
 * @property {string[]} deps Every source file this route's compile read (the page
 *   itself, includes, loop JSON data files, colocated `.skin`/`.js`) —
 *   project-relative, POSIX-separated, sorted.
 * @property {string[]} collections Collection names the route loops, so a change
 *   to any entry of the collection rebuilds this route.
 * @property {RouteManifestEntry[]} pages The manifest entries this route emitted
 *   (one, or one per pagination page), so `routes.json`/`_headers`/the sitemap
 *   can be reassembled globally without recompiling untouched routes.
 */
/** The dev dependency map's filename under `dist/`. */
export const DEP_MAP_FILE: ".wd-dev-deps.json";
/**
 * The value `buildSite` returns. `incremental` is present only when a `changed`
 * build actually rebuilt a subset of routes (absent on every full rebuild).
 */
export type BuildResult = {
    routes: RouteManifestEntry[];
    distRoot: string;
    feeds: {
        sitemap: number | null;
        rss: number | null;
    };
    incremental?: {
        changed: string[];
        rebuilt: string[];
        total: number;
    } | undefined;
};
/**
 * A compiled page bound for a concrete output route. Mirrors `CompiledPage` plus
 * the public `route` it's written to — for a paginated listing, page 1 keeps the
 * listing route and pages 2+ get `/<route>/page/<n>/`.
 */
export type EmittedPage = {
    /**
     * Public route path this page is written to.
     */
    route: string;
    html: string;
    assets: import("./compiler.js").Assets;
    warnings: string[];
};
/**
 * Site-wide metadata resolved from the home page's frontmatter.
 */
export type SiteIdentity = {
    /**
     * Absolute origin without a trailing slash, or "".
     */
    siteUrl: string;
    /**
     * Site title (also the RSS channel title).
     */
    title: string;
    /**
     * Site description (also the RSS channel description).
     */
    description: string;
    /**
     * `"allow"` or `"deny"`, from `ai_crawlers:`.
     */
    aiCrawlers: string;
};
export type Paths = import("./config.js").Paths;
export type Assets = import("./compiler.js").Assets;
export type Meta = import("./compiler.js").Meta;
export type Route = import("./router.js").Route;
/**
 * A built route entry written to `dist/routes.json`.
 */
export type RouteManifestEntry = {
    /**
     * Public route path.
     */
    route: string;
    /**
     * Source file path, relative to cwd, POSIX-separated.
     */
    file: string;
    assets: {
        skins: string[];
        scripts: string[];
        runtime: boolean;
    };
};
/**
 * One source route's record in the dev dependency map (`dist/.wd-dev-deps.json`),
 * written by dev builds so a later `--changed` build can rebuild only the routes
 * whose dependency graph contains the changed file.
 */
export type DepMapEntry = {
    /**
     * Source file, project-relative, POSIX-separated.
     */
    file: string;
    /**
     * Every source file this route's compile read (the page
     * itself, includes, loop JSON data files, colocated `.skin`/`.js`) —
     * project-relative, POSIX-separated, sorted.
     */
    deps: string[];
    /**
     * Collection names the route loops, so a change
     * to any entry of the collection rebuilds this route.
     */
    collections: string[];
    /**
     * The manifest entries this route emitted
     * (one, or one per pagination page), so `routes.json`/`_headers`/the sitemap
     * can be reassembled globally without recompiling untouched routes.
     */
    pages: RouteManifestEntry[];
};
