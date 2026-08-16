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
export function compilePage(file: string, context: Paths, options?: {
    feed?: {
        href: string;
        title: string;
    };
    site?: SiteContext;
    collections?: Map<string, import("./collections.js").CollectionRow[]>;
    vars?: Record<string, unknown>;
    reader?: import("./reader.js").Reader;
}): CompiledPage;
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
export function enhanceImages(html: string, paths: Paths, reader: import("./reader.js").Reader): string;
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
export function compileDocument(file: string, context: Paths, stack?: string[], vars?: Record<string, unknown>, collections?: Map<string, import("./collections.js").CollectionRow[]>, reader?: import("./reader.js").Reader): CompiledDocument;
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
export function compileFile(file: string, context: Paths, stack: string[], scope: Scope, comp: Compilation, sections: string[], loopItem: string | null, reactiveDepth?: number, loopOpener?: {
    at: string;
    line: string;
} | null): {
    meta: Meta;
    html: string;
};
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
export function compileFromMemory(files: Record<string, string> | Map<string, string>, entryPath: string, options?: {
    feed?: {
        href: string;
        title: string;
    };
    site?: SiteContext;
    collections?: Map<string, import("./collections.js").CollectionRow[]>;
    vars?: Record<string, unknown>;
    cwd?: string;
}): CompiledPage;
/**
 * Where this page sits on a real, deployed site: the origin the home page
 * declared with `site_url`, the concrete route this page is written to, and the
 * breadcrumb trail the builder resolved from the routes that actually exist.
 * Supplied by `src/builder.js`, the only layer that knows all three.
 */
export type SiteContext = {
    /**
     * Absolute site origin, e.g. `https://example.com`.
     */
    url: string;
    /**
     * Public route path for THIS page (trailing-slashed).
     */
    route: string;
    /**
     * Resolved crumb trail.
     */
    breadcrumbs?: {
        name: string;
        url: string;
    }[] | undefined;
};
export type Paths = import("./context.js").Paths;
export type Meta = import("./context.js").Meta;
export type Scope = import("./context.js").Scope;
export type Compilation = import("./context.js").Compilation;
export type Ctx = import("./context.js").Ctx;
export type CompiledDocument = import("./context.js").CompiledDocument;
export type CompiledPage = import("./context.js").CompiledPage;
