// ---------------------------------------------------------------------------
// BUILD-TIME FONT SUBSETTING (2.10.0).
//
// Raw font files are the most expensive asset a text-heavy site ships (the
// ToothDocs rebuild measured 1.07 MB of variable TTFs where 158 KB of subset
// woff2 served the same two families). This post-pass closes that: after the
// builder has emitted every page and stylesheet, it scans `dist/**/*.css` for
// `@font-face` rules whose `src url(...)` points at a PROJECT-LOCAL font
// (.ttf/.otf/.woff under `site/_` or `site/pages`), subsets each one to exactly
// the character set the site's emitted HTML uses (plus a documented base set),
// encodes the subset as woff2 beside the original in dist as
// `<name>-subset.woff2`, and rewrites the emitted CSS so `src:` lists the
// subset woff2 FIRST with `format("woff2")` and the original as fallback. The
// source `.skin` is never touched — the rewrite lives in dist only.
//
// Subsetting needs harfbuzzjs (the hb-subset wasm) and wawoff2, both OPTIONAL
// dependencies, so every wasm touch is quarantined behind the same seam the
// image pre-pass uses: the actual work runs in a child process
// (src/font-subset-worker.js) that loads the toolchain dynamically and reports
// `unavailable` instead of throwing when it is absent. Without the toolchain
// the build is byte-identical to 2.9.0 plus ONE hint. A font that fails to
// parse or subset is a hint naming the file; the build never fails over a font.
//
// Subsets are cached in `node_modules/.cache/darkmown-fonts/` keyed by font
// content hash + charset hash, so a second build with unchanged fonts and
// content does zero wasm work (and needs no toolchain at all when cached).
//
// The build is synchronous, the wasm API is not — that is the whole reason for
// the child process. `buildSite` stays a sync API; one `spawnSync` per build
// runs all pending subsets, and a fully cached build spawns nothing.
//
// FONT PRELOADS (2.12.0). The same pass ends by injecting
// `<link rel="preload" as="font" crossorigin>` into every emitted page for the
// fonts that page actually loads (found through its own linked stylesheets), so
// the font fetch starts with the CSS instead of after it — the visible
// swap-and-reflow on every load. A page preloads exactly the URL its rewritten
// CSS leads with: the subset woff2 when subsetting ran, the original project
// font when the toolchain is absent, the font was skipped, or the source was
// already woff2. Remote srcs are never preloaded, a page whose stylesheets
// declare no project fonts is left byte-identical, and re-running the pass over
// the same dist (the incremental build's re-emitted HTML) never duplicates a
// link.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fsReader } from "./compiler/fs-reader.js";
import { isAllowedInclude } from "./compiler/includes.js";

/**
 * @typedef {import("./config.js").Paths} Paths
 */

/**
 * One subset handed to the worker: reduce `source` to the shared charset and
 * write the woff2 result to `out`, the cache path.
 * @typedef {object} SubsetJob
 * @property {string} source Absolute path of the original font file.
 * @property {string} out Absolute cache path the subset woff2 is written to.
 */

/**
 * What the worker reports back. `unavailable` means the toolchain could not be
 * loaded at all (harfbuzzjs/wawoff2 not installed) — every pending font then
 * ships unsubsetted. `failed` carries one entry per font the toolchain itself
 * rejected (corrupt payload, unsupported format).
 * @typedef {object} SubsetResult
 * @property {boolean} unavailable
 * @property {{ file: string, error: string }[]} failed
 */

/**
 * The post-pass result, feeding the build summary. `unavailable` marks the
 * toolchain-absent build (which is otherwise identical to not having the
 * feature).
 * @typedef {object} FontSubsetPlan
 * @property {number} subsetted Fonts freshly subsetted this build.
 * @property {number} cached Fonts served from the on-disk cache.
 * @property {boolean} unavailable harfbuzzjs/wawoff2 could not be loaded.
 */

