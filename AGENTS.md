# Building with Darkmown — agent guide

Darkmown is a Markdown-native web framework. You build sites by writing `.md` and `.wd` files. This sheet is everything you need. Read it fully before writing files, and **always ship styling** — an unstyled page is a failed page.

## The one rule

- `.md` files are plain CommonMark. Directives stay inert text.
- `.wd` files are the same Markdown **plus directives** (state, loops, conditionals, includes, forms).
- To make a `.md` page interactive, **rename it to `.wd`**. ⚠️ Renaming means the old `.md` is **gone** — never leave both `index.md` and `index.wd`, that is a fatal `Duplicate route` build error. Upgrade = delete the `.md`, create the `.wd`.
- Static pages ship **zero** JavaScript; a page loads the ~6.6 KB gzipped runtime (CI-enforced under 8 KB) only if it declares reactive behavior. What ships at `/__wd/runtime.js` is a minified build of the readable source, with a sourcemap beside it at `/__wd/runtime.js.map`.

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

**A directive is a whole line, flush left, with its arguments.** An indented directive is prose and a directive inside a fenced block is code. A line that is only a keyword (`:state`, `:button`, `@loop`, and every other directive that takes arguments) is a **compile error** carrying that directive's own code and `Use:` hint, so a lone `:state` is `[WD201]` and a lone `:button` is `[WD301]`. Three keywords are valid bare because they mean something bare: `:::`, `:theme`, `:carousel`. To print a directive name as text, escape it: `\:fetch` renders `:fetch`.

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
- **Responsive image variants:** with sharp installed (`npm i -D sharp`, an optional dependency; builds work without it), the build scans `site/pages` for raster photos (jpg/jpeg/png/webp) over 700px wide and writes resized `name@640.ext` / `name@1280.ext` variants into `dist`, wiring a `srcset` onto the Markdown image with the original kept as `src`. Only widths below the intrinsic size are generated (never upscale), variants keep the source format, and EXIF orientation is applied. **Author-provided `name@<width>.ext` exports win per width**: your file is copied verbatim and measured from its own header (a `@640` file holding 600px emits `600w`), and generation fills only the uncovered widths; other sizes are hand exports on the probe list (64, 96, 128, …, 3840). Skipped silently: images ≤700px, `@width` files, hidden/symlinked paths, svg/gif/avif, and shelf images (the generator covers page-colocated images only). Without sharp the build behaves as before plus one `npm i -D sharp` hint per build; a corrupt image or a sharp failure on one file is a hint naming the file, never a build failure. Resizes cache in `node_modules/.cache/darkmown-images/` (content hash + width + format), so rebuilds and dev reloads do zero sharp work for unchanged images. Never wired: bound srcs (`![a]({ photo })`), remote/`data:`/query-hash srcs, page-relative or extensionless srcs, and raw-HTML `<img>` tags; the build never invents a `sizes` value, but the author can set one on the Markdown image with `![hero](hero.jpg){sizes="(max-width: 640px) 100vw, 640px"}` (raw `<img srcset sizes>` on an `html: true` page remains the escape hatch). `.md` pages get the width/height/lazy hardening but no srcset. The first image on the page stays eager with `fetchpriority="high"`, the rest lazy-load, and author-set attributes always win.
- Shelf `.json` files publish to `/__wd/data/<name>`; every other shelf file publishes to `/__wd/media/<path>`. Hidden segments (`.`, `-`, `_`) and symlinks are never published, matching the page-asset rule; a symlink that stays inside `site/_/` still works as an `@include`/`@loop` source (it unrolls into pages at build time), it is just never copied to `dist`.

