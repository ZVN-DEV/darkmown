// ---------------------------------------------------------------------------
// Includes / assets: resolve `@include` (and `@loop` data) targets to absolute
// paths inside `site/pages` or `site/_`, register colocated `.skin`/`.js`
// siblings, detect scoped skins and stamp their subtree HTML (`stampScope`),
// and warn when a plain `.md` file uses `.wd`-only syntax.
// ---------------------------------------------------------------------------

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
 * @param {import("./reader.js").Reader} reader Source reader for the skin file.
 * @returns {{ scoped: boolean, scopeId: string }}
 */
export function scopeInfoForSkin(skinPath, cwd, reader) {
  const rel = path.relative(cwd, skinPath).replaceAll(path.sep, "/");
  const scopeId = scopeIdFor(rel);
  const src = reader.readText(skinPath).replace(/\/\*[\s\S]*?\*\//g, "");
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
 * @param {import("./reader.js").Reader} reader Source reader for the skin file.
 * @returns {{ scoped: boolean, scopeId: string } | null}
 */
export function scopedSkinFor(file, context, reader) {
  const ext = path.extname(file);
  const candidate = `${file.slice(0, -ext.length)}.skin`;
  if (!reader.exists(candidate)) return null;
  return scopeInfoForSkin(candidate, context.cwd, reader);
}

/**
 * Raw-text (`script`, `style`) and escapable-raw-text (`textarea`, `title`)
 * elements per the HTML spec: their CONTENT is not markup, so `<`/`>` inside them
 * are plain characters and must never be treated as tags. The content runs to the
 * first matching close tag.
 * @type {Set<string>}
 */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

/**
 * Stamp `data-wd-scope="<id>"` onto every opening tag of a subtree — the HTML
 * half of compile-time scoped styles, mirroring {@link enhanceImages}: a
 * compile-time post-pass over assembled HTML, zero runtime JS. Every element
 * start tag that doesn't already carry a scope attribute gets one, so the scoped
 * stylesheet (whose selectors end in `[data-wd-scope="<id>"]`) matches inside
 * this subtree and nowhere else. Void/self-closing tags are stamped too (the
 * attribute is valid on any element). Closing tags, comments, doctype, and the
 * `<!`/`<?` families are left alone. A tag that ALREADY has a `data-wd-scope`
 * (e.g. a nested include with its own scope) keeps its own — first stamp wins.
 *
 * Raw-text / escapable-raw-text elements (`script`, `style`, `textarea`,
 * `title`) are special-cased: their OPENING tag is stamped (valid), but their
 * BODY is left byte-intact — `<`/`>` inside a `<script>` are JavaScript, not
 * markup, so stamping there would corrupt the content. A small tokenizer walks
 * tag-by-tag (quote-aware in attribute lists) and, on entering a raw-text
 * element, copies through verbatim until the matching close tag.
 * @param {string} html Subtree HTML to scope.
 * @param {string} scopeId Scope id (from {@link import("../skin.js").scopeIdFor}).
 * @returns {string}
 */
export function stampScope(html, scopeId) {
  // Opening tag: name + (quote-aware) attribute list + optional self-close slash.
  const openTag = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let out = "";
  let cursor = 0;
  for (let m = openTag.exec(html); m; m = openTag.exec(html)) {
    const [tag, name, attrs, slash] = m;
    out += html.slice(cursor, m.index); // text/markup before this opening tag
    const stamped = /\bdata-wd-scope\s*=/.test(attrs)
      ? tag // first stamp wins — a pre-stamped tag keeps its own scope
      : `<${name}${attrs} data-wd-scope="${scopeId}"${slash ? " /" : ""}>`;
    out += stamped;
    cursor = m.index + tag.length;

    // Raw-text element (not self-closed): copy its body through untouched and
    // resume scanning after the matching close tag, so nothing inside is stamped.
    if (!slash && RAW_TEXT_ELEMENTS.has(name.toLowerCase())) {
      const rest = html.slice(cursor);
      const closeMatch = new RegExp(`</${name}\\s*>`, "i").exec(rest);
      if (!closeMatch) {
        out += rest; // unterminated raw-text element — copy the remainder verbatim
        cursor = html.length;
        break;
      }
      const through = closeMatch.index + closeMatch[0].length; // body + close tag
      out += rest.slice(0, through); // byte-intact
      cursor += through;
      openTag.lastIndex = cursor; // skip the body the scanner would otherwise re-walk
    }
  }
  out += html.slice(cursor); // trailing text after the last opening tag
  return out;
}

/**
 * Register a page's colocated `.skin`/`.js` siblings as emitted assets.
 * @param {string} file
 * @param {Paths} context
 * @param {Assets} assets
 * @param {import("./reader.js").Reader} reader Source reader for sibling probing.
 * @returns {void}
 */
export function collectColocatedAssets(file, context, assets, reader) {
  const ext = path.extname(file);
  const stem = file.slice(0, -ext.length);
  for (const [assetExt, folder] of [
    [".skin", "styles"],
    [".js", "scripts"]
  ]) {
    const candidate = `${stem}${assetExt}`;
    if (!reader.exists(candidate)) continue;
    const rel = path.relative(context.cwd, candidate).replaceAll(path.sep, "/");
    const outputExt = assetExt === ".skin" ? ".css" : ".js";
    const publicPath = `/__wd/${folder}/${rel.slice(0, -assetExt.length).replace(/[/.]/g, "_")}${outputExt}`;
    assets.files.set(candidate, publicPath);
    if (assetExt === ".skin") {
      assets.skins.add(publicPath);
      // Surface "this skin is scoped" so the warning pass (builder) and the HTML
      // stamp can find the scoped skins among all colocated ones by source path.
      if (scopeInfoForSkin(candidate, context.cwd, reader).scoped)
        assets.scopedSkins.add(candidate);
    }
    if (assetExt === ".js") assets.scripts.add(publicPath);
  }
}

/**
 * Resolve an include spec to an absolute path inside `site/pages` or `site/_`.
 * @param {string} spec Include target (may be quoted).
 * @param {string} fromFile File requesting the include.
 * @param {Paths} context
 * @param {boolean} allowAny Allow non-page extensions (e.g. JSON for `@loop`).
 * @param {string} loc Source location (`file:line`) for the error messages, so
 *   an unresolved/out-of-sandbox include reports the directive's line. Callers
 *   with a line index pass `at(ctx, index)`; pass `fromFile` for the file-only
 *   message.
 * @param {import("./reader.js").Reader} reader Source reader for existence
 *   probing, threaded from `ctx.comp.reader`.
 * @returns {string}
 */
export function resolveInclude(spec, fromFile, context, allowAny, loc, reader) {
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
      throw new Error(`Include "${spec}" from ${loc} resolves outside site/pages or site/_`);
    }
    if (!reader.exists(resolved)) continue;
    if (!allowAny && !pageIncludeExtensions.includes(path.extname(resolved))) continue;
    return resolved;
  }
  throw new Error(
    `Could not resolve include "${spec}" from ${loc}. Looked in site/pages and site/_ — check the path and leading slash.`
  );
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
