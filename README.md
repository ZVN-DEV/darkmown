# Darkmown

[![npm](https://img.shields.io/npm/v/@zvndev/darkmown)](https://www.npmjs.com/package/@zvndev/darkmown)
[![CI](https://github.com/ZVN-DEV/darkmown/actions/workflows/ci.yml/badge.svg)](https://github.com/ZVN-DEV/darkmown/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue)](https://www.npmjs.com/package/@zvndev/darkmown)
[![license](https://img.shields.io/npm/l/@zvndev/darkmown)](./LICENSE)

**[darkmown.com](https://darkmown.com)** · Markdown that runs.

Darkmown is a Markdown-native web framework. Two formats, one rule: `.md` stays plain CommonMark forever, and renaming a file to `.wd` ("whateverdown") is what unlocks directives — includes, loops, state, conditionals, and sections. Static pages ship **zero** framework JavaScript; reactive pages share one runtime around ~7.4 KB gzipped, CI-enforced under 8 KB.

## Showcase

Five complete apps, each a readable `.wd` file — see them at **[darkmown.com/showcase](https://darkmown.com/showcase/)**:

- **[Folio](https://darkmown.com/folio/)** — a boutique storefront whose cart persists across pages, reloads, and browser tabs (`:store`), with live search and a checkout form.
- **[Pulse](https://darkmown.com/pulse/)** — a service dashboard driven by `:fetch`: loading / error / empty states, live refresh (`:every`), and status badges, with no hand-written JavaScript.
- **[Forge](https://darkmown.com/forge/)** — a plan configurator where `:computed` recomputes the price as you toggle features and seats, with conditional upsell hints.
- **[Compass](https://darkmown.com/compass/)** — a product-finder quiz: a branching state machine expressed entirely as `:if` steps over scored answers.
- **[Ledger](https://darkmown.com/ledger/)** — a spreadsheet-grade expense table: clickable-header reactive sort, a live filter, running totals via `sum`/`avg`/`max`, `| money`/`| date` format pipes, and a `:theme` toggle.

Plus focused feature demos: a draggable, keyboard-navigable **[Swiper](https://darkmown.com/carousel/)** (the `wd.subscribe` escape hatch) and a zero-JS **[Media](https://darkmown.com/media/)** page (`:video` / `:audio` / `:embed`).

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

- `darkmown init [dir] [--template <name>]` scaffolds a new site from a template (`starter`, `blog`, `store`, `dashboard`, `landing`).
- `darkmown dev` starts the live compiler with browser reload, an in-browser error overlay, and a local runner for `api/*` functions.
- `darkmown build [--target cloudflare]` writes static output to `dist`.
- `darkmown deploy <vercel|cloudflare> [--prod]` builds and deploys via the platform CLI.
- `darkmown serve` previews the built `dist` locally.
- `darkmown version` prints the installed package version.
- `darkmown help` prints CLI usage.

## Authoring model

- `site/pages` is the route tree. `.md` and `.wd` files become pages.
- `.md` is strict CommonMark (real parser: ordered lists, tables, blockquotes, images, the lot). Directives stay plain text, and the build hints when it spots `.wd` syntax in a `.md` file.
- Files or folders starting with `.`, `-`, or `_` are hidden from routing.
- `site/_` is the include shelf for `@include /name.wd`.
- Matching `page.skin` and `page.js` colocate styling and behavior by basename.
- Static pages ship zero Darkmown runtime. Reactive pages share `/__wd/runtime.js` (currently ~7.4 KB gzipped, CI-enforced under 8 KB).
- Shelf `.json` files are published at `/__wd/data/` so `:fetch` works on any static host.

## Interpolation

One syntax everywhere: `{ name }` or `{ name.path }`.

- In-scope static values (include arguments, loop values) resolve at build time.
- Declared `:state` becomes a live binding.
- The page's own frontmatter is in scope as `meta` — `{ meta.title }` prints a field.
- Anything else stays literal text — braces in prose never break a page or pull in the runtime.
- Build-time values also resolve **inside a link or image destination** — `[{ item.label }]({ item.url })` or `![{ p.alt }]({ p.src })` — so an `@loop` can drive an `href`/`src` and the page stays static. (Reactive `:state` cannot live in a destination.)

### Format pipes — `{ value | name:arg }`

Shape a value for display with a pipe, Liquid/Angular style: `{ price | money }`, `{ joinedAt | date:"medium" }`, `{ ratio | percent }`. Pipes **chain** left to right (`{ name | trim | capitalize }`) and take literal arguments (`{ total | money:"EUR" }`, `{ bio | truncate:80 }`). They work in static prose (folded at build time, zero-JS) and on live `:state`/`:store` bindings (re-applied on every render) — identical syntax either way. The pipe list is a fixed whitelist compiled to safe calls; there is no custom-function hook and nothing is `eval`'d.

| Pipe | Example | Result |
|---|---|---|
| `money[:currency[:locale]]` | `{ 89 \| money }` | `$89.00` |
| `number[:decimals]` | `{ 1234.5 \| number }` | `1,234.5` |
| `percent[:decimals]` | `{ 0.082 \| percent }` | `8%` |
| `round[:decimals]` | `{ 3.14159 \| round:2 }` | `3.14` |
| `date` / `time` / `datetime` `[:style]` | `{ "2026-06-22" \| date:"medium" }` | `Jun 22, 2026` |
| `upper` / `lower` / `capitalize` | `{ "draft" \| capitalize }` | `Draft` |
| `truncate:n` / `trim` | `{ bio \| truncate:80 }` | `…the first 80 chars…` |
| `pluralize:"item"[:"plural"]` | `{ 3 \| pluralize:"item" }` | `3 items` |
| `default:"—"` | `{ missing \| default:"—" }` | `—` |

The five **aggregates** double as pipes over a list — `{ cart \| count }`, `{ cart \| sum:"price" \| money }`, plus `avg` / `min` / `max` — and `join:", ":"name"` flattens a list of rows to a string. `date`/`time`/`datetime` are `Intl`-backed (`short` / `medium` / `long`); there is deliberately **no relative "time ago"** formatter, so builds stay byte-for-byte reproducible. An unknown pipe name is a compile error with the valid list.

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

Three keys also drive the document `<head>`: `title` sets `<title>`, `description` adds the meta description plus Open Graph / Twitter tags, and `image` (an absolute URL) sets the social-share preview (`og:image` / `twitter:image` and a `summary_large_image` card).

`transitions: true` opts a page into **instant, flash-free navigation** — zero JavaScript, all declarative. It emits a directional fade+slide **view transition** for the page swap (old lifts up and out, new rises up and in — replacing the default cross-fade, which left both pages ghosted at ~50 % opacity mid-navigation), plus a **`<script type="speculationrules">` prerender** hint that renders the next same-origin page on hover/pointerdown so the click activates an already-painted page (no white render-gap flash). It honors `prefers-reduced-motion`. Only same-origin pages that both opt in transition; browsers without support — or with page-preloading disabled — navigate normally. Off by default; opt out with `transitions: false`. Mark a link `{.no-prefetch}` to exclude it from prerendering. (Chrome disables prerendering while DevTools is open, so test the built site with DevTools closed.)

## Static assets

Images, fonts, icons, and other non-page files live on the include shelf at `site/_/` and are copied into the build untouched:

- Any non-`.md`/`.wd` file in `site/_/` → served at `/__wd/media/<path>` (e.g. `site/_/logo.svg` → `/__wd/media/logo.svg`).
- `.json` files → served at `/__wd/data/<name>` (this is what `:fetch` reads).

Reference them with a normal URL: `![logo](/__wd/media/logo.svg)`. The preview/`serve` layer returns the correct `Content-Type` per extension.

**Images are hardened at compile time.** Every `<img>` the compiler emits is stamped with its intrinsic `width`/`height` (read from the source file, so the browser reserves space and the page doesn't reflow as images decode), `decoding="async"`, and a load-priority split — the first image on the page stays eager with `fetchpriority="high"` (the LCP candidate), the rest get `loading="lazy"`. Author-set attributes always win, and remote or unreadable sources just skip the dimensions. The compiler **measures**, it doesn't resize — keep source images web-sized (modern formats, sensible dimensions).

**Or colocate an asset next to the page that uses it.** Any non-page file under `site/pages/` (anything but `.md`/`.wd` routes and the colocated `.skin`/`.js`) is copied to `dist/` at its own path, so a clean relative URL just works:

- `site/pages/logo.svg` → `dist/logo.svg` → `![logo](/logo.svg)`
- `site/pages/blog/cover.png` → `dist/blog/cover.png` → `![cover](/blog/cover.png)`

Hidden/private page paths stay private: any `site/pages` asset below a path segment starting with `.`, `-`, or `_` is skipped, and symlinked page assets are never copied. Keep drafts, private notes, and local secrets out of public output by naming them like routes: `.env`, `_private/secret.txt`, or `-draft/notes.txt`.

Use the shelf for assets shared across many pages; colocate the ones that belong to a single page or section. Both ship untouched with the correct content-type.

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
- **Reactive sort** — the field *and* the direction can each be a `{ state }` reference, so a clickable column header re-sorts the table live without any JavaScript: `sort by { sortKey } { sortDir }`. Drive them with `:state sortKey = "amount"` / `:state sortDir = "desc"` and `:button "Amount" -> sortKey = "amount" ; sortDir = "desc"`. The bare `{ sortKey }` resolves to a field on the loop item at render time.
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

### Nested reactive loops

*New in 0.19.0.* A reactive `@loop` may contain an inner reactive `@loop` over one of the outer row's fields — one level of nesting. The inner source is a dotted path rooted at the outer item (`order.lines`), so each row renders its own list and both stay live as state changes:

```wd
:state orders = [
  {"id": 1, "ref": "A-100", "lines": [{"sku": "x1", "qty": 2}, {"sku": "x2", "qty": 1}]},
  {"id": 2, "ref": "A-101", "lines": [{"sku": "y9", "qty": 5}]}
]

@loop orders into order
::: card
**{ order.ref }**
@loop order.lines into line
- { line.sku } × { line.qty }
@endloop
:::
@endloop
```

- The inner loop is keyed and reconciled per outer row, like any reactive loop.
- Interpolation inside the inner body resolves the inner item first, then the outer item — `{ line.qty }` and `{ order.ref }` are both in scope.
- Build-time loops over JSON/frontmatter already nest freely (the "loops nest" behavior above); what's new is **reactive-inside-reactive** over a `:state`/`:store`/`:fetch` row field.

> **Honest caveat:** nesting is **one level only** — an inner reactive loop may not itself contain a third reactive loop. Build-time loop nesting is unaffected by this limit.
>
> **Per-row actions inside an inner loop:** `cart += member` (append-row) works from an inner loop — it carries the inner item into a top-level `:state`/`:store` list. But a per-row **`remove`** needs a top-level list as its source, and an inner loop's source is a path off the outer row (`team.members`), so deleting an inner row in place is **not** supported — the compiler rejects it with a corrective message. Carry the row into a top-level list and remove it there.

## Sections

```wd
::: section #cart .dark
:state count = 0

Cart has { count } items.

:button "Add" -> count++
:::
```

State declared inside a section is scoped to it — two sections can both own a `count`. Bindings and actions resolve to the nearest scope.

### Reactive classes — `.class when <predicate>`

A container class can be toggled by a predicate. Static `.class` tokens are unchanged; add `when <predicate>` to make one reactive:

```wd
@loop products into p
::: card .product .on-sale when p.price < 50 .featured when p.featured
**{ p.name }** — ${ p.price }
:::
@endloop
```

The predicate uses the same whitelist as `:if` — item fields, declared `:state`/`:store`, numbers, strings, the `==`/`!=`/`>`/`<`/`>=`/`<=`/`contains` operators, and `and`/`or`/`not`. A bare path (`.featured when p.featured`) reads as truthy. (`@loop … where` is the comparison-only subset of this grammar.) A predicate over only static values folds at build time into a plain class; one that reads state or the loop item stays reactive and ships with the runtime.

## Reactive directives

```wd
:state count = 0

Count: { count }

:button "Increment" -> count++

:if count >= 10
Count is high.
:else if count > 0
Count has changed.
:else
Count is still zero.
:endif
```

A condition reads the same predicate grammar as `.class when`: a bare path (truthy), or the comparisons `==` `!=` `<` `<=` `>` `>=` `contains`, joined with `and`, `or`, and `not`. (`@loop … where` is the comparison-only subset — operators with `and`/`or`.) Chain with `:else if` (any number; an optional bare `:else` must be the last branch):

```wd
:if plan == "pro" or seats >= 5
Pro plan
:else if trialDays > 0 and not expired
Trial — { trialDays } days left
:else
Free plan
:endif
```

A whole chain compiles to nested conditional regions, so it stays reactive (or folds at build time when every value is static) exactly like a single `:if`.

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

### Computed values — `:computed`

`:computed name = <expression>` derives state from other state with a compile-time-checked expression — names, numbers, arithmetic (`+ - * /`), comparisons, and the five **aggregates** over a list: `sum(list, field)`, `avg(list, field)`, `min(list, field)`, `max(list, field)`, and `count(list)`. It recomputes whenever an input changes and reads like any other binding (so it pairs naturally with [format pipes](#format-pipes--value--namearg)):

```wd
:store cart = [{"price": 89}, {"price": 12}]
:computed subtotal = sum(cart, price)
:computed tax      = subtotal * 0.08
:computed total    = subtotal + tax

Subtotal: { subtotal | money } · Tax: { tax | money } · **{ total | money }**
```

The aggregate's field argument is a bare key on each row (`price`, not `item.price`). There are no function calls beyond the five aggregates and no property access beyond dotted state paths — anything richer belongs in a colocated `.js` behavior.

### Timers — `:every`

`:every <duration> -> <actions>` runs a `:button`-style action on an interval — the one piece of time the framework owns. Durations are `<n>ms` / `<n>s` / `<n>m`, and the actions are the same `;`-chained vocabulary as `:button`/`:effect` (including `name refetch` to re-run a `:fetch`):

```wd
:fetch board from "/status.json"
:every 10s -> board refetch        # live-refresh a dashboard

:state secs = 0
:every 1s -> secs++                # a ticking counter
```

Intervals **pause while the tab is hidden** (via `visibilitychange`) and resume on return, so a backgrounded dashboard stops firing requests and draining battery.

### Effects — `:effect`

`:effect <watched> -> <actions>` runs actions whenever a watched state path changes. The actions are the same `:button` vocabulary (`;`-chained) — this is the escape hatch for side effects beyond `:computed` (which derives state) and `:fetch` deps (which auto-refetch):

```wd
:state q = ""
:state searches = 0

:effect q -> searches++
```

Effects run after a render, against settled state, and an effect that mutates state triggers another pass — bounded by a 10-pass settle cap that warns (and stops) if an effect never settles. They do not fire on the initial load, only on a real change.

## Fetching data

`:fetch name from "url"` declares state and fills it from JSON over the network:

```
:fetch <name> from "<url>" [method=GET] [when=load|visible] [timeout=<ms>] [retry=<N>] [headers=<key>] [body=<key>] [refresh=<url>]
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
:else if roster_error
Couldn't load the team: { roster_error }
:else
@loop roster into member
- { member.name }
@empty
No team members yet.
@endloop
:endif
```

### Options

- `method=` — `GET` (default), `POST`, `PUT`, `PATCH`, or `DELETE`.
- `when=` — `load` (default) fires on page load; `visible` waits until the spot scrolls into view.
- `timeout=<ms>` — abort and set `name_error` if the response is too slow.
- `retry=<N>` — retry on network failure or a 5xx response before surfacing the error.
- `headers=<key>` — a `:state`/`:store` key holding an object, sent as request headers.
- `body=<key>` — a `:state`/`:store` key, JSON-serialized as the request body (for non-`GET`).
- `refresh=<url>` — a token-refresh endpoint; on a `401`, renew the `headers=` token and retry once (see below).

> **URL safety.** A `:fetch`/`refresh` URL must be a relative path, an `http(s)://` URL, or a leading `{ state }` interpolation. A protocol-relative `//host` or a non-http(s) scheme (`file:`, `data:`, `javascript:`, …) is a compile error.

### Authenticated requests and token refresh

`headers=<key>` sends a state object as request headers — pair it with `:store` to persist a bearer token across reloads:

```wd
:store session = { "Authorization": "Bearer …" }
:fetch feed from "/api/feed" headers=session
```

Add `refresh="<url>"` and Darkmown manages the token lifecycle: when a request comes back `401`, it POSTs the current `headers` object to the refresh URL, writes the returned headers (the new token) back into the `session` state — persisting it, since `session` is a `:store` — and retries the original request once. Concurrent `401`s sharing a refresh URL are de-duplicated into a single in-flight refresh.

```wd
:store session = { "Authorization": "Bearer …" }

:fetch feed from "/api/feed" headers=session refresh="/auth/refresh"
```

`refresh=` requires `headers=` (it needs a state key to renew). The refresh endpoint should accept the current headers as a JSON body and reply with the new headers object.

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
- **Multi-line seeds.** An array or object literal may span several lines for readability — open the `[`/`{` on the `:store`/`:state` line and let it run until it closes:

  ```wd
  :store rows = [
    {"id": 1, "label": "One"},
    {"id": 2, "label": "Two"}
  ]
  ```

  The literal must balance with no blank line inside it (a blank line ends the value); an unterminated literal is a compile error. Quote genuinely literal bracket text — `:state tag = "[draft]"`.

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
:select topic
- General
- Billing
:checkbox channels
- Email
- SMS
:radio plan
- Basic
- Pro
:textarea note placeholder="Anything else?"
:submit "Save"
:endform

:state cart = [] persist
```

- `:form into name` captures submits straight into state (no backend). `:form action="/url"` emits a plain native form instead — zero JS, full progressive enhancement. Form actions use the same URL scheme guard as `:fetch`: relative paths, explicit `http(s)://`, or leading `{ state }` interpolation; protocol-relative and non-http(s) schemes are compile errors.
- `:form action="/url" into reply` does both: with JS the submit posts urlencoded via fetch and the JSON reply lands in state `reply` (`reply_error` on failure); without JS it is the same native POST. Darkmown adapts to any backend — it does not own one.
- Field directives: `:input`, `:textarea name [rows=N]`, `:select name`, `:checkbox name`, and `:radio name` (the last three take `- Label` option lines) all capture into `:form into` state the same way. A `:checkbox` group captures **every checked value as an array**; a `:radio` group captures a single value. Each derives a non-visual `aria-label` from its placeholder, else a humanized field name, unless you supply `aria-label`/`aria-describedby`.
- `:state x = [] persist` keeps a single page's state in localStorage across reloads. (For state that is shared across pages and tabs, reach for [`:store`](#global-state--store) instead.)
- `:computed total = items.length * 4` derives state from state with a compile-time-checked expression — names, numbers, arithmetic, comparisons, and list aggregates (`sum`/`avg`/`min`/`max`/`count`). See [Computed values](#computed-values--computed).
- `:if item.path` works inside reactive loops for per-row branches, and nests — an inner `:if` resolves after the outer branch and stays reactive.

## Backends & deploy

Darkmown builds **100% static, CDN-cacheable HTML** — never per-request server rendering. Reactive pages hydrate from data-attributes client-side; dynamic data arrives via `:fetch`. When you need a backend, you don't learn a new syntax — you write a plain serverless function, and *it just comes with wherever you deploy*.

A backend endpoint is a plain-JS Web-standard handler in a top-level `api/` directory:

```js
// api/subscribe.js  →  /api/subscribe
export const config = { runtime: "edge" }; // Vercel runs api/ as Edge Functions

export default async function (request, context) {
  const { email } = await request.json();      // context.params for /api/users/[id]
  return Response.json({ ok: true, email });
}
```

- **One shape, every host.** `export default (request) => Response` is exactly what Vercel Edge, Cloudflare Pages, and Netlify Edge run. `api/users/[id].js` → `/api/users/:id`.
- **Local parity.** `darkmown dev` runs a local runner, so `:fetch /api/subscribe` and `:form action="/api/subscribe"` behave the same as production before you ever deploy.
- **Deploy in one command.** `darkmown deploy vercel` (functions run natively) or `darkmown deploy cloudflare` (the build emits a `dist/_worker.js` that routes `/api/*` and serves the rest from `env.ASSETS`). It prints your URL, or the login to run if the platform CLI isn't signed in.
- **Custom server / remote backend.** Point `:fetch`/`:form` at an absolute `https://…` URL and widen the CSP `connect-src` (and `form-action` for native form POSTs). Darkmown owns no server — it adapts to yours.

Templates get you to a running, deployable app fast: `darkmown init shop --template store` ships a cart **and** an `api/checkout.js`; `--template dashboard` ships a `:fetch` view **and** an `api/metrics.js`.

## Interactions — `:slider`, `:sortable`, `:carousel`

Rich interactions are **pay-for-what-you-use**: `:sortable`/`:carousel` compile to a tiny `/__wd/behaviors/<name>.js` module injected **only** on pages that use them, budgeted separately from the ≤8 KB core runtime. `:slider` is compile-time only — zero extra JS.

```wd
:slider volume = 50 min=0 max=100 step=5
Volume: { volume }

:store tasks = ["Draft", "Review", "Ship"]
@loop tasks into t sortable
- { t }
@endloop

:carousel autoplay=4000
::: slide
First slide
:::
::: slide
Second slide
:::
:endcarousel
```

- **`:slider name = v min max step`** renders a range input two-way bound through `:bind`; range values coerce to Number so `:computed`/math see a number. Ships no behavior module.
- **`:sortable`** (a `@loop` clause) drag-reorders the underlying `:state`/`:store` list via Pointer Events (mouse + touch), with full keyboard support (Arrow Up/Down on a focused row, screen-reader instructions + a live "Moved to position N of M" announcement), rewriting the list through the public `window.wd` API so the keyed loop repaints. Valid only on a plain reactive loop (no `where`/`sort`/`reverse`/`offset`/`limit`).
- **`:carousel [autoplay=N]`** treats **each direct child block as one slide** (wrap each in its own block, e.g. `::: slide`, and size it in your skin), using native CSS scroll-snap (touch swipe is free) plus prev/next buttons, dot navigation, and mouse drag. `autoplay` is suppressed under `prefers-reduced-motion`.

## Inline attributes

A trailing `{.class .class #id}` attaches classes / an id to the inline element directly before it — most often to style a link as a button without a wrapper:

```wd
[Get started](/start/){.btn .lg}
![logo](/logo.svg){.brand}
```

The block must follow the element with no space, and works on links, images, emphasis, and inline code. It never collides with `{ name }` interpolation — an interpolation always starts with a name, never a `.` or `#`.

## Media — `:video`, `:audio`, `:embed`

*New in 1.0.* Three one-line directives replace hand-written `<video>` / `<iframe>` markup. They are **compile-time only** — they emit no `data-wd-*`, so a media-only page still ships **zero** framework JavaScript.

```wd
:video /clip.mp4 poster=/clip.jpg controls
:audio /track.mp3 controls
:embed https://youtu.be/aqz-KE-bpKQ title="Big Buck Bunny"
```

- **`:video` / `:audio`** compile to a hardened HTML5 player. `preload="metadata"` and `controls` are added by default; flags (`controls`, `autoplay`, `loop`, `muted`, `playsinline`) and attributes (`poster`, `width`, `height`, `preload`) are validated against a per-element whitelist, and `autoplay` silently implies `muted` (browsers block sound-on autoplay). The `src`/`poster` URLs run through the same scheme guard as `:fetch` — relative or `http(s)` only.
- **`:embed`** rewrites a YouTube or Vimeo URL to its **no-cookie / player** form, wraps it in a responsive `16/9` box, and marks the iframe `loading="lazy"` with a locked-down `referrerpolicy`. Any other `http(s)` URL becomes a generic lazy iframe. Add `title="…"` for the accessible name.

Darkmown's shipped CSP pre-authorizes exactly the two embed origins (`youtube-nocookie.com`, `player.vimeo.com`) and `media-src 'self' https:`, so embeds and remote media work out of the box on the bundled server, Cloudflare `_headers`, and Vercel.

## Dark mode — `tokens dark`

*New in 0.19.0.* A colocated `.skin` file already declares its palette in a `tokens` block (`name value` pairs referenced elsewhere as `$name`). Add a second `tokens dark` block to override any of those tokens under the visitor's OS dark preference — it compiles to a `@media (prefers-color-scheme: dark) :root { … }` rule, so the page follows the system theme with **zero JavaScript**.

```skin
tokens
  paper #ffffff
  ink #171717

tokens dark
  paper #0b0b0f
  ink #f4f4f5

page
  bg $paper
  color $ink
```

A single `tokens dark` block powers **both** theming paths: it compiles to `:root[data-theme="dark"] { … }` (the manual toggle below) **and** `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` (the OS preference, unless a visitor has explicitly forced light). The base `tokens` block stays the light default, so a skin with no `tokens dark` block is unchanged.

### Manual toggle — `:theme`

*New in 1.0.* For an explicit light/dark switch alongside (or instead of) the OS preference, declare `:theme` once and drive it with ordinary buttons. It registers a durable `theme` store and reflects its value onto `<html data-theme="…">`:

```wd
:theme
:button "Auto"  -> theme = "auto"
:button "Light" -> theme = "light"
:button "Dark"  -> theme = "dark"
```

Because `tokens dark` already emits the `[data-theme="dark"]` rule, **no extra skin block is needed** — the same palette drives the toggle. `"light"` forces the light palette even under OS dark; `"auto"` clears the attribute and follows the OS again; `theme` persists across reloads and tabs like any `:store`. (`:theme name = "light"` renames the store and seeds a different default. The older `tokens [data-theme=dark]` block — a manual-only override — still works for bespoke setups.)

## The escape hatch

Reactive pages expose `window.wd` so a colocated `.js` file can do anything the directives deliberately don't — keyboard, drag/touch, canvas, charts, maps:

| Method | Purpose |
|---|---|
| `wd.get(key)` | read a state value |
| `wd.set(key, value)` | write it and re-render |
| `wd.subscribe(key, cb)` | run `cb(value)` now and on every settled change; returns an unsubscribe |
| `wd.state` | the live state object |
| `wd.render()` | force a render |

Section-scoped keys are addressed as `sectionId:name`. The bridge for "behaviors" is `subscribe` — it primes the callback immediately, then fires whenever the value settles, so an imperative widget stays in lockstep with declarative state:

```js
// index.js, colocated beside the page. Loads after the runtime, so wd is ready.
const track = document.querySelector("[data-track]");
wd.subscribe("slide", (i) => {            // framework state → imperative view
  track.style.transform = `translateX(${-i * 100}%)`;
});
document.querySelector("[data-next]")
  .addEventListener("click", () => wd.set("slide", wd.get("slide") + 1));
```

That is the whole contract: the framework reconciles state, text, classes, and loops; your behavior owns the gestures; they meet at one shared key. (See the [Swiper demo](https://darkmown.com/carousel/) — a draggable, keyboard-navigable carousel built exactly this way.)

Set `window.wd.debug = true` (it defaults to `false`) to log any `:computed` or `@loop … where` expression that fails to evaluate to the console — useful while authoring reactive pages.

## Editor support

A VS Code extension in [`editors/vscode`](editors/vscode) gives `.wd` and `.skin` files syntax highlighting, snippets, and folding — so a `.wd` file reads as Markdown-plus-directives, never as broken Markdown. For launch, it is source-installable: build a `.vsix` with `npm run pack:extension`, then install `editors/vscode/darkmown-*.vsix` with VS Code. Marketplace/Open VSX publishing is tracked as post-launch distribution work, so the public package does not imply store availability yet.

## Security

### Trust boundary

Darkmown is a **trusted-author** site generator: you compile content you wrote, the same way you trust your own source code. Three assumptions hold the model together — know them before you point Darkmown at content from anyone else.

- **Compile only trusted, author-written content.** Do not compile `.md`/`.wd` files you did not write — user-generated content, third-party docs, form input — without sanitizing it first.
- **Raw HTML passes through by default.** Darkmown runs `markdown-it` with `html: true`, so raw HTML in your content is emitted verbatim — by design, like every Markdown site generator. There is no built-in sanitizer; a raw `<script>` or event-handler attribute in untrusted content would execute in the visitor's browser. A page can opt into strict mode with `html: false` frontmatter, which drops raw HTML entirely.
- **`:fetch` and `:form action=` have no host allowlist, and reactive pages need `unsafe-eval`.** A fetch/form URL is taken straight from the page source; the compiler rejects non-http(s) schemes but does not restrict which hosts you call, so SSRF/exfiltration protection is the author's responsibility. Reactive pages also require `script-src 'unsafe-eval'` in your Content-Security-Policy, because the runtime compiles validated `:computed` / `@loop … where` / `.class when` expressions via `new Function` — a strict CSP without `unsafe-eval` will break reactive pages (static pages are unaffected).

> **The single biggest footgun:** do not compile untrusted or user-submitted Markdown without sanitizing it first. There is no built-in sanitizer. A page can flip to strict mode with `html: false` frontmatter, which drops raw HTML entirely (see [SECURITY.md](SECURITY.md)).

Directive actions and `:computed`/`@loop … where` expressions are never `eval`'d as raw user content — they compile to a whitelisted grammar (item paths, declared `:state`, numbers, strings) that runs via `new Function`. See [SECURITY.md](SECURITY.md) for the full security model.

### Shipped security headers

Builds emit security response headers so a deployed site gets sane defaults without hand-writing a config. The build writes a `dist/_headers` file (Cloudflare Pages format), and the Vercel/local `serve` paths apply the equivalent. On every page:

- **`Content-Security-Policy`** — static pages get a tight policy; **reactive pages** (those that ship `/__wd/runtime.js`) add `script-src 'unsafe-eval' 'unsafe-inline'`, which the runtime needs to compile validated `:computed` / `@loop … where` / `.class when` expressions via `new Function`. Static pages stay strict.
- **`X-Content-Type-Options: nosniff`**, **`Referrer-Policy`**, and a **`frame-ancestors`** directive (clickjacking protection) on every page.

**If you use `:fetch` or `:form action=` against another host, widen `connect-src`.** The shipped CSP allows same-origin connections; calling a third-party API is otherwise blocked by the policy. Add the host to `connect-src` in your deploy config (it is not auto-derived from your page sources). The CSP is a defense-in-depth layer — it does not replace the trust-boundary rules above; see [SECURITY.md](SECURITY.md) for tightening guidance.

## Spec status

See [docs/spec-alignment.md](docs/spec-alignment.md) for the deep alignment audit against the original vision.
