# Spec alignment audit

This audit compares the current Markie implementation with the original MARROW/WhateverDown vision.

## Fundamentally aligned

- **Markdown-first authoring:** `.md` works, `.mdx` is accepted, and `.wd` adds first-party directives.
- **Content tree over components:** routing, includes, and repeated fragments are file/document based instead of React-style components.
- **Tiered output:** static routes emit HTML/CSS and no Markie runtime; reactive routes opt into `/__wd/runtime.js`.
- **Tiny runtime target:** the reactive runtime is currently under 1 KB gzipped, below the original 5 KB target.
- **No virtual DOM:** state changes patch direct DOM bindings, conditionals, and loop regions.
- **`.skin` language:** indentation-based token styling compiles to CSS.
- **Includes over component ceremony:** `@include` and `@repeat` compose files from `site/_`.
- **Folder router:** `site/pages` maps to routes, and `.`, `-`, `_` prefixes hide pages.
- **Colocation:** matching `.skin` and `.js` files attach to the page by basename.
- **Live DX:** dev mode live-compiles and reloads through a small SSE client.

## Deliberate adaptations

- **Name and extension:** the source document used MARROW and `.mw`; the user asked for `.wd` and referred to Markie. This repo exposes the CLI as `markie` and keeps `.wd` as the native directive format.
- **Action safety:** the vision sketches plain JavaScript actions. Markie currently uses a narrow safe grammar for directive actions to avoid turning Markdown into arbitrary script execution.
- **Looping model:** static `@repeat` handles compile-time repetition from data; reactive `:for` handles runtime lists. This is clearer than one overloaded loop concept.
- **Scope model:** current reactivity is page-level. Section-scoped cascading state remains a future milestone.

## Still missing from the full vision

- Full CommonMark compliance through a mature parser.
- Dotted bindings such as `{ product.name }`.
- Section containers with `::: section #id .class`.
- `:fetch`, `:form`, `:session`, `:cart`, `:lazy`, and server-driven fragments.
- Scoped `<script scope>` and `@script` escape hatches.
- Keyed list patching; current list updates rerender the loop region.
- Editor tooling, diagnostics, and publish-ready package metadata.
- Browser compatibility fallbacks for advanced platform features.

## Current claim

Markie is faithful to the core thesis: Markdown can remain the authoring center, static pages should ship zero framework JavaScript, and reactive behavior can be compiled into tiny direct-DOM islands only where declared.

It is not yet the full production framework described in the original document.
