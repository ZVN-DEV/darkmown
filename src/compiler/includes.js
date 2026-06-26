// ---------------------------------------------------------------------------
// Includes / assets: resolve `@include` (and `@loop` data) targets to absolute
// paths inside `site/pages` or `site/_`, register colocated `.skin`/`.js`
// siblings, and warn when a plain `.md` file uses `.wd`-only syntax.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { pageIncludeExtensions } from "./context.js";
import { stripQuotes } from "./interpolation.js";

/**
 * @typedef {import("./context.js").Paths} Paths
 * @typedef {import("./context.js").Assets} Assets
 * @typedef {import("./context.js").Compilation} Compilation
 */

/**
 * Register a page's colocated `.skin`/`.js` siblings as emitted assets.
 * @param {string} file
 * @param {Paths} context
 * @param {Assets} assets
 * @returns {void}
 */
export function collectColocatedAssets(file, context, assets) {
  const ext = path.extname(file);
  const stem = file.slice(0, -ext.length);
  for (const [assetExt, folder] of [
    [".skin", "styles"],
    [".js", "scripts"]
  ]) {
    const candidate = `${stem}${assetExt}`;
    if (!fs.existsSync(candidate)) continue;
    const rel = path.relative(context.cwd, candidate).replaceAll(path.sep, "/");
    const outputExt = assetExt === ".skin" ? ".css" : ".js";
    const publicPath = `/__wd/${folder}/${rel.slice(0, -assetExt.length).replace(/[/.]/g, "_")}${outputExt}`;
    assets.files.set(candidate, publicPath);
    if (assetExt === ".skin") assets.skins.add(publicPath);
    if (assetExt === ".js") assets.scripts.add(publicPath);
  }
}

/**
 * Resolve an include spec to an absolute path inside `site/pages` or `site/_`.
 * @param {string} spec Include target (may be quoted).
 * @param {string} fromFile File requesting the include.
 * @param {Paths} context
 * @param {boolean} [allowAny] Allow non-page extensions (e.g. JSON for `@loop`).
 * @returns {string}
 */
export function resolveInclude(spec, fromFile, context, allowAny = false) {
  const clean = stripQuotes(spec);
  const candidates = [];
  if (clean.startsWith("/")) {
    candidates.push(path.join(context.shelfRoot, clean.slice(1)));
  } else {
    candidates.push(path.resolve(path.dirname(fromFile), clean));
    candidates.push(path.join(context.shelfRoot, clean));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!isAllowedInclude(resolved, context)) {
      throw new Error(`Include "${spec}" from ${fromFile} resolves outside site/pages or site/_`);
    }
    if (!fs.existsSync(resolved)) continue;
    if (!allowAny && !pageIncludeExtensions.includes(path.extname(resolved))) continue;
    return resolved;
  }
  throw new Error(`Could not resolve include "${spec}" from ${fromFile}`);
}

/**
 * @param {string} file
 * @param {Paths} context
 * @returns {boolean}
 */
export function isAllowedInclude(file, context) {
  const roots = [context.routesRoot, context.shelfRoot].map((root) => path.resolve(root));
  return roots.some((root) => file === root || file.startsWith(`${root}${path.sep}`));
}

// ---------------------------------------------------------------------------
// Plain .md hints
// ---------------------------------------------------------------------------

/**
 * Warn when a plain `.md` file contains `.wd`-only syntax that stays inert.
 * @param {string} body
 * @param {string} file
 * @param {Compilation} comp
 * @returns {void}
 */
export function scanMarkdownHints(body, file, comp) {
  let fence = null;
  for (const line of body.split("\n")) {
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length)
        fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const hit = line.match(
      /^(@include|@loop|@repeat|:state|:button|:if|:for|:try|:note|:sprint|:::)(\s|$)/
    );
    if (hit) {
      comp.warnings.push(
        `${file}: "${hit[1]}" is .wd syntax and stays plain text in .md — rename the file to .wd to activate it.`
      );
      return;
    }
  }
}
