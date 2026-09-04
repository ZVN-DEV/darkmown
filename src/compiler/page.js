// ---------------------------------------------------------------------------
// Page shell + document assembly: wrap a compiled body in the full HTML shell
// (title, social meta, favicon, skins, scripts, optional view transitions +
// speculationrules), harden every `<img>` at compile time, and drive the
// per-file compile (frontmatter + colocated assets + body / `.md` passthrough).
// ---------------------------------------------------------------------------

import path from "node:path";
import { createPaths } from "../config.js";
import { htmlHasHighlight } from "../highlight.js";
import { compileBody } from "./body.js";
import { createCompilation, createScope, wdError } from "./context.js";
import { parseFrontmatter, warnLikelyFrontmatter } from "./frontmatter.js";
import { imageSize } from "./image-size.js";
import {
  collectColocatedAssets,
  scanMarkdownHints,
  scopedSkinFor,
  stampScope
} from "./includes.js";
import { escapeHtml } from "./interpolation.js";
import { selectMd } from "./markdown.js";
import { memoryReader } from "./reader.js";
import { buildJsonLd, isArticleSchema } from "./schema.js";

/**
 * @typedef {import("./context.js").Paths} Paths
 * @typedef {import("./context.js").Meta} Meta
 * @typedef {import("./context.js").Scope} Scope
 * @typedef {import("./context.js").Compilation} Compilation
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").CompiledDocument} CompiledDocument
 * @typedef {import("./context.js").CompiledPage} CompiledPage
 */

// Skip-to-content link: the first focusable element on every page, visually
// hidden until keyboard focus reveals it. Styled inline (not via a skin) so it
// behaves on pages with no stylesheet at all; it rides ahead of page skins in
// the head, so a project skin can restyle `.wd-skip-link` freely.
const SKIP_LINK_STYLE =
  "<style>.wd-skip-link{position:absolute;top:0;left:0;z-index:100;padding:.55rem 1.1rem;background:#18221d;color:#f7f3ea;font:600 .9rem/1.2 system-ui,sans-serif;text-decoration:none;border-radius:0 0 8px 0;transform:translateY(-150%)}.wd-skip-link:focus{transform:none}</style>";

/**
 * Compile a page source file into a full HTML document plus its assets.
 * @param {string} file Absolute path to the source `.md`/`.wd` file.
 * @param {Paths} context Resolved project paths.
 * @param {{ feed?: { href: string, title: string }, site?: SiteContext, collections?: Map<string, import("./collections.js").CollectionRow[]>, vars?: Record<string, unknown>, reader?: import("./reader.js").Reader }} [options]
 *   When a site-wide RSS feed is emitted (the home page set `site_url` and the
 *   site has dated posts), `feed` carries its absolute href + title so every page
 *   links it. `site` carries the origin + this page's own route (and its resolved
 *   breadcrumb trail) so the shell can state a canonical URL. `collections` is the
 *   build-time collection index a bare-name `@loop` resolves against; `vars` seeds
 *   the document scope (the pager `page` object on a paginated route). `reader` is
 *   the source reader (fs-backed by default via `src/compiler.js`; in-memory for
 *   `compileFromMemory`).
 * @returns {CompiledPage}
 */
