# Building with Darkmown — agent guide

Darkmown is a Markdown-native web framework. You build sites by writing `.md` and `.wd` files. This sheet is everything you need. Read it fully before writing files, and **always ship styling** — an unstyled page is a failed page.

## The one rule

- `.md` files are plain CommonMark. Directives stay inert text.
- `.wd` files are the same Markdown **plus directives** (state, loops, conditionals, includes, forms).
- To make a `.md` page interactive, **rename it to `.wd`**. ⚠️ Renaming means the old `.md` is **gone** — never leave both `index.md` and `index.wd`, that is a fatal `Duplicate route` build error. Upgrade = delete the `.md`, create the `.wd`.
- Static pages ship **zero** JavaScript; a page loads the ~6.4 KB gzipped runtime (CI-enforced under 8 KB) only if it declares reactive behavior.

### ⚠️ Raw HTML is escaped by default (since 2.0.0)

Raw HTML you write in a `.md`/`.wd` body is **escaped by default** — a `<div>`, `<a class="btn">`, or `<main class="hero">` renders as *literal text*, not markup, unless you opt the page in. **To use any raw HTML on a page, add `html: true` to that file's frontmatter** (every page — and every `@include` — carries its own frontmatter, so opt each in). Rule of thumb: **if a page contains a raw HTML tag, it needs `html: true`.**

```wd
---
title: My page
html: true
---
```

`html: true` on that page is what lets a raw `<main>` / `<div>` / `<a>` in its body render as markup instead of escaped text.

**Annotations never go inside a `wd` fence.** Every line inside a fenced `wd` block is real source: a trailing `←` note or a `#` comment on a directive line is parsed as part of the directive and either breaks the build or (in frontmatter) is silently swallowed into the value. `.wd` has no comment syntax. Put explanations in prose next to the block, the way this file does.

`{ name }` interpolation, directives, and Markdown never needed `html: true` — only literal HTML tags do. One thing `html: true` does **not** unlock: an inline `<script>` is still blocked by the shipped Content-Security-Policy — put behavior in a colocated `.js` file instead.

## Project layout & routing

```
site/
  pages/        ← the route tree. index.wd → /, about.wd → /about/, docs/index.wd → /docs/
  _/            ← include shelf + shared partials (not routed). nav.wd and shelf JSON live here.
api/            ← optional serverless functions: export default (request) => Response
package.json
```
- **Folders are routes.** `site/pages/blog/post.wd` serves at `/blog/post/`.
- Files/folders starting with `.`, `-`, or `_` are **hidden** from routing (drafts, partials).
- A `page.skin` next to `page.wd` attaches styling; a `page.js` attaches behavior. Matched by basename.
- **Colocated assets:** any other file under `site/pages/` (not a `.md`/`.wd` route, not a basename-matched `.skin`/`.js`) copies to `dist/` at its own path with the right content-type — so `site/pages/logo.svg` is served at `/logo.svg`. Use the `site/_/` shelf for assets shared across pages; colocate the ones a single page owns.
- Shelf `.json` files publish to `/__wd/data/<name>`; every other shelf file publishes to `/__wd/media/<path>`.

Commands: `darkmown dev`, `darkmown build [--drafts]`, `darkmown serve`, `darkmown deploy <vercel|cloudflare>`, `darkmown catalog [--llms|--llms-full]`.

## Frontmatter: the complete key set

A `---` block at the very top of the file. Values are strings, plus inline arrays (`tags: [a, b, "x, y"]`).

```wd
---
title: Hello, Darkmown
description: Why I rewrote my blog as plain Markdown files.
image: https://example.com/og.png
lang: en
html: true
transitions: true
draft: true
date: 2026-09-04
updated: 2026-09-05
excerpt: A short summary for the feed.
author: Ada Lovelace
schema: BlogPosting
site_url: https://example.com
ai_crawlers: allow
rss_limit: 20
---
```

