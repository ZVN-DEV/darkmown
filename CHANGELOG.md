# Changelog

All notable changes to Darkmown are documented here. Versions follow [semver](https://semver.org); pre-1.0 minor versions may contain breaking changes.

## 1.5.1 (Unreleased)

Fixes from a product review — build-time and dev-server correctness only; the runtime is unchanged (still 7459 B gzipped).

- **Fixed: highlighted pages emitted a mangled stylesheet link.** The `/__wd/highlight.css` `<link>` was wrapped inside a second link tag's `href` attribute on every page with a highlighted code block. Each such page now emits exactly one well-formed tag, still ordered before page skins so `$code-*` overrides cascade.
- **`@loop` over a missing field is an empty list, not an error.** An in-scope loop source that resolves to `undefined`/`null` — like an optional frontmatter field (`tags: string[]?`) a page omits — loops zero rows and renders the `@empty` branch, matching the runtime. Previously `build --drafts` died on a draft post without `tags`. A present-but-non-list value is still a compile error, now with the true `file:line` and a corrective hint.
- **Compile errors report true file line numbers.** Line numbers were computed over the frontmatter-stripped body, so an error after a 3-line frontmatter block pointed three lines short. The frontmatter offset is now threaded through the compile context, so `file:line` matches what an editor's jump-to-line expects.
- **The dev server no longer lies about a failed initial build.** The full compile error prints prominently, the "ready" line states the build failed (with the fix-to-retry flow), and unbuilt HTML routes serve a build-failure page carrying the dev client — the SSE overlay replays the error and the next successful build reloads — instead of the misleading "hidden or has not been created" 404.
- **Dogfood regression tests.** The repo's own site now builds with `--drafts` in tests and CI (the staging path a default build never exercises), and every built page is swept for tag markup inside attribute values (the double-wrapped-link class of bug).

## 1.5.0 — 2026-06-28

Content collections — query a folder of markdown as data, with optional typed validation and pagination. Plus a default-styling pass so buttons and form controls look good out of the box, and two fixes from a product review. The runtime is unchanged (still 7459 B gzipped); collections and styling are entirely build-time.

- **Content collections.** Any `site/pages/<name>/` subdirectory is a queryable collection, referenced by its **bare name** in the existing loop — no new concept, no config file. `@loop blog into post sort by date desc paginate 10` reads the entries under `site/pages/blog/`, each as a row of its frontmatter plus derived `url`, `slug`, and `excerpt`. The whole `where` / `sort` / format-pipe / `:if` machinery works unchanged, and a pure listing stays zero-JS (`runtime: false`). Drafts are excluded by default (and can never leak into a listing); `build --drafts` includes them.
- **Typed schemas (optional).** Drop a `_schema.wd` at a collection's root to validate every entry's frontmatter at build time — one `field: type` per line over a closed vocabulary (`string`, `number`, `boolean`, `date`, `string[]`, trailing `?` = optional). Mismatches fail the build with a `file:line` error naming the entry and field. Absent `_schema.wd` = no validation (opt-in, like everything else).
- **Pagination.** `paginate N` on a collection loop multiplies one listing source into static pages — page 1 stays at `/blog/`, the rest at `/blog/page/2/`, `/blog/page/3/`. A `{ page.current }` / `{ page.total }` / `{ page.prev }` / `{ page.next }` pager is available in the listing scope; every generated page is static HTML in `routes.json` + `sitemap.xml`.
- **Polished default styling.** `:button`/`:submit` compile to a bare classless `<button>`, so their look came entirely from the base skin — which previously left them as flat/unstyled. The base skin and **all five scaffold templates** now ship a token-driven default for buttons (filled-accent with hover/active/focus-visible/disabled states, plus `.secondary`/`.ghost` variants) and form controls (inputs, selects with a custom chevron, textareas, checkbox/radio/range) — consistent in light **and** dark, with `prefers-reduced-motion` honored. A freshly scaffolded site looks good immediately.
- **Fixes (from a product review).** (1) Scoped-style stamping no longer corrupts the contents of raw-text elements (`<script>`/`<style>`/`<textarea>`/`<title>`) — it stamps their opening tags but leaves their bodies byte-intact. (2) Nested static routes (e.g. `/blog/<slug>/`, `/blog/page/2/`) now correctly receive the strict (no `unsafe-eval`) CSP on Vercel; the header drift-guard now validates full route paths so the gap can't recur.

## 1.4.0 — 2026-06-28

Scoped styles — the long-standing "`.skin` selectors are global" gap, closed. Opt-in, compile-time, and **zero runtime** (the shared runtime is still 7459 B gzipped; nothing new ships to the client but one HTML attribute and one attribute selector).

- **`scoped` skins.** Put `scoped` as the first line of a `.skin` file and its selectors apply only to the page or include it ships with — so two components can reuse the same class name (`.card`) without colliding. The compiler appends a per-file `[data-wd-scope="wd-xxxx"]` attribute to each selector's subject and stamps the matching subtree's HTML; the scope id is a stable hash of the skin's path. Selectors compose as you'd expect: descendant selectors scope only the subject, comma lists scope each branch, `@media`/`@supports` wrappers pass through, and `&`-nesting/pseudo-classes resolve before the attribute is attached.
- **Tokens stay global.** A `tokens` / `tokens dark` block in a `scoped` skin still emits global `:root` custom properties, so `var(--…)`, dark mode, `:theme`, and the `$code-*` highlight tokens keep working across the whole site — only your component's selector rules are scoped.
- **`:global(...)` escape hatch** for a whole selector that must stay global (e.g. a class you portal elsewhere). Page-level selectors (`page`, `*`, `html`, `body`, `::selection`) are rejected in a scoped skin with a corrective hint — those belong in a global design-system skin.
- **Fully backward compatible.** A `.skin` without the `scoped` marker is unchanged, byte-for-byte (covered by a golden test). Existing global skins — `base.skin`, `nav.skin`, every scaffolded project — keep styling the whole site exactly as before. Unused scoped selectors produce a build *warning* (never silently removed, since a colocated `.js` behavior may add the class at runtime).

## 1.3.0 — 2026-06-28

The "table-stakes batteries" release — the build-time, zero-JS features a markdown site is expected to ship. The runtime is unchanged (still 7459 B gzipped, well under the 8 KB budget); everything here is compile-time HTML/CSS or build output.

- **Syntax highlighting.** Fenced code blocks with a known language are highlighted at compile time (via `highlight.js` through markdown-it) — HTML plus a small stylesheet, **zero client JS**. Colors are driven by a new `$code-*` skin-token set (`code-bg`, `code-fg`, `code-keyword`, `code-string`, `code-comment`, `code-function`, `code-number`, `code-punctuation`), so code **dark-modes for free** through the existing `tokens dark` / `:theme` system — override any token in your own `.skin`. The stylesheet (`/__wd/highlight.css`) ships **only on pages that contain a highlighted block** (pay-for-what-you-use). Unknown/absent languages degrade to plain escaped `<code>`; inline code and line numbers are intentionally excluded; a prose+code page stays `runtime: false`.
- **RSS + sitemap.xml + robots.txt.** `darkmown build` now emits `sitemap.xml`, `rss.xml`, and `robots.txt` at build time. Site identity lives in **one reserved home-page frontmatter field, `site_url`** (absolute origin) — which reuses the home `title`/`description` as the RSS channel and acts as the trigger; no config file is introduced. The sitemap lists every published route with a `<lastmod>` (frontmatter `date` → git last-commit date → file mtime). Any page with a `date:` becomes an RSS item (newest-first, capped; description from `excerpt:` → `description:` → first paragraph of a `.md`); an `<link rel="alternate" type="application/rss+xml">` is injected into every page `<head>`. With no `site_url`, `robots.txt` still emits (without the `Sitemap:` line) and the feeds are skipped with a build hint — never a crash.
- **Drafts.** `draft: true` frontmatter excludes a page from a production build — gone from `dist`, `routes.json`, the sitemap, and the feed (even if it has a `date:`). `darkmown dev` still builds and serves drafts with a dev-only banner; `darkmown build --drafts` includes them (for staging). Drafts are filtered at route discovery, so a feed can never leak one. This is distinct from the permanent `.`/`-`/`_` filename-prefix hiding: use a prefix to hide a file forever, `draft: true` to hide a page you intend to publish later.
- **New public frontmatter:** `site_url` (home page), `draft`, `date`, `excerpt`. New build flag: `--drafts`. The `blog` starter template now ships working feeds out of the box.

## 1.2.1 — 2026-06-27

Repository hygiene and documentation polish from a gold-standard audit (50/50 — every dimension at React-tier). No runtime, API, or behavior change; the shipped package is byte-identical except for one source comment.

- **Architecture docs name the value layer.** `src/compiler/format.js` (format pipes + list aggregates) is now listed in the compiler module map in both `CLAUDE.md` and `src/compiler/index.js` — previously the only module in the compile path absent from the architecture doc.
- **Honest CI labels.** The coverage-gate job was labeled "src-only line ≥ 90%" but `npm run test:cov` has always enforced **100%** (`scripts/test-coverage-gate.mjs 100`). The job name and its comment now state the real bar.
- **Tighter ignore rules.** `.env` / `.env.*` are now gitignored (the build's hidden-segment asset guard already kept them out of `dist`; this stops one from ever reaching git), and a stale internal design spec that predated the `docs/superpowers/` ignore rule is no longer tracked.

## 1.2.0 — 2026-06-27

Backends, deploy, and rich interactions — all additive. The core runtime is unchanged (still well under the 8 KB budget); the new behavior modules are budgeted separately so static pages stay zero-JS.

- **Serverless `api/` model.** Backend endpoints are plain-JS Web-standard handlers — `export default (request, context) => Response` — in a top-level `api/` directory (`api/echo.js` → `/api/echo`; `api/users/[id].js` → `/api/users/:id`). Darkmown owns no server and adds no backend DSL: it adapts to the host. The build stays 100% static. `darkmown dev` runs a local runner so `/api/*` behaves identically before you deploy; on **Vercel** the functions run natively (Edge); `darkmown build --target cloudflare` emits a `dist/_worker.js` that routes `/api/*` to the same functions and serves the rest from `env.ASSETS`. `form-action 'self'` was added to both CSP variants (and `vercel.json`) so a native `:form action="/api/…"` POST is allowed.
- **Templates + deploy CLI.** `darkmown init --template <starter|blog|store|dashboard|landing>` scaffolds from in-package templates — each a real, deployable site (`store`/`dashboard` ship an example `api/` function). `darkmown deploy <vercel|cloudflare> [--prod]` writes platform config, runs a target-aware build, wraps the platform CLI (`npx vercel` / `npx wrangler pages deploy`), and prints the deploy URL; an unauthenticated CLI surfaces the login to run.
- **Interaction behaviors (pay-for-what-you-use).** `:slider name = v min max step` is compile-time only — a range input bound through `:bind` (range values coerce to Number), shipping **no** JS. `:sortable` (a `@loop` clause) and `:carousel` compile to tiny `/__wd/behaviors/<name>.js` modules injected **only** on the pages that use them, budgeted **separately** from the core runtime in `.size-snapshot.json`. `:sortable` drag-reorders a plain reactive `:state`/`:store` loop via Pointer Events + Arrow keys through the public `window.wd` API; `:carousel` uses native CSS scroll-snap plus prev/next, dots, autoplay, and mouse drag. New `/interactions/` demo page.
- **Review hardening (a11y + backend).** Drag/keyboard feedback and focus now target the author's styled row (not the loop wrapper), so the dragging style and focus ring actually show; keyboard reorder gains screen-reader instructions, `aria-posinset`/`aria-setsize`, and a live "Moved to position N of M" announcement. The carousel drops an incomplete `tablist`/`tab` role for plain buttons with `aria-current`, suppresses autoplay under `prefers-reduced-motion` (and pauses when the tab is hidden). The dev API runner preserves multiple `Set-Cookie` headers (no comma-fold), matching production; `darkmown deploy` recognizes wrangler's real auth-failure wording and strips trailing punctuation from parsed URLs; the build warns on `api/` route collisions and on bare npm imports in Cloudflare advanced-mode handlers (which ship without a bundler).

## 1.1.0 — 2026-06-27

Follow-up to 1.0: turn the two rough edges flagged at release into real fixes. No runtime change (still ~7.4 KB gzipped).

- **Multi-line `:state` / `:store` / `:theme` values.** An array or object seed may now span several lines for readability — open the `[`/`{` on the directive line and let it run until it balances:

  ```wd
  :store rows = [
    {"id": 1, "label": "One"},
    {"id": 2, "label": "Two"}
  ]
  ```

  1.0 made the old silent-corruption case (the literal stored verbatim as the string `"["`) a compile error; 1.1 makes the readable multi-line form actually *work*. The compiler joins the balanced literal (string- and escape-aware bracket counting) into one line before parsing. The literal must balance with no blank line inside it; an unterminated literal stays a clear compile error. Quote genuinely literal bracket text (`:state tag = "[draft]"`). The Ledger demo's seed data is now written this way.
- **Single source of truth for the runtime-size budget (internal).** The gzip budget had drifted into four hardcoded copies (`package.json`, `scripts/size-check.mjs`, `.github/workflows/ci.yml`, `tests/size.test.js`) — a mismatch in `ci.yml` failed the 1.0 PR. The budget now lives only in `.size-snapshot.json` (`runtime.budget`); `scripts/size-check.mjs` reads it and everything else delegates to that script. A `tests/size.test.js` drift guard fails if any config reintroduces a hardcoded budget or an inline size gate.

## 1.0.0 — 2026-06-27

The 1.0 release. The directive surface is now stable, and this version closes the biggest "I'd have to drop to raw HTML/JS for that" gaps an audit found — display formatting, time, an explicit theme toggle, live table sort, media, and a real escape hatch — while holding the zero-JS-by-default promise. Six additions, all either compile-time or sharing the one runtime, which moves from ~5.8 KB to **~7.4 KB gzipped**; the CI budget is raised 6 KB → **8 KB** to match (still un-minified, fully commented). No source-level breaking changes: existing `.wd` pages compile and behave identically.

- **Format pipes — `{ value | name:arg }`.** Shape a value for display with a Liquid/Angular-style pipe, chainable and argument-taking: `{ price | money }`, `{ joinedAt | date:"medium" }`, `{ bio | truncate:80 }`. The whitelist covers `money` / `number` / `percent` / `round`, `date` / `time` / `datetime` (Intl-backed), `upper` / `lower` / `capitalize`, `truncate` / `trim`, `pluralize`, and `default`. Pipes fold at build time on static values (zero-JS) and re-apply on every render for `:state`/`:store` bindings — same syntax. There is deliberately **no relative "time ago"** formatter, so builds stay reproducible. An unknown pipe is a compile error with the valid list.
- **Aggregates — `sum` / `avg` / `min` / `max` / `count`.** Usable both in `:computed` (`:computed total = sum(cart, price)`) and as pipes over a list (`{ cart | count }`, `{ cart | sum:"price" | money }`). The field argument is a bare row key. This is the first time `:computed` can roll up a list — previously a hard gap that forced hand-written JS.
- **Timers — `:every <duration> -> <actions>`.** The one piece of time the framework owns: `:every 10s -> board refetch`, `:every 1s -> secs++`. Durations are `ms`/`s`/`m`; actions are the `:button`/`:effect` vocabulary. Intervals **pause while the tab is hidden** and resume on return, so a backgrounded dashboard stops firing requests.
- **Manual theme toggle — `:theme`.** Declare `:theme` once and drive it with buttons (`:button "Dark" -> theme = "dark"`); it registers a durable `theme` store and reflects onto `<html data-theme>`. A single `tokens dark` block now compiles to **both** `:root[data-theme="dark"]` (the toggle) and the OS `prefers-color-scheme` media query (scoped to `:not([data-theme="light"])`), so one palette powers OS-auto and the manual switch. `"auto"` clears the attribute and follows the OS again.
- **Reactive table sort.** `@loop … sort by { sortKey } { sortDir }` — the sort field *and* direction can each be a `{ state }` reference, so a clickable column header re-sorts the table live with no JavaScript. Drives the new Ledger demo.
- **Media — `:video` / `:audio` / `:embed`.** Three compile-time-only directives (zero `data-wd-*`, so a media page stays zero-JS). `:video`/`:audio` emit a hardened HTML5 player with whitelisted flags/attrs and sane defaults (`preload="metadata"`, `controls`, `autoplay`⇒`muted`); `:embed` rewrites a YouTube/Vimeo URL to its no-cookie/player form in a responsive lazy `16/9` iframe. The shipped CSP now pre-authorizes exactly those two embed origins plus `media-src 'self' https:`, so embeds and remote media work out of the box on the bundled server, Cloudflare `_headers`, and Vercel.
- **A real escape hatch — `wd.subscribe`.** `window.wd` gains `subscribe(key, cb)` (primes immediately, then fires on every settled change, returns an unsubscribe), joining `get`/`set`/`state`/`render`. This is the bridge for colocated `.js` "behaviors" — the gestural layer the framework deliberately omits (keyboard, drag/touch, canvas). The new Swiper demo is a draggable, keyboard-navigable carousel built entirely on it: the framework owns the `slide` state, dots, and readout declaratively; the behavior owns the gestures and transition.
- **Hardening.** A multi-line `:state`/`:store` value (e.g. an array opened on the directive line and continued below) is now a clear compile error instead of silently storing the partial `"["` string — these directives take a single-line value. New demos: **Ledger** (sortable expense table), **Swiper** (escape-hatch carousel), and **Media**. The Folio cart now totals with `sum` + `| money`; Pulse live-refreshes with `:every`.

## 0.20.0 — 2026-06-26

Engineering hardening: a real programmatic API, plus a gold-standard pass on tooling, tests, and internals. No behavior change for existing sites — the runtime is byte-for-byte the same (~5.8 KB gzipped).

- **Programmatic API.** `@zvndev/darkmown` now ships a proper entry point: `import { buildSite, compilePage, compileDocument, parseFrontmatter, escapeHtml, … } from "@zvndev/darkmown"` resolves through an `exports` map and a `src/index.js` barrel that mirrors the public surface already declared in `types/index.d.ts`. The package was CLI-only before; the `darkmown` CLI is unchanged.
- **Compiler internals split.** The ~2,900-line `src/compiler.js` is now a `src/compiler/` folder along its existing seams (page shell, frontmatter, includes, interpolation, predicates, markdown plugin, loops, directives, body). Public exports and output are identical — `src/compiler.js` stays as a thin re-export barrel. Purely internal.
- **Sharper compile errors.** Malformed-directive errors now report `file:line` (matching the unclosed-block errors that already did), and action-literal failures name the offending page. Easier to trace a mistake back to its source.
- **Lint + format with Biome.** Added Biome (one binary, lint + format) with `npm run lint` / `npm run format:check`, a `lint` CI job, and a husky + lint-staged pre-commit that checks staged files. `src/runtime.js` is excluded from the formatter so the byte budget is never moved by a reformat. Style commands are documented in CONTRIBUTING.md.
- **100% line coverage, CI-gated.** The test suite now covers every line of `src/`, and the coverage gate is raised from 90% to 100%. Covering the CLI and dev-server paths surfaced and fixed two real bugs: symlinked-bin entry-point detection and a dev-server response that wrote headers before reading the file.
- **Runtime size trend.** A committed `.size-snapshot.json` baseline lets CI report the gzipped-runtime delta on every change, alongside the existing hard < 6 KB gate.
- **Fixed a production-breaking `vercel.json`.** An invalid `comment` property was rejected by Vercel's strict schema and failed every deploy before install; removed, with a regression test that rejects any non-allowlisted key in a `headers[]` rule.

## 0.19.0 — 2026-06-25

Post-review sprint: deeper reactive loops, hardened deploys, and OS-aware theming.

- **Nested reactive loops (one level).** A reactive `@loop` can now contain an inner reactive `@loop <outerItem>.<field> into x` — the inner source is a dotted path on the outer row, so each reconciled row renders its own keyed inner list and both stay live. Interpolation resolves the inner item first, then the outer (`{ line.qty }` and `{ order.ref }` both in scope). Build-time loop nesting over JSON/frontmatter was already supported; what's new is reactive-inside-reactive. Nesting is **one level only** — an inner reactive loop may not contain a third.
- **Security headers / CSP on deploy.** Builds now emit security response headers so a deployed site is hardened by default: a `dist/_headers` file (Cloudflare Pages format), with the Vercel and local `serve` paths applying the equivalent. Every page carries `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and a `frame-ancestors` directive. The **Content-Security-Policy is tiered**: static pages get a tight policy, and reactive pages (those shipping `/__wd/runtime.js`) add `script-src 'unsafe-eval' 'unsafe-inline'` for the runtime's `new Function` expression compiler. The default CSP allows same-origin connections only — a `:fetch`/`:form action=` to another host must widen `connect-src` by hand. It is defense-in-depth, not a host allowlist; SSRF protection stays the author's responsibility.
- **Dark-mode theming — `tokens dark`.** A `.skin` file can add a `tokens dark` block beside its base `tokens`; the dark tokens compile to `@media (prefers-color-scheme: dark) :root { … }`, overriding the matching base tokens under the visitor's OS dark preference. Rules keep referencing the same `$name` tokens, so dark mode is a zero-JavaScript palette swap. A skin with no `tokens dark` block is unchanged.
- **Runtime test backfill.** Added runtime/compiler tests covering the new reactive-loop nesting and the security-header and theming output.
- **Compile errors carry a line number.** A compile error now includes the offending line number alongside the file path and corrective suggestion, so the source of a directive mistake is easier to find.

## 0.18.0 — 2026-06-24

Navigation goes instant and flash-free, and images are hardened at compile time.

- **Prerendered, gap-free navigation.** `transitions: true` now also emits a declarative `<script type="speculationrules">` that **prerenders** same-origin links on hover/pointerdown (eagerness `moderate`). The next page is fully rendered before the click, so activation is instant — eliminating the white render-gap flash that plain navigation (and even prefetch, which only warms the cache) leaves for the view transition to paper over. It is browser-interpreted JSON, not framework runtime JS, so static pages stay zero-JS; unsupported browsers (or those with preloading disabled) ignore it and navigate normally. Mark a link `{.no-prefetch}` to opt it out; `rel=nofollow` links are never speculated. (Chrome disables prerendering while DevTools is open — verify on the built site with DevTools closed.)
- **Directional view transition.** The root transition is no longer the UA cross-fade, which left both pages superimposed at ~50 % opacity mid-navigation — a visible double-exposure ghost. `transitions: true` now emits a short directional fade+slide (old lifts up and out, new rises up and in, 200 ms eased) so pages move past each other instead of stacking. Honors `prefers-reduced-motion`.
- **Compile-time image hardening.** Every `<img>` is stamped with its intrinsic `width`/`height` (read from the file on disk via `image-size`, a new build-time dependency — no runtime cost), `decoding="async"`, and a load-priority split: the first image stays eager with `fetchpriority="high"` (the LCP candidate), the rest get `loading="lazy"`. This removes the layout-shift "jump" as images decode and stops below-the-fold images competing for bandwidth. Author-set attributes are never overwritten; remote or unreadable sources degrade gracefully (no dimensions, no error).
- All three are compile-time only — the shipped reactive runtime is unchanged (still ~5.8 KB gzipped, under the 6 KB budget). The demo site (`site/pages/`) now opts into `transitions: true` to dogfood the navigation.

## 0.17.0 — 2026-06-23

Multi-select and single-choice form groups: **`:checkbox` and `:radio`**.

- **`:checkbox name` and `:radio name`** (each followed by `- Label` option lines) render a labelled group of `<input>`s that share one `name`, wrapped in `<label>`s inside a `role="group"` / `role="radiogroup"` container with a derived aria-label. They join `:input`/`:textarea`/`:select` as `:form into` field directives.
- **Checkbox groups capture an array.** A `:checkbox` group is marked `data-wd-multi`, and the runtime's submit handler now collects every checked value via `FormData.getAll` instead of collapsing duplicate names to the last one. A `:radio` group captures a single value like `:input`. This is the only runtime change (shipped reactive runtime is 5836 B gzipped, still under the 6 KB budget); everything else is compile-time.
- Live demo on `/data/` (the inquiry form), and the AGENTS.md inline-`{.class}` note is corrected (it had stale "no `{.class}` syntax" copy from before 0.15.0).

## 0.16.0 — 2026-06-23

Cross-document **view transitions** return as a per-page opt-in.

- **`transitions: true` frontmatter** emits the CSS-only `@view-transition { navigation: auto; }` rule, giving a smooth same-origin cross-fade on navigation with zero JavaScript. It only animates between same-origin pages that both opt in, and browsers without support silently skip the fade (no hang, no layout change). Default-off; opt out explicitly with `transitions: false`. Re-enabled after the original cross-document render-blocking regression (stalled rAF / hanging navigation on deployed pages) was verified resolved on modern Chrome. Compile-time only — no change to the shipped runtime size.

## 0.15.0 — 2026-06-23

Form controls and inline styling reach the authoring layer.

- **`:textarea` and `:select` field directives.** Forms gain a multi-line `:textarea name [rows=N]` and a `:select name` (with `- Label` option lines). Both capture into `:form into` state exactly like `:input`, and derive a non-visual accessible name from their placeholder or humanized field name.
- **Inline attributes.** A trailing `{.class .class #id}` (no leading space) attaches classes / an id to the inline element directly before it — link, image, emphasis, or inline code — most often to style a link as a button without a wrapping container. It never collides with `{ name }` interpolation, which always begins with a name.
- **Interpolated link destinations.** `{ name }` now resolves inside markdown link and image destinations, so `@loop` / state values can data-drive an `href` or `src`.

## 0.14.1 — 2026-06-19

Patch-release hardening for page assets, form actions, and release metadata.

- **Security — private page assets stay private.** Page-colocated assets now follow the same hidden-path convention as routes: files or folders under `site/pages/` whose path segment starts with `.`, `-`, or `_` are not copied to `dist`. Symlinked page assets are also skipped, closing the accidental-publication path for `.env`, `_private/*`, `-draft/*`, and symlink-to-outside files. Normal colocated assets such as `site/pages/logo.svg` and `site/pages/blog/cover.png` still emit unchanged.
- **Security — `:form action=` scheme validation.** Native and round-trip forms now validate `action=` with the same compile-time URL scheme guard as `:fetch`: relative URLs, explicit `http(s)://`, and leading `{ state }` interpolation are allowed; protocol-relative URLs and non-http(s) schemes (`javascript:`, `data:`, `file:`, …) are compile errors.
- **Release hygiene.** `package-lock.json` package metadata is synced to the release version, so package review no longer reports stale root version drift.

## 0.14.0 — 2026-06-18

Richer conditionals — `:if` / `:else if` now read the full predicate grammar instead of a bare truthy path only. The reactive runtime is ~5.7 KB gzipped (5762 B), still under the 6 KB CI budget and shipped un-minified.

- **Conditionals — comparison & logical expressions.** A `:if` / `:else if` condition now accepts the same compile-time-validated grammar as `.class when`: a bare path (truthy) **or** the comparisons `==` `!=` `<` `<=` `>` `>=` `contains`, joined with `and`, `or`, and negated with `not`. Operands are loop-item paths, declared `:state`/`:store`, numbers, `"strings"`, or `true`/`false`/`null`. `:if plan == "pro" or seats >= 5` and `:else if trialDays > 0 and not expired` are now valid where only `:if plan` worked before. A bare path keeps the original zero-overhead fast path.
- **Same reactivity rules, same security.** A condition over only static values still folds the branch at build time (`runtime: false` preserved); one over `:state` emits a reactive region (`data-wd-if` + `data-wd-if-expr`); one over a loop item evaluates per row (`data-wd-each-if`). The expression compiles to the same whitelisted form over `I()`/`S()`/`C()` and runs via the shared `evalPredicate` runtime helper — no new eval surface, and `constructor`/`prototype`/`__proto__` path segments stay rejected in compiler and runtime. `:else if` chains inherit this automatically.
- **No grouping (caveat).** There is no parenthesis grouping; `and`/`or` associate left-to-right with no precedence between them. Split into `:else if` branches or a `:computed` boolean when grouping matters. `@loop … where` stays the comparison-only subset of this grammar (no `not`, no bare-truthy form).
- **Fix — nested global conditionals re-evaluate after an outer flip.** When a page-level (non-loop) `:if` flips to its falsy branch, the runtime now recurses into the freshly injected branch and evaluates any nested conditional (the desugared `:else if` tail) in the same pass. Previously the injected nested region kept its build-time branch until the next unrelated render. This also corrects bare-path nested `:else if` chains over page state, not just the new comparison form.

## 0.13.0 — 2026-06-18

Layered capabilities — four reactive features shaped as progressive disclosure: a simple default, with more power one layer down. The reactive runtime grew to ~5.7 KB gzipped; the CI budget moves from 5 KB to **6 KB** (still shipped un-minified, source fully commented).

- **Conditionals — `:else if` chains.** `:if A` / `:else if B` / … / `:else` / `:endif`. Any number of `:else if`; an optional trailing bare `:else` must come last (a later `:else if` is a compile error). Desugars to nested `:if` regions the runtime already drives — identical behavior for static, reactive, and loop-row conditionals, and no runtime change.
- **Styling — reactive classes (`::: … .class when <predicate>`).** A container class can be toggled by a predicate using the same whitelisted grammar as `@loop … where` / `:if` (`item.field`, `:state`, `==`/`!=`/`>`/`<`/`>=`/`<=`/`contains`, `and`/`or`). A fully-static predicate folds at build time; a state predicate becomes a global `data-wd-class` binding; a loop-item predicate reacts per row. Static `.class` tokens are unchanged.
- **Fetch — authenticated requests + token refresh (`:fetch … headers= refresh=`).** `headers=<stateKey>` (already shipped) spreads a state object into request headers; pair with `:store` to persist a bearer token. New `refresh="<url>"`: on an HTTP 401 the runtime POSTs the current headers to the refresh URL, writes the renewed token back to state (persisting if it is a `:store`), and retries the original request once. Concurrent 401s sharing a refresh URL are de-duplicated into a single in-flight refresh.
- **Effects — `:effect <state> -> <actions>`.** Run actions (the full `:button` vocabulary, `;`-chained) whenever a watched state path changes — for side effects beyond `:computed` (derive state) and fetch deps (auto-refetch). Effects run after a render against settled state, with a 10-pass settle cap guarding against effect→effect loops.
- **Assets — page-colocated static files.** Any non-page file under `site/pages/` (images, SVG, fonts — anything but `.md`/`.wd`/`.skin`/`.js`) is copied to `dist/` at its path: `site/pages/logo.svg` → `dist/logo.svg`, `site/pages/blog/cover.png` → `dist/blog/cover.png`. The shelf (`site/_/` → `/__wd/media`, `/__wd/data`) is unchanged; `.avif` joins the served content-types.
- **Security — `:fetch` URL scheme hardening.** `:fetch` (and `refresh=`) URLs are validated at compile time: relative paths, `http(s)://`, and a leading `{ state }` interpolation are allowed; a protocol-relative `//host` or any non-http(s) scheme (`file:`, `data:`, `javascript:`, …) is now a compile error with a corrective hint.

## 0.12.1 — 2026-06-18

Release-hygiene and DX polish (post-0.12.0 smoke audit).

- **Clean compile errors.** `darkmown build` prints a single `✗ <message>` line on a compile error instead of a raw Node.js stack trace (the dev rebuild log inherits the same clean output). The message still carries the file path and corrective hint.
- **Bare `darkmown` prints help.** Running the command with no arguments shows usage instead of silently running a build.
- **Social-share images.** A new `image:` frontmatter key sets `og:image` / `twitter:image` and upgrades the Twitter card to `summary_large_image`. The home page now ships an Open Graph card.
- **`SECURITY.md` ships in the package** so the README's in-package security link resolves for npm consumers.
- **Static assets documented.** README explains that non-page shelf files (`site/_/`) are copied to `/__wd/media/` (and `.json` to `/__wd/data/`).
- **README badges** added (npm version, CI, provenance, license).

## 0.12.0 — 2026-06-18

Security and deploy-hardening sprint.

- **Critical fix — `:computed` expression injection closed.** String literals inside `:computed` expressions are now escaped with `JSON.stringify` (the same path `@loop where` already used), so a crafted literal can no longer break out of the validated whitelist and execute arbitrary JavaScript at build time or in the browser. Added a regression suite that decodes and evaluates the emitted expression, plus a fuzzer invariant that runs compiled expressions inside a trapped sandbox to catch the whole class.
- **Honest coverage gate.** Coverage now measures `src/**` only — test files no longer inflate the denominator — and the gate explicitly discloses that the browser runtime is covered by the Playwright e2e job rather than the line gate.
- **Accessible form inputs by default.** `:input` and `:bind` auto-emit an `aria-label` (from the placeholder, else a humanized field name) when no `aria-label`/`aria-describedby` is supplied. The label is non-visual and never overrides an author-supplied attribute.
- **Static-host deploys hardened.** Builds emit `dist/404.html`; the preview server serves it on a miss and returns correct content-types for images, SVG, and fonts (unknown types default to `application/octet-stream`). `vercel.json`/`wrangler.toml` document clean-URL and 404 behavior.
- **Dev server survives a broken build.** A compile error during `darkmown dev` startup no longer crashes the process — the server stays up and the error appears in the overlay, clearing on the next good build.
- **Trust boundary documented.** README, SECURITY.md, and the docs site now state the trust model plainly: compile only authored content — `html: true` passes raw HTML through, `:fetch` has no URL allowlist, and reactive pages require `script-src 'unsafe-eval'`.

## 0.11.2 — 2026-06-17

Product trust and release-hardening sprint.

- **Public demos fixed.** `/app/` now renders feature bullets from the current data shape, and deploy/form copy clearly distinguishes static hosting from server-backed demo endpoints.
- **Preview servers safer by default.** `darkmown dev` and `darkmown serve` bind to `127.0.0.1` unless `HOST` is set, and malformed preview URLs no longer crash the server.
- **Directive hardening.** Demo `:try` links reject dangerous URL schemes; `:input` and `:bind` now carry escaped accessibility attributes.
- **Release gates tightened.** Tag releases verify Node 20/22/24 before publishing, keep the runtime-size budget enforced, and prepublish checks cover typecheck, coverage, build, size, audit, and consumer smoke.
- **Runtime guidance synced.** Packaged guidance and public copy now describe the measured ~4.7 KB gzipped runtime with the under-5 KB CI budget.

## 0.11.1 — 2026-06-17

Maintenance release. No functional changes since 0.11.0.

- **Fully comment-free shipped runtime.** The last two inline comments in `src/runtime.js` are converted to a strippable form, so the emitted `runtime.js` now contains zero comments (the source stays fully documented). The reactive runtime is ~4.7 KB gzipped.

## 0.11.0 — 2026-06-16

Three big `.wd` capabilities for building real apps — global state, a full fetch lifecycle, and complete loop ergonomics — plus a leaner runtime.

- **Global state — `:store`.** `:store cart = []` is durable by default (localStorage), synced across browser tabs in real time, and global by name; opt out of persistence with `ephemeral`. Button actions gained a full vocabulary — `toggle`, `prepend`, `merge`, `delete`, `clear`, `member-toggle`, `remove`/`remove-value`, and `reset` (back to the declared seed) — all working on `:state` and `:store`, with dotted-path targets (`cart.count++`) and `;`-separated multi-action buttons.
- **Fetch lifecycle.** `:fetch` now exposes `name_loading` and `name_empty` alongside `name_error`, so loading → error → empty → data renders with plain `:if`. URLs interpolate state (`/api/users/{ id }`) and auto-refetch when their inputs change; new `timeout`, `retry`, `method`, `headers`, and `body` options; a `refetch` action; and `@loop` now reads a dotted sub-path of fetched data (`@loop data.items into x`).
- **Loop ergonomics.** `@loop … sort by key [asc|desc] reverse offset N limit N` (offset/limit accept a `:state` key for reactive paging), per-row `$index` / `$number` / `$first` / `$last` / `$count`, and an `@empty` branch for zero rows. Static loops still resolve at build time and ship zero JS.
- **Leaner runtime.** The shipped runtime now strips whole-line `//` comments in addition to JSDoc (still no minification — identifiers, structure, and whitespace are preserved), so the source stays fully commented while the download shrinks. Even with all three features above, the reactive runtime is ~4.7 KB gzipped, comfortably under the 5 KB budget.
- **Security.** The prototype-pollution guard is now a single source of truth shared by the path reader and writer; dotted action targets and dynamic fetch URLs are guarded and URL-encoded.

## 0.10.0 — 2026-06-15

Launch-readiness: every public claim is now backed by runnable evidence instead of stale copy.

- **Provable docs.** README, `docs/cli.md`, `docs/spec-alignment.md`, and the gold-standard audit are re-synced to the shipped code — loop semantics, the build-time vs reactive split, and per-row `:button` actions (`cart += product` carries the row into another list; `cart remove line` drops it) are documented exactly as they compile. A docs-snippet test compiles the README/docs examples so the copy can't drift from the code again.
- **Consumer smoke script.** `npm run smoke` packs the tarball, installs it into a throwaway project, scaffolds, and builds it the way a real consumer would — the same supply-chain check the release workflow runs, now available locally.
- **CLI + scaffold polish.** `darkmown version` prints the installed package version; first-run scaffold output and CLI guidance now match the docs.
- **Editor + packaging scripts.** `npm run test:extension` and `npm run pack:extension` build and tokenize-test the VS Code grammar from the repo root; the extension ships its own `LICENSE` and a corrected README.
- **`homepage` now points at https://darkmown.com.**

## 0.9.0 — 2026-06-15

The "proof + full test pyramid" release: prove the moat on the homepage, test everything from unit to browser e2e, and pass a gold-standard open-source audit.

- **Landing: the vs-Markdoc proof.** The homepage is now a side-by-side comparison — the real `.wd` source for a live search-filter + add-to-cart store rendered working on the page, next to the equivalent Markdoc (which has no native loop and needs a React component + hydration for interactivity). The homepage is now itself a reactive `.wd` app; `/markdown/` and `/docs/` stay static (zero JS) to prove the static path.
- **Full test pyramid.** Unit + integration backfill (grammar whitelists, skin compiler, interpolation, router, every compile-error path), a zero-dependency CLI/pipeline e2e (`darkmown init` → build → serve → fetch → assert), real-browser e2e via Playwright (`npm run test:e2e`), and a seeded property/fuzz suite (5,000 cases/run) for the parser and expression validators. The zero-dep `npm test` suite grew from 98 to ~200 checks; coverage is ~96% lines, gated at 80% in CI.
- **The fuzzer earned its keep:** it found two real bugs, now fixed — two `:button` action errors that omitted the file path, and bare object interpolation (`{ meta }`) emitting `[object Object]` instead of an actionable error. Arrays now join with `, ` consistently.
- **Type safety.** Source stays plain JavaScript but is fully type-checked via JSDoc + `checkJs` (`npm run typecheck`, gated in CI), and ships `.d.ts` declarations. `typescript` is a dev-only dependency; the runtime stays zero-dependency.
- **Lean shipped runtime.** JSDoc is stripped from the runtime on emit, so the browser still stays under the shared runtime budget; the current runtime is ~4.7 KB gzipped even as the source carries full type annotations. The size budget now measures the shipped artifact.
- **Gold-standard hardening (46.5/50 audit).** Release pack-smoke test before publish, `prepublishOnly` guard, `dependabot` (npm + GitHub Actions), CI `concurrency` cancellation, `.github/` PR + issue templates, `CODEOWNERS`, a short `CODE_OF_CONDUCT.md`, an exposed/documented `window.wd.debug`, and repo-root tidy-up.

## 0.8.2 — 2026-06-14

Honesty, hardening, and polish pass — every claim in the docs is now backed by shipped code.

- **Security:** new per-page `html: false` frontmatter opt-out routes that page's Markdown through a strict renderer that escapes raw HTML — the mitigation for compiling untrusted/user-submitted content (default stays `html: true` for trusted authors). README and SECURITY.md now warn prominently that untrusted Markdown must be sanitized. `escapeHtml` also escapes single quotes.
- **Runtime:** state changes now batch into a single render per tick (`requestAnimationFrame`, falling back to a microtask), so rapid `:bind` input no longer re-runs the reconciler on every keystroke; the final state always renders and the public `wd.render()` stays synchronous. Opt-in `window.wd.debug` surfaces warnings for failed `:computed` / `where` expressions that were previously silent.
- **Tests:** first runtime/DOM test suite — keyed loop reconcile (node reuse on add/remove/reorder), `getPath` prototype-pollution rejection, loop-key collisions, and render batching — loading the real runtime via `node:vm`, no new dependencies. Suite grew 83 → 98.
- **Compiler:** unterminated frontmatter now throws an actionable error with the file path instead of silently swallowing the page; empty `---`/`---` blocks parse cleanly.
- **Docs & claims:** view transitions are now correctly described as parked/disabled (they were advertised but hardcoded off); the "no eval" wording is corrected (`:computed` and `where` compile to a whitelisted grammar run via `new Function`, never raw user content); runtime size copy corrected across all surfaces; the current runtime is ~4.7 KB gzipped and CI-enforced under 5 KB; `:note`/`:try`/`:sprint` documented as demo-only; `docs/cli.md` scaffold output synced; VS Code install instructions corrected (build from source; Marketplace listing pending).
- **Site & tooling:** landing-page whitespace fixed (removed the forced `60vh` hero band); mobile nav no longer overflows; tagline locked to "Markdown that runs."; regenerated `package-lock.json` identity (`@zvndev/darkmown`).

## 0.8.1 — 2026-06-14

- Fix: a quoted array item that follows `, ` no longer keeps a leading space — `tags: [a, "b, c"]` parses to `["a", "b, c"]`, not `["a", " b, c"]`.

## 0.8.0 — 2026-06-14

- **Array frontmatter + readable `meta`.** Frontmatter now parses inline flow arrays — `tags: [sales, revenue, "q1, q2"]` becomes a real array (previously the literal string `"[sales, revenue]"`), with quoted items keeping their internal commas and bracket-free values staying plain scalars. Block sequences (`- item` lines) remain out of scope to keep the parser single-pass.
- A page's frontmatter is now in scope in its body as `meta`: `{ meta.title }` prints a field, `{ meta.tags }` renders an array joined with `, `, and `@loop meta.tags into tag` iterates a frontmatter array at build time (stays `runtime: false`, zero-JS).
- A correctness fix in its own right, and the groundwork for reading/emitting bundles in Google Cloud's Open Knowledge Format (markdown + `type`-bearing frontmatter + cross-links). OKF support, if pursued, will be a thin additive export — deliberately not coupled to its v0.1 Draft.

## 0.7.0 — 2026-06-13

- **Per-row actions in reactive loops.** A `:button` inside `@loop … into item` can now act on its own row — the canonical add-to-cart / remove-line / delete-todo pattern, with no hand-written JavaScript:
  - `cart += item` appends a **copy** of the current row to another `:state` list. This is the only way to carry a loop item into another list (literal action values still can't reference rows); the copy means adding the same source row twice yields two independent lines.
  - `<list> remove <item>` removes the current row from the list being looped. `<list>` must be that loop's own `:state` source and `<item>` the loop variable — both validated at compile time.
  The runtime resolves the clicked row by stamping each reconciled node with its item, so removal targets the exact row and stays correct even when the loop is filtered with `where` (index-based removal would not). Closes the last gap blocking a real store demo.
- Live demo: the reactive page's filtering section is now a full mini-shop — search products, add to cart, remove lines — all composing on one page.

## 0.6.0 — 2026-06-13

- **State-driven list filtering — `@loop … where <predicate>`.** Filter any loop with conditions that join via `and` / `or`. Operators: `==` `!=` `<` `<=` `>` `>=` and `contains` (case-insensitive substring). Operands are item paths, declared `:state`, numbers, or `"strings"` — a compile-time whitelist (no expressions, no `eval`; `constructor`/`prototype`/`__proto__` rejected in compiler and runtime). **The predicate decides reactivity:** an item-only predicate filters at build time and the page stays zero-JS; a predicate that reads `:state` compiles to a reactive filtered loop driven by the keyed reconciler (rows are baked in for static JSON sources). This replaces the fragile DOM-toggle escape hatch — the #1 gap surfaced by the agent-eval benchmark.
- **`:bind <state>`** — a two-way `<input>` bound to a `:state` value, the input primitive behind live search. Accepts `type=` (default `text`), `placeholder=`, `autocomplete=`, and the `required` / `autofocus` flags. The field reflects state changes back unless it is focused.
- **`.skin` robustness:** `/* … */` block comments and decorative divider lines (`----`, `* * *`) are skipped instead of mis-parsed as rules.
- Scaffold (`darkmown init`): ships a styled default nav (brand + links, hover states) and an `about.md` companion page so a fresh project looks finished and the nav links resolve.
- Live demo: the reactive page now includes a real "search in pure Markdown" section powered by `@loop … where` + `:bind`.

## 0.5.0 — 2026-06-12

- **Nested `:if` over loop items.** Conditionals inside a reactive `@loop` now nest — an inner `:if` resolves after the outer branch, per row, both at build time (balanced-region pre-render) and at runtime (recursive fill). Previously the compiler threw "not supported yet"; the loop-template fill no longer relies on a non-greedy regex that broke on nesting.
- **VS Code extension** (`editors/vscode`): syntax highlighting, snippets, and folding for `.wd` and `.skin` files. Grammars are tested through the real VS Code tokenizer (vscode-textmate) in CI.
- New `/app/` demo — a whole live app in one `.wd` file: static build-time loop, fetched data looped with nested conditionals, a persistent counter with a computed milestone, and a form that round-trips to a real server. It is the framework's elevator pitch as a single page.
- Site: landing page repositioned around the core wedge ("Markdown that runs" — full reactive websites in plain Markdown). `description`/Open Graph/Twitter meta tags now emit from frontmatter.

## 0.4.0 — 2026-06-11

- **Renamed**: the framework is now **Darkmown** (formerly Markie). Package `@zvndev/darkmown` (npm's typosquat guard reserves bare `darkmown` as too similar to `markdown`), CLI `darkmown`. The `.wd` format and `/__wd/` asset paths are unchanged.
- **License**: MIT. Repository is public.
- Gold-standard launch hardening: CI (Node 20/22/24 matrix, build check, runtime size budget, dependency audit), release automation on tag push, SECURITY.md, CONTRIBUTING.md, CLAUDE.md, this changelog.

## 0.3.0 — 2026-06-11

- `:form action="/url" into reply` — server round-trips against any backend: urlencoded fetch POST with the JSON reply landing in state; degrades to a plain native POST without JS.
- Dev error overlay: failed rebuilds render the compiler error in the browser and clear on the next good build.
- `darkmown serve` — preview the built `dist` locally.
- Dev-only `/__wd/echo` endpoint for round-trip demos.

## 0.2.0 — 2026-06-11

- `:fetch name from "url"` (+ `when=visible` lazy loading via IntersectionObserver).
- `:computed name = expr` — derived state with a compile-time-validated expression grammar.
- `:form into name`, `:input`, `:submit` — forms that write state with zero backend.
- `:state x = v persist` — localStorage-backed state.
- `:if item.path` inside reactive loops (per-row branches).
- `window.wd` escape hatch for colocated `.js`.
- `::: section` containers with scoped state; keyed loop reconciliation.
- View transitions via `transitions: true` frontmatter. **(Disabled since: cross-document `@view-transition` render-blocked deployed pages, hanging navigation. `transitions` is currently hardcoded off in `src/compiler.js`; reintroduction is tracked pending proper activation fallbacks.)**
- Real CommonMark parsing (markdown-it); strict `.md` (directives stay plain text).
- `@loop … into … @endloop` — the one loop, replacing `@repeat` and `:for`.
- Dev server rebuilds in a child process (always-fresh modules).

## 0.1.0 — 2026-06-11

- Initial prototype: folder router, dot/minus hidden pages, `site/_` include shelf, colocated `.skin`/`.js`, `@include`/`@repeat`, `:state`/`:button`/`:if`/`:for`, sub-1 KB runtime, live dev server.
