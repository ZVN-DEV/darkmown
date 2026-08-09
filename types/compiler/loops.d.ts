/**
 * @param {string} line
 * @param {string[]} bodyLines
 * @param {string[] | null} emptyLines
 * @param {Ctx} ctx
 * @param {number} index 0-based line index of the `@loop` opener.
 * @param {number} [emptyStart] 0-based index the empty branch starts at within
 *   the loop body, so its nested errors report the true file line.
 * @returns {string}
 */
export function handleLoop(line: string, bodyLines: string[], emptyLines: string[] | null, ctx: Ctx, index: number, emptyStart?: number): string;
/**
 * @param {string} str
 * @param {number} start
 * @param {string} tag
 * @returns {number}
 */
export function matchElement(str: string, start: number, tag: string): number;
/**
 * Stable per-render key for a loop row, disambiguating duplicates with `#n`.
 * @param {unknown} item
 * @param {Map<string, number>} counts Mutable seen-count accumulator.
 * @returns {string}
 */
export function loopKeyOf(item: unknown, counts: Map<string, number>): string;
/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Predicate} Predicate
 * @typedef {import("./context.js").NumArg} NumArg
 * @typedef {import("./context.js").LoopOpts} LoopOpts
 */
export const LOOP_EXAMPLE: "@loop /products.json into p where p.price < 50 sort by p.price asc";
export type Ctx = import("./context.js").Ctx;
export type Predicate = import("./context.js").Predicate;
export type NumArg = import("./context.js").NumArg;
export type LoopOpts = import("./context.js").LoopOpts;
