# Spec alignment audit

This audit compares the current Darkmown implementation with the original MARROW/WhateverDown vision and the follow-up decisions made on 2026-06-11.

## Fundamentally aligned

- **Markdown-first authoring:** `.md` is strict CommonMark rendered by a real parser (markdown-it); `.wd` is the same Markdown plus first-party directives. Renaming the file is the upgrade path — extensions genuinely gate functionality.
- **Content tree over components:** routing, includes, and repeated fragments are file/document based instead of React-style components.
- **Tiered output:** static routes emit HTML/CSS and no Darkmown runtime; reactive routes opt into `/__wd/runtime.js` (~3.1 KB gzipped, CI-enforced below the 5 KB target).
- **No virtual DOM:** state changes patch direct DOM bindings, conditional regions, and keyed loop regions.
- **Keyed list patching:** reactive loops reconcile by item key (`id`/`key`/value) instead of re-rendering the region.
- **Sections with scoped state:** `::: section #id .class` containers scope `:state`; bindings and actions resolve through the nearest scope chain.
- **`.skin` language:** indentation-based token styling compiles to CSS.
- **Folder router:** `site/pages` maps to routes, and `.`, `-`, `_` prefixes hide pages.
- **Colocation:** matching `.skin` and `.js` files attach to the page by basename, for includes too.
- **Live DX:** dev mode live-compiles and reloads through a small SSE client.

## Stage 3 additions (2026-06-11, same day)

- **`:fetch name from "url"`:** declarative data loading into reactive state, with `name_error` for failures. Shelf `.json` publishes to `/__wd/data/` so it works on static hosts.
- **`:form` two ways:** `:form into name` captures submits into client state with zero backend; `:form action="/url"` emits a plain native form and ships no JS — the progressive-enhancement story from the original doc.
- **`:state x = v persist`:** localStorage-backed state. This is the honest client-side slice of the original `:cart` primitive; server sync remains future work.
- **`:if item.path` inside reactive loops:** per-row conditional branches, filled at compile time and re-filled by the keyed patcher. Conditionals **nest** — an inner `:if` is resolved after the outer branch, both at build time (balanced-region pre-render) and at runtime (recursive fill).
- **`window.wd` escape hatch:** `get`/`set`/`state`/`render` exposed to colocated `.js` — the adapted form of the original `<script scope>` "infinite extension" idea, aligned with Darkmown's colocation model instead of inline scripts.

## Deliberate adaptations

- **One loop, `@loop … into … @endloop`:** replaces both the original doc's `:for/:endfor` and the earlier `@repeat`. The source decides behavior: JSON file or in-scope value unrolls at build time; a `:state` list compiles to a keyed reactive region. Includes inside a loop inherit the loop value (Liquid-style), and `with x={ row.field }` reassigns.
- **One interpolation syntax:** `{ name }` / `{ name.path }` everywhere. Static in-scope values resolve at build time, declared state binds live, and unknown names stay literal — braces in prose never pull in the runtime.
- **`.mdx` removed:** it was a label without semantics. The formats are `.md` (plain) and `.wd` (full surface).
- **Action safety:** directive actions use a narrow compile-time-checked grammar instead of arbitrary JavaScript. Actions must target declared state.
- **Name and extension:** MARROW/`.mw` became Darkmown/`.wd` per the follow-up direction.

## Stage 4 additions (2026-06-11, same day)

- **View transitions (currently disabled):** `transitions: true` in frontmatter was wired to emit `@view-transition { navigation: auto; }` — the original doc's zero-JS MPA navigation polish. **This is turned off as of now:** cross-document `@view-transition` render-blocked deployed pages (stalled rAF, hanging navigation), so `transitions` is hardcoded to `""` in `src/compiler.js`. The frontmatter key is accepted but has no effect today. Reintroduction is tracked pending proper activation fallbacks (see "Still missing from the full vision").
- **Lazy loading:** `:fetch … when=visible` defers the request until the marker scrolls into view (IntersectionObserver) — the adapted form of `:lazy`.
- **Computed state:** `:computed name = expr` with a compile-time-validated grammar (state refs, numbers, strings, arithmetic, comparisons; assignment, calls, and prototype walks rejected). Initial values are evaluated at build time.
- **Dev self-reload:** `darkmown dev` rebuilds in a child process, so changes to the framework's own `src/` always compile with fresh modules.
- **Packaging:** version 0.2.0 with repository metadata; `darkmown version` reads package.json.

## Stage 5 additions (2026-06-11, same day)

- **Adapter-style Tier 2 (decided):** Darkmown does not own a server. `:form action="/url" into reply` posts urlencoded via fetch and lands the JSON reply in state, degrading to a plain native POST without JS. Sessions ride on `:fetch` plus ordinary cookies against any backend. A first-party `site/api/` runtime stays open as a future option if a real project demands it.
- **Dev error overlay:** failed rebuilds render the compiler error in the browser; the overlay clears on the next good build.
- **`darkmown serve`:** local preview of the built `dist`, no dev client injected.
- **Packaging:** v0.3.0, license UNLICENSED pending a licensing decision, scaffold pins the live version, npm pack contents covered by tests.

