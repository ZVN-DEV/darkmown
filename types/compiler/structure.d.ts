/**
 * Peel the leading run of whitelisted accessibility attributes off `rest`.
 *
 * Stops at the first token that does not open like an attribute (a `.class`, a
 * `#id`, a `->`, or the end of the line) and hands that remainder back. A token
 * that DOES open like an attribute but is misspelt, unquoted, or outside the
 * whitelist is a compile error — never silently skipped.
 * @param {string} rest Everything from the cursor to the end of the line.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @param {string} what Directive label for the message, e.g. `:button`.
 * @returns {{ attrs: [string, string][], rest: string }}
 */
export function takeA11yAttrs(rest: string, ctx: Ctx, index: number, what: string): {
    attrs: [string, string][];
    rest: string;
};
/**
 * Serialize validated attribute pairs into an HTML attribute string. The NAME
 * came through {@link A11Y_ATTR_NAME} so it is inert; the VALUE is author text
 * and is escaped.
 * @param {[string, string][]} attrs
 * @returns {string}
 */
export function a11yAttrHtml(attrs: [string, string][]): string;
/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleInclude(line: string, ctx: Ctx, index: number): string;
/**
 * @param {string} header
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleContainer(header: string, bodyLines: string[], ctx: Ctx, index: number): string;
/**
 * `:carousel [autoplay=N]` … `:endcarousel` — a horizontally scroll-snapping
 * carousel. Contract: each DIRECT child element of the track is one slide, so put
 * each slide in its own block (e.g. a `::: slide` container) and give that block
 * the slide sizing in your skin — loose prose lines would each count as a slide.
 * Registers the `carousel` behavior (prev/next, dot nav, optional autoplay, mouse
 * drag); native CSS scroll-snap + the page skin handle layout and touch swipe.
 * `autoplay` is suppressed under `prefers-reduced-motion`. No runtime required.
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleCarousel(line: string, bodyLines: string[], ctx: Ctx, index: number): string;
/**
 * @param {string} line
 * @param {string[]} truthyLines
 * @param {string[]} falsyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @param {number} [falsyStart] 0-based index the falsy body starts at in the
 *   current slice, so nested errors in that branch report the true file line.
 * @returns {string}
 */
export function handleIf(line: string, truthyLines: string[], falsyLines: string[], ctx: Ctx, index: number, falsyStart?: number): string;
/**
 * Render the documentation-demo directive `:try` (the "Try it" card the homepage
 * uses). `:note` and `:sprint` lived here too and were deleted: nothing in the
 * site, the docs, or the public directive set used them, and a directive the
 * catalog does not list is a trap for an AI author that discovers it in source.
 * @param {string} line
 * @param {Ctx} ctx
 * @returns {string}
 */
export function renderDemoDirective(line: string, ctx: Ctx): string;
/**
 * @typedef {import("./context.js").Ctx} Ctx
 */
export const INCLUDE_EXAMPLE: "@include /header.wd";
export const CONTAINER_EXAMPLE: "::: card .featured";
export const CONTAINER_A11Y_EXAMPLE: "::: card .note role=\"region\" aria-label=\"Notes\"";
export const IF_EXAMPLE: ":if count > 0";
export const CAROUSEL_EXAMPLE: ":carousel autoplay=3000";
/** The corrective `Use:` tail every attribute error carries. */
export const A11Y_ATTR_USE: "role=\"\u2026\", aria-\u2026=\"\u2026\", or title=\"\u2026\" (quoted static text)";
export type Ctx = import("./context.js").Ctx;
