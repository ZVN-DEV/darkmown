# Markie

Markie is a Markdown-native web framework based on the original MARROW/WhateverDown vision.

Two formats, one rule: `.md` stays plain CommonMark forever, and renaming a file to `.wd` ("whateverdown") is what unlocks directives — includes, loops, state, conditionals, and sections.

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

- `site/pages` is the route tree. `.md` and `.wd` files become pages.
- `.md` is strict CommonMark (real parser: ordered lists, tables, blockquotes, images, the lot). Directives stay plain text, and the build hints when it spots `.wd` syntax in a `.md` file.
- Files or folders starting with `.`, `-`, or `_` are hidden from routing.
- `site/_` is the include shelf for `@include /name.wd`.
- Matching `page.skin` and `page.js` colocate styling and behavior by basename.
- Static pages ship zero Markie runtime. Reactive pages share `/__wd/runtime.js` (currently ~1.1 KB gzipped).

## Interpolation

One syntax everywhere: `{ name }` or `{ name.path }`.

- In-scope static values (include arguments, loop values) resolve at build time.
- Declared `:state` becomes a live binding.
- Anything else stays literal text — braces in prose never break a page or pull in the runtime.

## Loops

`@loop <things> into <thing>` is the only loop. The source decides the behavior:

```wd
@loop /features.json into card     <- JSON file: unrolled at build time
@include /feature-card.wd          <- includes inherit the loop value
@endloop

:state todos = [{"id": 1, "title": "Route pages"}]

@loop todos into todo              <- :state list: reactive, patched by key
- { todo.title }
@endloop
```

Loops nest, dotted paths reach into rows, and `@include ... with x={ row.field }` reassigns values Liquid-style.

## Sections

```wd
::: section #cart .dark
:state count = 0

Cart has { count } items.

:button "Add" -> count++
:::
```

State declared inside a section is scoped to it — two sections can both own a `count`. Bindings and actions resolve to the nearest scope.

## Reactive directives

```wd
:state count = 0

Count: { count }

:button "Increment" -> count++

:if count
Count has changed.
:else
Count is still zero.
:endif
```

Directive actions are intentionally narrow and compile-time checked. Arbitrary JavaScript belongs in colocated `.js` files.

## Spec status

See [docs/spec-alignment.md](docs/spec-alignment.md) for the deep alignment audit against the original vision.
