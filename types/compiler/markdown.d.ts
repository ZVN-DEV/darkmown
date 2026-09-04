/**
 * Pick the markdown-it instance for a page (raw HTML off by default, on with `html: true`).
 * @param {Meta} [meta]
 * @returns {MarkdownIt}
 */
export function selectMd(meta?: Meta): MarkdownIt;
/**
 * Render one prose chunk.
 * @param {string} text
 * @param {Ctx} ctx
 * @param {number} [index] 0-based line index the chunk starts at in the current
 *   `compileBody` slice, so a warning about a binding inside it reports the true
 *   `file:line`. Defaults to the top of the slice.
 * @returns {string}
 */
export function renderProse(text: string, ctx: Ctx, index?: number): string;
/**
 * The inline token an attr block attaches to: the immediately-preceding image
 * (self-closing) or the open token matching the immediately-preceding close
 * (link/em/strong/…). Returns null when nothing valid precedes. Exported so its
 * contract — including the defensive unbalanced-close fallback that markdown-it's
 * always-balanced token stream never triggers in practice — is unit-testable.
 * @param {any[]} children markdown-it inline child tokens
 * @param {number} i Index of the attr-block text token.
 * @returns {any} the matching markdown-it Token, or null
 */
export function attrTarget(children: any[], i: number): any;
/**
 * GitHub-style heading slug: lowercase, punctuation stripped (letters, numbers,
 * whitespace, `_`, and `-` survive), each whitespace character becomes a hyphen.
 * Punctuation-only headings fall back to `"section"` so the id is never empty.
 * @param {string} text Plain heading text.
 * @returns {string}
 */
export function slugify(text: string): string;
/**
 * A resolved `{ name.path }` binding.
 */
export type Binding = {
    /**
     * What the inline rule emits: a `data-wd-each` /
     * `data-wd-bind` span for a reactive value, the escaped value for a static one.
     */
    html: string;
    /**
     * The PLAIN resolved text (unescaped, no markup) — a
     * reactive value's initial paint. This is what a link destination, a raw-HTML
     * attribute, and a heading slug need; `html` is unusable in all three.
     */
    text: string;
    /**
     * Where the value came from, and
     * therefore what the non-inline positions may do with it: `static` is a
     * build-time value and always safe to substitute; `state` is `:state`/`:store`
     * and can only be painted once; `row` is a reactive `@loop` row, whose ONE
     * template serves every row, so it cannot be substituted at all.
     */
    kind: "static" | "state" | "row";
};
export type Meta = import("./context.js").Meta;
export type Ctx = import("./context.js").Ctx;
import MarkdownIt from "markdown-it";