Commands: `darkmown dev`, `darkmown build [--drafts]`, `darkmown validate` (compile-check without writing `dist`), `darkmown serve` (previews `dist`, runs `api/` functions like dev, and compresses text responses), `darkmown deploy <vercel|cloudflare>`, `darkmown catalog [--llms|--llms-full]`, `darkmown mcp` (an MCP server on stdio: catalog, grammar, validate, error codes, docs).

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
noindex: true
icon: /icon.svg
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
- `html: true` allows raw HTML in that file's body. `transitions: true` opts into a view transition (instant swap, no root animation) plus link prerendering.
- `draft: true` keeps the page out of `dist`, `routes.json`, the sitemap, and the feed. `darkmown dev` still serves it; `darkmown build --drafts` includes it.
- `noindex: true` builds the page but removes it from discovery: a robots `noindex,nofollow` meta, and exclusion from `sitemap.xml`, `rss.xml`, and the generated `llms.txt`/`llms-full.txt`. On a collection entry with a `_schema.wd`, declare it as `noindex: boolean?`.
- `icon: /path` sets the favicon verbatim (a `type` is added for `.svg`/`.png`/`.ico`). With no `icon:` key, the first of `site/pages/icon.svg`, `icon.png`, `favicon.ico` wins; with neither, the built-in mark is the fallback.
- `skins: [/base.skin]` (an inline array, same parsing as `tags:`) loads shared `.skin` files for that page only. Paths resolve like `@include` paths; the file must exist, end in `.skin`, and stay inside `site/pages`/`site/_`, or the build fails with `[WD017]`. One scoped skin per page: a shared `scoped` skin scopes to the whole page body.
- `defaults: [name="value"]` (include files only) sets fallback values for `with` arguments; see Includes & sections.
- `date` marks the page a post (RSS item, sitemap `lastmod`, `og:type=article`). `updated` and `excerpt` refine that. `author` feeds an article `schema:`.
- `schema:` emits JSON-LD. One value, or a list. The closed set: `Article`, `BlogPosting`, `TechArticle`, `WebSite`, `Organization`. `organization:` and `logo:` support the `Organization` type. Anything else is a compile error.
- **Home page only:** `site_url: https://example.com` (no trailing slash) turns on `sitemap.xml`, `rss.xml`, and canonical URLs. `ai_crawlers: allow` (default) or `deny` flips every AI-crawler group in `robots.txt`. `rss_limit: 50` sets how many newest posts `rss.xml` carries (default 20). `md_source: true` publishes every page's byte-exact markdown source at `<route>.md` (with a `<link rel="alternate" type="text/markdown">` head tag); a page opts out with `md_source: false`.
- The page's own frontmatter is in scope as `meta`. Anything else you write is a free-form field, queryable when the page is a collection entry.

## Interpolation — one syntax

`{ name }` or `{ name.path }`. Resolves in order: loop item → in-scope value → declared `:state` → otherwise literal text. **Declare state before you bind it** — compilation is line-based, top to bottom, so a `{ x }` or `:if x` must come *after* the `:state x` (or the `:form into x`) that creates it.

The page's frontmatter is in scope as `meta`: `{ meta.title }` prints a field, `{ meta.tags }` joins an array with `, `, and `@loop meta.tags into tag` iterates a frontmatter array (build-time, stays static). Frontmatter arrays are inline only — `tags: [a, b, "x, y"]`; a value without a leading `[` is a plain string.

Values resolve **inside a link or image destination** too, and every brace in the destination resolves, not just one filling the whole value: `[Docs](/docs/{ region }/)`. A build-time value folds and the page stays static; a `:state`/`:store`/`:computed` value, a reactive loop row, or a `{ $index }` becomes a **live binding** the runtime rewrites on every render.

```wd
:state region = "eu"

:button "US" -> region = "us"

[Open the docs](/docs/{ region }/)
```

Values in URL position are percent-encoded, and the runtime refuses a `javascript:`, `data:`, or `vbscript:` result by applying an empty attribute. Values resolve in **raw HTML** too (attributes and html blocks, HTML-escaped, `html: true` only), but raw HTML is a build-time paint, **not** a binding: `<a href="{ url }">` never updates, and the compiler warns. Fenced code and inline code spans are never rewritten.

**Build-time bindings** fold the build's date at compile time, anywhere a binding can appear: `{ $build.year }` (`2026`), `{ $build.date }` (`2026-10-13`), `{ $build.datetime }` (full ISO timestamp). They always fold, so a page using only `$build` bindings stays zero-JS; `© { $build.year }` in a footer include is the standard use. An unknown `$build.*` name stays literal text, and `.md` files are never folded.

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

Pipes also fold inside **raw HTML** on an `html: true` page (attribute values and html blocks): a static value (a collection row, a JSON row, `meta`) formats at build time with full pipe semantics, so a static `@loop` with pipes in raw HTML stays zero-JS. A reactive value there can never fold, so it is painted once (or stays literal) with a build hint; before 2.8 it was emitted as literal text with no diagnostic.

