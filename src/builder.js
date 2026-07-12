import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverApiRoutes } from "./api-runner.js";
import { llmsText } from "./catalog.js";
import { buildCollections } from "./compiler/collections.js";
import { compilePage, parseFrontmatter } from "./compiler.js";
import { createPaths, routesDir, shelfDir } from "./config.js";
import {
  absoluteUrl,
  buildRobots,
  buildRss,
  buildSitemap,
  lastmodFor,
  RSS_ITEM_LIMIT,
  rfc822,
  rssDescription
} from "./feeds.js";
import { BASE_SECURITY_HEADERS, REACTIVE_CSP, STATIC_CSP } from "./headers.js";
import { HIGHLIGHT_CSS } from "./highlight.js";
import { discoverRoutes, outputPathForRoute } from "./router.js";
import { compileSkin, scopeIdFor } from "./skin.js";

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
export const DEP_MAP_FILE = ".wd-dev-deps.json";

// Bumped whenever the map's shape changes, so a stale map from an older
// Darkmown falls back to a full rebuild instead of being misread.
const DEP_MAP_VERSION = 1;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

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
export function buildSite(cwd = process.cwd(), options = {}) {
  const paths = createPaths(cwd);
  const changed = (options.changed ?? []).map((file) => file.replaceAll(path.sep, "/"));
  if (changed.length > 0) {
    const partial = buildIncremental(cwd, paths, options, changed);
    if (partial) return partial;
    // A `changed` build that fell back still writes the map, so the NEXT change
    // gets to be incremental again.
    return buildFull(cwd, paths, { ...options, depMap: true });
  }
  return buildFull(cwd, paths, options);
}

/**
 * The value `buildSite` returns. `incremental` is present only when a `changed`
 * build actually rebuilt a subset of routes (absent on every full rebuild).
 * @typedef {object} BuildResult
 * @property {RouteManifestEntry[]} routes
 * @property {string} distRoot
 * @property {{ sitemap: number | null, rss: number | null }} feeds
 * @property {{ changed: string[], rebuilt: string[], total: number }} [incremental]
 */

/**
 * The full site build: wipe `dist`, compile every route, emit every global file.
 * @param {string} cwd
 * @param {Paths} paths
 * @param {{ target?: string, includeDrafts?: boolean, depMap?: boolean, quietFeedHints?: boolean }} options
 * @returns {BuildResult}
 */
function buildFull(cwd, paths, options) {
  fs.rmSync(paths.distRoot, { recursive: true, force: true });
  fs.mkdirSync(paths.distRoot, { recursive: true });
  emitShelfAssets(paths);
  const routes = discoverRoutes(paths.routesRoot, { includeDrafts: options.includeDrafts });
  // Build the collection index from the (post-draft-filter) routes — every
  // site/pages/<name>/ subdirectory's entries become queryable rows a bare-name
  // `@loop blog into post` resolves against. Drafts are already excluded, so a
  // draft entry can never appear in a listing. Validates each collection's
  // `_schema.wd` here (throwing on a bad entry with file:line).
  const collections = buildCollections(routes, paths);
  // Site identity lives in the HOME page frontmatter (no config loader): the
  // `site_url` origin triggers + prefixes the feeds, reusing `title`/`description`
  // as the RSS channel fields. Resolved once, up front, so every page can link
  // the feed during the loop.
  const identity = siteIdentity(routes);
  const feedLink = feedLinkFor(identity, routes);
  /** @type {RouteManifestEntry[]} */
  const manifest = [];

  /** @type {Set<string>} */
  const warned = new Set();

  /** @type {string | undefined} HTML of the `/404/` route, copied to dist/404.html. */
  let notFoundHtml;

  // Extra (paginated 2+) routes the build generates beyond the discovered set —
  // each is indexable static HTML, so it belongs in the sitemap (it has no own
  // frontmatter `date:`; it reuses its listing source file for `<lastmod>`).
  /** @type {Route[]} */
  const extraRoutes = [];

  /** @type {Record<string, DepMapEntry>} */
  const mapRoutes = {};

  for (const route of routes) {
    const built = buildRoute(route, cwd, paths, collections, feedLink, warned);
    manifest.push(...built.mapEntry.pages);
    if (built.notFoundHtml !== undefined) notFoundHtml = built.notFoundHtml;
    for (const entry of built.mapEntry.pages) {
      if (entry.route !== route.route) extraRoutes.push({ ...route, route: entry.route });
    }
    mapRoutes[route.route] = built.mapEntry;
  }

  // Hosts (Vercel, Cloudflare Pages) and the framework's own server auto-serve
  // dist/404.html for misses. Prefer the compiled 404 route; fall back to a
  // minimal page so a 404 is always available.
  fs.writeFileSync(path.join(paths.distRoot, "404.html"), notFoundHtml ?? defaultNotFoundHtml());

  emitGlobalFiles(manifest, paths);

  // Crawler files + feeds. robots.txt is ALWAYS emitted; sitemap.xml + rss.xml
  // need the home `site_url` (else a loud, actionable build hint). Drafts are
  // already filtered out of `routes`, so neither feed can ever see one. The
  // paginated 2+ routes are indexable HTML too, so they join the sitemap (RSS is
  // dated-posts-only, which they are not, so it's unaffected).
  const feeds = emitFeeds([...routes, ...extraRoutes], identity, paths, options.quietFeedHints);

  // Page-colocated static assets (images, SVG, fonts, …) copy last, so the guard
  // sees every emitted route/framework file already on disk.
  emitPageAssets(paths);

  // Surface api/ routing footguns on every build (target-independent): two files
  // that resolve to the same /api path mean one is silently unreachable.
  const apiDir = path.join(cwd, "api");
  const apiRoutes = discoverApiRoutes(apiDir);
  warnApiRouteCollisions(apiRoutes, apiDir);

  if (options.target === "cloudflare") {
    emitCloudflareWorker(paths, apiDir, apiRoutes);
  }

  if (options.depMap) writeDepMap(paths, feedLink, mapRoutes);

  return { routes: manifest, distRoot: paths.distRoot, feeds };
}

