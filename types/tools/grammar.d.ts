/** @returns {string[]} Every category name, for callers that want to enumerate. */
export function categoryNames(): string[];
/**
 * TOOL ENTRY POINT.
 *
 * @param {string[]} [categories] Category names. Omitted or empty means all of
 *   them, which is the whole cheatsheet and is the thing this tool exists to
 *   avoid sending.
 * Failures use the same {ok, text, data} shape as every other tool. It used to
 * answer {ok: false, error}, which `Session` never reads, so an unknown category
 * handed the model an undefined message.
 *
 * @returns {{ok: boolean, text: string, data: object}}
 */
export function grammar(categories?: string[]): {
    ok: boolean;
    text: string;
    data: object;
};
/**
 * How much a slice saves against sending everything.
 *
 * The plan claims filtering the cheatsheet is both a context saving and a
 * hallucination guard. The saving half is measurable, so it gets measured
 * rather than asserted.
 *
 * @param {string[]} categories
 * @returns {{sliceChars: number, fullChars: number, saved: number, savedPct: number}}
 */
export function grammarCost(categories: string[]): {
    sliceChars: number;
    fullChars: number;
    saved: number;
    savedPct: number;
};
export namespace CATEGORIES {
    let state: string[];
    let loops: string[];
    let actions: string[];
    let forms: string[];
    let fetch: string[];
    let structure: string[];
    let media: string[];
}