/**
 * A project-local font referenced by an emitted `@font-face` rule.
 * @typedef {object} FontRef
 * @property {string} url The url() target exactly as written in the CSS.
 * @property {string} source Absolute path of the font file it resolves to.
 * @property {string} subsetUrl Served URL of the subset (`<stem>-subset.woff2`).
 * @property {string} subsetDist Absolute dist path the subset is written to.
 * @property {string} [cacheFile] Absolute cache path, set once the hashes are known.
 */

/**
 * A project-local font an emitted stylesheet can preload. For a subsettable
 * font this is the FontRef itself; an already-woff2 original carries a null
 * `subsetUrl` (there is nothing to subset — it preloads as-is).
 * @typedef {object} PreloadRef
 * @property {string} url The url() target exactly as written in the CSS.
 * @property {string} source Absolute path of the font file it resolves to.
 * @property {string | null} subsetUrl Served URL of the subset, when subsettable.
 */

/**
 * One preload link to inject into a page.
 * @typedef {object} PreloadFont
 * @property {string} href The URL the page's CSS leads with (subset or original).
 * @property {string} type The MIME type for the href's extension.
 */

/** The formats hb-subset reads directly; woff2 inputs and remote URLs pass through. */
const SUBSETTABLE_EXTENSIONS = new Set([".ttf", ".otf", ".woff"]);

/** Already-encoded woff2: never subsetted, but preloaded as-is. */
const WOFF2_ONLY = new Set([".woff2"]);

/** The preload `type` for each preloadeable font extension. */
const FONT_MIME = /** @type {Record<string, string>} */ ({
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
});

/** The cache root, relative to the project. Under node_modules, so already ignored. */
const CACHE_DIR = "node_modules/.cache/darkmown-fonts";

/** The shelf's public mount point; everything else resolves against site/pages. */
const SHELF_URL_PREFIX = "/__wd/media/";

const WORKER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "font-subset-worker.js"
);

/** An `@font-face { … }` block in emitted CSS (the skin compiler never nests one). */
const FONT_FACE_BLOCK = /@font-face\s*\{[^}]*\}/g;

/** A url() target, double-quoted, single-quoted, or bare. */
const URL_REF = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/g;

/** A whole `<link …>` tag in emitted HTML. */
const LINK_TAG = /<link\b[^>]*>/g;

/** A numeric character reference: `&#65;` or `&#x2605;`. */
const NUMERIC_ENTITY = /&#(x[0-9a-fA-F]+|X[0-9a-fA-F]+|\d+);/g;

// The base charset every subset carries, regardless of page content: the
// characters a page can always legitimately render (framework chrome, markdown
// typography, template copy like the store's "✓") even when this build's scan
// did not see them — for example text a colocated .js injects at runtime.
//   0020–007E  printable ASCII
//   00A0–00FF  Latin-1 Supplement (printable half: ·, é, ü, …)
//   2010–2027  hyphens, en/em dashes, curly quotes, ellipsis, bullets, leaders
//   2030–2033  per-mille, prime, double prime
//   2039–203A  single guillemets
//   2190–2199  arrows (← ↑ → ↓ and diagonals)
//   singles    ★ ☆ ✓ ✕ ✗
const BASE_RANGES = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2010, 0x2027],
  [0x2030, 0x2033],
  [0x2039, 0x203a],
  [0x2190, 0x2199]
];
const BASE_SINGLES = [0x2605, 0x2606, 0x2713, 0x2715, 0x2717];

/** @returns {number[]} The sorted base charset (runs at module load). */
function buildBaseCodepoints() {
  /** @type {number[]} */
  const cps = [];
  for (const [lo, hi] of BASE_RANGES) for (let cp = lo; cp <= hi; cp++) cps.push(cp);
  cps.push(...BASE_SINGLES);
  return cps.sort((a, b) => a - b);
}

/** The base charset, sorted ascending. */
export const BASE_CODEPOINTS = buildBaseCodepoints();

