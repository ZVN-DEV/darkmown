// ---------------------------------------------------------------------------
// Page shell + document assembly: wrap a compiled body in the full HTML shell
// (title, social meta, favicon, skins, scripts, optional view transitions +
// speculationrules), harden every `<img>` at compile time, and drive the
// per-file compile (frontmatter + colocated assets + body / `.md` passthrough).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";
import { htmlHasHighlight } from "../highlight.js";
import { compileBody } from "./body.js";
import { createCompilation, createScope } from "./context.js";
import { parseFrontmatter, warnLikelyFrontmatter } from "./frontmatter.js";
import { collectColocatedAssets, scanMarkdownHints, scopedSkinFor } from "./includes.js";
import { escapeHtml } from "./interpolation.js";
import { selectMd } from "./markdown.js";

/**
 * @typedef {import("./context.js").Paths} Paths
 * @typedef {import("./context.js").Meta} Meta
 * @typedef {import("./context.js").Scope} Scope
 * @typedef {import("./context.js").Compilation} Compilation
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").CompiledDocument} CompiledDocument
 * @typedef {import("./context.js").CompiledPage} CompiledPage
 */

/**
 * Compile a page source file into a full HTML document plus its assets.
 * @param {string} file Absolute path to the source `.md`/`.wd` file.
 * @param {Paths} context Resolved project paths.
 * @param {{ feed?: { href: string, title: string }, collections?: Map<string, import("./collections.js").CollectionRow[]>, vars?: Record<string, unknown> }} [options]
 *   When a site-wide RSS feed is emitted (the home page set `site_url` and the
 *   site has dated posts), `feed` carries its absolute href + title so every page
 *   links it. `collections` is the build-time collection index a bare-name
 *   `@loop` resolves against; `vars` seeds the document scope (the pager `page`
 *   object on a paginated route).
 * @returns {CompiledPage}
 */