- `title`, `description`, `image` drive `<title>`, the meta description, and the Open Graph / Twitter card. `lang` sets `<html lang>` (default `en`).
- `html: true` allows raw HTML in that file's body. `transitions: true` opts into view transitions plus link prerendering.
- `draft: true` keeps the page out of `dist`, `routes.json`, the sitemap, and the feed. `darkmown dev` still serves it; `darkmown build --drafts` includes it.
- `date` marks the page a post (RSS item, sitemap `lastmod`, `og:type=article`). `updated` and `excerpt` refine that. `author` feeds an article `schema:`.
- `schema:` emits JSON-LD. One value, or a list. The closed set: `Article`, `BlogPosting`, `TechArticle`, `WebSite`, `Organization`. `organization:` and `logo:` support the `Organization` type. Anything else is a compile error.
- **Home page only:** `site_url: https://example.com` (no trailing slash) turns on `sitemap.xml`, `rss.xml`, and canonical URLs. `ai_crawlers: allow` (default) or `deny` flips every AI-crawler group in `robots.txt`. `rss_limit: 50` sets how many newest posts `rss.xml` carries (default 20).
- The page's own frontmatter is in scope as `meta`. Anything else you write is a free-form field, queryable when the page is a collection entry.

## Interpolation — one syntax

`{ name }` or `{ name.path }`. Resolves in order: loop item → in-scope value → declared `:state` → otherwise literal text. **Declare state before you bind it** — compilation is line-based, top to bottom, so a `{ x }` or `:if x` must come *after* the `:state x` (or the `:form into x`) that creates it.

The page's frontmatter is in scope as `meta`: `{ meta.title }` prints a field, `{ meta.tags }` joins an array with `, `, and `@loop meta.tags into tag` iterates a frontmatter array (build-time, stays static). Frontmatter arrays are inline only — `tags: [a, b, "x, y"]`; a value without a leading `[` is a plain string.

Build-time values resolve **inside a link or image destination** too: `[{ item.label }]({ item.url })`. Reactive `:state` cannot live in a destination.

### Format pipes: `{ value | name:arg }`

Shape a value for display. Pipes chain left to right and take literal arguments. They fold at build time for static values and re-apply on every render for `:state`/`:store` bindings, same syntax either way.

```wd
:state cart = [{"name": "Aurora", "price": 89, "joined": "2026-06-22"}]

@loop cart into p
{ p.name | upper } · { p.price | money } · { p.joined | date:"medium" }
@endloop

{ cart | count } lines, { cart | sum:"price" | money } total.
```

The whitelist, and nothing else: `money[:currency[:locale]]`, `number[:decimals]`, `percent[:decimals]`, `round[:decimals]`, `date` / `time` / `datetime` `[:style]` (`short`/`medium`/`long`), `upper`, `lower`, `capitalize`, `truncate:n`, `trim`, `pluralize:"item"[:"plural"]`, `default:"text"`, `join:", "`, and the five list aggregates `sum` / `avg` / `min` / `max` / `count` (each takes an optional `"field"` argument). There is no custom-pipe hook and no relative "time ago". An unknown pipe name is a compile error listing the valid ones.

A pipe only shapes a value the page can **resolve**. `{ 89 | money }` is not a name in scope, so it stays literal text, braces and all.

## Directives — the complete set (nothing else exists)

Twenty-five directives. `@include`, `@loop`, `:::`, `:if`, `:state`, `:store`, `:computed`, `:fetch`, `:effect`, `:every`, `:theme`, `:button`, `:form`, `:input`, `:textarea`, `:select`, `:checkbox`, `:radio`, `:submit`, `:bind`, `:slider`, `:video`, `:audio`, `:embed`, `:carousel`. Block forms close with `@endloop`, `:endif`, `:endform`, `:endcarousel`, or a bare `:::`. Run `darkmown catalog` for the same list as JSON.

### State, stores, and computed
```wd
:state count = 0
:state draftNote = "" persist
:store cart = []
:store sidebarOpen = false ephemeral
:computed total = count * 4

Count: { count } · Total: { total }
```
- `:state name = value` is page-scoped (and section-scoped inside a `::: section`). **Ephemeral by default**; add `persist` for localStorage.
- `:store name = value` is global by name, shared across pages and tabs. **Persisted by default**; add `ephemeral` to opt out.
- `:computed name = <expression>` derives from other state: names, numbers, `+ - * /`, comparisons, and the five aggregates `sum(list, field)` / `avg` / `min` / `max` / `count(list)`. It takes no `persist`/`ephemeral` (that is a compile error).
- Values are JSON: string, number, `true`/`false`/`null`, array, object. An array or object literal may span lines; the `persist`/`ephemeral` token then goes after the closing bracket. A blank line inside the literal ends it.

