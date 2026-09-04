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
     * and paints its seed then binds; `row` is a reactive `@loop` row, whose ONE
     * template serves every row, so it paints nothing and binds per row.
     */
    kind: "static" | "state" | "row";
    /**
     * For `state`: the fully-qualified state key.
     */
    key?: string | undefined;
    /**
     * For `state`/`row`: the dotted sub-path under it ("" for the whole value).
     */
    path?: string | undefined;
    /**
     * For `row`: the per-row meta variable (`index`, `number`, …).
     */
    meta?: string | undefined;
};
export type Meta = import("./context.js").Meta;
export type Ctx = import("./context.js").Ctx;
/**
 * One reactive binding found in a destination: the serialized template part the
 * runtime evaluates, plus the build-time text to paint for it.
 */
export type PendingAttr = {
    /**
     *   `s` = state key + sub-path, `i` = loop-row sub-path, `m` = row meta variable.
     */
    part: ["s", string, string] | ["i", string] | ["m", string];
    /**
     * Build-time paint ("" for anything per-row).
     */
    text: string;
    /**
     * The author's own `{ … }` source, restored when the
     * `](…)` turned out not to be a link after all.
     */
    raw: string;
};
import MarkdownIt from "markdown-it";
