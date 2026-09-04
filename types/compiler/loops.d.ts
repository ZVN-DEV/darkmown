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
 * Splice two adjacent tables into one, in the two shapes a `.wd` body produces:
 *
 * 1. Two tables that carry the SAME markup before `<tbody>` — one compiled row
 *    body per loop row. Their `<tbody>` contents concatenate. Requiring the
 *    prefixes to match is what keeps a header that interpolates the row (a
 *    genuinely different table per row) from losing every header but the first.
 * 2. A HEADER-ONLY table (a `<thead>` and no `<tbody>`: what `| Name | N |` +
 *    `|---|---|` in the prose above a loop compiles to) followed by a BODY-ONLY
 *    table (a `<tbody>` and no `<thead>`: what a loop over bare `|…|` rows now
 *    emits). The body moves inside the header's table.
 *
 * Exported because both seams matter: the loop's own row seam (case 1) and the
 * body-level seam between flushed prose and a handler's output (case 2), which
 * `compileBody` owns.
 * @param {string} prev
 * @param {string} next
 * @returns {string | null} The spliced HTML, or null when they do not merge.
 */
export function spliceTables(prev: string, next: string): string | null;
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