```wd
:store rows = [
  {"id": 1, "label": "One"},
  {"id": 2, "label": "Two"}
] persist
```

### Buttons and the action vocabulary
```wd
:state count = 0
:state flag = false
:state items = []
:state settings = {"beta": true}

:button "Add" -> count++
:button "Add 5" -> count += 5
:button "Reset" -> count reset
:button "Two things" -> count++ ; flag toggle
```
`:button "Label" -> action` mutates one declared `:state`/`:store`. Chain actions with `;`. The **fixed whitelist** (nothing else compiles):

| Action | Syntax |
|---|---|
| Increment / decrement | `n++` · `n--` |
| Add / subtract | `n += 5` · `n -= 2` |
| Set | `name = value` |
| Toggle a boolean | `flag toggle` |
| Append / prepend | `list append v` (or `list += v`) · `list prepend v` |
| Member toggle | `list toggle v` |
| Remove a value | `list remove v` |
| Clear | `name clear` |
| Merge / delete a key | `obj merge other` · `obj delete "key"` |
| Reset to the declared seed | `name reset` |
| Re-run a `:fetch` | `name refetch` |

Targets can be dotted paths (`cart.count++`). Values are JSON literals. A `:button` and a `:::` container header accept exactly three static attributes, written before the `->`: `role="…"`, `aria-…="…"`, and `title="…"` (e.g. `:button "Menu" aria-expanded="false" aria-controls="m" -> open toggle`, `::: card .note role="region" aria-label="Notes"`). Anything else (`class=`, `id=`, `style=`, `onclick=`, `data-…=`) is a compile error; style with `.class` tokens and act with `->` actions. For a link styled as a button, write `[Get started](/start/){.btn}` or raw HTML `<a class="btn" href="…">` (raw HTML needs `html: true`).

**Per-row actions (inside a reactive `@loop … into item`):** two actions reference the current row instead of a JSON literal.
```wd
:state products = [{"id": 1, "name": "Aurora"}]
:state cart = []

@loop products into product
:button "Add to cart" -> cart += product
@endloop

@loop cart into line
:button "Remove" -> cart remove line
@endloop
```
`cart += product` appends a **copy** of this row to another `:state` list; it is the only way to carry a loop item into another list. `<list> remove <item>` drops this row from the list being looped: `<list>` must be that loop's own `:state` source and `<item>` the loop variable, both compile-checked. This is the canonical add-to-cart / remove-line / delete-todo pattern, no `.js` needed. Removal targets the exact row, so it is correct even under a `where` filter.

### Conditionals
```wd
:state plan = "pro"
:state seats = 5
:state trialDays = 0
:state expired = false

:if plan == "pro" or seats >= 5
Pro plan.
:else if trialDays > 0 and not expired
Trial.
:else
Free plan.
:endif
```
`:if <predicate>` branches on a compile-time-validated predicate — a bare path (truthy), comparisons (`==` `!=` `<` `<=` `>` `>=` `contains`), joined with `and`/`or`/`not`. Operands are item paths, declared `:state`/`:store`, numbers, or `"strings"` — no expressions. (Same grammar as `.class when`; `@loop … where` is the comparison-only subset — operators with `and`/`or`.) Chain with `:else if` (any number; a bare `:else` must be last). Conditionals nest, including per-row inside a loop.

### Reactive classes — `.class when <predicate>`
```wd
:state tasks = [{"id": 1, "title": "Ship", "done": false, "priority": 4}]

@loop tasks into task
::: card .task .done when task.done .urgent when task.priority > 3
**{ task.title }**
:::
@endloop
```
`.class when <predicate>` on a `:::` container toggles that class from the same predicate grammar as `:if`. A predicate over only static values folds to a plain class at build time; one reading `:state` or the loop item stays reactive.

### Loops — the only loop
```wd
@loop /products.json into product
- **{ product.name }** · { product.price | money }
@endloop

:state todos = [{"id": 1, "title": "Ship"}]
@loop todos into todo
- { todo.title }
@endloop
```
A JSON file path is unrolled at build time and stays zero-JS. A `:state`/`:store`/`:fetch` list is reactive and patched by key. An in-scope value (an include argument, a frontmatter array, a dotted path off a row) also works. Loops nest, and `:if todo.done` branches per row. One level of reactive-inside-reactive nesting is allowed; a third is a compile error.

