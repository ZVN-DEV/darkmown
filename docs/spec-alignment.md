# Spec alignment audit

This audit compares the current Darkmown implementation with the original MARROW/WhateverDown vision and the follow-up decisions made on 2026-06-11.

## Fundamentally aligned

- **Markdown-first authoring:** `.md` is strict CommonMark rendered by a real parser (markdown-it); `.wd` is the same Markdown plus first-party directives. Renaming the file is the upgrade path — extensions genuinely gate functionality.
- **Content tree over components:** routing, includes, and repeated fragments are file/document based instead of React-style components.
- **Tiered output:** static routes emit HTML/CSS and no Darkmown runtime; reactive routes opt into `/__wd/runtime.js` (~5.7 KB gzipped, CI-enforced below the 6 KB target).
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
- **Packaging:** v0.3.0 introduced package metadata and pack tests; the current public package is MIT licensed and scaffolded projects pin the live Darkmown version.

## Stage 6 additions (2026-06-13)

- **Nested `:if` over loop items (v0.5.0):** conditionals nest inside reactive `@loop`, per row. Both fill paths fixed — build-time balanced `matchElement` recursion and runtime `fillItem` recursion.
- **State-driven list filtering — `@loop … where <predicate>`:** the #1 need surfaced by the agent-eval benchmark. Conditions (`field <op> value`, plus `contains`) join with `and` / `or` over a compile-time-validated whitelist — item paths, declared `:state`, numbers, strings; `constructor`/`prototype`/`__proto__` rejected. Raw user content is never evaluated; the validated predicate compiles to the whitelisted grammar and runs via `new Function` at runtime. The source decides reactivity, matching the loop itself: an item-only predicate filters at build time and stays zero-JS; a predicate that reads `:state` compiles to a reactive filtered loop (rows baked in for static sources). This replaces the fragile DOM-toggle escape hatch with the keyed reconciler.
- **`:bind <state>`:** two-way `<input>` bound to a `:state` value — the input primitive that powers live search. Accepts `type=`, `placeholder=`, `autocomplete=`, `required`, `autofocus`.
- **Per-row actions in reactive loops:** a `:button` inside `@loop … into item` can act on its own row — `cart += item` appends a copy of the row to another `:state` list (the only way to carry a loop item into another list), and `list remove item` removes the row from the looped `:state` source (both names compile-checked against the enclosing loop). The runtime resolves the clicked row by stamping each reconciled node with its item, so removal is exact even under a `where` filter. This closes the last "store demo" gap noted in the design memory (per-row `:button` couldn't carry row data). (The `:if` string-equality gap noted here was fully closed in v0.14.0 — see Stage 10 — when `:if` gained the comparison grammar.)
- **`.skin` robustness:** `@media`/`@supports` at-rules wrap nested rules; the `font` shorthand passes through (size-led or containing `/`) while `font <stack>` still aliases to `font-family`; `/* … */` block comments and decorative divider lines are skipped.
- **Editor tooling:** VS Code extension (`editors/vscode`) ships `.wd` + `.skin` TextMate grammars, snippets, and folding, grammar-tested in CI.
- **`AGENTS.md`:** a model-facing build guide (shipped in the npm files array), tuned over a 5-round agent-eval benchmark that lifted build quality from 2.78→4.51/5.

## Stage 8 additions (2026-06-16)

Three capability gaps from the 2026-06-16 audit, closed together over a shared `setPath` and an expanded action handler.

- **Global state — `:store`:** `:store name = value [ephemeral]` declares page-global, durable-by-default state. Non-ephemeral stores persist to `localStorage["wd:store:<name>"]`, hydrate the declared value as a seed only when absent (first write wins thereafter), and sync across tabs via a single `storage` listener that re-renders on change. `ephemeral` opts out of persistence and cross-tab sync (in-memory for the session). Stores are never section-scoped; they share the runtime `state` object with `:state`, and a compile-time collision check keeps the two namespaces disjoint (declaring a `:store` and `:state` with one name, or a store twice, is a path-and-suggestion compile error). Reads (`{ cart }`, `:if`, `@loop`, `:computed`) and all actions resolve stores identically to state.
- **Full action vocabulary:** `:button … ->` now covers `inc`/`dec` (`n++`, `n--`), `add`/`sub` (`n += k`, `n -= k`), `set` (`name = v`), `toggle` (`flag toggle`), `append` (`list append v` / `list += v`), `prepend`, `member-toggle` (`list toggle v`), `remove-value` (`list remove v`), `clear`, `merge` (`obj merge <key|{…}>`), `delete` (`obj delete "key"`), and `reset` (restore the declared seed) — alongside the existing `append-row` (`cart += item`) and per-row `remove`. Targets are dotted-path aware (`cart.count++`) via a safe `setPath` mirroring `getPath` (proto-pollution guards in compiler and runtime). Buttons may carry a `;`-separated action sequence, applied in order with a single render. Operands are the compile-validated literal grammar (string / number / boolean / null / inline JSON; merge also accepts a bare state/store key). **Honest caveat:** `member-toggle` and `remove-value` compare by value with `===`/`includes`, so they are reliable for primitive members but not for object members (two equal-looking objects are distinct values) — remove row objects with the per-row `remove` action instead.
- **Fetch lifecycle:** `:fetch name from "url" [method=] [when=load|visible] [timeout=ms] [retry=N] [headers=key] [body=key] [refresh=url]` (`headers=`/`refresh=` detailed under Stage 9). Each fetch auto-declares four states — `name` (null), `name_loading` (false), `name_error` (null), `name_empty` (false, true for `null`/`[]`/`{}`) — enabling the recommended loading → error → empty → data pattern (with `@empty` absorbing the empty case for list fetches). URLs may interpolate `{ state }` and auto-refetch (≈150 ms debounce) when a dependency key changes, skipping while a required value is empty. A `refetch` action (`name refetch`) re-triggers a load on demand. Full HTTP via `method`/`headers`/`body`; `timeout` arms an AbortController; `retry` backs off on network error or 5xx before surfacing the error.
- **Loop ergonomics:** `@loop src into item [where …] [sort by key [asc|desc]] [reverse] [offset N] [limit N]`, clauses in that fixed order. `sort by` keys must start with the loop item (`item.path`); the comparator is numeric when both values are numbers, else `String(...).localeCompare`. `offset`/`limit` accept an integer **or** a `:state`/`:store` key for reactive pagination. Per-row meta vars — `$index` (0-based), `$number` (1-based), `$first`, `$last`, `$count` — are usable in interpolation and `:if`. An `@empty` branch renders when the post-pipeline row count is 0. **Honest caveat:** `sort by` over null/missing keys is best-effort — those values stringify (`"null"`/`"undefined"`) and fall into the lexicographic `localeCompare` path rather than getting special handling. Every clause stays build-time when the source and all arguments are static, preserving `runtime: false`.

## Stage 7 additions (2026-06-14)

- **Array frontmatter + readable `meta`:** `parseFrontmatter` now parses inline flow arrays (`tags: [a, b, "x, y"]` → real array; quoted items keep internal commas; a value without a leading `[` stays a scalar — block sequences are intentionally out of scope to keep the parser single-pass). A page's frontmatter is exposed to its body under `meta`, so `{ meta.title }` prints a field, `{ meta.tags }` renders an array joined with `, `, and `@loop meta.tags into tag` iterates a frontmatter array at build time (stays `runtime: false`). Genuine correctness fix on its own, and the groundwork for reading/emitting OKF-style bundles (Google Cloud's Open Knowledge Format — markdown + `type`-bearing frontmatter + cross-links; tracked but deliberately not coupled to its v0.1 Draft).

