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

## Deliberate adaptations

- **One loop, `@loop … into … @endloop`:** replaces both the original doc's `:for/:endfor` and the earlier `@repeat`. The source decides behavior: JSON file or in-scope value unrolls at build time; a `:state` list compiles to a keyed reactive region. Includes inside a loop inherit the loop value (Liquid-style), and `with x={ row.field }` reassigns.
- **One interpolation syntax:** `{ name }` / `{ name.path }` everywhere. Static in-scope values resolve at build time, declared state binds live, and unknown names stay literal — braces in prose never pull in the runtime.
- **`.mdx` removed:** it was a label without semantics. The formats are `.md` (plain) and `.wd` (full surface).
- **Action safety:** directive actions use a narrow compile-time-checked grammar instead of arbitrary JavaScript. Actions must target declared state.
- **Name and extension:** MARROW/`.mw` became Markie/`.wd` per the follow-up direction.

## Still missing from the full vision

- `:fetch`, `:form`, `:session`, `:cart`, `:lazy`, and server-driven fragments (Tier 2).
- Scoped `<script scope>` and `@script` escape hatches.
- `:if` over reactive loop items, and computed/derived state.
- View transitions, `@starting-style` emission, and browser fallbacks.
- Editor tooling, diagnostics, and publish-ready package metadata.

## Current claim

Markie is faithful to the core thesis: Markdown remains the authoring center, static pages ship zero framework JavaScript, and reactive behavior compiles into tiny direct-DOM islands only where declared. The extension is the feature gate, the loop is one concept with progressive disclosure, and state scopes to document structure.

It is not yet the full production framework described in the original document.