export function compilePage(file, context, options = {}) {
  // The raw entry point requires a reader — the Node barrel (`src/compiler.js`)
  // injects `fsReader()`, and `compileFromMemory` injects a `memoryReader`.
  const reader = /** @type {import("./reader.js").Reader} */ (options.reader);
  const compiled = compileDocument(file, context, [], options.vars, options.collections, reader);
  const title = String(compiled.meta.title || "Darkmown");
  const description = String(compiled.meta.description || "");
  // Per-page document language for the `<html lang>` attribute (`lang: fr` in
  // frontmatter). Defaults to English.
  const lang =
    typeof compiled.meta.lang === "string" && compiled.meta.lang.trim()
      ? compiled.meta.lang.trim()
      : "en";
  // Optional `image:` frontmatter sets the social-share preview (absolute URL).
  const image = typeof compiled.meta.image === "string" ? compiled.meta.image : "";
  // The page's own absolute URL, resolved by the builder (which knows both the
  // site origin from the home page's `site_url` and the concrete route this page
  // is written to, including a paginated `/page/2/`). Without it there is no
  // honest canonical to state, so the tags are simply omitted.
  const canonical = canonicalUrl(options.site);
  // `og:type` follows the framework's own "this is a post" signals: a
  // frontmatter `date:` (what RSS already keys off) or an article-family
  // `schema:` type. Everything else is a website page.
  const dated = typeof compiled.meta.date === "string" && compiled.meta.date.trim() !== "";
  const ogType = dated || isArticleSchema(compiled.meta) ? "article" : "website";
  /** @type {string[]} */
  const social = [];
  if (description) social.push(`<meta name="description" content="${escapeHtml(description)}">`);
  // The canonical link is the one place the site declares which URL form wins.
  // It must agree with the sitemap and with every internal link, so it is built
  // from the same route string those are built from.
  if (canonical) social.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);
  if (description || image || canonical) {
    social.push(`<meta property="og:title" content="${escapeHtml(title)}">`);
    if (description)
      social.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
    social.push(`<meta property="og:type" content="${ogType}">`);
    if (canonical) social.push(`<meta property="og:url" content="${escapeHtml(canonical)}">`);
  }
  if (image) {
    social.push(`<meta property="og:image" content="${escapeHtml(image)}">`);
    social.push(`<meta name="twitter:image" content="${escapeHtml(image)}">`);
  }
  // No `twitter:title`/`twitter:description`: X's card parser falls back to the
  // Open Graph tags above when the twitter-namespaced ones are absent, so they
  // would be duplicate bytes on every page. `twitter:card` has no Open Graph
  // equivalent, so it is stated explicitly.
  if (description || image || canonical) {
    social.push(
      `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`
    );
  }
  // Structured data (JSON-LD): opt-in per page via `schema:`, plus the
  // breadcrumb trail the builder resolved for a nested route. Inert data, not
  // executable script, it adds zero runtime bytes and a static page stays static.
  const jsonLd = buildJsonLd({
    meta: compiled.meta,
    file,
    title,
    description,
    image,
    lang,
    canonical,
    breadcrumbs: (options.site && options.site.breadcrumbs) || []
  });
  if (jsonLd) social.push(jsonLd);
  const descriptionTag = social.length ? `\n  ${social.join("\n  ")}` : "";
  const favicon =
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E%3Crect%20width='32'%20height='32'%20rx='6'%20fill='%2318221d'/%3E%3Ctext%20x='16'%20y='23'%20text-anchor='middle'%20font-family='Georgia,serif'%20font-size='19'%20font-weight='bold'%20fill='%23f7f3ea'%3ED%3C/text%3E%3C/svg%3E";
  // The framework highlight stylesheet rides ahead of page skins so a project's
  // own `$code-*` tokens / overrides still cascade over it. Pay-for-what-you-use:
  // linked only on pages with a highlighted code block (`hasCode`).
  const highlightHref = compiled.assets.hasCode ? ["/__wd/highlight.css"] : [];
  const cssLinks = [...highlightHref, ...compiled.assets.skins]
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
  const scopedSkin = scopedSkinFor(file, context, reader);
  const stamped =
    scopedSkin && scopedSkin.scoped ? stampScope(compiled.html, scopedSkin.scopeId) : compiled.html;
  const body = enhanceImages(stamped, context, reader);
  const { content, target } = ensureMainLandmark(body);

  return {
    meta: compiled.meta,
    deps: compiled.deps,
    collectionsUsed: compiled.collectionsUsed,
    symbols: compiled.symbols,
    html: `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>${descriptionTag}
  <link rel="icon" href="${favicon}">${feedLink}
  ${SKIP_LINK_STYLE}
  ${cssLinks}${transitions}${speculation}
</head>
<body>
<a class="wd-skip-link" href="#${escapeHtml(target)}">Skip to content</a>
${content}
${scripts}
</body>
</html>`,
    assets: compiled.assets,
    warnings: compiled.warnings,
    pagination: compiled.pagination
  };
}