/**
 * Subset every project-local font referenced by the emitted stylesheets and
 * rewrite the dist CSS to lead with the subset woff2. Then inject one font
 * `<link rel="preload" as="font" crossorigin>` per project font into every
 * emitted page that loads it through its own linked stylesheets.
 *
 * Skips, none of them errors: remote/protocol-relative/data/relative URLs
 * (silently), already-woff2 sources (silently — not subsetted, but preloaded
 * as-is), URLs that escape or miss the project (silently — a broken link is an
 * authoring bug, not a subsetting one). An unreadable font file, and one the
 * toolchain fails on, get a hint naming the file and ship as-is. With no
 * project-font reference in any emitted stylesheet the pass is a no-op and
 * never even scans the HTML.
 * @param {Paths} paths
 * @param {{ cacheDir?: string, quiet?: boolean,
 *   runJobs?: (payload: { charset: number[], jobs: SubsetJob[] }) => SubsetResult }} [options]
 *   `quiet` suppresses the hints (dev-server rebuilds). `runJobs` is the subset
 *   seam — the default spawns the worker process; tests inject fakes for the
 *   unavailable/failure paths.
 * @returns {FontSubsetPlan}
 */
export function subsetFonts(paths, options = {}) {
  const cacheDir = options.cacheDir ?? path.join(paths.cwd, CACHE_DIR);
  const runJobs = options.runJobs ?? runSubsetJobs;
  const hint = options.quiet ? () => {} : (/** @type {string} */ m) => console.warn(`hint: ${m}`);
  const stats = { subsetted: 0, cached: 0, unavailable: false };
  if (!fs.existsSync(paths.distRoot)) return stats;

  // Pass 1: every local font any emitted stylesheet references, deduped by
  // source file (several @font-face blocks, and several stylesheets, can share
  // one font file — it is subsetted once and each reference is rewritten).
  // `cssRefs` keeps the per-stylesheet list for the preload injection (pass 4):
  // subsettable refs plus already-woff2 originals.
  /** @type {Map<string, FontRef>} */
  const fonts = new Map();
  /** @type {string[]} Every url() occurrence that resolved, for the rewrite map. */
  const occurrences = [];
  /** @type {string[]} */
  const cssFiles = [];
  /** @type {Map<string, PreloadRef[]>} Stylesheet → its project fonts, in order. */
  const cssRefs = new Map();
  for (const file of walk(paths.distRoot)) {
    if (!file.endsWith(".css")) continue;
    cssFiles.push(file);
    const css = fs.readFileSync(file, "utf8");
    /** @type {PreloadRef[]} */
    const refs = [];
    for (const url of fontUrlsInCss(css)) {
      const resolved = resolveFontUrl(paths, url);
      if (resolved) {
        occurrences.push(url);
        if (!fonts.has(resolved.source)) fonts.set(resolved.source, resolved);
        refs.push(resolved);
        continue;
      }
      const woff2 = resolveWoff2FontUrl(paths, url);
      if (woff2) refs.push(woff2);
    }
    if (refs.length > 0) cssRefs.set(file, refs);
  }
  if (fonts.size === 0 && cssRefs.size === 0) return stats;

  /** Sources whose subset landed in dist this build (cache or fresh). */
  const emitted = new Set();

  if (fonts.size > 0) {
    // Pass 2: the charset — the base set plus every code point in the emitted
    // pages. The scan reads the final HTML, so non-latin content flows into the
    // union automatically; over-inclusion from markup is impossible to notice
    // (tags are ASCII, which the base set already carries).
    /** @type {string[]} */
    const texts = [];
    for (const file of walk(paths.distRoot)) {
      if (file.endsWith(".html")) texts.push(fs.readFileSync(file, "utf8"));
    }
    const codepoints = charsetFromTexts(texts);
    const charsetHash = hash(codepoints.join(","));

    /** @type {SubsetJob[]} */
    const pending = [];
    /** @type {FontRef[]} */
    const waiting = [];
    /** @type {string[]} Project-relative paths of fonts with uncached work, for the absent-toolchain hint. */
    const needingTools = [];

    /**
     * Materialize one subset: copy it from the cache to its served path.
     * @param {FontRef} ref
     */
    const emitSubset = (ref) => {
      fs.mkdirSync(path.dirname(ref.subsetDist), { recursive: true });
      fs.copyFileSync(/** @type {string} */ (ref.cacheFile), ref.subsetDist);
      emitted.add(ref.source);
    };

    for (const ref of fonts.values()) {
      /** @type {Uint8Array} */
      let bytes;
      try {
        bytes = fs.readFileSync(ref.source);
      } catch {
        hint(
          `no woff2 subset for ${relPosix(paths, ref.source)} — the file could not be read. ` +
            "The original font ships as-is."
        );
        continue;
      }
      ref.cacheFile = path.join(cacheDir, `${hash(bytes)}-${charsetHash}.woff2`);
      if (fs.existsSync(ref.cacheFile)) {
        emitSubset(ref);
        stats.cached++;
      } else {
        pending.push({ source: ref.source, out: ref.cacheFile });
        waiting.push(ref);
        needingTools.push(relPosix(paths, ref.source));
      }
    }

    if (pending.length > 0) {
      const result = runJobs({ charset: codepoints, jobs: pending });
      if (result.unavailable) {
        stats.unavailable = true;
        hint(
          `${needingTools.length} font${needingTools.length === 1 ? "" : "s"} could be subsetted ` +
            `to woff2 (${needingTools.join(", ")}). Run \`npm i -D harfbuzzjs wawoff2\` ` +
            "to subset fonts at build time."
        );
      } else {
        const failed = new Map(result.failed.map((f) => [f.file, f.error]));
        for (const ref of waiting) {
          const error = failed.get(ref.source);
          if (error !== undefined) {
            hint(
              `no woff2 subset for ${relPosix(paths, ref.source)} — the font could not be ` +
                `subsetted (${error}). The original font ships as-is.`
            );
            continue;
          }
          emitSubset(ref);
          stats.subsetted++;
        }
      }
    }

    // Pass 3: rewrite the emitted CSS. Only stylesheets that reference a
    // successfully subsetted font change; everything else is untouched, and the
    // source .skin files are never written.
    if (emitted.size > 0) {
      /** @type {Map<string, string>} url as written in the CSS → subset URL */
      const subsetByUrl = new Map();
      for (const url of occurrences) {
        const resolved = resolveFontUrl(paths, url);
        if (resolved && emitted.has(resolved.source)) subsetByUrl.set(url, resolved.subsetUrl);
      }
      for (const file of cssFiles) {
        const css = fs.readFileSync(file, "utf8");
        const rewritten = rewriteFontFaceCss(css, subsetByUrl);
        if (rewritten !== css) fs.writeFileSync(file, rewritten);
      }
    }
  }

  // Pass 4: preload links. Every emitted page gets one
  // `<link rel="preload" as="font" crossorigin>` per project font its OWN
  // linked stylesheets declare, right after the last stylesheet link — the URL
  // the page's CSS leads with (the subset woff2 when it exists, the original
  // otherwise). Pages loading no project fonts stay byte-identical.
  injectFontPreloads(paths, cssRefs, emitted);

  return stats;
}

