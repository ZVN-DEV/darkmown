/**
 * Re-parse a validated compiled expression (JS fragment over I()/S()/C()/A())
 * into a compact AST. Throws on anything outside the closed grammar.
 * @param {string} code
 * @returns {any[]}
 */
export function astOf(code: string): any[];
/**
 * Build-time mirror of the runtime AST walker — same operators, so a `:computed`
 * or `where`/`when` predicate folds to the SAME value the runtime will recompute.
 * `state` reads come from the compilation's declared-state map. No eval.
 * @param {any[]} node
 * @param {unknown} item Loop row for I(); undefined otherwise.
 * @param {{ state: Map<string, unknown> }} comp
 * @returns {any}
 */
export function evalAst(node: any[], item: unknown, comp: {
    state: Map<string, unknown>;
}): any;
export function serializeExpr(code: string): string;
