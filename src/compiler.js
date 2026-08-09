// Darkmown's compiler, split into cohesive modules under `src/compiler/`. This
// file is the Node-facing barrel: it re-exports the public API from
// `src/compiler/index.js` so every existing `import … from "./compiler.js"`
// (builder, tests) keeps working unchanged. It is ALSO the single place the
// default filesystem reader is injected — `compilePage`/`compileDocument`/
// `enhanceImages` default their reader to `fsReader()` here, so callers keep
// their old signatures and the compile stays byte-identical. The fs-free entry
// point (`compileFromMemory`) needs no default and passes through. Because this
// module imports `fs-reader.js` (and thus `node:fs`), it is Node-only; the
// browser bundles `compileFromMemory` from `src/compiler/page.js` directly.

// Re-export the public typedefs so existing `import("./compiler.js").Type`
// references (e.g. `Assets` in src/builder.js) keep resolving after the split.
/**
 * @typedef {import("./compiler/context.js").Meta} Meta
 * @typedef {import("./compiler/context.js").FrontmatterValue} FrontmatterValue
 * @typedef {import("./compiler/context.js").Assets} Assets
 * @typedef {import("./compiler/context.js").Compilation} Compilation
 * @typedef {import("./compiler/context.js").Scope} Scope
 * @typedef {import("./compiler/context.js").Ctx} Ctx
 * @typedef {import("./compiler/context.js").CompiledDocument} CompiledDocument
 * @typedef {import("./compiler/context.js").CompiledPage} CompiledPage
 */

import { fsReader } from "./compiler/fs-reader.js";
import {
  compileDocument as compileDocumentImpl,
  compilePage as compilePageImpl,
  enhanceImages as enhanceImagesImpl
} from "./compiler/index.js";

export {
  compileFromMemory,
  escapeHtml,
  loopKeyOf,
  parseFrontmatter,
  stampScope
} from "./compiler/index.js";

/**
 * Compile a page source file into a full HTML document plus its assets, reading
 * from the real filesystem by default. Pass `options.reader` to compile against
 * a different source (see `compileFromMemory`).
 * @param {string} file Absolute path to the source `.md`/`.wd` file.
 * @param {import("./config.js").Paths} context Resolved project paths.
 * @param {{ feed?: { href: string, title: string }, site?: import("./compiler/page.js").SiteContext, collections?: Map<string, import("./compiler/collections.js").CollectionRow[]>, vars?: Record<string, unknown>, reader?: import("./compiler/reader.js").Reader }} [options]
 * @returns {CompiledPage}
 */
export function compilePage(file, context, options = {}) {
  return compilePageImpl(file, context, { reader: fsReader(), ...options });
}

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
export function compileDocument(file, context, stack, vars, collections, reader = fsReader()) {
  return compileDocumentImpl(file, context, stack, vars, collections, reader);
}

/**
 * Harden every `<img>` in an assembled page body, reading intrinsic dimensions
 * from the real filesystem by default.
 * @param {string} html Assembled page body HTML.
 * @param {import("./config.js").Paths} paths Resolved project paths.
 * @param {import("./compiler/reader.js").Reader} [reader] Source reader for image bytes.
 * @returns {string}
 */
export function enhanceImages(html, paths, reader = fsReader()) {
  return enhanceImagesImpl(html, paths, reader);
}
