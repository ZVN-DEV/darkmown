/**
 * Compile a page source file into a full HTML document plus its assets.
 * @param {string} file Absolute path to the source `.md`/`.wd` file.
 * @param {Paths} context Resolved project paths.
 * @returns {CompiledPage}
 */
export function compilePage(file: string, context: Paths): CompiledPage;
/**
 * Compile a source file into its body HTML, frontmatter, and assets (no page shell).
 * @param {string} file Absolute path to the source file.
 * @param {Paths} context Resolved project paths.
 * @param {string[]} [stack] Include stack for cycle detection.
 * @param {Record<string, unknown>} [vars] Initial static scope variables.
 * @returns {CompiledDocument}
 */
export function compileDocument(file: string, context: Paths, stack?: string[], vars?: Record<string, unknown>): CompiledDocument;
/**
 * Compile a page from an in-memory map of project-relative path → source, with
 * no filesystem access. `entryPath` is the project-relative path of the page to
 * compile; includes and `@loop` data resolve against the same map.
 * @param {Record<string, string> | Map<string, string>} files
 * @param {string} entryPath
 * @param {{ vars?: Record<string, unknown>, cwd?: string }} [options]
 * @returns {CompiledPage}
 */
export function compileFromMemory(files: Record<string, string> | Map<string, string>, entryPath: string, options?: {
    vars?: Record<string, unknown>;
    cwd?: string;
}): CompiledPage;
/**
 * Split a raw file into its frontmatter `meta` and `body`.
 * @param {string} raw Full file contents.
 * @param {string} [file] Source path, used only for error messages.
 * @returns {{ meta: Meta, body: string }}
 */
export function parseFrontmatter(raw: string, file?: string): {
    meta: Meta;
    body: string;
};
/**
 * Stable per-render key for a loop row, disambiguating duplicates with `#n`.
 * @param {unknown} item
 * @param {Map<string, number>} counts Mutable seen-count accumulator.
 * @returns {string}
 */
export function loopKeyOf(item: unknown, counts: Map<string, number>): string;
/**
 * Escape a value for safe inclusion in HTML text and attribute contexts.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value: unknown): string;
/**
 * A loop offset/limit argument: a non-negative integer literal or a state key.
 */
export type NumArg = {
    kind: "literal";
    value: number;
} | {
    kind: "key";
    value: string;
};
/**
 * A compiled `@loop … where` predicate.
 */
export type Predicate = {
    /**
     * Safe JS boolean expression over `I()`/`S()`/`C()`.
     */
    body: string;
    /**
     * Whether the predicate reads declared state.
     */
    refsState: boolean;
};
/**
 * Loop clause configuration shared by the static and reactive paths.
 */
export type LoopOpts = {
    where: Predicate | null;
    sort: {
        key: string;
        dir: string;
    } | null;
    reverse: boolean;
    offset: NumArg | null;
    limit: NumArg | null;
    /**
     * Empty-branch body lines, if any.
     */
    empty: string[] | null;
    /**
     * Whether offset/limit reference state.
     */
    clauseRefsState: boolean;
};
export type Paths = import("./config.js").Paths;
/**
 * Frontmatter values are scalars or inline arrays of scalars.
 */
export type FrontmatterValue = string | number | boolean | null | Array<string | number | boolean | null>;
/**
 * Parsed page frontmatter, keyed by field name.
 */
export type Meta = Record<string, FrontmatterValue>;
/**
 * Collected output assets for a compiled document.
 */
export type Assets = {
    /**
     * Public hrefs of compiled skin stylesheets.
     */
    skins: Set<string>;
    /**
     * Public hrefs of colocated page scripts.
     */
    scripts: Set<string>;
    /**
     * Source path → public href for emitted assets.
     */
    files: Map<string, string>;
    /**
     * Whether the reactive runtime is required.
     */
    runtime: boolean;
};
/**
 * Per-document compilation accumulator shared across includes/sections.
 */
export type Compilation = {
    assets: Assets;
    /**
     * Declared state keys → initial values.
     */
    state: Map<string, unknown>;
    /**
     * Page-global store names (a subset of state keys).
     */
    stores: Set<string>;
    /**
     * Non-fatal authoring hints.
     */
    warnings: string[];
    /**
     * Counter for auto-generated section ids.
     */
    sectionCounter: number;
};
/**
 * A lexical scope chain for static interpolation values (include args, loop vars).
 */
export type Scope = {
    parent: Scope | null;
    vars: Record<string, unknown>;
};
/**
 * Per-file compile context threaded through the directive handlers.
 */
export type Ctx = {
    /**
     * Absolute path to the file being compiled.
     */
    file: string;
    /**
     * Resolved project paths.
     */
    context: Paths;
    /**
     * Include stack (real paths) for cycle detection.
     */
    stack: string[];
    /**
     * Static value scope chain.
     */
    scope: Scope;
    /**
     * Shared compilation accumulator.
     */
    comp: Compilation;
    /**
     * Active section-id scope chain.
     */
    sections: string[];
    /**
     * Name of the current reactive loop item, if any.
     */
    loopItem: string | null;
    /**
     * State key of the list being looped, if any.
     */
    loopKey?: string | undefined;
    /**
     * Inside a loop body, so `$index`/`$first`/… are valid.
     */
    loopMeta?: boolean | undefined;
    /**
     * Markdown-it instance selected for this file.
     */
    md?: MarkdownIt | undefined;
};
/**
 * A compiled page document.
 */
export type CompiledDocument = {
    meta: Meta;
    html: string;
    assets: Assets;
    warnings: string[];
};
/**
 * A compiled page: the document plus its full HTML shell.
 */
export type CompiledPage = {
    meta: Meta;
    html: string;
    assets: Assets;
    warnings: string[];
};
/**
 * A parsed `:button` action.
 */
export type Action = {
    /**
     * Runtime operation (inc/dec/add/sub/append/prepend/set/toggle/member-toggle/remove/remove-value/clear/merge/delete/reset/append-row).
     */
    op: string;
    /**
     * State key (possibly dotted) the action mutates.
     */
    target: string;
    /**
     * Literal value for value-carrying ops.
     */
    value?: unknown;
};
import MarkdownIt from "markdown-it";