export function compilePage(file, context, options = {}) {
  const compiled = compileDocument(file, context, [], options.vars, options.collections);
  const title = compiled.meta.title || "Darkmown";
  const description = compiled.meta.description || "";
  // Optional `image:` frontmatter sets the social-share preview (absolute URL).
  const image = typeof compiled.meta.image === "string" ? compiled.meta.image : "";
  /** @type {string[]} */
  const social = [];
  if (description) social.push(`<meta name="description" content="${escapeHtml(description)}">`);
  if (description || image) {
    social.push(`<meta property="og:title" content="${escapeHtml(title)}">`);
    if (description)
      social.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
    social.push(`<meta property="og:type" content="website">`);
  }
  if (image) {
    social.push(`<meta property="og:image" content="${escapeHtml(image)}">`);
    social.push(`<meta name="twitter:image" content="${escapeHtml(image)}">`);
  }
  if (description || image) {
    social.push(
      `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`
    );
  }
  const descriptionTag = social.length ? `\n  ${social.join("\n  ")}` : "";
  const favicon =
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='6'%20fill='%2318221d'/%3E%3Ctext%20x='16'%20y='23'%20text-anchor='middle'%20font-family='Georgia,serif'%20font-size='19'%20font-weight='bold'%20fill='%23f7f3ea'%3ED%3C/text%3E%3C/svg%3E";
  // The framework highlight stylesheet rides ahead of page skins so a project's
  // own `$code-*` tokens / overrides still cascade over it. Pay-for-what-you-use:
  // linked only on pages with a highlighted code block (`hasCode`).
  const highlightLink = compiled.assets.hasCode
    ? [`<link rel="stylesheet" href="/__wd/highlight.css">`]
    : [];
  const cssLinks = [...highlightLink, ...compiled.assets.skins]
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join("\n");
  // RSS feed discovery: when the site emits an `rss.xml` (home `site_url` set +
  // at least one dated post), every page advertises it so readers/aggregators
  // can autodiscover the feed. Build-time only — no client JS.
  const feedLink = options.feed
    ? `\n  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(options.feed.title)}" href="${escapeHtml(options.feed.href)}">`
    : "";
  // Pay-for-what-you-use behavior modules (slider is compile-time and never here;
  // sortable/carousel each emit one) load after the runtime — sortable depends on
  // `window.wd` — and before any colocated page script.
  const behaviorSrcs = [...compiled.assets.behaviors].map((name) => `/__wd/behaviors/${name}.js`);
  const scriptSrcs = [
    ...(compiled.assets.runtime ? ["/__wd/runtime.js"] : []),
    ...behaviorSrcs,
    ...compiled.assets.scripts
  ];
  const scripts = scriptSrcs
    .map((src) => `<script type="module" src="${src}"></script>`)
    .join("\n");
  // Cross-document view transitions: opt in per page with `transitions: true` in
  // frontmatter to emit a CSS-only stylesheet — a smooth same-origin transition
  // on navigation, with zero JavaScript. Ignored by browsers without support
  // (graceful, transition-free fallback) and only applies to same-origin
  // navigations where both the outgoing and incoming page opt in.
  //
  // The default UA animation cross-fades the root: outgoing opacity 1→0 while
  // incoming 0→1, both at once. Mid-navigation that leaves the two pages
  // superimposed at ~50% opacity — headings ghost over headings. We override it
  // with a directional fade+slide (old lifts up and out, new rises up and in) so
  // the pages move past each other instead of stacking. Short + eased = peppy.
  const wantTransitions =
    compiled.meta.transitions === true || compiled.meta.transitions === "true";
  const transitions = wantTransitions
    ? `\n  <style>
    @view-transition { navigation: auto; }
    ::view-transition-old(root) { animation: wd-nav-out 200ms cubic-bezier(0.4, 0, 1, 1) both; }
    ::view-transition-new(root) { animation: wd-nav-in 200ms cubic-bezier(0, 0, 0.2, 1) both; }
    @keyframes wd-nav-out { to { opacity: 0; transform: translateY(-1rem); } }
    @keyframes wd-nav-in { from { opacity: 0; transform: translateY(1rem); } }
    @media (prefers-reduced-motion: reduce) {
      ::view-transition-old(root), ::view-transition-new(root) { animation-duration: 1ms; }
      @keyframes wd-nav-out { to { opacity: 0; } }
      @keyframes wd-nav-in { from { opacity: 0; } }
    }
  </style>`
    : "";

  // The latency half of smooth navigation — and what kills the white flash. A
  // declarative speculationrules script (the browser interprets it — not
  // framework runtime JS, so the zero-JS invariant holds) *prerenders* the next
  // same-origin page on hover/pointerdown. Prefetch only warms the cache, so the
  // page still has to render on click — that render gap is the white flash. A
  // prerender renders the whole page in a hidden tab ahead of the click, so
  // activation is instant: no render gap, and the view transition fires on the
  // already-painted page. Safe now that pages are light. Eagerness `moderate` =
  // ~200ms hover / pointerdown, capped at two. Mark a link `{.no-prefetch}` to
  // opt it out; `rel=nofollow` links are never speculated. Browsers without
  // support (or with preloading disabled) ignore the tag and navigate normally.
  const speculation = wantTransitions
    ? `\n  <script type="speculationrules">{"prerender":[{"where":{"and":[{"href_matches":"/*"},{"not":{"selector_matches":".no-prefetch"}},{"not":{"selector_matches":"[rel~=nofollow]"}}]},"eagerness":"moderate"}]}</script>`
    : "";

  // A route whose OWN colocated skin opted into scoping stamps the whole page
  // body so its scoped selectors match. Pure compile-time string post-pass (like
  // enhanceImages) — no runtime, no `data-wd-*` marker, so a static page stays
  // static. Include-scoped skins are stamped earlier, in handleInclude.
  const scopedSkin = scopedSkinFor(file, context);
  const stamped =
    scopedSkin && scopedSkin.scoped ? stampScope(compiled.html, scopedSkin.scopeId) : compiled.html;
  const body = enhanceImages(stamped, context);

  return {
    meta: compiled.meta,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>${descriptionTag}
  <link rel="icon" href="${favicon}">${feedLink}
  ${cssLinks}${transitions}${speculation}
</head>
<body>
${body}
${scripts}
</body>
</html>`,
    assets: compiled.assets,
    warnings: compiled.warnings,
    pagination: compiled.pagination
  };
}

/**
 * Harden every `<img>` in the assembled page body — compile-time only, zero
 * runtime JS. Bare markdown images reflow the page as they decode (cumulative
 * layout shift — the literal "jump" on navigation) and load eagerly. This
 * stamps intrinsic `width`/`height` (read from the file on disk so the browser
 * reserves space), `decoding="async"` on all, and a load-priority split: the
 * first image is the LCP candidate (eager + `fetchpriority="high"`), the rest
 * lazy-load. Author-set attributes are never overwritten.
 * @param {string} html Assembled page body HTML.
 * @param {Paths} paths Resolved project paths.
 * @returns {string}
 */
export function enhanceImages(html, paths) {
  let index = 0;
  return html.replace(/<img\b[^>]*?\/?>/g, (tag) => {
    const i = index++;
    const has = (/** @type {string} */ attr) => new RegExp(`\\b${attr}\\s*=`, "i").test(tag);
    /** @type {string[]} */
    const add = [];
    // Dimensions only when the author hasn't sized it — adding one axis to a
    // manually-sized image would distort its aspect ratio.
    if (!has("width") && !has("height")) {
      const dim = measureImage(srcOf(tag), paths);
      if (dim) add.push(`width="${dim.width}"`, `height="${dim.height}"`);
    }
    if (!has("decoding")) add.push(`decoding="async"`);
    if (i === 0) {
      // First image is the LCP candidate: stays eager, gets a priority hint.
      if (!has("fetchpriority")) add.push(`fetchpriority="high"`);
    } else if (!has("loading")) {
      add.push(`loading="lazy"`);
    }
    if (!add.length) return tag;
    return `${tag.replace(/\s*\/?>\s*$/, "")} ${add.join(" ")}>`;
  });
}

/**
 * Stamp `data-wd-scope="<id>"` onto every opening tag of a subtree — the HTML
 * half of compile-time scoped styles, mirroring {@link enhanceImages}: a regex
 * post-pass over assembled HTML, zero runtime JS. Every element start tag that
 * doesn't already carry a scope attribute gets one, so the scoped stylesheet
 * (whose selectors end in `[data-wd-scope="<id>"]`) matches inside this subtree
 * and nowhere else. Void/self-closing tags are stamped too (the attribute is
 * valid on any element). Closing tags, comments, doctype, and the `<!`/`<?`
 * families are left alone. A tag that ALREADY has a `data-wd-scope` (e.g. a
 * nested include with its own scope) keeps its own — first stamp wins.
 * @param {string} html Subtree HTML to scope.
 * @param {string} scopeId Scope id (from {@link import("../skin.js").scopeIdFor}).
 * @returns {string}
 */
export function stampScope(html, scopeId) {
  return html.replace(
    /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g,
    (tag, name, attrs, slash) => {
      if (/\bdata-wd-scope\s*=/.test(attrs)) return tag;
      return `<${name}${attrs} data-wd-scope="${scopeId}"${slash ? " /" : ""}>`;
    }
  );
}

/**
 * Extract the `src` attribute value from an `<img>` tag, or "" if absent.
 * @param {string} tag
 * @returns {string}
 */
function srcOf(tag) {
  const m = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i);
  return m ? m[1] : "";
}

/**
 * Read an image's intrinsic dimensions from disk, or null when the src is
 * remote/relative/unreadable. Resolution mirrors the asset emit: `/__wd/media/x`
 * comes from the shelf (`site/_`), other absolute paths from `site/pages`.
 * @param {string} src
 * @param {Paths} paths
 * @returns {{ width: number, height: number } | null}
 */
function measureImage(src, paths) {
  if (!src || /^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return null;
  let filePath;
  if (src.startsWith("/__wd/media/")) {
    filePath = path.join(paths.shelfRoot, src.slice("/__wd/media/".length));
  } else if (src.startsWith("/")) {
    filePath = path.join(paths.routesRoot, src.slice(1));
  } else {
    return null; // page-relative: the source directory is lost after assembly
  }
  try {
    const { width, height } = imageSize(fs.readFileSync(filePath));
    if (typeof width === "number" && typeof height === "number") return { width, height };
  } catch {
    /* missing or unreadable — degrade to no dimensions */
  }
  return null;
}

/**
 * Compile a source file into its body HTML, frontmatter, and assets (no page shell).
 * @param {string} file Absolute path to the source file.
 * @param {Paths} context Resolved project paths.
 * @param {string[]} [stack] Include stack for cycle detection.
 * @param {Record<string, unknown>} [vars] Initial static scope variables.
 * @param {Map<string, import("./collections.js").CollectionRow[]>} [collections]
 *   Build-time collection index a bare-name `@loop` resolves against.
 * @returns {CompiledDocument}
 */
export function compileDocument(file, context, stack = [], vars = {}, collections = new Map()) {
  const comp = createCompilation();
  comp.collections = collections;
  const result = compileFile(file, context, stack, createScope(null, vars), comp, [], null);
  return {
    meta: result.meta,
    html: result.html,
    assets: comp.assets,
    warnings: comp.warnings,
    pagination: comp.pagination
  };
}

/**
 * Compile a single file: parse frontmatter, collect assets, render body.
 * @param {string} file
 * @param {Paths} context
 * @param {string[]} stack
 * @param {Scope} scope
 * @param {Compilation} comp
 * @param {string[]} sections
 * @param {string | null} loopItem
 * @returns {{ meta: Meta, html: string }}
 */
export function compileFile(file, context, stack, scope, comp, sections, loopItem) {
  const real = fs.realpathSync(file);
  if (stack.includes(real)) {
    throw new Error(
      `Include cycle detected: ${[...stack, real].map((p) => path.basename(p)).join(" -> ")}`
    );
  }

  const raw = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontmatter(raw, file);
  warnLikelyFrontmatter(raw, file, comp);
  collectColocatedAssets(file, context, comp.assets);

  if (path.extname(file) === ".md") {
    scanMarkdownHints(body, file, comp);
    const html = selectMd(meta).render(body, {});
    if (htmlHasHighlight(html)) comp.assets.hasCode = true;
    return { meta, html };
  }

  // Expose this file's frontmatter to the body under `meta` so `{ meta.title }`,
  // `{ meta.tags }`, and `@loop meta.tags into tag` resolve as static values.
  /** @type {Ctx} */
  const ctx = {
    file,
    context,
    stack: [...stack, real],
    scope: createScope(scope, { meta }),
    comp,
    sections,
    loopItem,
    md: selectMd(meta)
  };
  const html = compileBody(body.replace(/\r\n?/g, "\n").split("\n"), ctx);
  if (htmlHasHighlight(html)) comp.assets.hasCode = true;
  return { meta, html };
}
