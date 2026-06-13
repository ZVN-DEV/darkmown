# Building with Darkmown — agent guide

Darkmown is a Markdown-native web framework. You build sites by writing `.md` and `.wd` files. This sheet is everything you need to build or modify a Darkmown site. Read it fully before writing files.

## The one rule

- `.md` files are plain CommonMark. Directives stay inert text.
- `.wd` files are the same Markdown **plus directives** (state, loops, conditionals, includes, forms). To make a `.md` page interactive, **rename it to `.wd`** — nothing else changes.
- Static pages ship **zero** JavaScript. A page only loads the ~2 KB runtime if it declares reactive behavior.

## Project layout & routing

```
site/
  pages/        ← the route tree. index.wd → /, about.wd → /about/, docs/index.wd → /docs/
  _/            ← include shelf + shared partials (not routed). nav.wd lives here.
package.json
```

- **Folders are routes.** A file at `site/pages/blog/post.wd` serves at `/blog/post/`.
- Files/folders starting with `.`, `-`, or `_` are **hidden** from routing (drafts, partials).
- A `page.skin` next to `page.wd` attaches styling; a `page.js` attaches behavior. Matched by basename.

Commands: `darkmown dev` (live server), `darkmown build` (writes `dist/`), `darkmown serve` (preview build).

## Interpolation — one syntax

`{ name }` or `{ name.path }`. It resolves, in order: loop item → in-scope value (include arg / loop var) → declared `:state` → otherwise stays literal text. Unknown names never break the page.

## Directives

### State and buttons
```wd
:state count = 0
:state cart = [] persist          ← `persist` keeps it in localStorage

Count: { count }

:button "Add" -> count++
:button "Add 5" -> count += 5
:button "Add item" -> cart += {"id": 1, "name": "Sticker"}
:button "Reset" -> count = 0
```
Button actions are a **fixed whitelist**: `x++`, `x--`, `x += <number>`, `list += <json>`, `x = <json>`. The target must be declared `:state`. Values are JSON literals — they cannot reference loop items or other state.

### Conditionals
```wd
:if count
Shown when count is truthy.
:else
Shown when falsy.
:endif
```
`:if name.path` tests a dotted path. Conditionals nest, including per-row inside a loop.

### Loops — the only loop
```wd
@loop /products.json into product       ← JSON file: unrolled at build time (static)
- **{ product.name }** — { product.price }
@endloop

:state todos = [{"id": 1, "title": "Ship"}]
@loop todos into todo                    ← :state list: reactive, patched by key
- { todo.title }
@endloop
```
Source can be a JSON file path, an in-scope value, or a `:state` list. Loops nest. Inside a loop, `:if todo.done` branches per row.

### Includes
```wd
@include /nav.wd                         ← from site/_/
@include /card.wd with title={ row.name } price={ row.price }
```
Includes inherit the surrounding scope; `with` passes/reassigns values.

### Sections (scoped state)
```wd
::: section #cart .panel
:state items = []
{ items.length } items
:button "Add" -> items += {"id": 1}
:::
```
State inside a section is scoped to it. Two sections can each own a `count`. Address section state from `.js` as `sectionId:name`.

### Data, forms, computed
```wd
:fetch team from "/__wd/data/team.json"   ← loads JSON into state; sets team_error on failure
:fetch quotes from "/q.json" when=visible ← lazy: fires when scrolled into view

:if team
@loop team into member
- { member.name }
@endloop
:else
Loading…
:endif

:form into profile                        ← captures submit into state, no backend
:input name placeholder="Your name" required
:submit "Save"
:endform

:form action="/api/subscribe" into reply  ← posts to your backend; JSON reply → state.reply
:input email placeholder="Email"
:submit "Subscribe"
:endform

:computed total = items.length * 4         ← derived state; arithmetic & comparisons only
```
Shelf `.json` files (in `site/_/`) publish to `/__wd/data/`. `:form action=` posts urlencoded and lands the JSON reply in state; without JS it degrades to a native POST. Darkmown owns no backend — point forms at your own API.

## Styling with `.skin`

A colocated `.skin` file compiles to CSS. It is indentation-structural: a line is a selector if the next line is indented under it.

```skin
tokens                 ← becomes :root CSS variables
  ink #16181d
  accent #4f46e5
  radius 12px

body
  margin 0
  font system-ui, sans-serif
  color $ink           ← $token → var(--token)

.hero
  padding 4rem 2rem
  background $accent
  border-radius $radius
```

You can also write a normal `<style>` block in a `.wd` file if you prefer plain CSS.

## The escape hatch — for anything directives can't express

Directives are intentionally narrow. For real logic (filtering a list, custom interactions), use a colocated `.js` file with the `window.wd` API:

```js
// products.js — attached to products.wd
const input = document.querySelector("#search");
input.addEventListener("input", () => {
  const all = wd.get("products");
  wd.set("visible", all.filter(p => p.name.toLowerCase().includes(input.value.toLowerCase())));
});
```
`window.wd`: `wd.get(key)`, `wd.set(key, value)`, `wd.state`, `wd.render()`. Section state is keyed `sectionId:name`.

## Hard rules — do not break these

1. **Never invent directives or syntax.** Only the directives above exist. No `{% %}`, no `:for`, no `v-if`, no JSX.
2. **One loop (`@loop … into … @endloop`), one interpolation (`{ name }`).** Never use alternates.
3. **Button/`:computed` grammars are whitelisted.** No arbitrary JS in directives — that goes in `.js`.
4. `.md` stays inert. If a page needs directives, make it `.wd`.
5. Interpolation only resolves declared state / in-scope values. Declare state before binding it.
6. For complex logic, reach for the `.js` escape hatch — don't try to force it into directives.

## Minimal complete page

```wd
---
title: Hello
---

@include /nav.wd

<main>

# Hello

:state count = 0

You clicked { count } times.

:button "Click" -> count++

</main>
```
