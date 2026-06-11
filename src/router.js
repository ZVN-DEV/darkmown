import fs from "node:fs";
import path from "node:path";
import { isHiddenName, pageExtensions } from "./config.js";

export function discoverRoutes(routesRoot) {
  if (!fs.existsSync(routesRoot)) return [];
  const routes = [];

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

export function routeFromFile(routesRoot, file) {
  const ext = path.extname(file);
  const rel = path.relative(routesRoot, file).slice(0, -ext.length);
  const parts = rel.split(path.sep);
  if (parts.at(-1) === "index") parts.pop();
  const route = `/${parts.join("/")}`;
  return route === "/" ? "/" : `${route}/`;
}

export function outputPathForRoute(distRoot, route) {
  const clean = route === "/" ? "" : route.replace(/^\/|\/$/g, "");
  return path.join(distRoot, clean, "index.html");
}
