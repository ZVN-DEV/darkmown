# Building with Darkmown — agent guide

Darkmown is a Markdown-native web framework. You build sites by writing `.md` and `.wd` files. This sheet is everything you need. Read it fully before writing files, and **always ship styling** — an unstyled page is a failed page.

## The one rule

- `.md` files are plain CommonMark. Directives stay inert text.
- `.wd` files are the same Markdown **plus directives** (state, loops, conditionals, includes, forms).
- To make a `.md` page interactive, **rename it to `.wd`**. ⚠️ Renaming means the old `.md` is **gone** — never leave both `index.md` and `index.wd`, that is a fatal `Duplicate route` build error. Upgrade = delete the `.md`, create the `.wd`.
- Static pages ship **zero** JavaScript; a page loads the ~4.7 KB gzipped runtime (CI-enforced under 5 KB) only if it declares reactive behavior.

## Project layout & routing

```
site/
  pages/        ← the route tree. index.wd → /, about.wd → /about/, docs/index.wd → /docs/
  _/            ← include shelf + shared partials (not routed). nav.wd and shelf JSON live here.
package.json
```
- **Folders are routes.** `site/pages/blog/post.wd` serves at `/blog/post/`.
- Files/folders starting with `.`, `-`, or `_` are **hidden** from routing (drafts, partials).
- A `page.skin` next to `page.wd` attaches styling; a `page.js` attaches behavior. Matched by basename.

Commands: `darkmown dev`, `darkmown build`, `darkmown serve`.

## Interpolation — one syntax

`{ name }` or `{ name.path }`. Resolves in order: loop item → in-scope value → declared `:state` → otherwise literal text. **Declare state before you bind it** — compilation is line-based, top to bottom, so a `{ x }` or `:if x` must come *after* the `:state x` (or the `:form into x`) that creates it.

The page's frontmatter is in scope as `meta`: `{ meta.title }` prints a field, `{ meta.tags }` joins an array with `, `, and `@loop meta.tags into tag` iterates a frontmatter array (build-time, stays static). Frontmatter arrays are inline only — `tags: [a, b, "x, y"]`; a value without a leading `[` is a plain string.

## Directives — the complete set (nothing else exists)

### State and buttons
```wd
:state count = 0
:state cart = [] persist          ← persist = localStorage

Count: { count }

:button "Add" -> count++
:button "Add 5" -> count += 5
:button "Add item" -> cart += {"id": 1, "name": "Sticker"}
:button "Reset" -> count = 0
```
Button actions are a **fixed whitelist**: `x++`, `x--`, `x += <number>`, `list += <json>`, `x = <json>`. Target must be declared `:state`. Literal values are JSON. **`:button` is for state actions only** — for a link styled as a button, write raw HTML `<a class="btn" href="…">`.