## Stage 10 additions (2026-06-18, v0.14.0)

- **Richer `:if` / `:else if` conditions:** a conditional now accepts the same compile-time-validated predicate grammar as `.class when` (its sibling through the shared `compileWhen`) — instead of a bare truthy path only. Operands are item paths, declared `:state`/`:store`, numbers, `"strings"`, `true`/`false`/`null`; comparisons `==` `!=` `<` `<=` `>` `>=` and `contains`; joined with `and` / `or` and negated with `not`. A bare path still reads as truthy (the fast path is unchanged). (`@loop … where` stays a comparison-only subset — each condition needs an operator; it has no `not` or bare-truthy form. Unifying it is deferred, not done here.) Reactivity is decided exactly as before: a predicate over only static values folds the branch at build time (`runtime: false` preserved); one over `:state` emits a global `data-wd-if` region carrying `data-wd-if-expr`; one over a loop item emits a per-row `data-wd-each-if` with `data-wd-if-expr`. The expression compiles to the **same** whitelisted grammar over `I()`/`S()`/`C()` and runs via `new Function` through the shared `evalPredicate` runtime helper — no new eval surface, and `constructor`/`prototype`/`__proto__` segments stay rejected in compiler and runtime. `:else if` chains inherit this automatically (each desugared condition re-enters the same path). **Honest caveat:** there is no parenthesis grouping — `and`/`or` associate left-to-right with no precedence between them, so model intent explicitly (split into `:else if` branches or a `:computed` boolean when grouping matters).

## Stage 9 additions (2026-06-18, v0.13.0)

Four progressive-disclosure capabilities plus an assets and a security change. The reactive runtime grew to ~5.7 KB gzipped; the CI budget moved 5 KB → 6 KB (still un-minified).