/**
 * The incremental (dev) build: rebuild only the routes whose dependency graph
 * contains a changed file, reusing everything else from the previous build.
 * Correctness first — returns null (→ full rebuild) on ANY uncertainty: no/stale
 * dependency map, a route added/removed/renamed, a deleted changed file, a
 * changed file no dependency graph accounts for, or a change to the site-wide
 * feed link every page embeds. The global outputs (`routes.json`, `_headers`,
 * robots/sitemap/rss, the dep map) are re-emitted from the merged manifest every
 * time so a partial rebuild can never leave them inconsistent.
 * @param {string} cwd
 * @param {Paths} paths
 * @param {{ target?: string, includeDrafts?: boolean, quietFeedHints?: boolean }} options
 * @param {string[]} changed Project-relative POSIX paths of the changed files.
 * @returns {BuildResult | null} null → caller runs the full build.
 */
function buildIncremental(cwd, paths, options, changed) {
  if (options.target) return fullFallback(changed, "targeted builds always run full");
  const map = readDepMap(paths);
  if (!map) return fullFallback(changed, "no dependency map from a previous dev build");

  const routes = discoverRoutes(paths.routesRoot, { includeDrafts: options.includeDrafts });
  const current = new Map(routes.map((route) => [route.route, relPosix(cwd, route.file)]));
  const prevRoutes = Object.keys(map.routes);
  if (
    prevRoutes.length !== current.size ||
    prevRoutes.some((key) => map.routes[key].file !== current.get(key))
  ) {
    return fullFallback(changed, "a route was added, removed, or renamed");
  }

  const collections = buildCollections(routes, paths);
  const identity = siteIdentity(routes);
  const feedLink = feedLinkFor(identity, routes);
  // The feed <link> is embedded in EVERY page's head, so a change to it
  // (site_url/title set or cleared, the first dated post appearing) fans out to
  // the whole site — that is a full rebuild, not a partial one.
  if (JSON.stringify(feedLink ?? null) !== JSON.stringify(map.feed ?? null)) {
    return fullFallback(changed, "the site feed link changed");
  }

  /** @type {Set<string>} */
  const affected = new Set();
  for (const file of changed) {
    if (!fs.existsSync(path.join(cwd, file))) {
      return fullFallback(changed, `"${file}" was removed or renamed`);
    }
    const hits = routesAffectedBy(file, map.routes, collections);
    if (!hits) return fullFallback(changed, `"${file}" is not in the dependency map`);
    for (const routePath of hits) affected.add(routePath);
    copyChangedAsset(file, cwd, paths);
  }

  const byRoute = new Map(routes.map((route) => [route.route, route]));
  /** @type {Set<string>} */
  const warned = new Set();
  const rebuilt = [...affected].sort();
  for (const routePath of rebuilt) {
    const route = /** @type {Route} */ (byRoute.get(routePath));
    const built = buildRoute(route, cwd, paths, collections, feedLink, warned);
    // A shrunk pagination leaves stale `/page/N/` outputs behind — remove any
    // previously-emitted page this rebuild no longer produces.
    const kept = new Set(built.mapEntry.pages.map((entry) => entry.route));
    for (const page of map.routes[routePath].pages) {
      if (!kept.has(page.route)) {
        fs.rmSync(outputPathForRoute(paths.distRoot, page.route), { force: true });
      }
    }
    if (built.notFoundHtml !== undefined) {
      fs.writeFileSync(path.join(paths.distRoot, "404.html"), built.notFoundHtml);
    }
    map.routes[routePath] = built.mapEntry;
  }

  // Reassemble the GLOBAL outputs from the merged map (fresh entries for rebuilt
  // routes, previous entries for untouched ones) in discovery order, so
  // routes.json, _headers, and the feeds stay whole-site consistent.
  /** @type {RouteManifestEntry[]} */
  const manifest = [];
  /** @type {Route[]} */
  const extraRoutes = [];
  for (const route of routes) {
    for (const entry of map.routes[route.route].pages) {
      manifest.push(entry);
      if (entry.route !== route.route) extraRoutes.push({ ...route, route: entry.route });
    }
  }
  emitGlobalFiles(manifest, paths);
  const feeds = emitFeeds([...routes, ...extraRoutes], identity, paths, options.quietFeedHints);
  writeDepMap(paths, feedLink, map.routes);

  return {
    routes: manifest,
    distRoot: paths.distRoot,
    feeds,
    incremental: { changed, rebuilt, total: routes.length }
  };
}

/**
 * Compile one source route and emit its page(s) + assets. A normal route emits
 * one page; a paginated listing emits page 1 at the route and `/page/<n>/` for
 * the rest. Shared verbatim by the full and incremental builds so a partially
 * rebuilt route is byte-identical to a fully rebuilt one.
 * @param {Route} route
 * @param {string} cwd
 * @param {Paths} paths
 * @param {Map<string, import("./compiler/collections.js").CollectionRow[]>} collections
 * @param {{ href: string, title: string } | undefined} feedLink
 * @param {Set<string>} warned Cross-route dedupe set for emitted hints.
 * @returns {{ mapEntry: DepMapEntry, notFoundHtml: string | undefined }}
 */
