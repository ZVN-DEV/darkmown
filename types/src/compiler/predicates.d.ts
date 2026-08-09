/**
 * @param {string} raw
 * @param {string} itemName
 * @param {Ctx} ctx
 * @returns {Predicate}
 */
export function compilePredicate(raw: string, itemName: string, ctx: Ctx): Predicate;
/**
 * Evaluate a compiled predicate against a row at build time by walking its AST —
 * the same closed evaluator the runtime uses, so the fold matches. No eval.
 * @param {string} body
 * @param {unknown} item
 * @param {Ctx} ctx
 * @returns {boolean}
 */
export function evalPredicate(body: string, item: unknown, ctx: Ctx): boolean;
/**
 * Compile a `::: … .class when <predicate>`. Allows `:if`-style bare truthy
 * paths and `where`-style `left <op> right` conditions joined by `and`/`or`.
 * Folds to a static verdict when every operand is build-known, else returns a
 * runtime body over I()/S()/C() plus whether it reads the reactive loop item
 * (which decides data-wd-each-class vs the global data-wd-class).
 * @param {string} raw
 * @param {Ctx} ctx
 * @param {string} [what] Directive label for error messages.
 * @returns {{ static: true, value: boolean } | { static: false, body: string, item: boolean }}
 */
export function compileWhen(raw: string, ctx: Ctx, what?: string): {
    static: true;
    value: boolean;
} | {
    static: false;
    body: string;
    item: boolean;
};
/**
 * Compile a `:computed` expression into safe JS over the `S(key, path)` reader.
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {string}
 */
export function compileComputedExpr(raw: string, ctx: Ctx): string;
/**
 * @typedef {import("./context.js").Ctx} Ctx
 * @typedef {import("./context.js").Predicate} Predicate
 */
export const PREDICATE_OPS: string[];
export const PREDICATE_JOINERS: string[];
export type Ctx = import("./context.js").Ctx;
export type Predicate = import("./context.js").Predicate;
