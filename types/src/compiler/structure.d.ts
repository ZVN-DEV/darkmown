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
 * Render the documentation-demo directives (`:try`, `:note`, `:sprint`).
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
export const IF_EXAMPLE: ":if count > 0";
export const CAROUSEL_EXAMPLE: ":carousel autoplay=3000";
export type Ctx = import("./context.js").Ctx;
