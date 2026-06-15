# Darkmown

**[darkmown.com](https://darkmown.com)** · Markdown that runs.

Darkmown is a Markdown-native web framework. Two formats, one rule: `.md` stays plain CommonMark forever, and renaming a file to `.wd` ("whateverdown") is what unlocks directives — includes, loops, state, conditionals, and sections. Static pages ship **zero** framework JavaScript; reactive pages share one runtime around ~2.9 KB gzipped (CI-enforced under 5 KB).

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
- Static pages ship zero Darkmown runtime. Reactive pages share `/__wd/runtime.js` (currently ~2.9 KB gzipped, CI-enforced under 5 KB).
- Shelf `.json` files are published at `/__wd/data/` so `:fetch` works on any static host.

## Interpolation

One syntax everywhere: `{ name }` or `{ name.path }`.

- In-scope static values (include arguments, loop values) resolve at build time.
- Declared `:state` becomes a live binding.
- The page's own frontmatter is in scope as `meta` — `{ meta.title }` prints a field.
- Anything else stays literal text — braces in prose never break a page or pull in the runtime.

## Frontmatter

YAML-style `key: value` frontmatter between `---` fences. Values are strings, plus inline arrays:

```wd
---
title: Customers
tags: [sales, revenue, "q1, q2"]
---
```

- `{ meta.title }` prints a scalar; `{ meta.tags }` prints an array joined with `, `.
- `@loop meta.tags into tag` iterates an array field at build time (stays static, zero-JS).
- Arrays are inline flow only (`[a, b]`); quoted items keep internal commas (`"q1, q2"`). A value without a leading `[` stays a plain string.

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

### Filtering — `@loop … where`

Add `where <predicate>` to filter a loop. Conditions compare a loop-item field against a number, a string, or another value, and join with `and` / `or`:

```wd
@loop /products.json into p where p.featured == true and p.price < 80
- { p.name }
@endloop
```

Operators: `==` `!=` `<` `<=` `>` `>=`, plus `contains` for case-insensitive substring match. The predicate is a compile-time-validated whitelist — only item paths, declared `:state`, numbers, and `"strings"` are allowed (no arbitrary expressions). Raw user content is never evaluated; the validated predicate compiles to a whitelisted grammar that runs via `new Function`.

**The source decides reactivity, just like the loop itself.** If the predicate only reads the row, the filter runs at build time and the page stays **zero-JS**. If the predicate reads a `:state` value, the loop becomes reactive and re-filters live as that state changes — a live search in pure Markdown:

```wd
:state products = [{"id":1,"name":"Aurora Lamp"},{"id":2,"name":"Briza Fan"}]
:state q = ""

:bind q placeholder="Search"

@loop products into p where p.name contains q
- { p.name }
@endloop
```

`:bind <state>` renders an `<input>` wired two-way to a `:state` value — typing updates the state, and the state reflects back into the field. It accepts `type=` (default `text`), `placeholder=`, `autocomplete=`, and the `required` / `autofocus` flags.

### Editable lists — per-row actions

A `:button` inside a reactive `@loop` can act on its own row. Two row actions exist:

```wd
:state products = [{"id": 1, "name": "Aurora", "price": 49}]
:state cart = []

@loop products into product
::: card
**{ product.name }** — ${ product.price }
:button "Add to cart" -> cart += product    <- carry this row into another list
:::
@endloop

@loop cart into line
::: card
{ line.name }
:button "Remove" -> cart remove line          <- drop this row from the looped list
:::
@endloop
```

- `cart += <item>` appends a **copy** of the current row to another `:state` list, so adding the same product twice gives two independent lines.
- `<list> remove <item>` removes the current row from the list being looped. The `<list>` must be that loop's own `:state` source and `<item>` must be the loop variable — both checked at compile time. Removal targets the exact row, so it stays correct even when the loop is filtered with `where`.

That is a full add-to-cart / remove-line flow — and a to-do list with delete — in plain Markdown, no JavaScript.

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

## Editor support

A VS Code extension in [`editors/vscode`](editors/vscode) gives `.wd` and `.skin` files syntax highlighting, snippets, and folding — so a `.wd` file reads as Markdown-plus-directives, never as broken Markdown. Install it from source by building a `.vsix`: `cd editors/vscode && npx @vscode/vsce package`, then `code --install-extension darkmown-*.vsix`. A Marketplace listing is coming soon.

## Security

Darkmown renders Markdown with `html: true`, so **raw HTML in your content passes through verbatim** — by design, like every Markdown site generator. Treat content files as trusted input.

> **The single biggest footgun:** do not compile untrusted or user-submitted Markdown without sanitizing it first. There is no built-in sanitizer.

Directive actions and `:computed`/`@loop … where` expressions are never `eval`'d as raw user content — they compile to a whitelisted grammar (item paths, declared `:state`, numbers, strings) that runs via `new Function`. See [SECURITY.md](SECURITY.md) for the full security model.

## Spec status

See [docs/spec-alignment.md](docs/spec-alignment.md) for the deep alignment audit against the original vision.