**Clauses, in this fixed order after `into <item>`:**

```
@loop <src> into <item> [where …] [sort by <key> [asc|desc]] [reverse] [offset N] [limit N] [paginate N] [sortable]
```

```wd
@loop /products.json into p where p.price < 80 sort by p.price desc reverse offset 1 limit 5
{ $number }. { p.name }
@empty
Nothing matched.
@endloop
```

- `where` filters. `sort by <item>.field [asc|desc]` orders (numbers numerically, everything else as text; `asc` is the default). Both the field and the direction may be a `{ state }` reference, which is how a clickable-header sort works.
- `reverse` flips the order. `offset N` / `limit N` slice, and `N` may be a `:state` key (which makes the loop reactive).
- `paginate N` is **collections only** and splits the listing into real routes: page 1 keeps the route, pages 2+ land at `/<route>/page/2/`. It cannot combine with `offset`/`limit`.
- `sortable` (a bare clause, **not** `:sortable`) makes a plain reactive `:state`/`:store` loop drag-reorderable, with keyboard support. Not valid alongside `where`/`sort`/`reverse`/`offset`/`limit`.
- `@empty` opens a fallback branch rendered when the loop produces no rows. A missing in-scope source is an empty list, not an error.

**Row variables**, valid only inside a loop body: `{ $index }` (0-based), `{ $number }` (1-based), `{ $first }`, `{ $last }`, `{ $count }`. They work in interpolation and in `:if`.

### Content collections and `_schema.wd`

**Any folder under `site/pages/` is a queryable collection**, referenced in `@loop` by its bare name. No `content/` root, no marker file: `site/pages/blog/` *is* the `blog` collection, and it resolves at build time (zero JS).

```wd
@loop blog into post sort by post.date desc limit 10
- [{ post.title }]({ post.url }) · { post.date | date:"medium" }
@endloop
```

Each entry's frontmatter becomes a row, plus three derived fields: `{ post.url }` (the route), `{ post.slug }` (the filename stem), `{ post.excerpt }` (the frontmatter `excerpt:`, else the first paragraph). Drafts never appear in a default build.

Drop a `_schema.wd` at the collection root to type-check every entry's frontmatter at build time. It is frontmatter-shaped, one `field: type` rule per line:

```wd
---
title: string
date: date
excerpt: string?
tags: string[]?
---
```

The closed vocabulary: `string`, `number`, `boolean`, `date`, `string[]`, each with a trailing `?` for optional. A missing required field, a wrong type, an unknown extra field, or an unknown type token fails the build with a `file:line`. No `_schema.wd`, no validation.

### Includes & sections
```wd
@include /nav.wd
@include /card.wd with title="Aurora"

::: section #cart .panel
:state items = []
{ items.length } items
:::
```
- `@include /partial.wd [with key="value" …]` inlines a file from `site/_/` or `site/pages/`. Paths are **static literals**; there is no dynamic include path. Includes are macros, not components: no children, no slots, no default arguments. A missing argument renders `{ title }` literally.
- `::: [tag] [.class …] [#id] … :::` groups content. A container named `section`, `nav`, or `main` emits that real element; any other name is a `<div>` with that class. State declared inside a section is scoped to it (`sectionId:name`). Containers accept **only** `.class` / `#id` / `.class when …`, never `aria-*` or `role`.
- There is **no layout or shell inheritance**. Every page includes its own nav and footer.

### Fetching data
```wd
:fetch roster from "/__wd/data/team.json" timeout=8000 retry=2
:fetch quotes from "/q.json" when=visible

:if roster_loading
Loading…
:else if roster_error
Could not load the team: { roster_error }
:else
@loop roster into member
- { member.name }
@empty
No team members yet.
@endloop
:endif
```
`:fetch name from "url"` declares four keys: `name` (the data, `null` until it lands), `name_loading`, `name_error`, `name_empty`. Options: `method=` (GET/POST/PUT/PATCH/DELETE), `when=load|visible`, `timeout=<ms>`, `retry=<N>`, `headers=<state key>`, `body=<state key>`, `refresh=<url>`. A URL may interpolate `{ state }` and re-runs when it changes; `name refetch` re-runs it by hand.

