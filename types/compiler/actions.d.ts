/**
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleButton(line: string, ctx: Ctx, index: number): string;
/**
 * Parse `:effect <watched> -> <actions>` into a zero-output marker the runtime
 * watches: when `<watched>` state changes, it runs `<actions>` (the same `:button`
 * action vocabulary, `;`-chained). For arbitrary side effects beyond `:computed`
 * (derive state) and fetch deps (auto-refetch).
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleEffect(line: string, ctx: Ctx, index: number): string;
/**
 * Parse `:every <duration> -> <actions>` into a marker the runtime drives on a
 * timer: every `<duration>` it runs `<actions>` (the same `:button` vocabulary,
 * `;`-chained), and the interval auto-pauses while the tab is hidden. The one time
 * primitive — behind live polling (`:every 5s -> board refetch`), clocks and
 * countdowns (`:every 1s -> seconds++`), and slideshow autoplay (`:every 4s -> slide++`).
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleEvery(line: string, ctx: Ctx, index: number): string;
/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Action} Action
 */
export const BUTTON_EXAMPLE: ":button \"Add one\" -> count++";
export const EFFECT_EXAMPLE: ":effect query -> searches++";
export const EVERY_EXAMPLE: ":every 5s -> seconds++";
export const ACTION_EXAMPLE: "count++";
export const ACTION_USE: "Use: name++, name--, n += k, n -= k, name = v, flag toggle, list append/prepend v, list toggle v, list remove v, x clear, obj merge other, obj delete key, name reset, name refetch — chain with \";\" — e.g. count++";
export type Ctx = import("./context.js").Ctx;
export type Action = import("./context.js").Action;
