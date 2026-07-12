// ---------------------------------------------------------------------------
// Compiler module wiring. The compiler is split across cohesive seams:
//
//   context.js        shared typedefs + tiny helpers (createCompilation, at, …)
//   interpolation.js  path/value resolution, state-key lookup, escapeHtml, literals
//   frontmatter.js    `---` block → meta + body, inline scalar/array parsing
//   includes.js       @include / @loop-data resolution, colocated assets,
//                     scoped-skin detection + the HTML scope stamp, .md hints
//   predicates.js     where / when / :if / :computed expression compilers
//   format.js         { value | pipe } format pipes + list aggregates (value layer)
//   markdown.js       markdown-it instances + plugins + prose interpolation
//   state.js          :state / :store / :computed / :theme + declare* helpers
//   actions.js        the :button action parser + :button / :effect / :every
//   fetch.js          :fetch + the shared URL scheme guard
//   forms.js          :form + field directives + :bind / :slider
//   media.js          :video / :audio / :embed
//   structure.js      @include / ::: container / :if / :carousel + demo directives
//   directives.js     barrel re-exporting the handle* family from the six above
//   loops.js          @loop pipeline + row-template initial-paint fill
//   body.js           the line-based directive dispatcher (compileBody)
//   page.js           HTML page shell, image hardening, per-file compile
//
// Handlers recurse into nested bodies through `ctx.compileBody` (and `@include`
// through `ctx.compileFile`), threaded in by `compileFile` — so the graph is an
// import-cycle-free DAG rooted at context.js.
//
// This barrel re-exports the public API; `src/compiler.js` re-exports from here
// so every existing `import … from "./compiler.js"` keeps working unchanged.
// ---------------------------------------------------------------------------

export { parseFrontmatter } from "./frontmatter.js";
export { stampScope } from "./includes.js";
export { escapeHtml } from "./interpolation.js";
export { loopKeyOf } from "./loops.js";
export { compileDocument, compileFromMemory, compilePage, enhanceImages } from "./page.js";