URLs must be a relative path, an explicit `http(s)://`, or a leading `{ state }`. Protocol-relative `//host` and non-http(s) schemes are compile errors. A bare `:if name_loading` region gets `role="status" aria-live="polite"` and `:if name_error` gets `role="alert"` for free.

**Authenticated requests.** Seed the store **empty** and let your `api/` endpoint fill it at runtime. A literal token written into a `.wd` file is inlined into public HTML for everyone to read.
```wd
:store session = {}

:form action="/api/login" into login
:input email type=email required
:input password type=password required
:submit "Sign in"
:endform

:effect login -> session merge login

:fetch feed from "/api/feed" headers=session refresh="/auth/refresh"
```
`headers=<key>` sends a state object as request headers. `refresh=<url>` (which requires `headers=`) renews the token on a `401` and retries once.

### Forms and fields
```wd
:form into profile
:input name placeholder="Your name" required
:input email type=email placeholder="Email"
:textarea note placeholder="Anything else?" rows=4
:select topic
- General
- Billing
:checkbox channels
- Email
- SMS
:radio plan
- Basic
- Pro
:submit "Save"
:endform

:if profile
Thanks, **{ profile.name }**!
:endif
```
- `:form into x` captures the submit into state, no backend. `:form action="/url"` emits a plain native POST (zero JS). `:form action="/url" into reply` does both: fetch when JS is on, native POST when it is not, JSON reply into `reply` (`reply_error` on failure). Darkmown owns no backend; point forms at your own `api/` or an absolute URL.
- `:select` / `:checkbox` / `:radio` take `- Label` option lines. `:checkbox` captures an **array** of checked values; `:radio` captures one.
- Every generated control derives an `aria-label` from its placeholder or field name unless you supply one.

**Form-state rules (these cause most form failures):**
- `:form into x` declares `x` only at `:endform`. A `:if x` (or `{ x.field }`) that reads it must come **after `:endform`**, never inside the form body.
- State declared inside a `::: section` is **scoped to that section** (as `sectionId:x`). If you wrap a `:form into x` in a section, a `:if x` *outside* that section can't see it. Keep the form and the `:if` that reads it in the **same scope** — or don't wrap the form in a section.

### Bound controls: `:bind`, `:slider`
```wd
:state products = [{"id": 1, "name": "Aurora"}, {"id": 2, "name": "Briza"}]
:state q = ""

:bind q placeholder="Search"
:slider volume = 50 min=0 max=100 step=5

Volume: { volume }

@loop products into p where p.name contains q
- { p.name }
@endloop
```
`:bind <state>` is an `<input>` wired two-way to a declared `:state`. It accepts `type=` (default `text`), `placeholder=`, `autocomplete=`, and the `required` / `autofocus` flags. `:slider name = v [min=] [max=] [step=] [persist]` is a range input bound the same way; its value coerces to Number so `:computed` sees a number. Both are how live filtering works: **if a `where` predicate reads any `:state`, the loop becomes reactive and re-filters live; if it only reads the row, it filters at build time and the page stays zero-JS.**

### Timers and effects: `:every`, `:effect`
```wd
:state secs = 0
:state q = ""
:state searches = 0

:every 1s -> secs++
:effect q -> searches++
```
- `:every <duration> -> <actions>` runs the `:button` vocabulary on an interval. Durations are `<n>ms` / `<n>s` / `<n>m`. Intervals **pause while the tab is hidden** and resume on return, so a background dashboard stops firing requests.
- `:effect <watched> -> <actions>` runs actions when a watched state path changes. Effects run on change, never on load, and are capped at 10 settle passes.

### Theme toggle: `:theme`
```wd
:theme
:button "Auto"  -> theme = "auto"
:button "Light" -> theme = "light"
:button "Dark"  -> theme = "dark"
```
`:theme` registers a durable `theme` store and reflects it onto `<html data-theme="…">`. A `tokens dark` block in your `.skin` already powers both this toggle and the OS `prefers-color-scheme` query, so no extra CSS is needed. `:theme name = "light"` renames the store and seeds a different default.

