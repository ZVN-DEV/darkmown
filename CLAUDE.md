# Darkmown — AI contributor guide

Darkmown is a markdown-native web framework: `.md` files are strict CommonMark, `.wd` files add first-party directives (loops, state, includes, sections, fetch, forms). Static pages ship **zero** framework JavaScript; reactive pages share one runtime (currently ~3.2 KB gzipped) that must stay **under 5 KB gzipped** (CI-enforced).

## Architecture in one pass

Compile pipeline (`src/compiler.js`):
1. `compilePage` → HTML shell (title, favicon, skins, scripts). Note: view transitions are currently disabled — `transitions` is hardcoded to `""` in `src/compiler.js` pending proper activation fallbacks.
2. `compileFile` → frontmatter + colocated assets; `.md` renders via markdown-it directly; `.wd` goes to `compileBody`
3. `compileBody` → line-based directive parser; prose segments render through markdown-it with the `wd_binding` inline plugin
4. Interpolation `{ name.path }` resolves in priority order: reactive loop item → static scope (include args, loop vars) → declared state (section scope chain, qualified keys like `cart:items`) → literal text
5. Reactive output = data attributes (`data-wd-bind`, `data-wd-loop`, `data-wd-if`, `data-wd-form`, `data-wd-fetch`, `data-wd-computed`) consumed by `src/runtime.js`

Runtime render order matters: computed → if-regions (skip when branch unchanged) → keyed loop reconcile → text binds.

## Invariants — do not break

- `.md` never gets directive behavior. The extension is the feature gate.
- One loop (`@loop … into … @endloop`), one interpolation syntax (`{ name }`). Never add alternates.
- Directive actions and `:computed`/`@loop … where` expressions are compile-time-validated whitelists. No eval of raw user content, but validated expressions compile to a whitelisted grammar and run via `new Function` (`src/runtime.js`). `constructor`/`prototype`/`__proto__` path segments are rejected in compiler AND runtime (`getPath`).
- Includes resolve only inside `site/pages` and `site/_` (traversal + cycle checks in `resolveInclude`/`compileFile`).
- Static pages must emit `runtime: false` in `dist/routes.json`. Adding a feature that flips static pages reactive is a regression.
- Compile errors include file path + corrective suggestion ("Use: @loop …").

## Workflow

- `npm test` — node --test, all suites must pass
- `npm run dev` — demo site on :5173 with SSE reload and an error overlay; **rebuilds run in a child process** so framework src changes always load fresh (don't "optimize" this back to in-process)
- Every new feature: test in `tests/`, live demo under `site/pages/`, docs in `README.md` + `site/pages/docs/index.wd`, entry in `docs/spec-alignment.md`
- Version bumps: `package.json` only — CLI version and scaffold pin read it dynamically

## Naming

The framework is **Darkmown** (markdown with the first letters of mark/down swapped). The file format stays `.wd` ("whateverdown") and internal asset paths stay `/__wd/`. Don't rename format internals when touching brand copy.
