import fs from "node:fs";
import path from "node:path";
import { isHiddenName, pageExtensions } from "./config.js";

/**
 * A discovered page route: the source file and its public route path.
 * @typedef {object} Route
 * @property {string} file Absolute path to the source `.md`/`.wd` file.
 * @property {string} route Public route path (always trailing-slashed, e.g. `/about/`).
 */

/**
 * Walk `routesRoot` and collect page routes, sorted and de-duplicated.
 * @param {string} routesRoot Absolute path to `site/pages`.
 * @returns {Route[]}
 */
export function discoverRoutes(routesRoot) {
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
      routes.push({
        file: abs,
        route: routeFromFile(routesRoot, abs)
      });
    }
  }

  walk(routesRoot);
  const seen = new Map();
  for (const route of routes) {
    if (seen.has(route.route)) {
      throw new Error(`Duplicate route "${route.route}" from ${seen.get(route.route)} and ${route.file}`);
    }
    seen.set(route.route, route.file);
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
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
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} route Public route path.
 * @returns {string}
 */
export function outputPathForRoute(distRoot, route) {
  const clean = route === "/" ? "" : route.replace(/^\/|\/$/g, "");
  return path.join(distRoot, clean, "index.html");
}