### Media: `:video`, `:audio`, `:embed`
```wd
:video /clip.mp4 poster=/clip.jpg controls
:audio /track.mp3 controls
:embed https://youtu.be/aqz-KE-bpKQ title="Big Buck Bunny"
```
All three are **compile-time only** and emit no `data-wd-*`, so a media page stays zero-JS. `:video`/`:audio` take whitelisted flags (`controls`, `autoplay`, `loop`, `muted`, `playsinline`) and attributes (`poster`, `width`, `height`, `preload`); `autoplay` implies `muted`. `:embed` rewrites a YouTube/Vimeo URL to its no-cookie/player form inside a lazy, responsive 16/9 box; any other `http(s)` URL becomes a generic lazy iframe.

### Carousel: `:carousel`
```wd
:carousel autoplay=4000
::: slide
First slide
:::
::: slide
Second slide
:::
:endcarousel
```
Each direct child block is one slide, so wrap each in its own `:::` block and size it in your skin. Native CSS scroll-snap plus prev/next buttons, dots, and mouse drag. `autoplay` is suppressed under `prefers-reduced-motion`. `:carousel` and `sortable` each load a tiny `/__wd/behaviors/*.js` module, only on the pages that use them.

## What HTML each directive emits — target these in `.skin`

Your `.skin` selectors must match the **real** output. The emitted HTML is:

| You write | It renders as |
|---|---|
| `# Heading`, prose, `- list` | normal `<h1>`, `<p>`, `<ul><li>` (style by tag) |
| `::: section #id .card … :::` | `<section id="id" class="card">…</section>` |
| `::: name .card … :::` (non-`section`) | `<div class="card">…</div>` |
| `:button "x" -> …` | `<button>x</button>` |
| `:input email …` | `<input type="…">` |
| `:textarea note …` | `<textarea>` |
| `:select name` + `- Label` lines | `<select>` of `<option>`s |
| `:checkbox name` / `:radio name` + `- Label` lines | labelled `<input type=checkbox\|radio>` group (`:checkbox` captures an **array**, `:radio` one value) |
| `:bind q placeholder="…"` | `<input>` bound two-way to `:state q` |
| `:slider v = 50 …` | `<input type="range">` |
| `:submit "Go"` | `<button type="submit">Go</button>` |
| `:form …` | `<form>…</form>` |
| `:video` / `:audio` / `:embed` | `<video>` / `<audio>` / a wrapped lazy `<iframe>` |
| reactive `@loop` of a list | `<ul>`/`<ol>` (or `<div>`) of items |
| `{ name }` | a text node |

So style with real selectors: `section`, `.card`, `button`, `input`, `form`, `h1`. **To add a class to a container, use `::: name .class`; to add one to a single inline element, use a trailing `{.class .class #id}`, as in `[Get started](/start/){.btn}`.** Inline attributes attach to **links, images, and emphasis** only; they do **not** work on inline code (`` `x` ``{.hl} renders the braces as text). A container class can also be reactive: `::: card .on-sale when p.price < 50` toggles the class from a predicate (same grammar as `:if`).

Every heading also gets a stable GitHub-style `id` at build time, so `[jump](#my-heading)` deep-links with zero JS.

## Styling with `.skin` — ship this on every page

A colocated `.skin` compiles to CSS. It is indentation-structural: a line is a **selector** if the next line is indented under it; otherwise it is a `property value` declaration. Start from a real design system — tokens, a type scale, spacing, a responsive grid:

