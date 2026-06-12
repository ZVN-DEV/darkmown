# Changelog

All notable changes to Darkmown are documented here. Versions follow [semver](https://semver.org); pre-1.0 minor versions may contain breaking changes.

## 0.5.0 — 2026-06-12

- **Nested `:if` over loop items.** Conditionals inside a reactive `@loop` now nest — an inner `:if` resolves after the outer branch, per row, both at build time (balanced-region pre-render) and at runtime (recursive fill). Previously the compiler threw "not supported yet"; the loop-template fill no longer relies on a non-greedy regex that broke on nesting.
- **VS Code extension** (`editors/vscode`): syntax highlighting, snippets, and folding for `.wd` and `.skin` files. Grammars are tested through the real VS Code tokenizer (vscode-textmate) in CI.
- New `/app/` demo — a whole live app in one `.wd` file: static build-time loop, fetched data looped with nested conditionals, a persistent counter with a computed milestone, and a form that round-trips to a real server. It is the framework's elevator pitch as a single page.
- Site: landing page repositioned around the core wedge ("Markdown that runs" — full reactive websites in plain Markdown). `description`/Open Graph/Twitter meta tags now emit from frontmatter. Runtime-size claims corrected to the true ~2 KB; mobile nav wraps instead of overflowing.

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
- View transitions via `transitions: true` frontmatter.
- Real CommonMark parsing (markdown-it); strict `.md` (directives stay plain text).
- `@loop … into … @endloop` — the one loop, replacing `@repeat` and `:for`.
- Dev server rebuilds in a child process (always-fresh modules).

## 0.1.0 — 2026-06-11

- Initial prototype: folder router, dot/minus hidden pages, `site/_` include shelf, colocated `.skin`/`.js`, `@include`/`@repeat`, `:state`/`:button`/`:if`/`:for`, sub-1 KB runtime, live dev server.
