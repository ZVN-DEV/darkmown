/**
 * Parse the inside of a `{ … }` binding into its path and an ordered list of
 * pipe stages. `{ price | money }` → `{ path: "price", stages: [{name:"money",args:[]}] }`.
 * Stage validation (unknown formatter) happens in {@link validatePipes}.
 * @param {string} inner
 * @returns {{ path: string, stages: Stage[] }}
 */
export function parsePipes(inner: string): {
    path: string;
    stages: Stage[];
};
/**
 * Compile-time validation: every stage must name a known formatter. Throws a
 * corrective compile error otherwise. Returns the parsed `{ path, stages }`.
 * @param {string} inner
 * @param {Ctx} ctx
 * @returns {{ path: string, stages: Stage[] }}
 */
export function validatePipes(inner: string, ctx: Ctx): {
    path: string;
    stages: Stage[];
};
/**
 * Run a resolved value through a pipe chain at build time. Returns the final
 * value (a string or number); the caller stringifies for output. Mirrors the
 * runtime's `applyFmt`.
 * @param {any} value
 * @param {Stage[]} stages
 * @returns {any}
 */
export function applyPipeline(value: any, stages: Stage[]): any;
/** @type {Record<string, (list: any[], field?: string) => number>} */
export const AGGREGATES: Record<string, (list: any[], field?: string) => number>;
/**
 * The whitelist. Each formatter is a pure function of (value, args) — no clock,
 * no DOM, no globals beyond `Intl` — so a static value folds deterministically at
 * build time and a reactive value formats identically in the browser.
 * @type {Record<string, (value: any, args: any[]) => string | number>}
 */
export const FORMATTERS: Record<string, (value: any, args: any[]) => string | number>;
/** Formatter names, for error messages and the runtime mirror check. */
export const FORMATTER_NAMES: string[];
export function fmtAttr(stages: Stage[]): string;
export function stagesFromAttr(json: string): Stage[];
export type Ctx = import("./context.js").Ctx;
export type Stage = {
    name: string;
    args: Array<string | number | boolean | null>;
};
