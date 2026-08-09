/**
 * Derive a short, deterministic scope id from a skin's PROJECT-RELATIVE PATH.
 * Path-based (stable across content edits, unique per component file) and short
 * enough to read in the emitted CSS (`wd-7c21`). The same path always yields the
 * same id, so the CSS rewrite (builder) and the HTML stamp (page/include) agree
 * without sharing state — they just hash the same relative path. The path is
 * normalized to POSIX separators first so a build is identical on Windows.
 * @param {string} relPath Skin path relative to the project root (cwd).
 * @returns {string} The scope id, e.g. `wd-7c21`.
 */
export function scopeIdFor(relPath: string): string;
/**
 * A nesting frame in the indentation stack.
 * @typedef {object} SkinFrame
 * @property {number} indent
 * @property {string | null} selector
 * @property {string} [media]
 */
/**
 * Compile indentation-based `.skin` source into CSS.
 *
 * Scoping (opt-in): when `opts.scope` is set the skin is compiled in scoped
 * mode — every selector RULE gets `[data-wd-scope="<id>"]` appended to the
 * subject of each compound selector, so the stylesheet only ever matches inside
 * the stamped subtree. Design tokens (`tokens` / `tokens dark` / `tokens [attr]`)
 * stay GLOBAL on `:root` regardless, so `var(--x)` and dark mode keep working
 * site-wide. A whole-selector `:global(.x)` escapes scoping. Page-level selectors
 * (`page`/`*`/`html`/`body`/`::selection`) are a compile error in scoped mode.
 * Without `opts.scope`, output is byte-identical to before this feature existed.
 * @param {string} source
 * @param {{ scope?: string, subjects?: Set<string> }} [opts] `scope`: the scope
 *   id enabling scoped mode. `subjects`: an optional set the compiler fills with
 *   every scoped subject token (`.card`, `h2`, `#id`) for the unused-selector
 *   warning, so the caller need not re-parse the source.
 * @returns {string}
 */
export function compileSkin(source: string, opts?: {
    scope?: string;
    subjects?: Set<string>;
}): string;
/**
 * A nesting frame in the indentation stack.
 */
export type SkinFrame = {
    indent: number;
    selector: string | null;
    media?: string | undefined;
};
