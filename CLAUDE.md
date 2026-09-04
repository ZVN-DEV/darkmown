# Darkmown — AI contributor guide

Darkmown is a markdown-native web framework: `.md` files are strict CommonMark, `.wd` files add first-party directives (loops, state, includes, sections, fetch, forms). Static pages ship **zero** framework JavaScript; reactive pages share one runtime (currently ~7.7 KB gzipped) that must stay **under 8 KB gzipped** (CI-enforced).

## Architecture in one pass

Compile pipeline. `src/compiler.js` is a thin re-export barrel (public API: `compilePage`, `enhanceImages`, `compileDocument`, `parseFrontmatter`, `loopKeyOf`, `escapeHtml` + the shared typedefs); the implementation lives in `src/compiler/` modules wired by `src/compiler/index.js`. State threads through an explicit `Ctx`/`Compilation` object (no module-level mutable state). The modules:
- `context.js` — shared typedefs (`Ctx`, `Compilation`, `Assets`, `LoopOpts`, `Predicate`, `Action`, …), `createCompilation`/`createScope`, the `at(file, index)` → `file:line` helper, and `LOOP_META`. Imports nothing; sits at the root of the DAG.
- `interpolation.js` — path/value resolution (`getPath`, `validatePath`, `lookupVar`/`lookupPath`, `resolveStateKey`, `interpolateLeaf`), literal parsing, `escapeHtml`, `safeScriptJson`, `humanizeName`.
- `frontmatter.js` — `parseFrontmatter` (the `---` block → meta + body) + inline scalar/array parsing + the "forgot the opening `---`" warning.
- `includes.js` — `resolveInclude`/`isAllowedInclude` (traversal + the `site/pages`/`site/_` sandbox), colocated `.skin`/`.js` asset collection, scoped-skin detection (`scopedSkinFor`) + the HTML scope stamp (`stampScope`), and the plain-`.md` `.wd`-syntax hints.
- `predicates.js` — the compile-time-validated expression whitelists: `@loop … where`, `::: … .class when`, `:if a <op> b`, and `:computed`; all map to safe JS over `I()`/`S()`/`C()`.
- `format.js` — the value layer: `{ value | name:arg | name2 }` format pipes + `{ list | sum:"price" }` aggregates, a fixed compile-time-validated formatter registry (no eval). Folds to text at build time for static values; emits `data-wd-fmt` for values that read `:state`/`:store`. The formatter math is mirrored compactly in `src/runtime.js` for the reactive path; `tests/format.test.js` + the compile↔runtime parity test guard against drift.
- `markdown.js` — the markdown-it instances + the `wd_binding`/`wd_attrs` plugins + prose rendering and `{ name.path }` binding resolution.
- `loops.js` — the `@loop` header/clause parser and the static-unroll vs reactive `data-wd-loop` pipeline, plus the row-template initial-paint string fill; exports `loopKeyOf`.
- `state.js` — `handleState`/`handleStore`/`handleComputed`/`handleTheme` + the shared `declareState`/`declareStore`/`declareErrorState` helpers the fetch/form handlers register their auto-declared keys through.
- `actions.js` — the `:button` action-expression parser (the validated `{ op, target, value }` vocabulary) + its consumers `handleButton`/`handleEffect`/`handleEvery`.
- `fetch.js` — `handleFetch` + `validateFetchUrl`, the compile-time URL scheme guard the form/media/embed handlers reuse.
- `forms.js` — `handleForm` + the field directives (`handleInput`/`handleTextarea`/`handleSelect`/`handleChoiceGroup`/`handleSubmit`) and the bound controls `handleBind`/`handleSlider`.
- `media.js` — `handleMedia` (`:video`/`:audio`) + `handleEmbed`. Compile-time only, zero runtime.
- `structure.js` — `handleInclude`/`handleContainer`/`handleIf`/`handleCarousel` + the `:try`/`:note`/`:sprint` demo directives.
- `directives.js` — barrel re-exporting the `handle*` family from the six handler modules above, so the dispatcher has one import site. Every handler takes the 0-based line `index` so malformed/invalid errors report `file:line` via `at`.
- `body.js` — `compileBody`, the line-based directive dispatcher: walks the `.wd` body, honors fenced code, dispatches each opener to its handler (passing the line index), and flushes prose to `markdown.js`. The block scanners (`scanBlock`/`scanContainer`/`scanConditional`) capture multi-line directive bodies.
- `page.js` — `compilePage` (HTML shell: title, favicon, skins, scripts, opt-in `transitions: true` view-transition CSS + speculationrules), `enhanceImages` (compile-time `<img>` hardening), `compileDocument`, and `compileFile` (frontmatter + colocated assets; `.md` renders via markdown-it directly, `.wd` goes to `compileBody`).

