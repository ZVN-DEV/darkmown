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
/**
 * Resolve the `skins:` frontmatter key to the absolute paths of the shared
 * `.skin` files a page pulls in, in listed order. The value is an inline array
 * (`skins: [/base.skin, /marketing.skin]`) reusing the same array parsing as
 * `tags:`; each entry resolves like an `@include` path — a leading `/` is
 * rooted at the shelf/pages roots (`site/_` first, then `site/pages`), a
 * relative path resolves beside the page, then on the shelf — and must point
 * at a real `.skin` file inside the `site/pages` / `site/_` sandbox. Anything
 * else (a non-array value, a non-string entry, a missing file, a wrong
 * extension, a path escaping the sandbox) is a WD017 compile error naming the
 * offending entry.
 * @param {Meta} meta Parsed frontmatter.
 * @param {string} file Absolute path of the file the frontmatter came from.
 * @param {import("./context.js").Paths} context Resolved project paths.
 * @param {import("./reader.js").Reader} reader Source reader (fs or in-memory).
 * @returns {string[]} Absolute `.skin` paths, in listed order (empty when the
 *   key is absent).
 */
export function resolveSharedSkins(meta: Meta, file: string, context: import("./context.js").Paths, reader: import("./reader.js").Reader): string[];
export type Meta = import("./context.js").Meta;
export type FrontmatterValue = import("./context.js").FrontmatterValue;
export type Compilation = import("./context.js").Compilation;
