/**
 * @typedef {import("./context.js").Ctx} Ctx
 */
/**
 * Parse a `.wd` body line-by-line into HTML, mixing directives and prose.
 * @param {string[]} lines
 * @param {Ctx} ctx
 * @returns {string}
 */
export function compileBody(lines: string[], ctx: Ctx): string;
export type Ctx = import("./context.js").Ctx;
