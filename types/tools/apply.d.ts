/**
 * Resolve one edit's target to a 1-based inclusive line range in `source`.
 *
 * Every rejection names what was wrong AND what would have worked, because a
 * rejection a model cannot act on is just a failed attempt.
 *
 * @param {string} source
 * @param {Edit} edit
 * @param {import("../compiler/context.js").Symbol[]} symbols
 * @returns {{ok: true, from: number, to: number} | {ok: false, error: string}}
 */
export function resolveTarget(source: string, edit: Edit, symbols: import("../compiler/context.js").Symbol[]): {
    ok: true;
    from: number;
    to: number;
} | {
    ok: false;
    error: string;
};
/**
 * TOOL ENTRY POINT.
 *
 * @param {Record<string, string>} files
 * @param {string} entry File to edit, in the same key form as `files`.
 * @param {Edit[]} [edits] Missing or empty is reported, not thrown.
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function apply(files: Record<string, string>, entry: string, edits?: Edit[]): {
    ok: boolean;
    text: string;
    data: object;
};
/** The operations a caller may ask for. Closed, and validated per edit. */
export const OPS: Set<string>;
/**
 * One edit, as a caller (or a model) writes it.
 *
 * Every field is optional because a malformed edit is REPORTED, not thrown: the
 * whole point of this surface is that a model gets a sentence back telling it
 * what to fix. Typing them as required would describe a contract this module
 * deliberately does not enforce at the boundary.
 */
export type Edit = {
    /**
     * One of {@link OPS}.
     */
    op?: string | undefined;
    /**
     * 1-based line, as printed by `outline`.
     */
    line?: number | undefined;
    /**
     * A symbol target, e.g. `state:cart`.
     */
    symbol?: string | undefined;
    /**
     * Exact source text to find.
     */
    anchor?: string | undefined;
    /**
     * Replacement or inserted text.
     */
    text?: string | undefined;
    /**
     * What the caller believed is at `line`, for staleness.
     */
    expect?: string | undefined;
};
