# Changelog

All notable changes to Darkmown are documented here. Versions follow [semver](https://semver.org); pre-1.0 minor versions may contain breaking changes.

## 0.11.2 — 2026-06-17

Product trust and release-hardening sprint.

- **Public demos fixed.** `/app/` now renders feature bullets from the current data shape, and deploy/form copy clearly distinguishes static hosting from server-backed demo endpoints.
- **Preview servers safer by default.** `darkmown dev` and `darkmown serve` bind to `127.0.0.1` unless `HOST` is set, and malformed preview URLs no longer crash the server.
- **Directive hardening.** Demo `:try` links reject dangerous URL schemes; `:input` and `:bind` now carry escaped accessibility attributes.
- **Release gates tightened.** Tag releases verify Node 20/22/24 before publishing, keep the runtime-size budget enforced, and prepublish checks cover typecheck, coverage, build, size, audit, and consumer smoke.
- **Runtime guidance synced.** Packaged guidance and public copy now describe the measured ~4.7 KB gzipped runtime with the under-5 KB CI budget.

## 0.11.1 — 2026-06-17

Maintenance release. No functional changes since 0.11.0.

- **Fully comment-free shipped runtime.** The last two inline comments in `src/runtime.js` are converted to a strippable form, so the emitted `runtime.js` now contains zero comments (the source stays fully documented). The reactive runtime is ~4.7 KB gzipped.

## 0.11.0 — 2026-06-16

Three big `.wd` capabilities for building real apps — global state, a full fetch lifecycle, and complete loop ergonomics — plus a leaner runtime.

- **Global state — `:store`.** `:store cart = []` is durable by default (localStorage), synced across browser tabs in real time, and global by name; opt out of persistence with `ephemeral`. Button actions gained a full vocabulary — `toggle`, `prepend`, `merge`, `delete`, `clear`, `member-toggle`, `remove`/`remove-value`, and `reset` (back to the declared seed) — all working on `:state` and `:store`, with dotted-path targets (`cart.count++`) and `;`-separated multi-action buttons.
- **Fetch lifecycle.** `:fetch` now exposes `name_loading` and `name_empty` alongside `name_error`, so loading → error → empty → data renders with plain `:if`. URLs interpolate state (`/api/users/{ id }`) and auto-refetch when their inputs change; new `timeout`, `retry`, `method`, `headers`, and `body` options; a `refetch` action; and `@loop` now reads a dotted sub-path of fetched data (`@loop data.items into x`).
- **Loop ergonomics.** `@loop … sort by key [asc|desc] reverse offset N limit N` (offset/limit accept a `:state` key for reactive paging), per-row `$index` / `$number` / `$first` / `$last` / `$count`, and an `@empty` branch for zero rows. Static loops still resolve at build time and ship zero JS.
- **Leaner runtime.** The shipped runtime now strips whole-line `//` comments in addition to JSDoc (still no minification — identifiers, structure, and whitespace are preserved), so the source stays fully commented while the download shrinks. Even with all three features above, the reactive runtime is ~4.7 KB gzipped, comfortably under the 5 KB budget.
- **Security.** The prototype-pollution guard is now a single source of truth shared by the path reader and writer; dotted action targets and dynamic fetch URLs are guarded and URL-encoded.

## 0.10.0 — 2026-06-15

Launch-readiness: every public claim is now backed by runnable evidence instead of stale copy.

- **Provable docs.** README, `docs/cli.md`, `docs/spec-alignment.md`, and the gold-standard audit are re-synced to the shipped code — loop semantics, the build-time vs reactive split, and per-row `:button` actions (`cart += product` carries the row into another list; `cart remove line` drops it) are documented exactly as they compile. A docs-snippet test compiles the README/docs examples so the copy can't drift from the code again.
- **Consumer smoke script.** `npm run smoke` packs the tarball, installs it into a throwaway project, scaffolds, and builds it the way a real consumer would — the same supply-chain check the release workflow runs, now available locally.
- **CLI + scaffold polish.** `darkmown version` prints the installed package version; first-run scaffold output and CLI guidance now match the docs.
- **Editor + packaging scripts.** `npm run test:extension` and `npm run pack:extension` build and tokenize-test the VS Code grammar from the repo root; the extension ships its own `LICENSE` and a corrected README.
- **`homepage` now points at https://darkmown.com.**

## 0.9.0 — 2026-06-15

The "proof + full test pyramid" release: prove the moat on the homepage, test everything from unit to browser e2e, and pass a gold-standard open-source audit.

- **Landing: the vs-Markdoc proof.** The homepage is now a side-by-side comparison — the real `.wd` source for a live search-filter + add-to-cart store rendered working on the page, next to the equivalent Markdoc (which has no native loop and needs a React component + hydration for interactivity). The homepage is now itself a reactive `.wd` app; `/markdown/` and `/docs/` stay static (zero JS) to prove the static path.
- **Full test pyramid.** Unit + integration backfill (grammar whitelists, skin compiler, interpolation, router, every compile-error path), a zero-dependency CLI/pipeline e2e (`darkmown init` → build → serve → fetch → assert), real-browser e2e via Playwright (`npm run test:e2e`), and a seeded property/fuzz suite (5,000 cases/run) for the parser and expression validators. The zero-dep `npm test` suite grew from 98 to ~200 checks; coverage is ~96% lines, gated at 80% in CI.
- **The fuzzer earned its keep:** it found two real bugs, now fixed — two `:button` action errors that omitted the file path, and bare object interpolation (`{ meta }`) emitting `[object Object]` instead of an actionable error. Arrays now join with `, ` consistently.
- **Type safety.** Source stays plain JavaScript but is fully type-checked via JSDoc + `checkJs` (`npm run typecheck`, gated in CI), and ships `.d.ts` declarations. `typescript` is a dev-only dependency; the runtime stays zero-dependency.
- **Lean shipped runtime.** JSDoc is stripped from the runtime on emit, so the browser still stays under the shared runtime budget; the current runtime is ~4.7 KB gzipped even as the source carries full type annotations. The size budget now measures the shipped artifact.
- **Gold-standard hardening (46.5/50 audit).** Release pack-smoke test before publish, `prepublishOnly` guard, `dependabot` (npm + GitHub Actions), CI `concurrency` cancellation, `.github/` PR + issue templates, `CODEOWNERS`, a short `CODE_OF_CONDUCT.md`, an exposed/documented `window.wd.debug`, and repo-root tidy-up.

## 0.8.2 — 2026-06-14

Honesty, hardening, and polish pass — every claim in the docs is now backed by shipped code.

- **Security:** new per-page `html: false` frontmatter opt-out routes that page's Markdown through a strict renderer that escapes raw HTML — the mitigation for compiling untrusted/user-submitted content (default stays `html: true` for trusted authors). README and SECURITY.md now warn prominently that untrusted Markdown must be sanitized. `escapeHtml` also escapes single quotes.
- **Runtime:** state changes now batch into a single render per tick (`requestAnimationFrame`, falling back to a microtask), so rapid `:bind` input no longer re-runs the reconciler on every keystroke; the final state always renders and the public `wd.render()` stays synchronous. Opt-in `window.wd.debug` surfaces warnings for failed `:computed` / `where` expressions that were previously silent.
- **Tests:** first runtime/DOM test suite — keyed loop reconcile (node reuse on add/remove/reorder), `getPath` prototype-pollution rejection, loop-key collisions, and render batching — loading the real runtime via `node:vm`, no new dependencies. Suite grew 83 → 98.
- **Compiler:** unterminated frontmatter now throws an actionable error with the file path instead of silently swallowing the page; empty `---`/`---` blocks parse cleanly.
- **Docs & claims:** view transitions are now correctly described as parked/disabled (they were advertised but hardcoded off); the "no eval" wording is corrected (`:computed` and `where` compile to a whitelisted grammar run via `new Function`, never raw user content); runtime size copy corrected across all surfaces; the current runtime is ~4.7 KB gzipped and CI-enforced under 5 KB; `:note`/`:try`/`:sprint` documented as demo-only; `docs/cli.md` scaffold output synced; VS Code install instructions corrected (build from source; Marketplace listing pending).
- **Site & tooling:** landing-page whitespace fixed (removed the forced `60vh` hero band); mobile nav no longer overflows; tagline locked to "Markdown that runs."; regenerated `package-lock.json` identity (`@zvndev/darkmown`).

## 0.8.1 — 2026-06-14

- Fix: a quoted array item that follows `, ` no longer keeps a leading space — `tags: [a, "b, c"]` parses to `["a", "b, c"]`, not `["a", " b, c"]`.

## 0.8.0 — 2026-06-14

- **Array frontmatter + readable `meta`.** Frontmatter now parses inline flow arrays — `tags: [sales, revenue, "q1, q2"]` becomes a real array (previously the literal string `"[sales, revenue]"`), with quoted items keeping their internal commas and bracket-free values staying plain scalars. Block sequences (`- item` lines) remain out of scope to keep the parser single-pass.
- A page's frontmatter is now in scope in its body as `meta`: `{ meta.title }` prints a field, `{ meta.tags }` renders an array joined with `, `, and `@loop meta.tags into tag` iterates a frontmatter array at build time (stays `runtime: false`, zero-JS).
- A correctness fix in its own right, and the groundwork for reading/emitting bundles in Google Cloud's Open Knowledge Format (markdown + `type`-bearing frontmatter + cross-links). OKF support, if pursued, will be a thin additive export — deliberately not coupled to its v0.1 Draft.

## 0.7.0 — 2026-06-13

- **Per-row actions in reactive loops.** A `:button` inside `@loop … into item` can now act on its own row — the canonical add-to-cart / remove-line / delete-todo pattern, with no hand-written JavaScript:
  - `cart += item` appends a **copy** of the current row to another `:state` list. This is the only way to carry a loop item into another list (literal action values still can't reference rows); the copy means adding the same source row twice yields two independent lines.
  - `<list> remove <item>` removes the current row from the list being looped. `<list>` must be that loop's own `:state` source and `<item>` the loop variable — both validated at compile time.
  The runtime resolves the clicked row by stamping each reconciled node with its item, so removal targets the exact row and stays correct even when the loop is filtered with `where` (index-based removal would not). Closes the last gap blocking a real store demo.
- Live demo: the reactive page's filtering section is now a full mini-shop — search products, add to cart, remove lines — all composing on one page.

## 0.6.0 — 2026-06-13

- **State-driven list filtering — `@loop … where <predicate>`.** Filter any loop with conditions that join via `and` / `or`. Operators: `==` `!=` `<` `<=` `>` `>=` and `contains` (case-insensitive substring). Operands are item paths, declared `:state`, numbers, or `"strings"` — a compile-time whitelist (no expressions, no `eval`; `constructor`/`prototype`/`__proto__` rejected in compiler and runtime). **The predicate decides reactivity:** an item-only predicate filters at build time and the page stays zero-JS; a predicate that reads `:state` compiles to a reactive filtered loop driven by the keyed reconciler (rows are baked in for static JSON sources). This replaces the fragile DOM-toggle escape hatch — the #1 gap surfaced by the agent-eval benchmark.
- **`:bind <state>`** — a two-way `<input>` bound to a `:state` value, the input primitive behind live search. Accepts `type=` (default `text`), `placeholder=`, `autocomplete=`, and the `required` / `autofocus` flags. The field reflects state changes back unless it is focused.
- **`.skin` robustness:** `/* … */` block comments and decorative divider lines (`----`, `* * *`) are skipped instead of mis-parsed as rules.
- Scaffold (`darkmown init`): ships a styled default nav (brand + links, hover states) and an `about.md` companion page so a fresh project looks finished and the nav links resolve.
- Live demo: the reactive page now includes a real "search in pure Markdown" section powered by `@loop … where` + `:bind`.

## 0.5.0 — 2026-06-12

- **Nested `:if` over loop items.** Conditionals inside a reactive `@loop` now nest — an inner `:if` resolves after the outer branch, per row, both at build time (balanced-region pre-render) and at runtime (recursive fill). Previously the compiler threw "not supported yet"; the loop-template fill no longer relies on a non-greedy regex that broke on nesting.
- **VS Code extension** (`editors/vscode`): syntax highlighting, snippets, and folding for `.wd` and `.skin` files. Grammars are tested through the real VS Code tokenizer (vscode-textmate) in CI.
- New `/app/` demo — a whole live app in one `.wd` file: static build-time loop, fetched data looped with nested conditionals, a persistent counter with a computed milestone, and a form that round-trips to a real server. It is the framework's elevator pitch as a single page.
- Site: landing page repositioned around the core wedge ("Markdown that runs" — full reactive websites in plain Markdown). `description`/Open Graph/Twitter meta tags now emit from frontmatter.

## 0.4.0 — 2026-06-11

- **Renamed**: the framework is now **Darkmown** (formerly Markie). Package `@zvndev/darkmown` (npm's typosquat guard reserves bare `darkmown` as too similar to `markdown`), CLI `darkmown`. The `.wd` format and `/__wd/` asset paths are unchanged.
- **License**: MIT. Repository is public.
- Gold-standard launch hardening: CI (Node 20/22/24 matrix, build check, runtime size budget, dependency audit), release automation on tag push, SECURITY.md, CONTRIBUTING.md, CLAUDE.md, this changelog.

## 0.3.0 — 2026-06-11

- `:form action="/url" into reply` — server round-trips against any backend: urlencoded fetch POST with the JSON reply landing in state; degrades to a plain native POST without JS.
- Dev error overlay: failed rebuilds render the compiler error in the browser and clear on the next good build.
- `darkmown serve` — preview the built `dist` locally.
- Dev-only `/__wd/echo` endpoint for round-trip demos.

## 0.2.0 — 2026-06-11

- `:fetch name from "url"` (+ `when=visible` lazy loading via IntersectionObserver).
- `:computed name = expr` — derived state with a compile-time-validated expression grammar.
- `:form into name`, `:input`, `:submit` — forms that write state with zero backend.
- `:state x = v persist` — localStorage-backed state.
- `:if item.path` inside reactive loops (per-row branches).
- `window.wd` escape hatch for colocated `.js`.
- `::: section` containers with scoped state; keyed loop reconciliation.
- View transitions via `transitions: true` frontmatter. **(Disabled since: cross-document `@view-transition` render-blocked deployed pages, hanging navigation. `transitions` is currently hardcoded off in `src/compiler.js`; reintroduction is tracked pending proper activation fallbacks.)**
- Real CommonMark parsing (markdown-it); strict `.md` (directives stay plain text).
- `@loop … into … @endloop` — the one loop, replacing `@repeat` and `:for`.
- Dev server rebuilds in a child process (always-fresh modules).

## 0.1.0 — 2026-06-11

- Initial prototype: folder router, dot/minus hidden pages, `site/_` include shelf, colocated `.skin`/`.js`, `@include`/`@repeat`, `:state`/`:button`/`:if`/`:for`, sub-1 KB runtime, live dev server.