function buildRoute(route, cwd, paths, collections, feedLink, warned) {
  const compiled = compileRoutePages(route, paths, collections, feedLink);
  /** @type {RouteManifestEntry[]} */
  const entries = [];
  /** @type {string | undefined} */
  let notFoundHtml;
  for (const page of compiled.pages) {
    for (const warning of page.warnings || []) {
      if (warned.has(warning)) continue;
      warned.add(warning);
      console.warn(`hint: ${warning}`);
    }
    const outFile = outputPathForRoute(paths.distRoot, page.route);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, page.html);
    if (page.route === "/404/") notFoundHtml = page.html;
    emitAssets(page.assets, paths, page.html, warned);
    if (page.assets.runtime) emitRuntime(paths);
    emitBehaviors(page.assets, paths);
    if (page.assets.hasCode) emitHighlight(paths);
    const behaviorSrcs = [...page.assets.behaviors].map((name) => `/__wd/behaviors/${name}.js`);
    entries.push({
      route: page.route,
      file: relPosix(cwd, route.file),
      assets: {
        skins: [...page.assets.skins],
        scripts: [
          ...(page.assets.runtime ? ["/__wd/runtime.js"] : []),
          ...behaviorSrcs,
          ...page.assets.scripts
        ],
        runtime: page.assets.runtime
      }
    });
  }
  return {
    notFoundHtml,
    mapEntry: {
      file: relPosix(cwd, route.file),
      deps: [...compiled.deps].map((dep) => relPosix(cwd, dep)).sort(),
      collections: [...compiled.collections].sort(),
      pages: entries
    }
  };
}

/**
 * Write the global manifest files derived from the (whole-site) route manifest:
 * `routes.json` and the Cloudflare `_headers`. One emit path for full and
 * incremental builds keeps them consistent by construction.
 *
 * Cloudflare Pages reads dist/_headers for security headers (Vercel reads
 * vercel.json; the local server adds them in src/statics.js). Since 2.1 both CSP
 * variants are eval-free (the reactive runtime walks a validated AST, not
 * `new Function`), so static and reactive routes resolve to the same policy; the
 * per-route static override is kept as defense-in-depth. A catch-all keeps assets
 * and any future path covered.
 * @param {RouteManifestEntry[]} manifest
 * @param {Paths} paths
 * @returns {void}
 */