## Directives — the complete set (nothing else exists)

Twenty-five directives. `@include`, `@loop`, `:::`, `:if`, `:state`, `:store`, `:computed`, `:fetch`, `:effect`, `:every`, `:theme`, `:button`, `:form`, `:input`, `:textarea`, `:select`, `:checkbox`, `:radio`, `:submit`, `:bind`, `:slider`, `:video`, `:audio`, `:embed`, `:carousel`. Block forms close with `@endloop`, `:endif`, `:endform`, `@endinclude`, `:endcarousel`, or a bare `:::`. Run `darkmown catalog` for the same list as JSON.

### State, stores, and computed
```wd
:state count = 0
:state draftNote = "" persist
:store cart = []
:store sidebarOpen = false ephemeral
:computed total = count * 4

Count: { count } · Total: { total }
```
- `:state name = value` is page-scoped (and section-scoped inside a `::: section`). **Ephemeral by default**; add `persist` for localStorage, and `from-url` to mirror the value into the query string.
- `:store name = value` is global by name, shared across pages and tabs. **Persisted by default**; add `ephemeral` to opt out.
- `:computed name = <expression>` derives from other state: names, numbers, `+ - * /`, comparisons, and the five aggregates `sum(list, field)` / `avg` / `min` / `max` / `count(list)`. It takes no `persist`/`ephemeral` (that is a compile error).
- Values are JSON: string, number, `true`/`false`/`null`, array, object. An array or object literal may span lines; the `persist`/`ephemeral` token then goes after the closing bracket. A blank line inside the literal ends it.
- A **seed is stored verbatim**. `:state b = a` where `a` is declared state is `[WD251]`, not a reference: derive it with `:computed b = a`, or quote it to keep the literal word. A plain undeclared word is still fine (`:state status = draft`). A seed that looks secret-shaped (a private-key header, a known token prefix with a real body, a JWT, a long mixed-case unbroken token) earns a build hint, never an error: seed `{}` or `""` and fill the value from an `api/` endpoint at runtime.
- `persist` and `ephemeral` on one line, or the same modifier twice, is `[WD261]`. A declaration named `__proto__`, `constructor`, or `prototype` is `[WD250]` on every declaring directive.
- A declaration inside an `:if` branch that starts **closed** is hydrated when the branch opens, `persist` included. The seed is claimed once per key, so re-opening the branch does not reset the value.

```wd
:store rows = [
  {"id": 1, "label": "One"},
  {"id": 2, "label": "Two"}
] persist
```

**`from-url` puts a `:state` in the query string.** The parameter is named after the key (`cart:items` becomes `cart.items`), writes go through `history.replaceState` (no history entry per keystroke), a value equal to its seed drops the parameter, and boot precedence is URL, then storage, then seed. It composes with `persist`.

```wd
:state q = "" from-url persist

:bind q placeholder="Search"

Searching for { q }.
```

`from-url` is `:state` only: on a `:store` or `:theme` it is `[WD260]` (both are shared by every page and tab, a query parameter belongs to one address), and on a `:computed` it is `[WD211]`.

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

**Markdown table rows.** A **static** loop whose body is bare `| … |` cells fills a table: write the header in prose above the loop, or put the whole table inside it. Either way the result is one `<table>` with one `<tr>` per row.

```wd
| Item | Price |
| --- | --- |
@loop /products.json into row
| **{ row.name }** | { row.price } |
@endloop
```

A format pipe inside a cell needs its `|` escaped (`{ row.price \| money }`). A pipe row written **after** `@endloop` stays a paragraph. A **reactive** loop over pipe rows is `[WD191]`: a reactive row is cloned into a `<div>`, which cannot live in a `<table>`, so use a static source, or build rows from containers (`::: trow` / `::: td`).

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

@include /card.wd with title="Pricing"

Children compile in the caller's scope and land at the include's standalone { children } line.

@endinclude