**Per-row actions (inside a reactive `@loop … into item`):** two actions reference the current row instead of a JSON literal —
```wd
@loop products into product
:button "Add to cart" -> cart += product   ← append a COPY of this row to another :state list
:::
@loop cart into line
:button "Remove" -> cart remove line        ← drop this row from the list being looped
```
`cart += product` is the only way to carry a loop item into another list (literals still can't reference rows). `<list> remove <item>`: `<list>` must be the loop's own `:state` source and `<item>` the loop variable (both compile-checked). This is the canonical add-to-cart / remove-line / delete-todo pattern — no `.js` needed. Removal targets the exact row, so it is correct even under a `where` filter.

### Conditionals
```wd
:if count
Shown when truthy.
:else
Shown when falsy.
:endif
```
`:if name.path` tests a dotted path. Conditionals nest, including per-row inside a loop.

### Loops — the only loop
```wd
@loop /products.json into product       ← JSON file: unrolled at build time
- **{ product.name }** — { product.price }
@endloop

:state todos = [{"id": 1, "title": "Ship"}]
@loop todos into todo                    ← :state list: reactive, patched by key
- { todo.title }
@endloop
```
Source: a JSON file path, an in-scope value, or a `:state` list. Loops nest; `:if todo.done` branches per row.

### Filtering — `@loop … where` + live search with `:bind`
```wd
@loop /products.json into p where p.featured == true and p.price < 80
- { p.name }                              ← item-only predicate → filtered at BUILD time, stays zero-JS
@endloop

:state products = [{"id":1,"name":"Aurora"},{"id":2,"name":"Briza"}]
:state q = ""
:bind q placeholder="Search"             ← <input> bound two-way to :state q
@loop products into p where p.name contains q   ← predicate reads :state → reactive, re-filters live
- { p.name }
@endloop
```
`where` joins conditions with `and` / `or`. Operators: `==` `!=` `<` `<=` `>` `>=` and `contains` (case-insensitive substring). Operands are item paths (`p.field`), declared `:state`, numbers, or `"strings"` — whitelist-validated, no expressions. **Rule that decides JS: if the predicate only reads the row, it filters at build time and the page stays static; if it reads any `:state`, the loop becomes reactive.** `:bind name` is the input primitive for live filtering — it accepts `type=` (default `text`), `placeholder=`, `autocomplete=`, and `required` / `autofocus`.

### Includes & sections
```wd
@include /nav.wd                         ← partial from site/_/
@include /card.wd with title={ row.name }

::: section #cart .panel                 ← container with id/classes; state inside is scoped to it
:state items = []
{ items.length } items
:::
```

### Data, forms, computed
```wd
:fetch team from "/__wd/data/team.json"   ← loads JSON into state; sets team_error on failure
:fetch quotes from "/q.json" when=visible ← lazy, on scroll into view

:form into profile                        ← captures submit into state (declares `profile`), no backend
:input name placeholder="Your name" required
:input email type=email placeholder="Email"   ← set type= for email/number/etc (default is text)
:submit "Save"
:endform

:if profile                               ← read form state AFTER :endform (see rule below)
Thanks, **{ profile.name }**!
:endif

:computed total = items.length * 4         ← derived state; arithmetic & comparisons only
```
Shelf `.json` files (in `site/_/`) publish to `/__wd/data/`. `:form action="/api/x" into reply` posts urlencoded and lands the JSON reply in state (without JS it degrades to a native POST). Darkmown owns no backend — point forms at your own API.

**Form-state rules (these cause most form failures):**
- `:form into x` declares `x` only at `:endform`. A `:if x` (or `{ x.field }`) that reads it must come **after `:endform`**, never inside the form body.
- State declared inside a `::: section` is **scoped to that section** (as `sectionId:x`). If you wrap a `:form into x` in a section, a `:if x` *outside* that section can't see it. Keep the form and the `:if` that reads it in the **same scope** — or don't wrap the form in a section.

## What HTML each directive emits — target these in `.skin`

Your `.skin` selectors must match the **real** output. The emitted HTML is:

| You write | It renders as |
|---|---|
| `# Heading`, prose, `- list` | normal `<h1>`, `<p>`, `<ul><li>` (style by tag) |
| `::: section #id .card … :::` | `<section id="id" class="card">…</section>` |
| `::: name .card … :::` (non-`section`) | `<div class="card">…</div>` |
| `:button "x" -> …` | `<button>x</button>` |
| `:input email …` | `<input type="…">` |
| `:bind q placeholder="…"` | `<input>` bound two-way to `:state q` |
| `:submit "Go"` | `<button type="submit">Go</button>` |
| `:form …` | `<form>…</form>` |
| reactive `@loop` of a list | `<ul>`/`<ol>` (or `<div>`) of items |
| `{ name }` | a text node |

So style with real selectors: `section`, `.card`, `button`, `input`, `form`, `h1`. **To add a class to a container, use `::: name .class`. For any other custom element, write raw HTML `<div class="…">`. There is NO `{.class}` attribute syntax.**

## Styling with `.skin` — ship this on every page

A colocated `.skin` compiles to CSS. It is indentation-structural: a line is a **selector** if the next line is indented under it; otherwise it is a `property value` declaration. Start from a real design system — tokens, a type scale, spacing, a responsive grid:

```skin
tokens                       ← becomes :root CSS variables ($name → var(--name))
  ink #14181f
  muted #5b6470
  paper #ffffff
  bg #f6f7f9
  accent #4f46e5
  line #e6e8ec
  radius 14px

body
  margin 0
  font 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif
  color $ink
  background $bg

main
  max-width 960px
  margin 0 auto
  padding 4rem 1.5rem

h1
  font-size 3rem
  line-height 1.05
  letter-spacing -0.03em
  margin 0 0 1rem

.hero
  padding 5rem 2rem
  border-radius $radius
  background linear-gradient(135deg, #4f46e5, #9333ea)
  color white

.grid
  display grid
  grid-template-columns repeat(3, 1fr)
  gap 1.25rem

.card
  background $paper
  border 1px solid $line
  border-radius $radius
  padding 1.5rem

.actions
  display flex
  gap .75rem
  flex-wrap wrap

button
  font-size 1rem
  padding .7rem 1.2rem
  border 0
  border-radius 10px
  background $accent
  color white
  cursor pointer
  transition transform .15s ease, box-shadow .15s ease

button:hover
  transform translateY(-1px)
  box-shadow 0 6px 20px rgba(79,70,229,.3)

input
  width 100%
  padding .7rem .9rem
  border 1px solid $line
  border-radius 10px
  font-size 1rem

input:focus-visible
  outline 2px solid $accent
  outline-offset 2px

@media (max-width: 640px)
  .grid
    grid-template-columns 1fr
  h1
    font-size 2.1rem
```
Always include: a tokens block, a real type scale, generous spacing, a `max-width` centered `main`, styled `button`/`input` with `:hover`/`:focus-visible` states, and a responsive `@media` rule (`.skin` supports `@media` — its indented rules are wrapped automatically). The `font` property is the CSS shorthand when it leads with a size (`font 16px/1.6 system-ui`) and `font-family` otherwise. Prefer `.skin`; a plain `<style>` block in a `.wd` also works.

**Layout gotcha — CTAs and link rows.** Markdown wraps adjacent links/buttons on consecutive lines into a single `<p>`, so putting `display:flex` on their container won't space them. To lay out a row of buttons or nav links, wrap them in explicit raw HTML and style that:
```wd
<div class="actions">
<a class="btn" href="/signup">Start free</a>
<a class="btn ghost" href="/docs">Docs</a>
</div>
```

### Page structure & hierarchy — required for styles to apply
- **Wrap every page's body in `<main>`.** Your `main { … }` rules (centering, `max-width`, page padding) are dead unless the element exists.
- **One `#` per page** (the H1/title). Use `##` for section headings (they render as `<h2>` — style those). Never emit two `<h1>`s.
- **Only style classes you actually attach.** Add a class with `::: name .card` (container) or raw HTML `class="…"`. Don't write `.thanks { … }` then forget to put `.thanks` on the element — the styling silently does nothing. (Wrap a styled confirmation in `::: section .thanks … :::`.)
- **Make cards feel real:** a subtle `box-shadow`, a `:hover` lift, and a distinct price/secondary-text color or weight. Avoid emoji as icons — they read as a default-AI tell; prefer an inline SVG or a styled monogram.
- **Markdown is NOT parsed inside raw HTML blocks.** `**bold**` or `_em_` written inside a `<div>…</div>` renders as literal asterisks. Inside raw HTML use real tags (`<strong>`, `<em>`); use Markdown `**` only in plain prose lines.

## The escape hatch — for logic directives can't express

Directives are narrow on purpose. For real logic (filtering, custom interactions), use a colocated `.js` with `window.wd` (`wd.get`, `wd.set`, `wd.state`, `wd.render`). Section state is keyed `sectionId:name`.

**Canonical "filter a list" pattern** (filtering is not a directive). Keep the fetched/source list intact and filter the rendered DOM — do not overwrite the source state, do not poll with setInterval:
```wd
<input id="q" placeholder="Search" autocomplete="off">

:fetch products from "/__wd/data/products.json"
:if products
@loop products into p
::: section .card
**{ p.name }** — { p.price }
:::
@endloop
:endif
```
```js
// products.js
const q = document.getElementById("q");
q.addEventListener("input", () => {
  const term = q.value.toLowerCase();
  for (const card of document.querySelectorAll(".card")) {
    card.style.display = card.textContent.toLowerCase().includes(term) ? "" : "none";
  }
});
```
This visual DOM filter is fine for a static fetched list. (Note: a `wd.render()` triggered by other state changes can reset the toggled `display`; for a list that also mutates reactively, re-apply the filter after such changes.)

## Hard rules — do not break these

1. **Never invent directives or syntax.** These do NOT exist: `@section`/`@endsection`, `{% if %}`, `{.class}` attribute lists, `:for`, `v-if`, JSX. The only container is `::: … :::`; the only loop is `@loop`; the only interpolation is `{ }`.
2. **Always ship styling.** A `.skin` (or `<style>`) with a modern type scale, spacing, and a responsive rule — every page. Unstyled = failure.
3. **`.skin` must target emitted HTML** (see the table). Verify selectors match real elements.
4. **Rename = delete.** Upgrading `.md`→`.wd` means removing the `.md`. Never leave both.
5. **Declare before you bind.** `:state` (or `:form into x`) must appear before any `{ x }` / `:if x` that reads it.
6. **Whitelisted grammars only.** Button/`:computed` actions are fixed forms; arbitrary logic goes in a `.js` escape hatch.

## Minimal complete page

```wd
---
title: Hello
---

@include /nav.wd

<main class="hero">

# Hello

:state count = 0

You clicked { count } times.

:button "Click" -> count++

</main>
```
…with a colocated `index.skin` styling `.hero`, `button`, and the type scale.