Flow: `compilePage` → `compileDocument` → `compileFile` → `compileBody` → directive handlers + prose. Block handlers recurse into nested bodies via `ctx.compileBody` (and `@include` compiles its target via `ctx.compileFile`), both threaded into the `Ctx` by `compileFile` — so the module graph is an import-cycle-free DAG; don't import `body.js`/`page.js` from a handler module. Interpolation `{ name.path }` resolves in priority order: reactive loop item → static scope (include args, loop vars) → declared state (section scope chain, qualified keys like `cart:items`) → literal text. Reactive output = data attributes (`data-wd-bind`, `data-wd-loop`, `data-wd-if`, `data-wd-form`, `data-wd-fetch`, `data-wd-computed`) consumed by `src/runtime.js`.

Runtime render order matters. `renderNow` repeats a settle pass (hard cap 3) of **scan (register directives new to the tree) → computed → if-regions (skip when branch unchanged) → reactive classes → keyed loop reconcile**, then runs once: **text/input binds → theme → effects → subscribers**. The repeat is load-bearing: the if/class passes are document-wide queries, so a row the reconcile cloned in the same pass was not in the tree when they ran and would keep the compile-time branch/class baked into its template; symmetrically, an `:if` branch that was just injected can carry `:fetch`/`:effect`/`:every` nodes no query had seen (`querySelectorAll` does not descend into `<template>` content). Either marks the pass dirty and buys one more pass. The per-row `:if` records its painted branch in `data-wd-if-active` on the `[data-wd-each-if]` span (same name as the global marker). `loopKeyOf` exists in both compiler and runtime; `tests/loopkey-parity.test.js` keeps them identical.

Styling: `src/skin.js`'s `compileSkin` turns an indentation-structural `.skin` into CSS (pure string→string; it knows nothing of paths). **Scoped styles** are opt-in and pure compile-time: a `.skin` whose first line is `scoped` compiles with `compileSkin(src, { scope })`, which appends `[data-wd-scope="<id>"]` to each selector's *subject* (after `&`-nesting, before any pseudo) while leaving `tokens`/`:root` GLOBAL; the matching id is stamped onto the subtree's HTML by `stampScope` (page body for a page skin, the include's subtree in `handleInclude` for an include skin). The id is a hash of the skin's project-relative path, computed in `builder.js` (the coordination point) and re-derived identically by the stamp. No runtime, no `data-wd-*` marker — a scoped static page stays static.

## Invariants — do not break

- `.md` never gets directive behavior. The extension is the feature gate.
- One loop (`@loop … into … @endloop`), one interpolation syntax (`{ name }`). Never add alternates.
- Directive actions and `:computed`/`@loop … where` expressions are compile-time-validated whitelists. No eval of raw user content: the validated expression is compiled to a compact serialized AST (`src/compiler/expr-ast.js`) and **interpreted by a closed evaluator** in `src/runtime.js` — **no `new Function`, no eval**, so reactive pages run under a strict CSP with **no `'unsafe-eval'`**. The interpreter's op vocabulary is closed (readers `L`/`S`/`I`/`C`/`A`, unary `!`/`u-`, and the fixed arithmetic/comparison/logical operators); an unknown op tag is a hard error, never a fallthrough. `constructor`/`prototype`/`__proto__` path segments are rejected in compiler AND runtime (`getPath`).
- Includes resolve only inside `site/pages` and `site/_` (traversal + cycle checks in `resolveInclude`/`compileFile`).
- Scoping is opt-in via the `scoped` first line and pure compile-time. Never scope the token/`:root` path; never touch `src/runtime.js` for it. A non-`scoped` `.skin` must stay byte-identical (golden-tested against `base.skin`).
- Static pages must emit `runtime: false` in `dist/routes.json`. Adding a feature that flips static pages reactive is a regression.
- Compile errors include file path + corrective suggestion ("Use: @loop …").

## Workflow

- `npm test` — node --test, all suites must pass
- `npm run dev` — demo site on :5173 with SSE reload and an error overlay; **rebuilds run in a child process** so framework src changes always load fresh (don't "optimize" this back to in-process)
- How dev rebuilds work: every dev build writes a per-route dependency map (`dist/.wd-dev-deps.json` — page file, resolved includes, colocated `.skin`/`.js`, `@loop` JSON data, collections looped). A `site/` change spawns `build --drafts --dep-map --changed <path>` and `buildSite` rebuilds only the routes whose dep graph contains the file (a collection member fans out to the collection's listing/paginated consumers); `routes.json`/`_headers`/sitemap/rss re-emit globally each time. ANY uncertainty (new/deleted/renamed file, unmapped file, feed-link change, missing/stale map) or a `src/` change ⇒ full rebuild — never trade a stale page for speed.
- Every new feature: test in `tests/`, live demo under `site/pages/`, docs in `README.md` + `site/pages/docs/index.wd`, entry in `docs/spec-alignment.md`
- Version bumps: `package.json` only — CLI version and scaffold pin read it dynamically

## Naming

The framework is **Darkmown** (markdown with the first letters of mark/down swapped). The file format stays `.wd` ("whateverdown") and internal asset paths stay `/__wd/`. Don't rename format internals when touching brand copy.
