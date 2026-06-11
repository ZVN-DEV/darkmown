# Spec alignment audit

This audit compares the current Markie implementation with the original MARROW/WhateverDown vision and the follow-up decisions made on 2026-06-11.

## Fundamentally aligned

- **Markdown-first authoring:** `.md` is strict CommonMark rendered by a real parser (markdown-it); `.wd` is the same Markdown plus first-party directives. Renaming the file is the upgrade path — extensions genuinely gate functionality.
- **Content tree over components:** routing, includes, and repeated fragments are file/document based instead of React-style components.
- **Tiered output:** static routes emit HTML/CSS and no Markie runtime; reactive routes opt into `/__wd/runtime.js` (~1.1 KB gzipped, below the original 5 KB target).
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
- **`:if item.path` inside reactive loops:** per-row conditional branches, filled at compile time and re-filled by the keyed patcher.
- **`window.wd` escape hatch:** `get`/`set`/`state`/`render` exposed to colocated `.js` — the adapted form of the original `<script scope>` "infinite extension" idea, aligned with Markie's colocation model instead of inline scripts.

## Deliberate adaptations

- **One loop, `@loop … into … @endloop`:** replaces both the original doc's `:for/:endfor` and the earlier `@repeat`. The source decides behavior: JSON file or in-scope value unrolls at build time; a `:state` list compiles to a keyed reactive region. Includes inside a loop inherit the loop value (Liquid-style), and `with x={ row.field }` reassigns.
- **One interpolation syntax:** `{ name }` / `{ name.path }` everywhere. Static in-scope values resolve at build time, declared state binds live, and unknown names stay literal — braces in prose never pull in the runtime.
- **`.mdx` removed:** it was a label without semantics. The formats are `.md` (plain) and `.wd` (full surface).
- **Action safety:** directive actions use a narrow compile-time-checked grammar instead of arbitrary JavaScript. Actions must target declared state.
- **Name and extension:** MARROW/`.mw` became Markie/`.wd` per the follow-up direction.

## Stage 4 additions (2026-06-11, same day)

- **View transitions:** `transitions: true` in frontmatter emits `@view-transition { navigation: auto; }` — the original doc's zero-JS MPA navigation polish.
- **Lazy loading:** `:fetch … when=visible` defers the request until the marker scrolls into view (IntersectionObserver) — the adapted form of `:lazy`.
- **Computed state:** `:computed name = expr` with a compile-time-validated grammar (state refs, numbers, strings, arithmetic, comparisons; assignment, calls, and prototype walks rejected). Initial values are evaluated at build time.
- **Dev self-reload:** `markie dev` rebuilds in a child process, so changes to the framework's own `src/` always compile with fresh modules.
- **Packaging:** version 0.2.0 with repository metadata; `markie version` reads package.json.

## Stage 5 additions (2026-06-11, same day)

- **Adapter-style Tier 2 (decided):** Markie does not own a server. `:form action="/url" into reply` posts urlencoded via fetch and lands the JSON reply in state, degrading to a plain native POST without JS. Sessions ride on `:fetch` plus ordinary cookies against any backend. A first-party `site/api/` runtime stays open as a future option if a real project demands it.
- **Dev error overlay:** failed rebuilds render the compiler error in the browser; the overlay clears on the next good build.
- **`markie serve`:** local preview of the built `dist`, no dev client injected.
- **Packaging:** v0.3.0, license UNLICENSED pending a licensing decision, scaffold pins the live version, npm pack contents covered by tests.

## Still missing from the full vision

- First-party server runtime (`site/api/`), HTML-fragment `swap` semantics, and cart server sync — parked behind the adapter decision until a real project needs them.
- Nested `:if` over loop items, and `@loop` over fetch sub-paths.
- `@starting-style` emission and browser fallbacks for older engines.
- Editor tooling, richer diagnostics, and an actual npm publish (needs a license decision).

## Current claim

Markie is faithful to the core thesis: Markdown remains the authoring center, static pages ship zero framework JavaScript, and reactive behavior compiles into tiny direct-DOM islands only where declared. The extension is the feature gate, the loop is one concept with progressive disclosure, and state scopes to document structure.

It is not yet the full production framework described in the original document.
