---
title: Markie docs
---

@include /nav.wd

<main>

# Docs

Markie is a Markdown-native framework for mostly-static sites with tiny reactive islands. This docs page is plain `.md`, but it includes `.wd` and `.mdx` fragments to prove the format bridge.

@include ./-relative-note.wd

@include /mdx-proof.mdx

## Install

From this repo:

```sh
npm install
npm link
markie help
```

Or use the local script surface:

```sh
npm run dev
npm run build
```

## Create a site

```sh
markie init my-site
cd my-site
npm install
npm run dev
```

## Routing rules

- `site/pages/index.wd` becomes `/`.
- `site/pages/docs/index.md` becomes `/docs/`.
- `.secret.wd`, `-draft.wd`, and hidden folders do not become pages.
- `site/_/` is the include shelf, never a route.
- `.md`, `.mdx`, and `.wd` can all be route files.

## Includes and colocation

- `@include /nav.wd` resolves from `site/_`.
- `@include ./-relative-note.wd` resolves beside the current page.
- `@repeat /feature-card.wd from /features.json` renders one static include per data row.
- A matching `.skin` file attaches CSS to the page.
- A matching `.js` file attaches page behavior.

## Reactive directives

Reactive pages opt into `/__wd/runtime.js`. Static pages do not.

```wd
:state count = 0

The count is { count }.

:button "Increment" -> count++

:if count
Count has changed.
:else
Count is still zero.
:endif

:state todos = ["Route pages"]

:for todo in todos
- { todo }
:endfor

:button "Add todo" -> todos += "Live compile"
```

## Spec status

The implementation is faithful to the original core thesis: Markdown-first authoring, no component ceremony, zero runtime on static pages, and tiny direct-DOM reactivity only when declared.

It is not yet the whole original vision. Section-scoped state, scoped scripts, `:fetch`, `:form`, `:session`, `:cart`, and server-driven fragments are still roadmap work. See `docs/spec-alignment.md` in the package for the full audit.

</main>
