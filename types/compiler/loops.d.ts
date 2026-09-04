/**
 * Serialize an already-validated expression fragment into the compact AST
 * attribute payload the runtime reads, turning a residual parse failure into a
 * CODED compile error with `file:line` instead of the AST layer's raw internal
 * `Error`.
 *
 * `expr-ast.js` re-parses the compiler's own output, so a failure there is not
 * an author mistake and it throws a plain `Error` by design. But the operand
 * folds in `predicates.js` splice BUILD-TIME VALUES into that output, and a
 * value the fold cannot render as a readable literal escapes as an uncoded
 * `expr-ast: …` error with no file, no line, and no suggestion — the one gap in
 * the "every author-facing error carries a code" invariant. This is the seam
 * where that becomes an ordinary Darkmown compile error again.
 *
 * Lives here rather than beside its `structure.js` callers because the error-code
 * registry pins each source file to a subsystem block (`compiler/loops.js` owns
 * WD1xx), and this guard's reserved code is WD190.
 * @param {string} code Validated JS fragment over `I()`/`S()`/`C()`/`A()`.
 * @param {Ctx} ctx
 * @param {number} index 0-based line index of the directive that owns it.
 * @param {string} what Directive label for the message, e.g. `":if"`.
 * @returns {any[]} The parsed AST.
 */
export function astAt(code: string, ctx: Ctx, index: number, what: string): any[];
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
 * @typedef {import("./context.js").Compilation} Compilation
 * @typedef {import("./context.js").Predicate} Predicate
 * @typedef {import("./context.js").NumArg} NumArg
 * @typedef {import("./context.js").LoopOpts} LoopOpts
 */
export const LOOP_EXAMPLE: "@loop /products.json into p where p.price < 50 sort by p.price asc";
export function serializeExprAt(code: string, ctx: Ctx, index: number, what: string): string;
export type Ctx = import("./context.js").Ctx;
export type Compilation = import("./context.js").Compilation;
export type Predicate = import("./context.js").Predicate;
export type NumArg = import("./context.js").NumArg;
export type LoopOpts = import("./context.js").LoopOpts;
