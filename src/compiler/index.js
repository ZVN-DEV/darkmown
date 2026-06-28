// ---------------------------------------------------------------------------
// Compiler module wiring. The compiler is split across cohesive seams:
//
//   context.js        shared typedefs + tiny helpers (createCompilation, at, …)
//   interpolation.js  path/value resolution, state-key lookup, escapeHtml, literals
//   frontmatter.js    `---` block → meta + body, inline scalar/array parsing
//   includes.js       @include / @loop-data resolution, colocated assets, .md hints
//   predicates.js     where / when / :if / :computed expression compilers
//   format.js         { value | pipe } format pipes + list aggregates (value layer)
//   markdown.js       markdown-it instances + plugins + prose interpolation
//   loops.js          @loop pipeline + row-template initial-paint fill
//   directives.js     the handle* family + :button action parser + demo directives
//   body.js           the line-based directive dispatcher (compileBody)
//   page.js           HTML page shell, image hardening, per-file compile
//
// This barrel re-exports the public API; `src/compiler.js` re-exports from here
// so every existing `import … from "./compiler.js"` keeps working unchanged.
// ---------------------------------------------------------------------------

export { parseFrontmatter } from "./frontmatter.js";
export { escapeHtml } from "./interpolation.js";
export { loopKeyOf } from "./loops.js";
export { compileDocument, compilePage, enhanceImages } from "./page.js";
