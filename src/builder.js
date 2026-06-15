import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePage } from "./compiler.js";
import { createPaths } from "./config.js";
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

  fs.writeFileSync(path.join(paths.distRoot, "routes.json"), JSON.stringify(manifest, null, 2));
  return { routes: manifest, distRoot: paths.distRoot };
}

/**
 * @param {Paths} paths
 * @returns {void}
 */
function emitRuntime(paths) {
  const out = path.join(paths.distRoot, "__wd/runtime.js");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(path.join(moduleDir, "runtime.js"), out);
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
