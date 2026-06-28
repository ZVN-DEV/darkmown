// ---------------------------------------------------------------------------
// Includes / assets: resolve `@include` (and `@loop` data) targets to absolute
// paths inside `site/pages` or `site/_`, register colocated `.skin`/`.js`
// siblings, and warn when a plain `.md` file uses `.wd`-only syntax.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { scopeIdFor } from "../skin.js";
import { pageIncludeExtensions } from "./context.js";
import { stripQuotes } from "./interpolation.js";

/**
 * @typedef {import("./context.js").Paths} Paths
 * @typedef {import("./context.js").Assets} Assets
 * @typedef {import("./context.js").Compilation} Compilation
 */

/**
 * Read a `.skin` file's first meaningful line (skipping `//` line comments,
 * `/* … *\/` block comments, blanks, and decorative dividers — the same skip
 * rules `compileSkin` applies) to decide whether it opts into scoping. A skin
 * scopes its selectors ONLY when that first line is exactly `scoped`; otherwise
 * it is global and untouched. This is the single source for "is this skin
 * scoped + what is its id", so the CSS rewrite (builder) and the HTML stamp
 * (page/include) always agree on both.
 * @param {string} skinPath Absolute path to the colocated `.skin` file.
 * @param {string} cwd Project root, for the path-based scope id.
 * @returns {{ scoped: boolean, scopeId: string }}
 */
export function scopeInfoForSkin(skinPath, cwd) {
  const rel = path.relative(cwd, skinPath).replaceAll(path.sep, "/");
  const scopeId = scopeIdFor(rel);
  const src = fs.readFileSync(skinPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const raw of src.split("\n")) {
    const t = raw.trim();
    if (!t || t.startsWith("//") || !/[A-Za-z0-9]/.test(t)) continue;
    return { scoped: t === "scoped", scopeId };
  }
  return { scoped: false, scopeId };
}

/**
 * The scope info for a page/include's OWN colocated `.skin` sibling, or null
 * when there is no sibling skin. Used by the HTML stamp sites: a route's own
 * scoped skin → stamp the page body; an include's scoped skin → stamp the
 * returned subtree. Resolution mirrors `collectColocatedAssets` (same stem,
 * `.skin` extension).
 * @param {string} file Absolute path to the page/include source file.
 * @param {Paths} context
 * @returns {{ scoped: boolean, scopeId: string } | null}
 */
export function scopedSkinFor(file, context) {
  const ext = path.extname(file);
  const candidate = `${file.slice(0, -ext.length)}.skin`;
  if (!fs.existsSync(candidate)) return null;
  return scopeInfoForSkin(candidate, context.cwd);
}

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
    if (assetExt === ".skin") {
      assets.skins.add(publicPath);
      // Surface "this skin is scoped" so the warning pass (builder) and the HTML
      // stamp can find the scoped skins among all colocated ones by source path.
      if (scopeInfoForSkin(candidate, context.cwd).scoped) assets.scopedSkins.add(candidate);
    }
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
