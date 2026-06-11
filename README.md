# Markie

Markie is a Markdown-native web framework prototype based on the original MARROW/WhateverDown vision in `/Users/macbookpro-kirby/Downloads/markdown-framework-idea.md`.

It keeps plain `.md` useful, accepts `.mdx` as a compatibility door, and uses `.wd` for first-party directives such as includes, state, conditionals, and loops.

## Install the CLI

From this repo:

```sh
npm install
npm link
markie help
```

For local development without linking:

```sh
node src/cli.js help
npm run dev
```

## Create a site

```sh
markie init my-site
cd my-site
npm install
npm run dev
```

## Commands

- `markie init [dir]` scaffolds a new site.
- `markie dev` starts the live compiler with browser reload.
- `markie build` writes static output to `dist`.
- `markie help` prints CLI usage.

## Authoring model

- `site/pages` is the route tree.
- `.md`, `.mdx`, and `.wd` can be pages.
- Files or folders starting with `.`, `-`, or `_` are hidden from routing.
- `site/_` is the include shelf for `@include /name.wd`.
- Matching `page.skin` and `page.js` colocate styling and behavior.
- Static pages ship zero Markie runtime.
- Reactive pages use `/__wd/runtime.js`; it is currently under 1 KB gzipped.

## Current reactive directives

```wd
:state count = 0

Count: { count }

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

Directive actions are intentionally narrow and compile-time checked. Arbitrary JavaScript belongs in colocated `.js` today and future scoped script APIs later.

## Spec status

See [docs/spec-alignment.md](docs/spec-alignment.md) for the deep alignment audit against the original vision.