/**
 * Where this page sits on a real, deployed site: the origin the home page
 * declared with `site_url`, the concrete route this page is written to, and the
 * breadcrumb trail the builder resolved from the routes that actually exist.
 * Supplied by `src/builder.js`, the only layer that knows all three.
 * @typedef {object} SiteContext
 * @property {string} url Absolute site origin, e.g. `https://example.com`.
 * @property {string} route Public route path for THIS page (trailing-slashed).
 * @property {{ name: string, url: string }[]} [breadcrumbs] Resolved crumb trail.
 */

/**
 * The page's absolute canonical URL, or "" when the site has no declared origin
 * (no `site_url` in the home page's frontmatter). One derivation, shared by the
 * `<link rel="canonical">` and `og:url` tags, and identical to the join the
 * sitemap uses: so the two can never disagree about the canonical URL form.
 * @param {SiteContext} [site]
 * @returns {string}
 */
function canonicalUrl(site) {
  if (!site || !site.url || !site.route) return "";
  return `${site.url.replace(/\/$/, "")}${site.route}`;
}

/**
 * Guarantee the page body exposes a main-content landmark the skip link can
 * target. A body that already has a `<main>` keeps it: an author-supplied id
 * wins as the skip target; a `<main>` without one gets `id="main"` stamped on.
 * A body with no `<main>` at all is wrapped whole. Pure compile-time string
 * pass (like {@link enhanceImages}) — a static page stays static.
 * @param {string} html Assembled page body HTML.
 * @returns {{ content: string, target: string }}
 */