::: section #cart .panel
:state items = []
{ items.length } items
:::
```
- `@include /partial.wd [with key="value" …]` inlines a file from `site/_/` or `site/pages/`. Paths are **static literals**; there is no dynamic include path. Includes are compile-time macros with one slot (below); a missing argument with no default renders `{ title }` literally.
- **`defaults:` frontmatter** (include files only) sets fallback values for `with` arguments: `defaults: [title="Untitled", cta="Learn more"]`. The caller's `with` value always wins; values are strings (`count="3"` is `"3"`, while a caller's `with count=5` stays typed); entries split on top-level commas only, so `cta="Learn more, today"` works. A malformed `defaults:` is `[WD613]`.
- **Block form:** `@include /card.wd with title="Pricing"` … `@endinclude` compiles the enclosed lines once in the CALLER's scope (its `:state`, and the loop item when the call sits inside a `@loop`) and inlines them where the include puts a standalone `{ children }` line. Zero runtime cost. Called without a block, the slot renders empty; a block given to an include with no `{ children }` line warns that the content is dropped. `with` arguments resolve at expansion time, so they cannot read a REACTIVE loop's row (`[WD604]`); read the loop variable directly in the children lines, which compile in caller scope.
- `{ children }` is a standalone line only: mid-paragraph or fenced it stays literal, and on a top-level page it is literal text. A `.md` include cannot host a slot. An include may place `{ children }` more than once; the children still compile once.
- **Pairing:** `@endinclude` closes the nearest preceding unpaired `@include`, so an inline `@include` between opener and closer consumes the pairing (keep inline includes outside a block's span). One level of block nesting is supported; deeper is `[WD616]`, and a stray closer is `[WD614]`. There is NO unclosed-block error: an unpaired opener is simply the inline form, which must stay legal.
- `::: [tag] [.class …] [#id] [.class when …] [role="…"] [aria-…="…"] [title="…"] … :::` groups content. A container named `section`, `nav`, or `main` emits that real element; any other name is a `<div>` with that class. State declared inside a section is scoped to it (`sectionId:name`).
- Container attributes are **exactly three names** (`role=`, any `aria-…=`, `title=`), always double-quoted static text, interleaved freely with `.class`/`#id` tokens: `::: nav .menu role="navigation" aria-label="Main"`. Anything else (`class=`, `id=`, `style=`, `onclick=`, `data-…=`) is `[WD650]`; a missing quoted value is `[WD651]`. No `{ state }` inside an aria value: it emits the literal braces. Zero runtime cost, a static page stays static.
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
`:fetch name from "url"` declares five keys: `name` (the data, `null` until it lands), `name_loading`, `name_error`, `name_error_body`, `name_empty`. On a failing response with a JSON body, `name_error` is the body's own `error` field, then its `message` field, falling back to `HTTP <status>`; `name_error_body` is the whole parsed body (`null` if the response was not JSON), so `{ signup_error_body.fields.email }` renders a field-level message. Both are cleared at the start of the next request, and a round-trip `:form` (one with both `into` and `action=`) declares them too. Options: `method=` (GET/POST/PUT/PATCH/DELETE), `when=load|visible`, `timeout=<ms>`, `retry=<N>`, `headers=<state key>`, `body=<state key>`, `refresh=<url>`. A URL may interpolate `{ state }` and re-runs when it changes; `name refetch` re-runs it by hand.

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
- **File upload:** a `:form` containing a file field (`:input photo type=file`, or a raw `<input type="file">` on an `html: true` page) compiles with `enctype="multipart/form-data"` and posts real `FormData`, so the file travels rather than just its name. Bound controls inside the form are appended by state key. A file field with `method="get"` is `[WD452]` (a GET has no body).

**Outside a `:form`, `:select`/`:radio`/`:checkbox` bind to state.** Same three lines, different meaning: where they sit decides which. Outside a form they bind to a declared `:state`/`:store` of that name, exactly like `:bind`.

```wd
:state density = "Comfortable"
:state previews = true

:select density
- Compact
- Comfortable
- Spacious

:checkbox previews
- Show image previews

:if density == "Compact"
Rows sit tight.
:endif
```

The state must be declared first: a bound field with no matching state is `[WD450]`. A **bound `:checkbox` is a single boolean**, so it takes exactly one `- Label` line; several options is `[WD451]` (use a `:radio` group). In-form behavior is unchanged, array-capturing checkbox groups included.

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
- **Both are page-level registrations.** Inside a reactive `@loop` body they are `[WD315]`: the runtime clones the body per row, so the timer or watcher would be registered once per row and a removed row's would keep firing. Declare it once outside the loop (page level, or inside the `::: section`) and act on the whole list: `:every 5s -> rows refetch`. Still fine: page level, inside a `:::`, inside a **static** loop, and in a reactive loop's `@empty` branch. `:button` inside a reactive loop is unaffected.

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
All three are **compile-time only** and emit no `data-wd-*`, so a media page stays zero-JS. `:video`/`:audio` take whitelisted flags (`controls`, `autoplay`, `loop`, `muted`, `playsinline`) and attributes (`poster`, `width`, `height`, `preload`); `autoplay` implies `muted`. `:embed` rewrites a YouTube/Vimeo URL to its no-cookie/player form inside a lazy, responsive 16/9 box; any other `http(s)` URL becomes a generic lazy iframe. `:embed` also takes `aspect=4:3` (any `<w>:<h>` ratio replaces 16/9), `height=400px` (pins the height and drops the ratio box; units `px`/`rem`/`em`/`vh`/`vw`/`%`, wins over `aspect=`), and `allow="payment clipboard-write"` (REPLACES the default iframe permissions; the whitelist is `payment`, `autoplay`, `encrypted-media`, `fullscreen`, `picture-in-picture`, `clipboard-write`, `camera`, `microphone`, `geolocation`, and `allow=""` strips all). A bad token is `[WD706]`, a bad ratio/length `[WD707]`.

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
| `:select`/`:radio`/`:checkbox` **outside** a `:form` | the same control, bound to `:state` of that name (no `name=` on a `:select`) |
| `[x]({ state })`, `![alt]({ state })` | `<a href>` / `<img src>` the runtime rewrites on every render |
| `:slider v = 50 …` | `<input type="range">` |
| `:submit "Go"` | `<button type="submit">Go</button>` |
| `:form …` | `<form>…</form>` |
| `:video` / `:audio` / `:embed` | `<video>` / `<audio>` / a wrapped lazy `<iframe>` |
| reactive `@loop` of a list | `<ul>`/`<ol>` (or `<div>`) of items |
| `{ name }` | a text node |

So style with real selectors: `section`, `.card`, `button`, `input`, `form`, `h1`. **To add a class to a container, use `::: name .class`; to add one to a single inline element, use a trailing `{.class .class #id}`, as in `[Get started](/start/){.btn}`.** Inline attributes attach to **links, images, and emphasis** only; they do **not** work on inline code (`` `x` ``{.hl} renders the braces as text). On an image the block also takes `sizes="…"` (`![hero](hero.jpg){sizes="(max-width: 640px) 100vw, 640px"}`), passed through HTML-escaped with or without a wired `srcset`. A container class can also be reactive: `::: card .on-sale when p.price < 50` toggles the class from a predicate (same grammar as `:if`).

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

**`@font-face` and `@keyframes` are skin at-rules.** Their indented children are font descriptors and keyframe selectors, not page selectors, so they compile as self-contained blocks. `@font-face` takes plain declarations (`font-family "Newsreader"`, `src url("/fonts/n.woff2") format("woff2")`, `font-weight 200 800`, `font-display swap`). `@keyframes <name>` requires a plain identifier; each indented child is a keyframe selector (`from`, `to`, a percentage, or a comma list) with its own declarations one level deeper, and anything else is a compile error. Aliases and `$token` refs work inside both, both stay **global** in a `scoped` skin (same contract as `tokens`), and both can nest under an `@media` line (the home for `prefers-reduced-motion` animation guards). With `harfbuzzjs` + `wawoff2` installed, project-local font srcs are also subsetted to woff2 at build time (see the fonts recipe below).

**Stylesheet order (changed in 2.8):** include skins compile first, then the page's `skins:` entries in listed order, and the page's own colocated `.skin` LAST, so the page wins ties at equal specificity. Before 2.8 the page's skin came first; delete any specificity hacks that only existed to beat the old order.

**Layout gotcha — CTAs and link rows.** Markdown wraps adjacent links/buttons on consecutive lines into a single `<p>`, so putting `display:flex` on their container won't space them. To lay out a row of buttons or nav links, wrap them in explicit raw HTML and style that (the page needs `html: true` in its frontmatter for the raw `<div>`/`<a>` to render — see the raw-HTML note above):
```wd
<div class="actions">
<a class="btn" href="/signup">Start free</a>
<a class="btn ghost" href="/docs">Docs</a>
</div>
```

**Sibling raw HTML collapses into one `<p>`.** Consecutive lines that each open with an inline-level or unknown tag (`<a class="card">`, `<picture>`, a custom element) parse as ONE paragraph: the elements render inline instead of as layout siblings, which collapses a grid to one column. Lines opening with a block-level tag (`<div>`, `<section>`, …) are hoisted by CommonMark into an HTML block and never hit this. The compiler warns once per run of 2+ such lines when the opening tag carries a `class` or `id` (classless prose links stay quiet), naming the count and the fix: wrap the run in a raw container (`<div class="grid">…</div>`). No warning inside a raw container, fenced code, blank-line-separated lines, or `{ state }`-led lines, and none on `.md` pages; a run inside a `:::` directive container DOES warn, because directive containers are not raw HTML.

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

Every bound control (`:bind`, `:slider`, and the bound `:select`/`:radio`/`:checkbox`) carries a `data-wd-bind-input="<key>"` attribute naming the exact state key it is bound to, section scope included (`data-wd-bind-input="ba1:ba1"`). That attribute is the supported way for escape-hatch code to find a bound input instead of guessing a key.

## Recipes from real rebuilds

Patterns that came out of rebuilding a 67-route marketing site in Darkmown. Each is short on purpose; steal the shape.

### Zero-JS nav menu

A `:state open` + `:button` menu forces the ~6.6 KB runtime onto every page that includes the nav, even pages that are otherwise static. If the page's only state is chrome state, a CSS-only disclosure menu keeps the whole page zero-JS:

```wd
---
title: Home
html: true
---

<nav class="menu">
<details class="menu-drawer">
<summary>Menu</summary>
<a href="/about/">About</a>
<a href="/services/">Services</a>
<a href="/contact/">Contact</a>
</details>
</nav>
```

Style `summary` as the hamburger and `.menu-drawer[open]` as the drawer in the shared skin (a checkbox + `:checked` sibling works the same way). The tradeoff to say out loud: CSS-only menus cost focus and ARIA quality (`aria-expanded` is not managed, there is no Escape-to-close), so once a page is reactive anyway, the `:button` menu is the better menu. The decision rule is which side of the runtime line the page already sits on.

### Fonts done right

Raw TTFs are the most expensive asset a marketing site ships: in the measured rebuild, three variable TTFs cost 1.07 MB on the homepage where the original site served 93 to 158 KB of subset woff2 for the same two families, roughly a 7x difference. Two ways to get there:

1. **Let the build do it:** `npm i -D harfbuzzjs wawoff2` (both optional dependencies) and a post-pass subsets every project-local `.ttf`/`.otf`/`.woff` in an `@font-face src url(...)` to the site's charset (every code point in the emitted HTML, plus a base set of ASCII, Latin-1, punctuation, arrows, and ★ ✓ ✗), emits `<name>-subset.woff2` beside the original, and rewrites the dist CSS to list the subset first. Cached in `node_modules/.cache/darkmown-fonts/`, idempotent under dev rebuilds, and absent the toolchain you get one hint per build and unchanged output. Measured on the rebuild: 1.07 MB of TTFs became 288 KB of woff2.
2. Or do it by hand: convert to **woff2**, subset to the glyphs the site uses, and ship the result yourself.

Either way: serve fonts from the shelf (`site/_/fonts/`, published at `/__wd/media/fonts/`) or colocate them, declare them with `@font-face` in a shared skin, and always set `font-display swap`. Preloading is automatic since 2.12: the build injects one `<link rel="preload" as="font" crossorigin>` per project font into every page whose own stylesheets declare it, leading with the subset woff2 when subsetting ran, so the first paint skips the fallback-font swap and reflow.

### Pre-fill a form message from query params

A booking page that arrives as `/request-appointment?service=whitening` should preselect and pre-fill. `:state from-url` reads the parameter, and a colocated `.js` composes the message, because the action whitelist deliberately cannot build strings:

```wd
:state service = "" from-url
:state message = "" from-url

:bind service placeholder="Service"
:bind message placeholder="How can we help?"
```

```js
// index.js, colocated beside the page
wd.subscribe("service", (service) => {
  if (service && !wd.get("message")) {
    wd.set("message", `I'd like to ask about ${service}.`);
  }
});
```

`wd.set` writes the state and the runtime reflects it into the bound input. If the script needs the element itself, select it with `[data-wd-bind-input="message"]`, which is the supported selector for bound inputs (a section-scoped key appears as its full `sectionId:name`).

## Compile errors: read the code, not just the prose

Every author-facing compile error opens with a stable `WDxxx` code and names the file and line:

```
[WD201] Malformed :state in site/pages/index.wd:1: :state x.
        Use: :state name = value [persist|ephemeral] — e.g. :state count = 0