/**
 * The default subset seam: run every pending job in ONE child process (the
 * build is synchronous; the wasm API is not), communicating through temp JSON
 * files rather than stdio so a large payload never hits a pipe buffer. The
 * worker always writes a results file — a missing or unparsable one means the
 * child itself died (crashed, or killed by the spawn timeout), which is
 * reported as `unavailable` (the build then behaves as if the toolchain were
 * absent: a hint, no subsets, no failure).
 * @param {{ charset: number[], jobs: SubsetJob[] }} payload
 * @param {(cmd: string, args: string[], opts: object) => unknown} [spawn]
 *   Injectable for tests; the real one is `spawnSync`.
 * @param {number} [timeoutMs] The worker is killed after this long (default
 *   two minutes), so a hung toolchain call cannot stall a build forever. The
 *   kill lands in the same `unavailable` path as any other dead child.
 * @returns {SubsetResult}
 */
export function runSubsetJobs(payload, spawn = /** @type {any} */ (spawnSync), timeoutMs = 120000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wd-font-subset-"));
  try {
    const jobsFile = path.join(dir, "jobs.json");
    const resultsFile = path.join(dir, "results.json");
    fs.writeFileSync(jobsFile, JSON.stringify(payload));
    spawn(process.execPath, [WORKER_PATH, jobsFile, resultsFile], {
      stdio: ["ignore", "ignore", "inherit"],
      timeout: timeoutMs
    });
    if (!fs.existsSync(resultsFile)) return { unavailable: true, failed: [] };
    try {
      return JSON.parse(fs.readFileSync(resultsFile, "utf8"));
    } catch {
      return { unavailable: true, failed: [] };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The subset charset for a build: the base set plus every code point appearing
 * in the given texts (the emitted pages' HTML). Numeric character references
 * (`&#9733;`, `&#x2605;`) are decoded first so a character the compiler emitted
 * as an entity still lands in the union. Tags and attribute syntax contribute
 * only ASCII, which the base set already carries, so the whole-file scan can
 * only ever over-include by a handful of glyphs.
 * @param {string[]} texts
 * @returns {number[]} Sorted ascending, deduped.
 */
export function charsetFromTexts(texts) {
  /** @type {Set<number>} */
  const set = new Set(BASE_CODEPOINTS);
  for (const text of texts) {
    const decoded = text.replace(NUMERIC_ENTITY, (_match, body) => {
      const cp = /^[xX]/.test(body)
        ? Number.parseInt(body.slice(1), 16)
        : Number.parseInt(body, 10);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    });
    for (const ch of decoded) set.add(/** @type {number} */ (ch.codePointAt(0)));
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Rewrite the `@font-face` blocks of an emitted stylesheet so each subsetted
 * font's `src` leads with the subset woff2, the original kept as fallback:
 *   src: url("/f/a-subset.woff2") format("woff2"), url("/f/a.ttf") format("truetype");
 * Only the `src` declaration changes — font-display and every other descriptor
 * pass through byte-identically. Idempotent: a block already carrying the
 * subset reference (a previous build's rewrite of a since-unedited skin) is
 * left alone.
 * @param {string} css Emitted stylesheet contents.
 * @param {Map<string, string>} subsetByUrl url() target as written → subset URL.
 * @returns {string}
 */
export function rewriteFontFaceCss(css, subsetByUrl) {
  if (subsetByUrl.size === 0) return css;
  return css.replace(FONT_FACE_BLOCK, (block) => {
    const srcDecl = /\bsrc\s*:\s*/.exec(block);
    if (!srcDecl) return block;
    /** @type {string[]} */
    const prefixes = [];
    for (const match of block.matchAll(URL_REF)) {
      const url = match[1] ?? match[2] ?? match[3];
      const subset = subsetByUrl.get(url);
      if (subset && !block.includes(subset) && !prefixes.some((p) => p.includes(subset))) {
        prefixes.push(`url("${subset}") format("woff2"), `);
      }
    }
    if (prefixes.length === 0) return block;
    const at = srcDecl.index + srcDecl[0].length;
    return `${block.slice(0, at)}${prefixes.join("")}${block.slice(at)}`;
  });
}

/**
 * Every url() target inside the `@font-face` blocks of a stylesheet, in order.
 * @param {string} css
 * @returns {string[]}
 */
function fontUrlsInCss(css) {
  /** @type {string[]} */
  const urls = [];
  for (const block of css.matchAll(FONT_FACE_BLOCK)) {
    for (const match of block[0].matchAll(URL_REF)) {
      urls.push(match[1] ?? match[2] ?? match[3]);
    }
  }
  return urls;
}

/**
 * Pass 4: inject font preload links into every emitted page. Each page
 * preloads exactly the fonts its own linked stylesheets declare — the subset
 * woff2 when subsetting emitted one, the original project font URL otherwise
 * (toolchain absent, font skipped, or source already woff2) — and nothing
 * else: a page whose stylesheets carry no project font stays byte-identical.
 * @param {Paths} paths
 * @param {Map<string, PreloadRef[]>} cssRefs Stylesheet → its project fonts.
 * @param {Set<string>} emitted Sources whose subset landed in dist this build.
 * @returns {void}
 */
function injectFontPreloads(paths, cssRefs, emitted) {
  // The preload list per stylesheet: the URL its rewritten CSS leads with,
  // deduped (a font referenced twice, and the subset reference a previous
  // build's rewrite added beside the original, collapse to one link).
  /** @type {Map<string, PreloadFont[]>} */
  const perCss = new Map();
  for (const [cssFile, refs] of cssRefs) {
    /** @type {PreloadFont[]} */
    const list = [];
    /** @type {Set<string>} */
    const seen = new Set();
    for (const ref of refs) {
      const href = ref.subsetUrl && emitted.has(ref.source) ? ref.subsetUrl : ref.url;
      if (seen.has(href)) continue;
      seen.add(href);
      list.push({ href, type: fontMimeType(href) });
    }
    perCss.set(cssFile, list);
  }

  for (const file of walk(paths.distRoot)) {
    if (!file.endsWith(".html")) continue;
    const html = fs.readFileSync(file, "utf8");
    /** @type {PreloadFont[]} */
    const preloads = [];
    /** @type {Set<string>} */
    const seen = new Set();
    for (const href of stylesheetHrefs(html)) {
      const cssFile = resolveDistCss(paths.distRoot, href);
      if (!cssFile) continue;
      for (const font of perCss.get(cssFile) ?? []) {
        if (seen.has(font.href)) continue;
        seen.add(font.href);
        preloads.push(font);
      }
    }
    const rewritten = injectPreloadLinks(html, preloads);
    if (rewritten !== html) fs.writeFileSync(file, rewritten);
  }
}

/**
 * Inject one `<link rel="preload" href="…" as="font" type="…" crossorigin>`
 * per font, immediately after the LAST stylesheet link in the head (after the
 * favicon link when the page has no stylesheet link, and not at all when it
 * has neither). `crossorigin` is mandatory: font fetches are always CORS-mode,
 * even same-origin, so a preload without it downloads the font twice.
 * Idempotent — a preload already present (an earlier pass over the same dist)
 * is never duplicated.
 * @param {string} html The emitted page.
 * @param {PreloadFont[]} preloads The fonts to preload, in order.
 * @returns {string} The page, unchanged when there is nothing new to inject.
 */
export function injectPreloadLinks(html, preloads) {
  const fresh = preloads.filter((font) => !html.includes(`rel="preload" href="${font.href}"`));
  if (fresh.length === 0) return html;
  const tags = fresh.map(
    (font) => `  <link rel="preload" href="${font.href}" as="font" type="${font.type}" crossorigin>`
  );
  let anchorEnd = -1;
  for (const match of html.matchAll(LINK_TAG)) {
    if (/\brel="stylesheet"/.test(match[0])) anchorEnd = match.index + match[0].length;
  }
  if (anchorEnd === -1) {
    for (const match of html.matchAll(LINK_TAG)) {
      if (/\brel="icon"/.test(match[0])) {
        anchorEnd = match.index + match[0].length;
        break;
      }
    }
  }
  if (anchorEnd === -1) return html;
  return `${html.slice(0, anchorEnd)}\n${tags.join("\n")}${html.slice(anchorEnd)}`;
}

/**
 * The hrefs of every `<link rel="stylesheet">` in a page, in document order.
 * @param {string} html
 * @returns {string[]}
 */
function stylesheetHrefs(html) {
  /** @type {string[]} */
  const hrefs = [];
  for (const match of html.matchAll(LINK_TAG)) {
    if (!/\brel="stylesheet"/.test(match[0])) continue;
    const href = /\bhref="([^"]*)"/.exec(match[0]);
    if (href) hrefs.push(href[1]);
  }
  return hrefs;
}

/**
 * Resolve a stylesheet href from an emitted page to its dist file, or null
 * when it cannot name one (remote, protocol-relative, an un-decodable or
 * escaping path, or simply not a .css file). The file need not exist — the
 * caller's map lookup is the existence check.
 * @param {string} distRoot
 * @param {string} href
 * @returns {string | null}
 */
function resolveDistCss(distRoot, href) {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const clean = href.split(/[?#]/)[0];
  if (!clean.endsWith(".css")) return null;
  /** @type {string} */
  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  const file = path.normalize(path.join(distRoot, decoded));
  if (!file.startsWith(distRoot + path.sep)) return null;
  return file;
}

/**
 * The preload `type` for a font URL, from its extension.
 * @param {string} href
 * @returns {string}
 */
function fontMimeType(href) {
  const ext = path.posix.extname(href.split(/[?#]/)[0]).toLowerCase();
  return FONT_MIME[ext] ?? "font/woff2";
}

/**
 * Resolve a url() target from an emitted `@font-face` to the project font file
 * it names, or null when it is not a subset candidate: anything not
 * leading-slash (remote, protocol-relative, `data:`, relative), a non-subsettable
 * extension (already-woff2 included), an un-decodable or escaping path, a
 * symlink (whose target could live anywhere on disk, whatever the link's own
 * path says), or a file that does not exist.
 * @param {Paths} paths
 * @param {string} url The raw url() target.
 * @returns {FontRef | null}
 */
function resolveFontUrl(paths, url) {
  return resolveProjectFont(paths, url, SUBSETTABLE_EXTENSIONS);
}

/**
 * The preload-only variant: an already-woff2 project font is never subsetted,
 * but it is still a font the page loads locally, so it earns a preload of its
 * own URL. Same project-local rules as resolveFontUrl.
 * @param {Paths} paths
 * @param {string} url The raw url() target.
 * @returns {PreloadRef | null}
 */
function resolveWoff2FontUrl(paths, url) {
  const ref = resolveProjectFont(paths, url, WOFF2_ONLY);
  return ref ? { url: ref.url, source: ref.source, subsetUrl: null } : null;
}

/**
 * The shared project-local resolution behind resolveFontUrl and
 * resolveWoff2FontUrl. `/__wd/media/<rel>` maps to the shelf; every other
 * absolute path maps to `site/pages`. A symlink is never project-local,
 * matching the asset-copy convention (`emitPageAssets` skips them entirely,
 * and so does the image pre-pass): the lexical containment check reads the
 * path as WRITTEN, so a link sitting inside the project could point anywhere
 * on disk and the target's bytes would be read and published as a subset. An
 * ancestor directory can be a symlink with the file itself plain, so the
 * canonical (realpath) containment check `@include` uses runs too — a font
 * whose real path escapes site/pages and site/_ is simply "not project-local"
 * here.
 * @param {Paths} paths
 * @param {string} url The raw url() target.
 * @param {Set<string>} extensions The extensions accepted by the caller.
 * @returns {FontRef | null}
 */
function resolveProjectFont(paths, url, extensions) {
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  const clean = url.split(/[?#]/)[0];
  const ext = path.posix.extname(clean).toLowerCase();
  if (!extensions.has(ext)) return null;
  /** @type {string} */
  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  const fromShelf = decoded.startsWith(SHELF_URL_PREFIX);
  const base = fromShelf ? paths.shelfRoot : paths.routesRoot;
  const rel = fromShelf ? decoded.slice(SHELF_URL_PREFIX.length) : decoded.slice(1);
  const source = path.normalize(path.join(base, rel));
  if (!source.startsWith(base + path.sep)) return null;
  if (!fs.existsSync(source)) return null;
  if (fs.lstatSync(source).isSymbolicLink()) return null;
  if (!isAllowedInclude(source, paths, fsReader())) return null;
  const subsetUrl = `${clean.slice(0, clean.length - ext.length)}-subset.woff2`;
  return { url, source, subsetUrl, subsetDist: path.join(paths.distRoot, subsetUrl.slice(1)) };
}

/**
 * A short content digest for cache keys.
 * @param {Uint8Array | string} data
 * @returns {string}
 */
function hash(data) {
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 24);
}

/**
 * A project-relative, POSIX-separated path for hint messages.
 * @param {Paths} paths
 * @param {string} file Absolute path.
 * @returns {string}
 */
function relPosix(paths, file) {
  return path.relative(paths.cwd, file).replaceAll(path.sep, "/");
}

/**
 * All files under `dir`, recursively. Mirrors the builder's own walker; kept
 * local so this module does not import the builder (which imports this).
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