- **`:else if` chains:** `:if … :else if … :else … :endif`, any number of `:else if`, optional trailing bare `:else` (a `:else if` after the bare `:else` is a compile error). Implemented by **desugaring** the chain tail into a nested `:if` inside the falsy branch, which re-enters the existing compile path — so static, reactive, and per-row (loop) conditionals all behave identically with no runtime change. (v0.13.0 accepted only a bare truthy path per condition; Stage 10 / v0.14.0 lifted that to the full predicate grammar.)
- **Reactive classes — `::: … .class when <predicate>`:** a container class toggled by a predicate using the `@loop … where` / `:if` whitelist (item fields, `:state`/`:store`, numbers, strings, `==`/`!=`/`>`/`<`/`>=`/`<=`/`contains`, `and`/`or`, plus a bare truthy path). A fully-static predicate folds to a plain class at build time (`runtime: false` preserved); a predicate over `:state` emits a global `data-wd-class`; a loop-item predicate emits `data-wd-each-class` evaluated per row. The predicate compiles to the same whitelisted grammar over `I()`/`S()`/`C()` and runs via `new Function`.
- **Authenticated fetch + token refresh — `:fetch … headers= refresh=`:** `headers=<stateKey>` (existing) spreads a state object into request headers. New `refresh="<url>"`: on HTTP 401 the runtime POSTs the current headers to the refresh URL, writes the returned headers object back into the `headers` state (persisting if it is a `:store`), and retries the original request once; concurrent 401s sharing a refresh URL collapse to a single in-flight refresh. **Honest caveat:** this is bearer-token-style renewal only — no OAuth authorization-code flow, no refresh-token rotation beyond what the endpoint returns; `refresh=` requires `headers=`.
- **Effects — `:effect <watched> -> <actions>`:** run the `:button` action vocabulary (`;`-chained) whenever a watched state path changes. Emits a zero-output `data-wd-effect` marker; the runtime snapshots each watched value and, after a render against settled state, runs the actions on change, re-rendering and re-checking up to a 10-pass settle cap (a non-settling effect warns and stops). **Honest caveat:** effects do not fire on initial load (only on change), and row-scoped actions (`append-row`/`remove`) have no clicked row in an effect, so they no-op.
- **Page-colocated static assets:** any non-page file under `site/pages/` (anything but `.md`/`.wd` routes and colocated `.skin`/`.js`) is copied to `dist/` at its path (`site/pages/logo.svg` → `dist/logo.svg`). The shelf (`site/_/` → `/__wd/media`, `/__wd/data`) is unchanged; a name clash with an emitted route is skipped with a warning. `.avif` was added to the served content-types.
- **`:fetch` URL scheme hardening (security):** `:fetch`/`refresh=` URLs are validated at compile time — relative, `http(s)://`, or a leading `{ state }` interpolation are allowed; protocol-relative `//host` and non-http(s) schemes (`file:`, `data:`, `javascript:`, …) are rejected with a corrective hint. **This is scheme validation, not a host allowlist** — SSRF to arbitrary http(s) hosts remains the author's responsibility (see the trust boundary).

## Demo-only directives (not part of the public surface)

The compiler recognizes three directives — `:note`, `:try`, and `:sprint` — that exist **only to power the demo site** (darkmown.com). They are **not** part of the supported public directive set, are not documented for authors, and may change or be removed without notice. Do not build pages that depend on them. The supported public directives are the ones catalogued above: `:state`, `:store`, `:computed`, `:effect`, `:button`, `:bind`, `:if`/`:else if`/`:else`/`:endif`, `:fetch` (with `headers`/`refresh`), `:form`/`:input`/`:submit`, `@loop`/`@empty`/`@endloop` (with `where`, `sort by`, `reverse`, `offset`, `limit`), `@include`, and `::: section` (with reactive `.class when`).

## Still missing from the full vision

- First-party server runtime (`site/api/`), HTML-fragment `swap` semantics, and cart server sync — parked behind the adapter decision until a real project needs them.
- **View transitions:** re-enabling `transitions: true` with proper activation fallbacks (disabled today — see Stage 4), plus `@starting-style` emission and browser fallbacks for older engines.
- Richer diagnostics and package-consumer QA in regular CI. Editor tooling exists as a source-installable VS Code extension; public Marketplace/Open VSX distribution remains a launch/distribution follow-up.

## Current claim

Darkmown is faithful to the core thesis: Markdown remains the authoring center, static pages ship zero framework JavaScript, and reactive behavior compiles into tiny direct-DOM islands only where declared. The extension is the feature gate, the loop is one concept with progressive disclosure, and state scopes to document structure.

The public npm package is published as `@zvndev/darkmown`, the project is MIT licensed, and the remaining gaps are explicitly scoped as post-launch product/distribution work rather than missing v0.9 claims.
