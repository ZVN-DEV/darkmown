# Darkmown

**[darkmown.com](https://darkmown.com)** · markdown, rearranged.

Darkmown is a Markdown-native web framework. Two formats, one rule: `.md` stays plain CommonMark forever, and renaming a file to `.wd` ("whateverdown") is what unlocks directives — includes, loops, state, conditionals, and sections. Static pages ship **zero** framework JavaScript; reactive pages share one runtime around 2 KB gzipped (CI-enforced under 5 KB).

## Quick start

```sh
npx @zvndev/darkmown init my-site
cd my-site
npm install
npm run dev
```

Or add it to an existing project:

```sh
npm install -D @zvndev/darkmown
npx darkmown dev
```

The package is `@zvndev/darkmown`; the command it installs is plain `darkmown`.

## Working from this repo

```sh
npm install
npm test
npm run dev    # live demo site — the same site that runs darkmown.com
```

## Commands

- `darkmown init [dir]` scaffolds a new site.
- `darkmown dev` starts the live compiler with browser reload and an in-browser error overlay when a build fails.
- `darkmown build` writes static output to `dist`.
- `darkmown serve` previews the built `dist` locally.
- `darkmown help` prints CLI usage.

## Authoring model

- `site/pages` is the route tree. `.md` and `.wd` files become pages.
- `.md` is strict CommonMark (real parser: ordered lists, tables, blockquotes, images, the lot). Directives stay plain text, and the build hints when it spots `.wd` syntax in a `.md` file.
- Files or folders starting with `.`, `-`, or `_` are hidden from routing.
- `site/_` is the include shelf for `@include /name.wd`.
- Matching `page.skin` and `page.js` colocate styling and behavior by basename.
- Static pages ship zero Darkmown runtime. Reactive pages share `/__wd/runtime.js` (currently ~2 KB gzipped, CI-enforced under 5 KB).
- Shelf `.json` files are published at `/__wd/data/` so `:fetch` works on any static host.

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

## Data, forms, and persistence

```wd
:fetch team from "/__wd/data/team.json"

:if team
@loop team into member
- { member.name }
@endloop
:else
Loading…
:endif

:form into profile
:input name placeholder="Your name" required
:submit "Save"
:endform

:state cart = [] persist
```

- `:fetch name from "url"` declares state and fills it from JSON over the network; `name_error` carries failures. Add `when=visible` to defer the request until the spot scrolls into view.
- `:computed total = items.length * 4` derives state from state with a compile-time-checked expression (names, numbers, arithmetic, comparisons — nothing else).
- `:form into name` captures submits straight into state (no backend). `:form action="/url"` emits a plain native form instead — zero JS, full progressive enhancement.
- `:form action="/url" into reply` does both: with JS the submit posts urlencoded via fetch and the JSON reply lands in state `reply` (`reply_error` on failure); without JS it is the same native POST. Darkmown adapts to any backend — it does not own one. `darkmown dev` ships a `/__wd/echo` endpoint for demos.
- `:state x = [] persist` keeps that state in localStorage across reloads.
- `:if item.path` works inside reactive loops for per-row branches, and nests — an inner `:if` resolves after the outer branch and stays reactive.

## The escape hatch

Reactive pages expose `window.wd` — `wd.get(key)`, `wd.set(key, value)`, `wd.state`, `wd.render()` — so colocated `.js` can do anything the directives can't. Section-scoped keys are addressed as `sectionId:name`.

## Spec status

See [docs/spec-alignment.md](docs/spec-alignment.md) for the deep alignment audit against the original vision.