function emitGlobalFiles(manifest, paths) {
  fs.writeFileSync(path.join(paths.distRoot, "routes.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(paths.distRoot, "_headers"), renderCloudflareHeaders(manifest));
  // `llms.txt` is the compact `.wd` cheatsheet an AI authoring tool fetches to
  // prime a small model. It depends only on the framework version, so it re-emits
  // identically on every build — cheap, and always present next to the site.
  fs.writeFileSync(path.join(paths.distRoot, "llms.txt"), llmsText());
}

/**
 * The site-wide RSS `<link rel="alternate">` every page embeds — present only
 * when rss.xml will actually be emitted: the home set `site_url` AND there is at
 * least one dated post. A stale `<link>` to a missing feed would 404 for
 * aggregators.
 * @param {{ siteUrl: string, title: string, description: string }} identity
 * @param {Route[]} routes
 * @returns {{ href: string, title: string } | undefined}
 */
function feedLinkFor(identity, routes) {
  return identity.siteUrl && hasDatedPost(routes)
    ? { href: absoluteUrl(identity.siteUrl, "/rss.xml"), title: identity.title }
    : undefined;
}

/**
 * A project-relative, POSIX-separated path — the canonical file-path form in
 * `routes.json` and the dev dependency map (and what the dev watcher reports).
 * @param {string} cwd
 * @param {string} file Absolute path.
 * @returns {string}
 */
function relPosix(cwd, file) {
  return path.relative(cwd, file).replaceAll(path.sep, "/");
}

/**
 * Read the previous dev build's dependency map, or null when it is absent,
 * unreadable, or from an incompatible version — every one of which means the
 * incremental build cannot trust its picture of the site and must go full.
 * @param {Paths} paths
 * @returns {{ version: number, feed: { href: string, title: string } | null, routes: Record<string, DepMapEntry> } | null}
 */
function readDepMap(paths) {
  try {
    const map = JSON.parse(fs.readFileSync(path.join(paths.distRoot, DEP_MAP_FILE), "utf8"));
    if (map && map.version === DEP_MAP_VERSION && map.routes) return map;
  } catch {
    /* absent or corrupt — full rebuild */
  }
  return null;
}

/**
 * Persist the dependency map for the next incremental build.
 * @param {Paths} paths
 * @param {{ href: string, title: string } | undefined} feedLink
 * @param {Record<string, DepMapEntry>} mapRoutes
 * @returns {void}
 */
function writeDepMap(paths, feedLink, mapRoutes) {
  fs.writeFileSync(
    path.join(paths.distRoot, DEP_MAP_FILE),
    JSON.stringify({ version: DEP_MAP_VERSION, feed: feedLink ?? null, routes: mapRoutes })
  );
}

/**
 * Log why an incremental build is falling back to a full rebuild, and return
 * null so the caller runs one. The reason lands on stderr, which the dev server
 * surfaces alongside the rebuild output.
 * @param {string[]} changed
 * @param {string} reason
 * @returns {null}
 */
function fullFallback(changed, reason) {
  console.warn(`hint: full rebuild — ${reason} (changed: ${changed.join(", ")})`);
  return null;
}

/**
 * The source routes a changed file affects: every route whose dependency set
 * contains it, plus — when the file is a page inside a collection directory
 * (an entry or its `_schema.wd`) — every route that loops that collection.
 * Returns null when NO dependency graph accounts for the file (a brand-new
 * include, an asset whose consumers aren't tracked, …) — the uncertainty signal
 * that forces a full rebuild.
 * @param {string} file Project-relative POSIX path of the changed file.
 * @param {Record<string, DepMapEntry>} mapRoutes
 * @param {Map<string, import("./compiler/collections.js").CollectionRow[]>} collections
 * @returns {Set<string> | null}
 */
function routesAffectedBy(file, mapRoutes, collections) {
  /** @type {Set<string>} */
  const affected = new Set();
  let known = false;
  for (const [routePath, entry] of Object.entries(mapRoutes)) {
    if (entry.deps.includes(file)) {
      affected.add(routePath);
      known = true;
    }
  }
  const collection = collectionMemberOf(file);
  if (collection && collections.has(collection)) {
    known = true;
    for (const [routePath, entry] of Object.entries(mapRoutes)) {
      if (entry.collections.includes(collection)) affected.add(routePath);
    }
  }
  return known ? affected : null;
}

/**
 * The collection a changed page file belongs to: `site/pages/blog/hello.md` →
 * `"blog"`. Only `.md`/`.wd` files nested under a `site/pages/<name>/` directory
 * qualify — any other file type there (an image a page might measure) is not a
 * collection membership signal and must go through the deps/full-rebuild path.
 * @param {string} file Project-relative POSIX path.
 * @returns {string | null}
 */
function collectionMemberOf(file) {
  const prefix = `${routesDir}/`;
  if (!file.startsWith(prefix)) return null;
  if (![".md", ".wd"].includes(path.posix.extname(file))) return null;
  const parts = file.slice(prefix.length).split("/");
  return parts.length >= 2 ? parts[0] : null;
}

/**
 * Re-copy a changed non-page asset to its published location during an
 * incremental build (the full build's `emitShelfAssets`/`emitPageAssets` sweep
 * doesn't run there). Only files a dependency graph already vouched for reach
 * this point — in practice `@loop` JSON data files, published under
 * `/__wd/data/` (shelf) or beside their page (site/pages). Page/skin/script
 * sources have their own emit paths and hidden segments are never published, so
 * both are skipped.
 * @param {string} file Project-relative POSIX path of the changed file.
 * @param {string} cwd
 * @param {Paths} paths
 * @returns {void}
 */
function copyChangedAsset(file, cwd, paths) {
  const ext = path.posix.extname(file).toLowerCase();
  if ([".md", ".wd", ".skin", ".js"].includes(ext)) return;
  /** @type {string} */
  let out;
  if (file.startsWith(`${shelfDir}/`)) {
    const rel = file.slice(shelfDir.length + 1);
    out = path.join(paths.distRoot, ext === ".json" ? "__wd/data" : "__wd/media", rel);
  } else {
    const rel = file.slice(routesDir.length + 1);
    if (rel.split("/").some((segment) => /^[._-]/.test(segment))) return;
    out = path.join(paths.distRoot, rel);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(cwd, file), out);
}

/**
 * A compiled page bound for a concrete output route. Mirrors `CompiledPage` plus
 * the public `route` it's written to — for a paginated listing, page 1 keeps the
 * listing route and pages 2+ get `/<route>/page/<n>/`.
 * @typedef {object} EmittedPage
 * @property {string} route Public route path this page is written to.
 * @property {string} html
 * @property {import("./compiler.js").Assets} assets
 * @property {string[]} warnings
 */

/**
 * Compile a route into the one-or-more static pages it emits, plus the union of
 * every source file the compiles read (`deps`) and every collection they looped
 * (`collections`) — the raw material of the dev dependency map. A normal route
 * is one page. A route whose body paginates a collection (`@loop … paginate N`)
 * is compiled once to discover the page count, then recompiled per page with the
 * correct `page` pager seeded into scope — page 1 at the route, pages 2..total at
 * `/<route>/page/<n>/`. Every emitted page is static HTML (`runtime: false` for a
 * pure listing).
 * @param {Route} route
 * @param {Paths} paths
 * @param {Map<string, import("./compiler/collections.js").CollectionRow[]>} collections
 * @param {{ href: string, title: string } | undefined} feedLink
 * @returns {{ pages: EmittedPage[], deps: Set<string>, collections: Set<string> }}
 */
function compileRoutePages(route, paths, collections, feedLink) {
  /** @type {Set<string>} */
  const deps = new Set();
  /** @type {Set<string>} */
  const used = new Set();
  const track = (/** @type {import("./compiler.js").CompiledPage} */ page) => {
    for (const dep of page.deps) deps.add(dep);
    for (const name of page.collectionsUsed) used.add(name);
    for (const source of page.assets.files.keys()) deps.add(source);
  };
  // First compile (discovery): page 1 with a placeholder pager. If the page has
  // no `paginate`, this is the only compile and we emit it as-is.
  const first = compilePage(route.file, paths, {
    feed: feedLink,
    collections,
    vars: { page: pagerVars(route.route, 1, 1) }
  });
  track(first);
  if (!first.pagination || first.pagination.total <= 1) {
    return {
      pages: [
        { route: route.route, html: first.html, assets: first.assets, warnings: first.warnings }
      ],
      deps,
      collections: used
    };
  }
  // Paginated: recompile every page (including page 1, whose pager `total`/`next`
  // were unknown on the discovery pass) with the correct pager.
  const total = first.pagination.total;
  /** @type {EmittedPage[]} */
  const pages = [];
  for (let n = 1; n <= total; n++) {
    const page = compilePage(route.file, paths, {
      feed: feedLink,
      collections,
      vars: { page: pagerVars(route.route, n, total) }
    });
    track(page);
    pages.push({
      route: pageRoute(route.route, n),
      html: page.html,
      assets: page.assets,
      warnings: page.warnings
    });
  }
  return { pages, deps, collections: used };
}

/**
 * The output route for page `n` of a paginated listing: page 1 keeps the
 * listing's own clean route; pages 2+ live at `/<route>/page/<n>/`.
 * @param {string} baseRoute Listing route (trailing-slashed).
 * @param {number} n 1-based page number.
 * @returns {string}
 */
function pageRoute(baseRoute, n) {
  return n === 1 ? baseRoute : `${baseRoute}page/${n}/`;
}

/**
 * Build the `{ page.* }` pager exposed to the template scope of a paginated
 * listing: `current`/`total` numbers and `prev`/`next` URLs (empty string at the
 * ends, so `{ page.prev }` renders nothing on page 1). Plain links to the
 * generated routes — zero JS.
 * @param {string} baseRoute Listing route.
 * @param {number} current 1-based current page.
 * @param {number} total Total page count.
 * @returns {{ current: number, total: number, prev: string, next: string }}
 */
function pagerVars(baseRoute, current, total) {
  return {
    current,
    total,
    prev: current > 1 ? pageRoute(baseRoute, current - 1) : "",
    next: current < total ? pageRoute(baseRoute, current + 1) : ""
  };
}

/**
 * Resolve the site's identity from the HOME route's frontmatter — the single
 * place site-wide metadata lives this cycle (no config loader). `site_url` is
 * the absolute origin (no trailing slash) that triggers and prefixes the feeds;
 * `title`/`description` double as the RSS channel fields. A site with no `/`
 * route, or a home page without `site_url`, yields an empty `siteUrl` and the
 * feeds are skipped (robots still emits).
 * @param {Route[]} routes
 * @returns {{ siteUrl: string, title: string, description: string }}
 */
function siteIdentity(routes) {
  const home = routes.find((route) => route.route === "/");
  const meta = home ? home.meta : {};
  const read = (/** @type {string} */ key) =>
    typeof meta[key] === "string" ? String(meta[key]).trim() : "";
  return {
    siteUrl: read("site_url").replace(/\/$/, ""),
    title: read("title") || "Darkmown",
    description: read("description")
  };
}

/**
 * Whether any emitted route is a "post" — has a frontmatter `date:`. That's the
 * RSS inclusion signal, and (collectively) the trigger for emitting rss.xml at
 * all alongside the home `site_url`.
 * @param {Route[]} routes
 * @returns {boolean}
 */
function hasDatedPost(routes) {
  return routes.some((route) => typeof route.meta.date === "string" && route.meta.date.trim());
}

/**
 * Emit robots.txt (always) and, when the home page set `site_url`, sitemap.xml
 * (every non-404 route) and rss.xml (dated posts only). Returns the URL/item
 * counts (`null` when a feed was skipped) for the CLI build summary.
 *
 * The sitemap `<lastmod>` for each route is the frontmatter `date:` if present,
 * else `lastmodFor(file)` (git last-commit date → file mtime). RSS items are the
 * routes with a `date:`, newest first, capped at {@link RSS_ITEM_LIMIT}.
 * @param {Route[]} routes Emitted (post-draft-filter) routes.
 * @param {{ siteUrl: string, title: string, description: string }} identity
 * @param {Paths} paths
 * @param {boolean} [quietHints] Suppress the site_url/placeholder feed hints — set
 *   on dev-server rebuilds so they print once per session (at the initial build)
 *   instead of on every incremental rebuild. A production `darkmown build` never
 *   sets it, so the hints always show there.
 * @returns {{ sitemap: number | null, rss: number | null }}
 */
function emitFeeds(routes, identity, paths, quietHints = false) {
  fs.writeFileSync(path.join(paths.distRoot, "robots.txt"), buildRobots(identity.siteUrl));

  if (!identity.siteUrl) {
    if (!quietHints) {
      console.warn(
        "hint: set site_url in site/pages/index frontmatter to emit sitemap.xml + rss.xml " +
          "(e.g. `site_url: https://example.com`). robots.txt was still written."
      );
    }
    return { sitemap: null, rss: null };
  }

  // The blog template ships `site_url: https://example.com` as a placeholder — a
  // real build against it would point every feed/sitemap URL at example.com.
  // Flag it so the author swaps in their real origin before deploying.
  if (identity.siteUrl === "https://example.com" && !quietHints) {
    console.warn(
      "hint: site_url is the placeholder https://example.com — sitemap.xml and rss.xml will " +
        "point at example.com. Set it to your real origin before deploying."
    );
  }

  // The `/404/` route is never a feed entry — it's not an indexable page and
  // not a post. Filter it out once; both feeds work off the result.
  const feedable = routes.filter((route) => route.route !== "/404/");

  // Sitemap: one <url> per emitted route (404 excluded above).
  const sitemapEntries = feedable.map((route) => ({
    loc: absoluteUrl(identity.siteUrl, route.route),
    lastmod:
      typeof route.meta.date === "string" && route.meta.date.trim()
        ? String(route.meta.date).trim().slice(0, 10)
        : lastmodFor(route.file)
  }));
  fs.writeFileSync(path.join(paths.distRoot, "sitemap.xml"), buildSitemap(sitemapEntries));

  // RSS: dated posts only, newest first, capped. The `date:` is the "this is a
  // post" signal. With no dated post there is nothing to syndicate, so rss.xml
  // is skipped entirely (and the per-page `<link rel=alternate>` is too) — an
  // empty feed file would just 404-by-content for aggregators.
  const posts = feedable
    .filter((route) => typeof route.meta.date === "string" && route.meta.date.trim())
    .sort((a, b) => String(b.meta.date).localeCompare(String(a.meta.date)))
    .slice(0, RSS_ITEM_LIMIT);
  if (posts.length === 0) return { sitemap: sitemapEntries.length, rss: null };

  const items = posts.map((route) => {
    const { body } = parseFrontmatter(fs.readFileSync(route.file, "utf8"), route.file);
    return {
      title: typeof route.meta.title === "string" ? route.meta.title : "Untitled",
      link: absoluteUrl(identity.siteUrl, route.route),
      pubDate: rfc822(String(route.meta.date)),
      description: rssDescription(route.meta, route.file, body)
    };
  });
  fs.writeFileSync(
    path.join(paths.distRoot, "rss.xml"),
    buildRss(
      {
        title: identity.title,
        description: identity.description,
        siteUrl: identity.siteUrl,
        feedUrl: absoluteUrl(identity.siteUrl, "/rss.xml")
      },
      items
    )
  );

  return { sitemap: sitemapEntries.length, rss: items.length };
}

/**
 * Warn when more than one handler resolves to the same `/api` path, since only
 * one is ever reachable and readdir order silently decides which. Two collisions
 * are caught: an exact duplicate (`api/users.js` + `api/users/index.js`) and two
 * dynamic siblings at the same position (`api/[id].js` + `api/[slug].js`), which
 * is why dynamic segments are normalized to `[*]` before grouping.
 * @param {import("./api-runner.js").ApiRoute[]} routes
 * @param {string} apiDir
 * @returns {void}
 */
function warnApiRouteCollisions(routes, apiDir) {
  /** @type {Map<string, string[]>} */
  const byPath = new Map();
  for (const route of routes) {
    const key = route.segments.map((s) => (s.startsWith("[") ? "[*]" : s)).join("/");
    const list = byPath.get(key) || [];
    list.push(path.relative(apiDir, route.file).replaceAll(path.sep, "/"));
    byPath.set(key, list);
  }
  for (const [key, files] of byPath) {
    if (files.length > 1) {
      console.warn(
        `hint: ${files.length} api handlers resolve to /api/${key} — only one is reachable. ` +
          `Rename or remove: ${files.join(", ")}.`
      );
    }
  }
}

/**
 * Emit `dist/_worker.js/` for a Cloudflare Pages deploy (advanced mode). The
 * project's `api/*.js` functions are copied in, and a generated `index.js` routes
 * `/api/*` to them (Web-standard `(request, { params, env }) => Response`) and
 * falls through to `env.ASSETS.fetch(request)` for static files — so `_headers`
 * still applies to assets. No-op when the project has no `api/` functions.
 *
 * Handlers must be dependency-free (or pre-bundled): advanced mode does not run a
 * bundler, so bare npm imports won't resolve. We scan copied handlers and warn on
 * any bare specifier. Same source still runs on Vercel (which does bundle) and in
 * `darkmown dev` — the shape is identical.
 * @param {Paths} paths
 * @param {string} apiDir Absolute path to the project's `api/` directory.
 * @param {import("./api-runner.js").ApiRoute[]} routes Discovered api routes.
 * @returns {void}
 */
function emitCloudflareWorker(paths, apiDir, routes) {
  if (routes.length === 0) return;

  const workerDir = path.join(paths.distRoot, "_worker.js");
  fs.mkdirSync(workerDir, { recursive: true });

  /** @type {{ ident: string, spec: string, segments: string[] }[]} */
  const entries = [];
  routes.forEach((route, i) => {
    const rel = path.relative(apiDir, route.file).replaceAll(path.sep, "/");
    const out = path.join(workerDir, "api", rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const source = fs.readFileSync(route.file, "utf8");
    warnBareImports(source, `api/${rel}`);
    fs.writeFileSync(out, source);
    entries.push({ ident: `h${i}`, spec: `./api/${rel}`, segments: route.segments });
  });

  const imports = entries
    .map((e) => `import ${e.ident} from ${JSON.stringify(e.spec)};`)
    .join("\n");
  const table = entries
    .map((e) => `  { segments: ${JSON.stringify(e.segments)}, handler: ${e.ident} }`)
    .join(",\n");

  fs.writeFileSync(path.join(workerDir, "index.js"), cloudflareWorkerSource(imports, table));
}

/**
 * Warn when a Cloudflare-bound handler imports a bare npm package. Advanced mode
 * runs no bundler, so only relative (`./`, `../`) and `node:` specifiers resolve
 * at the edge; a bare `import x from "some-pkg"` would fail at runtime with no
 * build-time signal. Advisory only — relative/`node:`/data imports pass clean.
 * @param {string} source Handler source.
 * @param {string} label Human-readable handler path for the message.
 * @returns {void}
 */
function warnBareImports(source, label) {
  /** @type {Set<string>} */
  const bare = new Set();
  const re =
    /(?:^|[^.\w])(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*\(?\s*['"]([^'"]+)['"]/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const spec = m[1] || m[2];
    if (spec && !/^[./]/.test(spec) && !spec.startsWith("node:")) bare.add(spec);
  }
  if (bare.size > 0) {
    console.warn(
      `hint: ${label} imports ${[...bare].map((s) => `"${s}"`).join(", ")} — Cloudflare ` +
        "advanced mode runs no bundler, so bare npm imports won't resolve at the edge. " +
        "Inline the dependency or pre-bundle the handler."
    );
  }
}

/**
 * The generated Cloudflare Pages `_worker.js/index.js` source. Mirrors the
 * dev runner's matching (static beats dynamic; `[param]` capture; `index`
 * collapses to its directory) so routing is identical across dev and prod.
 * @param {string} imports
 * @param {string} table
 * @returns {string}
 */
function cloudflareWorkerSource(imports, table) {
  return `// Generated by Darkmown for Cloudflare Pages (advanced mode). Routes /api/* to
// the project's api functions; every other request is a static asset.
${imports}

const routes = [
${table}
];

function match(pathname) {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return null;
  const parts = pathname.split("/").filter(Boolean).slice(1);
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = route.segments[i];
      if (seg[0] === "[" && seg[seg.length - 1] === "]") {
        params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
      } else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const matched = match(new URL(request.url).pathname);
    if (!matched) return env.ASSETS.fetch(request);
    try {
      const response = await matched.handler(request, { params: matched.params, env });
      if (response instanceof Response) return response;
      return Response.json({ ok: false, error: "Handler did not return a Response" }, { status: 500 });
    } catch (err) {
      return Response.json({ ok: false, error: String((err && err.message) || err) }, { status: 500 });
    }
  }
};
`;
}

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
export function stripRuntimeComments(source) {
  return (
    source
      // JSDoc blocks — type annotations the browser never needs.
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      // Whole-line `//` comments — developer notes that don't belong in the download.
      .replace(/^[ \t]*\/\/.*$/gm, "")
      // Drop the now blank/whitespace-only lines the removals leave behind.
      .replace(/^[ \t]*\n/gm, "")
  );
}

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
export function renderCloudflareHeaders(manifest) {
  const baseLines = Object.entries(BASE_SECURITY_HEADERS).map(
    ([name, value]) => `  ${name}: ${value}`
  );
  const blocks = [["/*", [...baseLines, `  Content-Security-Policy: ${REACTIVE_CSP}`]]];

  for (const entry of manifest) {
    if (entry.assets.runtime) continue; // reactive routes keep the catch-all (eval-free) CSP
    for (const pattern of cloudflarePathPatterns(entry.route)) {
      blocks.push([pattern, [`  Content-Security-Policy: ${STATIC_CSP}`]]);
    }
  }

  return `${blocks.map(([pattern, lines]) => [pattern, ...lines].join("\n")).join("\n\n")}\n`;
}

/**
 * Cloudflare `_headers` path patterns covering a clean-URL route. `/` →
 * `["/", "/index.html"]`; `/docs/` → `["/docs", "/docs/*"]`.
 * @param {string} route Route path from the manifest (always trailing-slashed).
 * @returns {string[]}
 */
function cloudflarePathPatterns(route) {
  if (route === "/") return ["/", "/index.html"];
  const trimmed = route.replace(/\/$/, ""); // "/docs/" -> "/docs"
  return [trimmed, `${trimmed}/*`];
}

/**
 * A minimal, zero-JS fallback 404 page used only when no `404.wd` route exists.
 * @returns {string}
 */
function defaultNotFoundHtml() {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Page not found</title>",
    "</head>",
    "<body>",
    "<main>",
    "<h1>Page not found</h1>",
    '<p>That route does not exist. <a href="/">Back to home</a>.</p>',
    "</main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

/**
 * @param {Paths} paths
 * @returns {void}
 */
function emitRuntime(paths) {
  const out = path.join(paths.distRoot, "__wd/runtime.js");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const source = fs.readFileSync(path.join(moduleDir, "runtime.js"), "utf8");
  fs.writeFileSync(out, stripRuntimeComments(source));
}

/**
 * Emit the pay-for-what-you-use behavior modules a page asked for, comment-
 * stripped like the runtime. Each is a standalone `/__wd/behaviors/<name>.js`
 * module, NOT part of `runtime.js`, so the core runtime budget is untouched.
 * @param {Assets} assets
 * @param {Paths} paths
 * @returns {void}
 */
function emitBehaviors(assets, paths) {
  for (const name of assets.behaviors) {
    const source = fs.readFileSync(path.join(moduleDir, "behaviors", `${name}.js`), "utf8");
    const out = path.join(paths.distRoot, "__wd/behaviors", `${name}.js`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, stripRuntimeComments(source));
  }
}

/**
 * Emit the framework syntax-highlighting stylesheet `/__wd/highlight.css`, called
 * only for a page that has a build-time-highlighted code block (`assets.hasCode`).
 * It is CSS only — highlighting is build-time HTML + this stylesheet, with zero
 * runtime JS — and maps highlight.js token classes onto the `$code-*` skin tokens,
 * so code dark-modes for free through `tokens dark` / `:theme`. Idempotent: writing
 * the same content per code-bearing page is harmless and keeps the call site simple.
 * @param {Paths} paths
 * @returns {void}
 */
function emitHighlight(paths) {
  const out = path.join(paths.distRoot, "__wd/highlight.css");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, HIGHLIGHT_CSS);
}

/**
 * Emit a page's colocated assets. `.skin` files compile through {@link compileSkin}
 * (other files copy verbatim). A skin that opted into scoping (`assets.scopedSkins`)
 * compiles in scoped mode: the scope id is derived here from its PROJECT-RELATIVE
 * PATH — the single coordination point with the HTML stamp, which derives the same
 * id from the same path — and threaded into `compileSkin({ scope })`. The compiler
 * also reports the scoped subject selectors, which we check against the stamped page
 * HTML to warn (never remove) on a scoped selector that matches no element.
 * @param {Assets} assets
 * @param {Paths} paths
 * @param {string} pageHtml Assembled page HTML (carries the `data-wd-scope` stamps).
 * @param {Set<string>} warned Cross-route dedupe set for emitted hints.
 * @returns {void}
 */
function emitAssets(assets, paths, pageHtml, warned) {
  for (const [source, href] of assets.files) {
    const out = path.join(paths.distRoot, href);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (source.endsWith(".skin")) {
      const src = fs.readFileSync(source, "utf8");
      if (assets.scopedSkins.has(source)) {
        const rel = path.relative(paths.cwd, source).replaceAll(path.sep, "/");
        const scope = scopeIdFor(rel);
        /** @type {Set<string>} */
        const subjects = new Set();
        fs.writeFileSync(out, compileSkin(src, { scope, subjects }));
        warnUnusedScoped(subjects, scope, pageHtml, path.basename(source), warned);
      } else {
        fs.writeFileSync(out, compileSkin(src));
      }
    } else {
      fs.copyFileSync(source, out);
    }
  }
}

/**
 * Warn (do NOT remove) when a scoped selector's subject never appears in its
 * stamped subtree — a likely typo or stale rule. We only have a class/element/id
 * to look for, so we scan the elements actually stamped with THIS scope id in the
 * assembled page and check each subject against them. A colocated `.js` may add
 * classes at runtime, so this stays advisory: the rule is always emitted. An empty
 * subject token (a bare attribute-selector subject) is unknowable here and skipped.
 * @param {Set<string>} subjects Scoped subject tokens (`.card`, `h2`, `#id`).
 * @param {string} scope Scope id.
 * @param {string} pageHtml Assembled page HTML.
 * @param {string} skinName Skin filename for the message.
 * @param {Set<string>} warned Cross-route dedupe set.
 * @returns {void}
 */
function warnUnusedScoped(subjects, scope, pageHtml, skinName, warned) {
  // The opening tags carrying this scope id — the only elements the scoped
  // stylesheet can match. One scan, reused for every subject.
  const stamped = pageHtml.match(
    new RegExp(`<[a-zA-Z][\\w-]*[^>]*\\bdata-wd-scope="${scope}"[^>]*>`, "g")
  );
  const tags = stamped ?? [];
  for (const subject of subjects) {
    if (!subject) continue;
    const present = tags.some((tag) => subjectMatchesTag(subject, tag));
    if (present) continue;
    const warning = `scoped selector "${subject}" in ${skinName} matches no element`;
    if (warned.has(warning)) continue;
    warned.add(warning);
    console.warn(`hint: ${warning}`);
  }
}

/**
 * Whether a scoped subject token (`.card` / `#id` / a bare tag like `h2`) could
 * match a single stamped opening tag. Class subjects look in the tag's `class`
 * attribute; id subjects in `id`; a bare tag compares the element name.
 * @param {string} subject
 * @param {string} tag A single opening tag string.
 * @returns {boolean}
 */
function subjectMatchesTag(subject, tag) {
  if (subject.startsWith(".")) {
    const cls = subject.slice(1);
    const m = tag.match(/\bclass\s*=\s*"([^"]*)"/);
    return m ? m[1].split(/\s+/).includes(cls) : false;
  }
  if (subject.startsWith("#")) {
    const m = tag.match(/\bid\s*=\s*"([^"]*)"/);
    return m ? m[1] === subject.slice(1) : false;
  }
  const name = tag.match(/^<([a-zA-Z][\w-]*)/);
  return name ? name[1].toLowerCase() === subject.toLowerCase() : false;
}

/**
 * Copy non-page shelf assets (JSON data, media) into `dist/__wd`.
 * @param {Paths} paths
 * @returns {void}
 */
function emitShelfAssets(paths) {
  if (!fs.existsSync(paths.shelfRoot)) return;
  for (const file of walk(paths.shelfRoot)) {
    const ext = path.extname(file);
    if ([".md", ".wd"].includes(ext)) continue;
    const rel = path.relative(paths.shelfRoot, file);
    const folder = ext === ".json" ? "__wd/data" : "__wd/media";
    const out = path.join(paths.distRoot, folder, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(file, out);
  }
}

/**
 * Copy page-colocated static assets (images, SVG, fonts, …) from `site/pages`
 * into `dist`, preserving their relative path: `site/pages/logo.svg` →
 * `dist/logo.svg`; `site/pages/blog/cover.png` → `dist/blog/cover.png`. Routes
 * (`.md`/`.wd`) and the compiler's colocated `.skin`/`.js` files are skipped —
 * those have their own emit paths. A backstop guard skips any asset whose output
 * would clobber an already-emitted route/framework file (in practice their
 * extensions differ, so this only fires on a genuine name clash).
 * @param {Paths} paths
 * @returns {void}
 */
function emitPageAssets(paths) {
  if (!fs.existsSync(paths.routesRoot)) return;
  for (const file of walk(paths.routesRoot)) {
    const ext = path.extname(file).toLowerCase();
    if ([".md", ".wd", ".skin", ".js"].includes(ext)) continue;
    const rel = path.relative(paths.routesRoot, file);
    if (hasHiddenPathSegment(rel) || fs.lstatSync(file).isSymbolicLink()) continue;
    const out = path.join(paths.distRoot, rel);
    if (fs.existsSync(out)) {
      console.warn(
        `hint: page asset "${rel}" skipped — a built route already emits /${rel.replaceAll(path.sep, "/")}`
      );
      continue;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(file, out);
  }
}

/**
 * Match the router's hidden-path convention for page-colocated assets too:
 * anything below a `.`, `-`, or `_` segment is private/draft framework input,
 * not public output.
 * @param {string} rel
 * @returns {boolean}
 */
function hasHiddenPathSegment(rel) {
  return rel.split(path.sep).some((segment) => /^[._-]/.test(segment));
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs));
    else files.push(abs);
  }
  return files;
}
