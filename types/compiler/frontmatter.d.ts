/**
 * @typedef {import("./context.js").Meta} Meta
 * @typedef {import("./context.js").FrontmatterValue} FrontmatterValue
 * @typedef {import("./context.js").Compilation} Compilation
 */
/**
 * Split a raw file into its frontmatter `meta` and `body`. `bodyLine` is the
 * 0-based file line index the body starts on (the number of lines the
 * frontmatter block consumed) so compile errors can report true file lines.
 *
 * `quotedKeys` names the fields the author wrote with quotes. Quotes are syntax,
 * not content, so `meta` never carries them — but "the author quoted it" is the
 * only signal that `sku: "007"` is the TEXT 007 and not the number 7, and the
 * typed-collection coercion needs it. Additive: existing destructuring of
 * `{ meta, body, bodyLine }` is unaffected.
 * @param {string} raw Full file contents.
 * @param {string} [file] Source path, used only for error messages.
 * @returns {{ meta: Meta, body: string, bodyLine: number, quotedKeys: Set<string> }}
 */
export function parseFrontmatter(raw: string, file?: string): {
    meta: Meta;
    body: string;
    bodyLine: number;
    quotedKeys: Set<string>;
};
/**
 * Warn (non-fatal) when a file looks like it MEANT to open frontmatter but forgot
 * the leading `---`: the first content line is a `key: value` pair and a bare
 * `---` fence appears within the opening lines. Conservative — a normal markdown
 * body whose first line happens to contain a colon (with no early `---`) is left
 * alone, since `---` is also a valid horizontal rule.
 * @param {string} raw
 * @param {string} file
 * @param {Compilation} comp
 * @returns {void}
 */
export function warnLikelyFrontmatter(raw: string, file: string, comp: Compilation): void;
export type Meta = import("./context.js").Meta;
export type FrontmatterValue = import("./context.js").FrontmatterValue;
export type Compilation = import("./context.js").Compilation;
