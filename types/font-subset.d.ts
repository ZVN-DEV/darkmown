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
export function subsetFonts(paths: Paths, options?: {
    cacheDir?: string;
    quiet?: boolean;
    runJobs?: (payload: {
        charset: number[];
        jobs: SubsetJob[];
    }) => SubsetResult;
}): FontSubsetPlan;
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
export function runSubsetJobs(payload: {
    charset: number[];
    jobs: SubsetJob[];
}, spawn?: (cmd: string, args: string[], opts: object) => unknown, timeoutMs?: number): SubsetResult;
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
export function charsetFromTexts(texts: string[]): number[];
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
export function rewriteFontFaceCss(css: string, subsetByUrl: Map<string, string>): string;
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
export function injectPreloadLinks(html: string, preloads: PreloadFont[]): string;
/** The base charset, sorted ascending. */
export const BASE_CODEPOINTS: number[];
export type Paths = import("./config.js").Paths;
/**
 * One subset handed to the worker: reduce `source` to the shared charset and
 * write the woff2 result to `out`, the cache path.
 */
export type SubsetJob = {
    /**
     * Absolute path of the original font file.
     */
    source: string;
    /**
     * Absolute cache path the subset woff2 is written to.
     */
    out: string;
};
/**
 * What the worker reports back. `unavailable` means the toolchain could not be
 * loaded at all (harfbuzzjs/wawoff2 not installed) — every pending font then
 * ships unsubsetted. `failed` carries one entry per font the toolchain itself
 * rejected (corrupt payload, unsupported format).
 */
export type SubsetResult = {
    unavailable: boolean;
    failed: {
        file: string;
        error: string;
    }[];
};
/**
 * The post-pass result, feeding the build summary. `unavailable` marks the
 * toolchain-absent build (which is otherwise identical to not having the
 * feature).
 */
export type FontSubsetPlan = {
    /**
     * Fonts freshly subsetted this build.
     */
    subsetted: number;
    /**
     * Fonts served from the on-disk cache.
     */
    cached: number;
    /**
     * harfbuzzjs/wawoff2 could not be loaded.
     */
    unavailable: boolean;
};
/**
 * A project-local font referenced by an emitted `@font-face` rule.
 */
export type FontRef = {
    /**
     * The url() target exactly as written in the CSS.
     */
    url: string;
    /**
     * Absolute path of the font file it resolves to.
     */
    source: string;
    /**
     * Served URL of the subset (`<stem>-subset.woff2`).
     */
    subsetUrl: string;
    /**
     * Absolute dist path the subset is written to.
     */
    subsetDist: string;
    /**
     * Absolute cache path, set once the hashes are known.
     */
    cacheFile?: string | undefined;
};
/**
 * A project-local font an emitted stylesheet can preload. For a subsettable
 * font this is the FontRef itself; an already-woff2 original carries a null
 * `subsetUrl` (there is nothing to subset — it preloads as-is).
 */
export type PreloadRef = {
    /**
     * The url() target exactly as written in the CSS.
     */
    url: string;
    /**
     * Absolute path of the font file it resolves to.
     */
    source: string;
    /**
     * Served URL of the subset, when subsettable.
     */
    subsetUrl: string | null;
};
/**
 * One preload link to inject into a page.
 */
export type PreloadFont = {
    /**
     * The URL the page's CSS leads with (subset or original).
     */
    href: string;
    /**
     * The MIME type for the href's extension.
     */
    type: string;
};
