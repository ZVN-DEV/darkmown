import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePage } from "./compiler.js";
import { createPaths } from "./config.js";
import { BASE_SECURITY_HEADERS, REACTIVE_CSP, STATIC_CSP } from "./headers.js";
import { discoverRoutes, outputPathForRoute } from "./router.js";
import { compileSkin } from "./skin.js";

/**
 * @typedef {import("./config.js").Paths} Paths
 * @typedef {import("./compiler.js").Assets} Assets
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
 * @param {string} [cwd] Project working directory (defaults to `process.cwd()`).
 * @returns {{ routes: RouteManifestEntry[], distRoot: string }}
 */
export function buildSite(cwd = process.cwd()) {
  const paths = createPaths(cwd);
  fs.rmSync(paths.distRoot, { recursive: true, force: true });
  fs.mkdirSync(paths.distRoot, { recursive: true });
  emitShelfAssets(paths);
  const routes = discoverRoutes(paths.routesRoot);
  /** @type {RouteManifestEntry[]} */
  const manifest = [];

  /** @type {Set<string>} */
  const warned = new Set();

  /** @type {string | undefined} HTML of the `/404/` route, copied to dist/404.html. */
  let notFoundHtml;

  for (const route of routes) {
    const page = compilePage(route.file, paths);
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
    manifest.push({
      route: route.route,
      file: path.relative(cwd, route.file).replaceAll(path.sep, "/"),
      assets: {
        skins: [...page.assets.skins],
        scripts: page.assets.runtime ? ["/__wd/runtime.js", ...page.assets.scripts] : [...page.assets.scripts],
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

  // Page-colocated static assets (images, SVG, fonts, …) copy last, so the guard
  // sees every emitted route/framework file already on disk.
  emitPageAssets(paths);

  return { routes: manifest, distRoot: paths.distRoot };
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
  return source
    // JSDoc blocks — type annotations the browser never needs.
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    // Whole-line `//` comments — developer notes that don't belong in the download.
    .replace(/^[ \t]*\/\/.*$/gm, "")
    // Drop the now blank/whitespace-only lines the removals leave behind.
    .replace(/^[ \t]*\n/gm, "");
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
  const baseLines = Object.entries(BASE_SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`);
  const blocks = [
    ["/*", [...baseLines, `  Content-Security-Policy: ${REACTIVE_CSP}`]]
  ];

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
    "<p>That route does not exist. <a href=\"/\">Back to home</a>.</p>",
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
      console.warn(`hint: page asset "${rel}" skipped — a built route already emits /${rel.replaceAll(path.sep, "/")}`);
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