function ensureMainLandmark(html) {
  const open = html.match(/<main\b[^>]*>/i);
  if (!open) return { content: `<main id="main">\n${html}\n</main>`, target: "main" };
  // The id attribute must start after whitespace (or a closing quote — sloppy
  // but browser-parsed) so `data-id="…"` never masquerades as the real id.
  const id = open[0].match(/[\s"']id\s*=\s*["']([^"']*)["']/i);
  if (id) return { content: html, target: id[1] || "main" };
  return { content: html.replace(open[0], `${open[0].slice(0, -1)} id="main">`), target: "main" };
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
 * @param {import("./reader.js").Reader} reader Source reader for the image bytes.
 * @returns {string}
 */
export function enhanceImages(html, paths, reader) {
  let index = 0;
  return html.replace(/<img\b[^>]*?\/?>/g, (tag) => {
    const i = index++;
    const has = (/** @type {string} */ attr) => new RegExp(`\\b${attr}\\s*=`, "i").test(tag);
    /** @type {string[]} */
    const add = [];
    // Dimensions only when the author hasn't sized it — adding one axis to a
    // manually-sized image would distort its aspect ratio. A REACTIVE src
    // (`![alt]({ photo })`, marked `data-wd-attr`/`data-wd-each-attr`) is sized
    // from whatever the seed happened to be, so baking width/height would
    // stretch every later image to the first one's aspect ratio.
    if (!has("width") && !has("height") && !/\bdata-wd-(?:each-)?attr\s*=/.test(tag)) {
      const dim = measureImage(srcOf(tag), paths, reader);
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
 * @param {import("./reader.js").Reader} reader
 * @returns {{ width: number, height: number } | null}
 */
function measureImage(src, paths, reader) {
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
    // `imageSize` itself never throws (an unsupported or malformed image is just
    // null); the try/catch is for the read, which does throw on a missing file.
    return imageSize(reader.readBinary(filePath));
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
 * @param {import("./reader.js").Reader} [reader] Source reader (fs-backed when
 *   omitted via `src/compiler.js`; in-memory for `compileFromMemory`).
 * @returns {CompiledDocument}
 */
export function compileDocument(
  file,
  context,
  stack = [],
  vars = {},
  collections = new Map(),
  reader
) {
  // reader is injected by every caller (the Node barrel's `fsReader()` or
  // `compileFromMemory`'s `memoryReader`); it is only trailing-optional here so
  // the defaulted `vars`/`collections` params can precede it.
  const comp = createCompilation(/** @type {import("./reader.js").Reader} */ (reader));
  comp.collections = collections;
  const result = compileFile(
    file,
    context,
    stack,
    createScope(null, vars),
    comp,
    [],
    null,
    0,
    null
  );
  return {
    meta: result.meta,
    html: result.html,
    assets: comp.assets,
    warnings: comp.warnings,
    pagination: comp.pagination,
    deps: comp.deps,
    collectionsUsed: comp.collectionsUsed,
    symbols: comp.symbols
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
 * @param {number} [reactiveDepth] Enclosing REACTIVE `@loop` levels, threaded in
 *   from the including page so an include's body can't bypass the two-level
 *   reactive-nesting limit at the `@include` boundary.
 * @param {{ at: string, line: string } | null} [loopOpener] The enclosing `@loop`
 *   opener, threaded in so a depth error inside the include names the right opener.
 * @returns {{ meta: Meta, html: string }}
 */
export function compileFile(
  file,
  context,
  stack,
  scope,
  comp,
  sections,
  loopItem,
  reactiveDepth = 0,
  loopOpener = null
) {
  const real = comp.reader.realpath(file);
  if (stack.includes(real)) {
    throw wdError(
      // No literal `[WD612]` here: wdError prefixes the code itself, and the
      // hardcoded copy printed it twice (`[WD612] [WD612] Include cycle …`).
      `Include cycle detected: ${[...stack, real].map((p) => path.basename(p)).join(" -> ")}`,
      { code: "WD612", file }
    );
  }

  const raw = comp.reader.readText(file);
  const { meta, body, bodyLine } = parseFrontmatter(raw, file);
  warnLikelyFrontmatter(raw, file, comp);
  comp.deps.add(file);
  collectColocatedAssets(file, context, comp.assets, comp.reader);

  if (path.extname(file) === ".md") {
    scanMarkdownHints(body, file, comp);
    // Share the compilation's heading-slug counters (as renderProse does), so a
    // `.md` included from a `.wd` page still dedupes anchors document-wide.
    const html = selectMd(meta).render(body, { headingSlugs: comp.headingSlugs });
    if (htmlHasHighlight(html)) comp.assets.hasCode = true;
    return { meta, html };
  }

  // Expose this file's frontmatter to the body under `meta` so `{ meta.title }`,
  // `{ meta.tags }`, and `@loop meta.tags into tag` resolve as static values.
  /** @type {Ctx} */
  const ctx = {
    file,
    bodyLine,
    context,
    stack: [...stack, real],
    scope: createScope(scope, { meta }),
    comp,
    sections,
    loopItem,
    reactiveDepth,
    ...(loopOpener ? { loopOpener } : {}),
    md: selectMd(meta),
    compileBody,
    compileFile
  };
  const html = compileBody(body.replace(/\r\n?/g, "\n").split("\n"), ctx);
  if (htmlHasHighlight(html)) comp.assets.hasCode = true;
  return { meta, html };
}

/**
 * Compile a page entirely from an in-memory file map — no filesystem, no
 * `node:fs`. `files` maps PROJECT-RELATIVE POSIX paths (`site/pages/index.wd`,
 * `site/_/nav.wd`) to their source strings; `entryPath` is the project-relative
 * path of the page to compile. Includes, colocated `.skin`/`.js` detection, and
 * `@loop` JSON-data reads all resolve against the same map (anything not in it
 * is simply "absent"), so `@include`s work as long as their targets are present.
 *
 * This is the strategic fs-free entry point the browser playground and a planned
 * mobile host use: the entire module graph reachable from here is free of
 * `node:fs`, so it bundles for the browser. It returns the same
 * {@link CompiledPage} shape as {@link compilePage} and throws the same
 * `file:line` compile errors, so the error DX is identical in-browser.
 * @param {Record<string, string> | Map<string, string>} files Project-relative
 *   path → source content.
 * @param {string} entryPath Project-relative path of the page to compile.
 * @param {{ feed?: { href: string, title: string }, site?: SiteContext, collections?: Map<string, import("./collections.js").CollectionRow[]>, vars?: Record<string, unknown>, cwd?: string }} [options]
 *   Same shell options as {@link compilePage}; `cwd` overrides the virtual
 *   project root the relative keys resolve against (defaults to `/`).
 * @returns {CompiledPage}
 */
export function compileFromMemory(files, entryPath, options = {}) {
  const cwd = options.cwd ?? "/";
  const reader = memoryReader(files, cwd);
  const context = createPaths(cwd);
  const abs = path.resolve(cwd, entryPath);
  return compilePage(abs, context, {
    feed: options.feed,
    site: options.site,
    collections: options.collections,
    vars: options.vars,
    reader
  });
}
