// Darkmown's compiler, split into cohesive modules under `src/compiler/`. This
// file is a thin barrel: it re-exports the public API from `src/compiler/index.js`
// so every existing `import … from "./compiler.js"` (builder, tests) keeps
// working unchanged. See `src/compiler/index.js` for the module map.

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

export { compilePage, enhanceImages, compileDocument, parseFrontmatter, loopKeyOf, escapeHtml } from "./compiler/index.js";
