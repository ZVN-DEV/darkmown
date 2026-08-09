import fs from "node:fs";
import path from "node:path";
import { wdError } from "./compiler/context.js";
import { parseFrontmatter } from "./compiler.js";
import { isHiddenName, pageExtensions } from "./config.js";

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
export function discoverRoutes(routesRoot, options = {}) {
  if (!fs.existsSync(routesRoot)) return [];
  /** @type {Route[]} */
  const routes = [];

  /** @param {string} dir */
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isHiddenName(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const ext = path.extname(entry.name);
      if (!pageExtensions.has(ext)) continue;
      const base = path.basename(entry.name, ext);
      if (isHiddenName(base)) continue;
      const { meta } = parseFrontmatter(fs.readFileSync(abs, "utf8"), abs);
      if (isDraft(meta) && !options.includeDrafts) continue;
      routes.push({
        file: abs,
        route: routeFromFile(routesRoot, abs),
        meta
      });
    }
  }

  walk(routesRoot);
  const seen = new Map();
  for (const route of routes) {
    if (seen.has(route.route)) {
      throw wdError(
        `Duplicate route "${route.route}" from ${seen.get(route.route)} and ${route.file}`,
        { code: "WD901", file: route.file }
      );
    }
    seen.set(route.route, route.file);
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Whether a page's frontmatter marks it a draft (`draft: true`). The scalar
 * frontmatter parser yields a boolean `true` or the string `"true"`, so accept
 * both; any other value (absent, `false`, `"false"`) is not a draft.
 * @param {Meta} meta
 * @returns {boolean}
 */
export function isDraft(meta) {
  return meta.draft === true || meta.draft === "true";
}

/**
 * Derive a public route path from a source file path.
 * @param {string} routesRoot Absolute path to `site/pages`.
 * @param {string} file Absolute path to the source file.
 * @returns {string}
 */
export function routeFromFile(routesRoot, file) {
  const ext = path.extname(file);
  const rel = path.relative(routesRoot, file).slice(0, -ext.length);
  const parts = rel.split(path.sep);
  if (parts.at(-1) === "index") parts.pop();
  const route = `/${parts.join("/")}`;
  return route === "/" ? "/" : `${route}/`;
}

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
export function outputPathForRoute(distRoot, route) {
  const clean = route === "/" ? "" : route.replace(/^\/|\/$/g, "");
  const out = path.join(distRoot, clean, "index.html");
  if (!path.resolve(out).startsWith(path.resolve(distRoot) + path.sep)) {
    throw wdError(
      `Route "${route}" resolves outside the build output directory ${distRoot} — routes must not contain traversal segments`,
      { code: "WD902" }
    );
  }
  return out;
}
