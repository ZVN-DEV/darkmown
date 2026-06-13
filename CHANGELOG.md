# Changelog

All notable changes to Darkmown are documented here. Versions follow [semver](https://semver.org); pre-1.0 minor versions may contain breaking changes.

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