```

Codes are grouped by subsystem: `WD0xx` source and frontmatter, `WD1xx` loops and collections, `WD2xx` state and expressions, `WD3xx` button/effect/timer actions, `WD4xx` forms, `WD5xx` fetching and URL safety, `WD6xx` includes and page structure, `WD7xx` media, `WD8xx` skins, `WD9xx` project and CLI.

The ones you are most likely to hit while writing new pages: `WD191` (a reactive `@loop` over `|` table rows), `WD250` (a reserved declaration name), `WD251` (`:state b = a` where `a` is state), `WD260` (`from-url` on `:store`/`:theme`), `WD261` (`persist` and `ephemeral` together), `WD315` (`:every`/`:effect` inside a reactive loop), `WD450` (a bound field with no state), `WD451` (a bound `:checkbox` with several options), `WD452` (a file field in a GET form), `WD650`/`WD651` (a non-whitelisted or unquoted attribute), `WD804`-`WD807` (a malformed `@font-face` or `@keyframes` block: a stray name on `@font-face`, a missing or invalid `@keyframes` name, a non-keyframe child, or a keyframe with no declarations), `WD950` (a bad `rss_limit`). Every `Use:` hint that contains `[bracket]` placeholders ends with a concrete `— e.g. <valid line>`: **copy the example, never the placeholder.** `darkmown catalog --llms-full` prints every code with its cause and fix.

**MCP server.** `darkmown mcp` speaks the Model Context Protocol on stdio (protocol 2024-11-05, hand-rolled, zero-dependency; stdout is protocol frames only, logs go to stderr). Five tools: `catalog`, `grammar`, `validate` (compile-check `.wd` source with coded errors), `error` (a WD code's cause, fix, and example), and `doc` (fuzzy section search over the shipped README/AGENTS.md), plus `darkmown://docs/{readme,agents,changelog,errors,cli}` resources. Point a client at it with `npx -y @zvndev/darkmown mcp`.

