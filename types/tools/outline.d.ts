/**
 * Compile and return one symbol per source construct, with every line resolved.
 *
 * Two foldings happen here, both forced by how the compiler works rather than by
 * taste. A statically-unrolled `@loop` recompiles its body once per row, so a
 * directive inside it records N identical symbols at one `file:line`; and a prose
 * read inside such a loop records N line-less reads. Both collapse to one.
 *
 * The `compiled` half is the compiler's own result, derived from the function
 * rather than restated here: widening it to `object` compiled fine while these
 * lived under bench/, and silently lost every property check the moment they
 * became part of the package.
 *
 * @typedef {ReturnType<typeof compileFromMemory>} Compiled
 * @typedef {import("../compiler/context.js").Symbol} Symbol
 *
 * @param {Record<string, string>} files
 * @param {string} entry
 * @returns {{ok: true, symbols: Symbol[], compiled: Compiled} | {ok: false, error: string}}
 */
export function symbolsOf(files: Record<string, string>, entry: string): {
    ok: true;
    symbols: Symbol[];
    compiled: Compiled;
} | {
    ok: false;
    error: string;
};
/**
 * TOOL ENTRY POINT: outline(files, entry)
 *
 * @param {Record<string, string>} files
 * @param {string} entry
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function outline(files: Record<string, string>, entry: string): {
    ok: boolean;
    text: string;
    data: object;
};
/**
 * TOOL ENTRY POINT: refs(files, entry, name)
 *
 * Every place a symbol is declared, written, or read, across the entry and
 * everything it includes. This is the query behind impact expansion: "what else
 * needs to change" is a lookup, not something a model should be recalling.
 *
 * @param {Record<string, string>} files
 * @param {string} entry
 * @param {string} [name] Symbol name, e.g. `cart`. Missing is reported, not thrown.
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function refs(files: Record<string, string>, entry: string, name?: string): {
    ok: boolean;
    text: string;
    data: object;
};
/**
 * TOOL ENTRY POINT: deps(files, entry)
 *
 * What this page pulls in (includes, data files, collections) and, for any other
 * page in the project, whether it pulls in the same thing. The reverse direction
 * is what makes "I changed a partial, what breaks" answerable.
 *
 * @param {Record<string, string>} files
 * @param {string} entry
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function deps(files: Record<string, string>, entry: string): {
    ok: boolean;
    text: string;
    data: object;
};
/**
 * Compile and return one symbol per source construct, with every line resolved.
 *
 * Two foldings happen here, both forced by how the compiler works rather than by
 * taste. A statically-unrolled `@loop` recompiles its body once per row, so a
 * directive inside it records N identical symbols at one `file:line`; and a prose
 * read inside such a loop records N line-less reads. Both collapse to one.
 *
 * The `compiled` half is the compiler's own result, derived from the function
 * rather than restated here: widening it to `object` compiled fine while these
 * lived under bench/, and silently lost every property check the moment they
 * became part of the package.
 */
export type Compiled = ReturnType<typeof compileFromMemory>;
/**
 * Compile and return one symbol per source construct, with every line resolved.
 *
 * Two foldings happen here, both forced by how the compiler works rather than by
 * taste. A statically-unrolled `@loop` recompiles its body once per row, so a
 * directive inside it records N identical symbols at one `file:line`; and a prose
 * read inside such a loop records N line-less reads. Both collapse to one.
 *
 * The `compiled` half is the compiler's own result, derived from the function
 * rather than restated here: widening it to `object` compiled fine while these
 * lived under bench/, and silently lost every property check the moment they
 * became part of the package.
 */
export type Symbol = import("../compiler/context.js").Symbol;
import { compileFromMemory } from "../compiler.js";