```skin
tokens
  ink #14181f
  muted #5b6470
  paper #ffffff
  bg #f6f7f9
  accent #4f46e5
  line #e6e8ec
  radius 14px

tokens dark
  ink #f4f4f5
  paper #14181f
  bg #0b0b0f

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
Always include: a tokens block, a real type scale, generous spacing, a `max-width` centered `main`, styled `button`/`input` with `:hover`/`:focus-visible` states, and a responsive `@media` rule (`.skin` supports `@media`, and its indented rules are wrapped automatically). A second `tokens dark` block overrides any token under the visitor's OS dark preference **and** under a `:theme` toggle, from one place. The `font` property is the CSS shorthand when it leads with a size (`font 16px/1.6 system-ui`) and `font-family` otherwise. Prefer `.skin`; a plain `<style>` block in a `.wd` also works.

**Scoped styles — opt in with `scoped`.** A `.skin` is **global** by default (style site-wide; the right default for your design system). To stop a reusable component's classes from clashing with the rest of the page, make the **first line** of its `.skin` the word `scoped` — its selectors then only match the component it's colocated with (a page skin scopes that page; an include skin scopes just that include's subtree). You still write `class="card"`; the build stamps a `data-wd-scope` attribute and rewrites the selectors — zero runtime, a static page stays static. **Tokens stay global** (a `tokens`/`tokens dark` block still emits `:root` vars, so `$accent` and dark mode keep working). Escape a single rule with `:global(.x)` (whole-selector only). `page`/`*`/`html`/`body`/`::selection` are a compile error in a scoped skin — those belong in a global skin.

**Syntax highlighting is free.** A fenced code block tagged with a language is highlighted at build time (no client JS), and its token classes read `$code-*` tokens from your skin, so highlighted code follows dark mode with no extra wiring.

**Layout gotcha — CTAs and link rows.** Markdown wraps adjacent links/buttons on consecutive lines into a single `<p>`, so putting `display:flex` on their container won't space them. To lay out a row of buttons or nav links, wrap them in explicit raw HTML and style that (the page needs `html: true` in its frontmatter for the raw `<div>`/`<a>` to render — see the raw-HTML note above):
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

Directives are narrow on purpose. For real logic (custom interactions, gestures, canvas, charts), use a colocated `.js` with `window.wd`: `wd.get(key)`, `wd.set(key, value)`, `wd.subscribe(key, cb)` (fires now and on every settled change, returns an unsubscribe), `wd.state`, `wd.render()`. Section state is keyed `sectionId:name`. The `.js` loads after the runtime, so `wd` is ready.

```js
// index.js, colocated beside the page
wd.subscribe("slide", (i) => {
  document.querySelector("[data-track]").style.transform = `translateX(${-i * 100}%)`;
});
```

Set `window.wd.debug = true` to log any `:computed` or `@loop … where` expression that fails to evaluate.

## Compile errors: read the code, not just the prose

Every author-facing compile error opens with a stable `WDxxx` code and names the file and line:

```
[WD201] Malformed :state in site/pages/index.wd:1: :state x.
        Use: :state name = value [persist|ephemeral] — e.g. :state count = 0
```

Codes are grouped by subsystem: `WD0xx` source and frontmatter, `WD1xx` loops and collections, `WD2xx` state and expressions, `WD3xx` button/effect/timer actions, `WD4xx` forms, `WD5xx` fetching and URL safety, `WD6xx` includes and page structure, `WD7xx` media, `WD8xx` skins, `WD9xx` project and CLI. Every `Use:` hint that contains `[bracket]` placeholders ends with a concrete `— e.g. <valid line>`: **copy the example, never the placeholder.** `darkmown catalog --llms-full` prints every code with its cause and fix.

## Hard rules — do not break these

1. **Never invent directives or syntax.** These do NOT exist: `@section`/`@endsection`, `{% if %}`, `:for`, `@repeat`, `v-if`, JSX, or any directive not in the list above. The only container is `::: … :::`; the only loop is `@loop`; the only interpolation is `{ }`.
2. **Never annotate inside a fence.** `.wd` has no comment syntax. A trailing `←` note or `#` comment on a directive line breaks the build, or silently corrupts a frontmatter value.
3. **Always ship styling.** A `.skin` (or `<style>`) with a modern type scale, spacing, and a responsive rule — every page. Unstyled = failure.
4. **`.skin` must target emitted HTML** (see the table). Verify selectors match real elements.
5. **Rename = delete.** Upgrading `.md`→`.wd` means removing the `.md`. Never leave both.
6. **Declare before you bind.** `:state` (or `:form into x`) must appear before any `{ x }` / `:if x` that reads it.
7. **Whitelisted grammars only.** Button/`:computed`/predicate vocabularies are fixed forms; arbitrary logic goes in a `.js` escape hatch.
8. **Never write a secret into a page.** `:state`/`:store` seeds are inlined into public HTML. Tokens and keys arrive at runtime from an `api/` endpoint.

## Minimal complete page

```wd
---
title: Hello
html: true
---

<main class="hero">

# Hello

:state count = 0

You clicked { count } times.

:button "Click" -> count++

</main>
```
`html: true` is what lets the raw `<main class="hero">` render as markup. Add a colocated `index.skin` styling `.hero`, `button`, and the type scale, and an `@include /nav.wd` if the project has a nav partial on the shelf.