## Hard rules — do not break these

1. **Never invent directives or syntax.** These do NOT exist: `@section`/`@endsection`, `{% if %}`, `:for`, `@repeat`, `v-if`, JSX, or any directive not in the list above. The only container is `::: … :::`; the only loop is `@loop`; the only interpolation is `{ }`.
2. **Never annotate inside a fence, and never write a bare keyword.** `.wd` has no comment syntax: a trailing `←` note or `#` comment on a directive line breaks the build, or silently corrupts a frontmatter value. A directive line must carry its arguments; a lone `:state`/`:button`/`@loop` is a compile error (only `:::`, `:theme`, `:carousel` are valid bare). To show a directive name as text, escape it: `\:fetch`.
3. **Always ship styling.** A `.skin` (or `<style>`) with a modern type scale, spacing, and a responsive rule — every page. Unstyled = failure.
4. **`.skin` must target emitted HTML** (see the table). Verify selectors match real elements.
5. **Rename = delete.** Upgrading `.md`→`.wd` means removing the `.md`. Never leave both.
6. **Declare before you bind.** `:state` (or `:form into x`) must appear before any `{ x }` / `:if x` that reads it.
7. **Whitelisted grammars only.** Button/`:computed`/predicate vocabularies are fixed forms; arbitrary logic goes in a `.js` escape hatch.
8. **Never write a secret into a page.** `:state`/`:store` seeds are inlined into public HTML. Tokens and keys arrive at runtime from an `api/` endpoint. The compiler backs this rule with a build hint when a seed looks secret-shaped (a hint, never an error).

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
