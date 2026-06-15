/**
 * A nesting frame in the indentation stack.
 * @typedef {object} SkinFrame
 * @property {number} indent
 * @property {string | null} selector
 * @property {string} [media]
 */
/**
 * Compile indentation-based `.skin` source into CSS.
 * @param {string} source
 * @returns {string}
 */
export function compileSkin(source: string): string;
/**
 * A nesting frame in the indentation stack.
 */
export type SkinFrame = {
    indent: number;
    selector: string | null;
    media?: string | undefined;
};