## Stage 6 additions (2026-06-13)

- **Nested `:if` over loop items (v0.5.0):** conditionals nest inside reactive `@loop`, per row. Both fill paths fixed — build-time balanced `matchElement` recursion and runtime `fillItem` recursion.
- **State-driven list filtering — `@loop … where <predicate>`:** the #1 need surfaced by the agent-eval benchmark. Conditions (`field <op> value`, plus `contains`) join with `and` / `or` over a compile-time-validated whitelist — item paths, declared `:state`, numbers, strings; `constructor`/`prototype`/`__proto__` rejected. Raw user content is never evaluated; the validated predicate compiles to the whitelisted grammar and runs via `new Function` at runtime. The source decides reactivity, matching the loop itself: an item-only predicate filters at build time and stays zero-JS; a predicate that reads `:state` compiles to a reactive filtered loop (rows baked in for static sources). This replaces the fragile DOM-toggle escape hatch with the keyed reconciler.
- **`:bind <state>`:** two-way `<input>` bound to a `:state` value — the input primitive that powers live search. Accepts `type=`, `placeholder=`, `autocomplete=`, `required`, `autofocus`.
- **Per-row actions in reactive loops:** a `:button` inside `@loop … into item` can act on its own row — `cart += item` appends a copy of the row to another `:state` list (the only way to carry a loop item into another list), and `list remove item` removes the row from the looped `:state` source (both names compile-checked against the enclosing loop). The runtime resolves the clicked row by stamping each reconciled node with its item, so removal is exact even under a `where` filter. This closes the last "store demo" gap noted in the design memory (per-row `:button` couldn't carry row data); `:if` string-equality remains the only listed gap, now partly covered by `@loop … where`.
- **`.skin` robustness:** `@media`/`@supports` at-rules wrap nested rules; the `font` shorthand passes through (size-led or containing `/`) while `font <stack>` still aliases to `font-family`; `/* … */` block comments and decorative divider lines are skipped.
- **Editor tooling:** VS Code extension (`editors/vscode`) ships `.wd` + `.skin` TextMate grammars, snippets, and folding, grammar-tested in CI.
- **`AGENTS.md`:** a model-facing build guide (shipped in the npm files array), tuned over a 5-round agent-eval benchmark that lifted build quality from 2.78→4.51/5.

## Stage 7 additions (2026-06-14)

- **Array frontmatter + readable `meta`:** `parseFrontmatter` now parses inline flow arrays (`tags: [a, b, "x, y"]` → real array; quoted items keep internal commas; a value without a leading `[` stays a scalar — block sequences are intentionally out of scope to keep the parser single-pass). A page's frontmatter is exposed to its body under `meta`, so `{ meta.title }` prints a field, `{ meta.tags }` renders an array joined with `, `, and `@loop meta.tags into tag` iterates a frontmatter array at build time (stays `runtime: false`). Genuine correctness fix on its own, and the groundwork for reading/emitting OKF-style bundles (Google Cloud's Open Knowledge Format — markdown + `type`-bearing frontmatter + cross-links; tracked but deliberately not coupled to its v0.1 Draft).

## Demo-only directives (not part of the public surface)

The compiler recognizes three directives — `:note`, `:try`, and `:sprint` — that exist **only to power the demo site** (darkmown.com). They are **not** part of the supported public directive set, are not documented for authors, and may change or be removed without notice. Do not build pages that depend on them. The supported public directives are the ones catalogued above: `:state`, `:computed`, `:button`, `:bind`, `:if`/`:else`/`:endif`, `:fetch`, `:form`/`:input`/`:submit`, `@loop`/`@endloop` (with `where`), `@include`, and `::: section`.

## Still missing from the full vision

- First-party server runtime (`site/api/`), HTML-fragment `swap` semantics, and cart server sync — parked behind the adapter decision until a real project needs them.
- `@loop` over fetch sub-paths (looping a path *inside* fetched state rather than top-level state).
- **View transitions:** re-enabling `transitions: true` with proper activation fallbacks (disabled today — see Stage 4), plus `@starting-style` emission and browser fallbacks for older engines.
- Editor tooling, richer diagnostics, and an actual npm publish (needs a license decision).

## Current claim

Darkmown is faithful to the core thesis: Markdown remains the authoring center, static pages ship zero framework JavaScript, and reactive behavior compiles into tiny direct-DOM islands only where declared. The extension is the feature gate, the loop is one concept with progressive disclosure, and state scopes to document structure.

It is not yet the full production framework described in the original document.
