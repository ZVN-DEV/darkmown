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
 * Compile an `@include` line — inline form (`@include /nav.wd`) or block form
 * (`@include /card.wd … @endinclude`, with `childrenLines` holding the lines
 * between opener and closer, captured by {@link scanIncludeBlock}).
 *
 * Block form is compile-time macro expansion and nothing more: the children
 * lines compile in the CALLER's context (its scope, its `:state`, its loop
 * item when the call sits in a `@loop` body) BEFORE the target compiles, and
 * the resulting HTML rides into the include's scope under
 * {@link INCLUDE_CHILDREN}, where the body parser splices it at each
 * `{ children }` slot line. No runtime marker, no reactivity of its own.
 * Children compile ONCE even when the include places the slot twice, so state
 * a child line declares is declared once in the caller.
 *
 * The include file's own frontmatter may declare `defaults: [name="value" …]`
 * fallback values for `with` arguments (see {@link parseIncludeDefaults}); a
 * caller-provided argument always wins over a default, and an argument with
 * neither keeps the literal-braces behavior.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @param {string[]} [childrenLines] Lines between `@include` and `@endinclude`
 *   for the block form; undefined for the inline form.
 * @returns {string}
 */
export function handleInclude(line: string, ctx: Ctx, index: number, childrenLines?: string[]): string;
/**
 * Scan ahead from an `@include` opener for the `@endinclude` that pairs with
 * it. Pairing is nearest-opener-first: a nested `@include` line pushes, an
 * `@endinclude` line pops the most recent unclosed opener, and the first
 * `@endinclude` found with nothing on the stack belongs to THIS opener — so
 * nested blocks pair correctly, and an inline `@include` earlier in the file
 * than a block (the common nav-include-then-card-block page) is unaffected.
 * Fenced code is skipped, exactly as in the other block scanners.
 *
 * Returns null when no closer pairs — the include is the INLINE form, which
 * stays legal (backward compatible): an opener that never pairs is an inline
 * include followed by ordinary prose, and the two are indistinguishable, so
 * there is deliberately no "unclosed block" error.
 * @param {string[]} lines The current body slice.
 * @param {number} start 0-based index of the `@include` opener line.
 * @returns {{ body: string[], end: number } | null} The children lines and the
 *   closer's 0-based index, or null for the inline form.
 */
export function scanIncludeBlock(lines: string[], start: number): {
    body: string[];
    end: number;
} | null;
/**
 * `@endinclude` reached the body dispatcher, meaning no `@include` opener
 * claimed it — the one-closer-too-many case (a typo'd closer, or a nested
 * block attempted inside a children block, where the inner opener already
 * took the closer the author meant for the outer one). Always throws.
 * @param {string} line The offending line, for the message.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line`.
 * @returns {never}
 */
export function strayEndinclude(line: string, ctx: Ctx, index: number): never;
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
