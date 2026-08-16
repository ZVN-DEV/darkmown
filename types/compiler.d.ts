/**
 * Compile a page source file into a full HTML document plus its assets, reading
 * from the real filesystem by default. Pass `options.reader` to compile against
 * a different source (see `compileFromMemory`).
 * @param {string} file Absolute path to the source `.md`/`.wd` file.
 * @param {import("./config.js").Paths} context Resolved project paths.
 * @param {{ feed?: { href: string, title: string }, site?: import("./compiler/page.js").SiteContext, collections?: Map<string, import("./compiler/collections.js").CollectionRow[]>, vars?: Record<string, unknown>, reader?: import("./compiler/reader.js").Reader }} [options]
 * @returns {CompiledPage}
 */
export function compilePage(file: string, context: import("./config.js").Paths, options?: {
    feed?: {
        href: string;
        title: string;
    };
    site?: import("./compiler/page.js").SiteContext;
    collections?: Map<string, import("./compiler/collections.js").CollectionRow[]>;
    vars?: Record<string, unknown>;
    reader?: import("./compiler/reader.js").Reader;
}): CompiledPage;
/**
 * Compile a source file into its body HTML, frontmatter, and assets (no page
 * shell), reading from the real filesystem by default.
 * @param {string} file Absolute path to the source file.
 * @param {import("./config.js").Paths} context Resolved project paths.
 * @param {string[]} [stack] Include stack for cycle detection.
 * @param {Record<string, unknown>} [vars] Initial static scope variables.
 * @param {Map<string, import("./compiler/collections.js").CollectionRow[]>} [collections]
 * @param {import("./compiler/reader.js").Reader} [reader] Source reader.
 * @returns {CompiledDocument}
 */
export function compileDocument(file: string, context: import("./config.js").Paths, stack?: string[], vars?: Record<string, unknown>, collections?: Map<string, import("./compiler/collections.js").CollectionRow[]>, reader?: import("./compiler/reader.js").Reader): CompiledDocument;
/**
 * Harden every `<img>` in an assembled page body, reading intrinsic dimensions
 * from the real filesystem by default.
 * @param {string} html Assembled page body HTML.
 * @param {import("./config.js").Paths} paths Resolved project paths.
 * @param {import("./compiler/reader.js").Reader} [reader] Source reader for image bytes.
 * @returns {string}
 */
export function enhanceImages(html: string, paths: import("./config.js").Paths, reader?: import("./compiler/reader.js").Reader): string;
export type Meta = import("./compiler/context.js").Meta;
export type FrontmatterValue = import("./compiler/context.js").FrontmatterValue;
export type Assets = import("./compiler/context.js").Assets;
export type Compilation = import("./compiler/context.js").Compilation;
export type Scope = import("./compiler/context.js").Scope;
export type Ctx = import("./compiler/context.js").Ctx;
export type CompiledDocument = import("./compiler/context.js").CompiledDocument;
export type CompiledPage = import("./compiler/context.js").CompiledPage;
export { compileFromMemory, escapeHtml, loopKeyOf, parseFrontmatter, stampScope } from "./compiler/index.js";
