# Darkmown

**[darkmown.com](https://darkmown.com)** · Markdown that runs.

Darkmown is a Markdown-native web framework. Two formats, one rule: `.md` stays plain CommonMark forever, and renaming a file to `.wd` ("whateverdown") is what unlocks directives — includes, loops, state, conditionals, and sections. Static pages ship **zero** framework JavaScript; reactive pages share one runtime around ~4.7 KB gzipped, CI-enforced under 5 KB.

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
npm run smoke   # pack, install, scaffold, and build a temporary consumer app
npm run dev     # live demo site — the same site that runs darkmown.com
```

## Commands

- `darkmown init [dir]` scaffolds a new site.
- `darkmown dev` starts the live compiler with browser reload and an in-browser error overlay when a build fails.
- `darkmown build` writes static output to `dist`.
- `darkmown serve` previews the built `dist` locally.
- `darkmown version` prints the installed package version.
- `darkmown help` prints CLI usage.

## Authoring model

- `site/pages` is the route tree. `.md` and `.wd` files become pages.
- `.md` is strict CommonMark (real parser: ordered lists, tables, blockquotes, images, the lot). Directives stay plain text, and the build hints when it spots `.wd` syntax in a `.md` file.
- Files or folders starting with `.`, `-`, or `_` are hidden from routing.
- `site/_` is the include shelf for `@include /name.wd`.
- Matching `page.skin` and `page.js` colocate styling and behavior by basename.
- Static pages ship zero Darkmown runtime. Reactive pages share `/__wd/runtime.js` (currently ~4.7 KB gzipped, CI-enforced under 5 KB).
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

A JSON-file loop is unrolled at build time; includes inside inherit the loop value. A `:state` list loop is reactive and patched by key.

```wd
@loop /features.json into card
@include /feature-card.wd
@endloop

:state todos = [{"id": 1, "title": "Route pages"}]

@loop todos into todo
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

### Sorting, paging, and meta — `sort by`, `limit`, `offset`, `reverse`

Shape a loop without writing JavaScript. Clauses come in a fixed order after `into`:

```
@loop <src> into <item> [where …] [sort by <key> [asc|desc]] [reverse] [offset <N>] [limit <N>]
```

```wd
@loop /posts.json into post sort by post.date desc limit 5
{ $number }. { post.title }
@endloop
```

- `sort by <key> [asc|desc]` — `<key>` must start with the loop item (`post.date`, not `date`). Numbers sort numerically; everything else sorts as text. `asc` is the default.
- `reverse` — reverse the (already sorted) order.
- `offset <N>` / `limit <N>` — `<N>` is a non-negative integer **or** a `:state`/`:store` key, which makes pagination reactive:

```wd
:state pageSize = 10

@loop products into product limit pageSize
- { product.name }
@endloop
```

Each row exposes five meta variables, relative to the rendered slice:

| Variable | Value |
|---|---|
| `{ $index }` | 0-based position |
| `{ $number }` | 1-based position (`$index + 1`) |
| `{ $first }` | `true` on the first row |
| `{ $last }` | `true` on the last row |
| `{ $count }` | number of rendered rows |

They work in interpolation and in `:if`:

```wd
@loop products into product
:if $first
**Top pick:**
:endif
{ $number } of { $count } — { product.name }
@endloop
```

### Empty lists — `@empty`

Add an `@empty` branch to show a fallback when the loop renders no rows (after `where`, `limit`, and the rest):

```wd
@loop todos into todo
- { todo.title }
@empty
Nothing left to do.
@endloop
```

> **Note:** All of these clauses stay build-time when the source and every clause argument are static — a sorted, limited loop over a JSON file ships **zero JavaScript**. The loop becomes reactive only when the source is `:state`/`:store`/`:fetch` data, or a clause reads reactive state (like `limit pageSize`).

### Editable lists — per-row actions

A `:button` inside a reactive `@loop` can act on its own row. `cart += product` carries the current row into another list; `cart remove line` drops the current row from the looped list:

```wd
:state products = [{"id": 1, "name": "Aurora", "price": 49}]
:state cart = []

@loop products into product
::: card
**{ product.name }** — ${ product.price }
:button "Add to cart" -> cart += product
:::
@endloop

@loop cart into line
::: card
{ line.name }
:button "Remove" -> cart remove line
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

### Button actions

A `:button "Label" -> action` mutates one `:state` or `:store` value. The same vocabulary works on both:

| Action | Syntax | Effect |
|---|---|---|
| Increment | `n++` | add 1 |
| Decrement | `n--` | subtract 1 |
| Add | `n += 5` | add a number |
| Subtract | `n -= 2` | subtract a number |
| Set | `name = value` | assign a literal |
| Toggle | `flag toggle` | flip a boolean |
| Append | `list append v` or `list += v` | add to the end of an array |
| Prepend | `list prepend v` | add to the front |
| Member toggle | `list toggle v` | add `v` if absent, else remove it |
| Remove value | `list remove v` | remove a value from an array |
| Clear | `name clear` | empty an array or object |
| Merge | `obj merge other` | shallow-merge an object (key or inline `{…}`) |
| Delete | `obj delete "key"` | remove a key |
| Reset | `name reset` | restore the declared starting value |

Values are literals: a `"string"`, number, `true`/`false`/`null`, or inline JSON (`{…}` / `[…]`).

**Targets can be dotted paths,** so a button can reach into nested state:

```wd
:state cart = {"count": 0, "total": 0}

:button "Add item" -> cart.count++
```

**One button can run several actions** with `;`. They apply in order, then the page renders once:

```wd
:button "Add to cart" -> cart.count++ ; cart.total += 9
```

> **Pitfall:** `list toggle v` and `list remove v` match members by value (`===`). That is exact for strings, numbers, and booleans, but not reliable for object members — two equal-looking objects are different values. To remove a row object, loop the list and use the per-row `remove` action below.

## Fetching data

`:fetch name from "url"` declares state and fills it from JSON over the network:

```
:fetch <name> from "<url>" [method=GET] [when=load|visible] [timeout=<ms>] [retry=<N>] [headers=<key>] [body=<key>]
```

Each fetch automatically declares four state keys you can branch on:

| State | Type | Meaning |
|---|---|---|
| `name` | the data | `null` until the response arrives |
| `name_loading` | boolean | `true` while the request is in flight |
| `name_error` | string | the error message, or `null` |
| `name_empty` | boolean | `true` when the data is `null`, `[]`, or `{}` |

### The four-state pattern

Cover loading, errors, empty, and data — `@empty` (from the loops above) absorbs the empty case:

```wd
:fetch roster from "/__wd/data/team.json" timeout=8000 retry=2

:if roster_loading
Loading…
:else
:if roster_error
Couldn't load the team: { roster_error }
:else
@loop roster into member
- { member.name }
@empty
No team members yet.
@endloop
:endif
:endif
```

### Options

- `method=` — `GET` (default), `POST`, `PUT`, `PATCH`, or `DELETE`.
- `when=` — `load` (default) fires on page load; `visible` waits until the spot scrolls into view.
- `timeout=<ms>` — abort and set `name_error` if the response is too slow.
- `retry=<N>` — retry on network failure or a 5xx response before surfacing the error.
- `headers=<key>` — a `:state`/`:store` key holding an object, sent as request headers.
- `body=<key>` — a `:state`/`:store` key, JSON-serialized as the request body (for non-`GET`).

### Dynamic URLs and refetching

A URL can interpolate state with `{ }`. The fetch re-runs automatically when that state changes (and skips while the value is still empty):

```wd
:state userId = ""

:fetch profile from "/api/users/{ userId }"
```

Trigger a reload by hand with the `refetch` action:

```wd
:button "Reload" -> roster refetch
```

### Looping into fetched data

Loop a sub-path of fetched (or any) state with a dotted source:

```wd
:fetch org from "/__wd/data/org.json"

@loop org.members into member
- { member.name }
@endloop
```

> **Note:** Shelf `.json` files are published at `/__wd/data/`, so `:fetch` works on any static host. The `darkmown dev` server also ships a `/__wd/echo` endpoint for demos.

## Global state — `:store`

`:state` is local to its page (and section). `:store` is **global, durable, and shared across tabs** — the right home for a cart, a theme, or a signed-in user.

```wd
:store cart = []

:button "Add" -> cart += {"id": 1, "name": "Aurora"}

You have { cart } items.
```

- **Durable by default.** A store is saved to `localStorage` under `wd:store:<name>` and reloaded on the next visit.
- **Shared across tabs.** Change a store in one tab and every other tab on the same site updates live.
- **Global by name.** A bare `{ cart }` reads the same store everywhere — stores are never section-scoped.
- **Same value grammar as `:state`** — string, number, boolean, `null`, array, or object — and the **same** button actions (`cart += …`, `count++`, `theme = "dark"`, and so on).

The declared value is a **seed**: it is used only the first time, when the store is absent from storage. After that the persisted value wins, so visitors keep their data.

### Opt out of persistence

Add `ephemeral` for an in-memory store that resets on reload and does not sync across tabs:

```wd
:store sidebarOpen = false ephemeral
```

> **Pitfall:** A store name must be unique. Declaring the same name as both a `:store` and a `:state` on one page is a compile error.

## Forms and persistence

Fetched data and a form live happily on the same page:

```wd
:fetch team from "/__wd/data/team.json"

@loop team into member
- { member.name }
@endloop

:form into profile
:input name placeholder="Your name" required
:submit "Save"
:endform

:state cart = [] persist
```

- `:form into name` captures submits straight into state (no backend). `:form action="/url"` emits a plain native form instead — zero JS, full progressive enhancement.
- `:form action="/url" into reply` does both: with JS the submit posts urlencoded via fetch and the JSON reply lands in state `reply` (`reply_error` on failure); without JS it is the same native POST. Darkmown adapts to any backend — it does not own one.
- `:state x = [] persist` keeps a single page's state in localStorage across reloads. (For state that is shared across pages and tabs, reach for [`:store`](#global-state--store) instead.)
- `:computed total = items.length * 4` derives state from state with a compile-time-checked expression (names, numbers, arithmetic, comparisons — nothing else).
- `:if item.path` works inside reactive loops for per-row branches, and nests — an inner `:if` resolves after the outer branch and stays reactive.

## The escape hatch

Reactive pages expose `window.wd` — `wd.get(key)`, `wd.set(key, value)`, `wd.state`, `wd.render()` — so colocated `.js` can do anything the directives can't. Section-scoped keys are addressed as `sectionId:name`.

Set `window.wd.debug = true` (it defaults to `false`) to log any `:computed` or `@loop … where` expression that fails to evaluate to the console — useful while authoring reactive pages.

## Editor support

A VS Code extension in [`editors/vscode`](editors/vscode) gives `.wd` and `.skin` files syntax highlighting, snippets, and folding — so a `.wd` file reads as Markdown-plus-directives, never as broken Markdown. For launch, it is source-installable: build a `.vsix` with `npm run pack:extension`, then install `editors/vscode/darkmown-*.vsix` with VS Code. Marketplace/Open VSX publishing is tracked as post-launch distribution work, so the public package does not imply store availability yet.

## Security

### Trust boundary

Darkmown is a **trusted-author** site generator: you compile content you wrote, the same way you trust your own source code. Three assumptions hold the model together — know them before you point Darkmown at content from anyone else.

- **Compile only trusted, author-written content.** Do not compile `.md`/`.wd` files you did not write — user-generated content, third-party docs, form input — without sanitizing it first.
- **Raw HTML passes through by default.** Darkmown runs `markdown-it` with `html: true`, so raw HTML in your content is emitted verbatim — by design, like every Markdown site generator. There is no built-in sanitizer; a raw `<script>` or event-handler attribute in untrusted content would execute in the visitor's browser. A page can opt into strict mode with `html: false` frontmatter, which drops raw HTML entirely.
- **`:fetch` has no URL allowlist, and reactive pages need `unsafe-eval`.** A `:fetch` URL is taken straight from the page source, so the request goes wherever the author wrote. Reactive pages also require `script-src 'unsafe-eval'` in your Content-Security-Policy, because the runtime compiles validated `:computed` / `@loop … where` expressions via `new Function` — a strict CSP without `unsafe-eval` will break reactive pages (static pages are unaffected).

> **The single biggest footgun:** do not compile untrusted or user-submitted Markdown without sanitizing it first. There is no built-in sanitizer.

Directive actions and `:computed`/`@loop … where` expressions are never `eval`'d as raw user content — they compile to a whitelisted grammar (item paths, declared `:state`, numbers, strings) that runs via `new Function`. See [SECURITY.md](SECURITY.md) for the full security model.

## Spec status

See [docs/spec-alignment.md](docs/spec-alignment.md) for the deep alignment audit against the original vision.
