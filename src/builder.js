import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverApiRoutes } from "./api-runner.js";
import { compilePage, parseFrontmatter } from "./compiler.js";
import { createPaths } from "./config.js";
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
import { compileSkin } from "./skin.js";

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
 * @param {{ target?: string, includeDrafts?: boolean }} [options] `target:
 *   "cloudflare"` emits the Pages worker. `includeDrafts: true` keeps `draft:
 *   true` pages in the build + feeds (dev / `build --drafts`); default excludes
 *   them at route discovery so feeds never see a draft.
 * @returns {{ routes: RouteManifestEntry[], distRoot: string, feeds: { sitemap: number | null, rss: number | null } }}
 */
export function buildSite(cwd = process.cwd(), options = {}) {
  const paths = createPaths(cwd);
  fs.rmSync(paths.distRoot, { recursive: true, force: true });
  fs.mkdirSync(paths.distRoot, { recursive: true });
  emitShelfAssets(paths);
  const routes = discoverRoutes(paths.routesRoot, { includeDrafts: options.includeDrafts });
  // Site identity lives in the HOME page frontmatter (no config loader): the
  // `site_url` origin triggers + prefixes the feeds, reusing `title`/`description`
  // as the RSS channel fields. Resolved once, up front, so every page can link
  // the feed during the loop.
  const identity = siteIdentity(routes);
  // Advertise the feed in every page's <head> only when rss.xml will actually be
  // emitted: the home set `site_url` AND there is at least one dated post. A
  // stale `<link>` to a missing feed would 404 for aggregators.
  const feedLink =
    identity.siteUrl && hasDatedPost(routes)
      ? { href: absoluteUrl(identity.siteUrl, "/rss.xml"), title: identity.title }
      : undefined;
  /** @type {RouteManifestEntry[]} */
  const manifest = [];

  /** @type {Set<string>} */
  const warned = new Set();

  /** @type {string | undefined} HTML of the `/404/` route, copied to dist/404.html. */
  let notFoundHtml;

  for (const route of routes) {
    const page = compilePage(route.file, paths, { feed: feedLink });
    for (const warning of page.warnings || []) {
      if (warned.has(warning)) continue;
      warned.add(warning);
      console.warn(`hint: ${warning}`);
    }
    const outFile = outputPathForRoute(paths.distRoot, route.route);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, page.html);
    if (route.route === "/404/") notFoundHtml = page.html;
    emitAssets(page.assets, paths);
    if (page.assets.runtime) emitRuntime(paths);
    emitBehaviors(page.assets, paths);
    if (page.assets.hasCode) emitHighlight(paths);
    const behaviorSrcs = [...page.assets.behaviors].map((name) => `/__wd/behaviors/${name}.js`);
    manifest.push({
      route: route.route,
      file: path.relative(cwd, route.file).replaceAll(path.sep, "/"),
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

  // Hosts (Vercel, Cloudflare Pages) and the framework's own server auto-serve
  // dist/404.html for misses. Prefer the compiled 404 route; fall back to a
  // minimal page so a 404 is always available.
  fs.writeFileSync(path.join(paths.distRoot, "404.html"), notFoundHtml ?? defaultNotFoundHtml());

  fs.writeFileSync(path.join(paths.distRoot, "routes.json"), JSON.stringify(manifest, null, 2));

  // Cloudflare Pages reads dist/_headers for security headers (Vercel reads
  // vercel.json; the local server adds them in src/statics.js). Static routes
  // get the stricter CSP (no 'unsafe-eval'); reactive routes get the relaxed
  // one. A catch-all keeps assets and any future path covered.
  fs.writeFileSync(path.join(paths.distRoot, "_headers"), renderCloudflareHeaders(manifest));

  // Crawler files + feeds. robots.txt is ALWAYS emitted; sitemap.xml + rss.xml
  // need the home `site_url` (else a loud, actionable build hint). Drafts are
  // already filtered out of `routes`, so neither feed can ever see one.
  const feeds = emitFeeds(routes, identity, paths);

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

  return { routes: manifest, distRoot: paths.distRoot, feeds };
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
 * @returns {{ sitemap: number | null, rss: number | null }}
 */
function emitFeeds(routes, identity, paths) {
  fs.writeFileSync(path.join(paths.distRoot, "robots.txt"), buildRobots(identity.siteUrl));

  if (!identity.siteUrl) {
    console.warn(
      "hint: set site_url in site/pages/index frontmatter to emit sitemap.xml + rss.xml " +
        "(e.g. `site_url: https://example.com`). robots.txt was still written."
    );
    return { sitemap: null, rss: null };
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
 * security headers + the relaxed reactive CSP that satisfies every page), then
 * one block per static route that overrides `Content-Security-Policy` with the
 * stricter, eval-free CSP. Reactive routes need no override — the catch-all
 * already carries the relaxed CSP.
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
    if (entry.assets.runtime) continue; // reactive routes keep the catch-all (relaxed) CSP
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
 * @param {Assets} assets
 * @param {Paths} paths
 * @returns {void}
 */
function emitAssets(assets, paths) {
  for (const [source, href] of assets.files) {
    const out = path.join(paths.distRoot, href);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (source.endsWith(".skin")) {
      fs.writeFileSync(out, compileSkin(fs.readFileSync(source, "utf8")));
    } else {
      fs.copyFileSync(source, out);
    }
  }
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
