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
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** The formats hb-subset reads directly; woff2 inputs and remote URLs pass through. */
const SUBSETTABLE_EXTENSIONS = new Set([".ttf", ".otf", ".woff"]);

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
 * rewrite the dist CSS to lead with the subset woff2.
 *
 * Skips, none of them errors: remote/protocol-relative/data/relative URLs
 * (silently), already-woff2 sources (silently), URLs that escape or miss the
 * project (silently — a broken link is an authoring bug, not a subsetting one).
 * An unreadable font file, and one the toolchain fails on, get a hint naming
 * the file and ship as-is. With no `@font-face` in any emitted stylesheet the
 * pass is a no-op and never even scans the HTML.
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
  /** @type {Map<string, FontRef>} */
  const fonts = new Map();
  /** @type {string[]} Every url() occurrence that resolved, for the rewrite map. */
  const occurrences = [];
  /** @type {string[]} */
  const cssFiles = [];
  for (const file of walk(paths.distRoot)) {
    if (!file.endsWith(".css")) continue;
    cssFiles.push(file);
    const css = fs.readFileSync(file, "utf8");
    for (const url of fontUrlsInCss(css)) {
      const resolved = resolveFontUrl(paths, url);
      if (!resolved) continue;
      occurrences.push(url);
      if (!fonts.has(resolved.source)) fonts.set(resolved.source, resolved);
    }
  }
  if (fonts.size === 0) return stats;

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
  /** Sources whose subset landed in dist this build (cache or fresh). */
  const emitted = new Set();

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

  return stats;
}

/**
 * The default subset seam: run every pending job in ONE child process (the
 * build is synchronous; the wasm API is not), communicating through temp JSON
 * files rather than stdio so a large payload never hits a pipe buffer. The
 * worker always writes a results file — a missing or unparsable one means the
 * child itself died, which is reported as `unavailable` (the build then behaves
 * as if the toolchain were absent: a hint, no subsets, no failure).
 * @param {{ charset: number[], jobs: SubsetJob[] }} payload
 * @param {(cmd: string, args: string[], opts: object) => unknown} [spawn]
 *   Injectable for tests; the real one is `spawnSync`.
 * @returns {SubsetResult}
 */
export function runSubsetJobs(payload, spawn = /** @type {any} */ (spawnSync)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wd-font-subset-"));
  try {
    const jobsFile = path.join(dir, "jobs.json");
    const resultsFile = path.join(dir, "results.json");
    fs.writeFileSync(jobsFile, JSON.stringify(payload));
    spawn(process.execPath, [WORKER_PATH, jobsFile, resultsFile], {
      stdio: ["ignore", "ignore", "inherit"]
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
 * Resolve a url() target from an emitted `@font-face` to the project font file
 * it names, or null when it is not a subset candidate: anything not
 * leading-slash (remote, protocol-relative, `data:`, relative), a non-subsettable
 * extension (already-woff2 included), an un-decodable or escaping path, or a
 * file that does not exist. `/__wd/media/<rel>` maps to the shelf; every other
 * absolute path maps to `site/pages`.
 * @param {Paths} paths
 * @param {string} url The raw url() target.
 * @returns {FontRef | null}
 */
function resolveFontUrl(paths, url) {
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  const clean = url.split(/[?#]/)[0];
  const ext = path.posix.extname(clean).toLowerCase();
  if (!SUBSETTABLE_EXTENSIONS.has(ext)) return null;
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
