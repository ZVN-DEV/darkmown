# Darkmown Friction Report: ToothDocs Rebuild

**Date:** 2026-10-13
**Framework version:** 2.7.0 (npm) plus unreleased local changes (runtime coverage gate, `darkmown validate`)
**Project:** darkmown-toothdocs, a 67-route rebuild of the ToothDocs production marketing site (Next.js 16, React 19, Tailwind 4) in Darkmown, at /Users/macbookpro-kirby/Desktop/Coding/ZVN/darkmown-toothdocs
**Build method:** 8 sequential build agents, one goal-driven commit per slice, extraction brief from the source repo's `capa.blueprint.json` (318 CMS records) and `src/content/*.ts`.

Purpose: a factual list of every place the framework slowed us down, forced a workaround, or could not express something the source site does. Each item names what we tried, what actually happened, where the evidence lives, and a concrete fix proposal. This is the input for the next Darkmown version.

Context for scale: the rebuild took roughly 3 hours of agent time. Most of the site was easy. Everything below is the exception list, not the norm.

---

## What worked without friction (for calibration)

- `:video`, `:carousel`, `:slider`, `<details>` accordions, and a pure-CSS marquee replaced embla, motion.dev, and custom sliders with zero or near-zero JS.
- Content collections did their job: 21 service pages, 10 doctor profiles, and a typed blog (`_schema.wd`) are folders of Markdown generated from the CMS blueprint. The services hub, doctor grids, and blog index are `@loop` queries.
- `:state ... from-url` powered the booking deep links (`/request-appointment?office=roslyn` preselects the office and pre-fills intent) with clean URLs and `replaceState` semantics.
- `:form action="/api/lead" into reply` gave us fetch-when-JS plus native-POST fallback with field-level error rendering, matching the source's form behavior.
- The whitelisted grammar meant every generated page compiled or produced a coded error with a fix hint. Generator scripts never produced silently-broken pages.

---

## P1 friction (every real project will hit these)

### F1. `.skin` cannot emit `@font-face` or `@keyframes`

- **What we tried:** the design system needed three `@font-face` rules (Newsreader roman/italic, Hanken Grotesk, variable TTFs) and the reviews marquee needed `@keyframes tdMarquee`.
- **What happened:** the `.skin` compiler has no at-rule support beyond `@media`/`@supports`, so both went into `<style>` blocks (in `site/_/nav.wd` and `site/pages/index.wd`). That then triggered F2.
- **Workaround shipped:** plain CSS assets (`site/_/fonts.css` published at `/__wd/media/fonts.css`, `site/pages/home/marquee.css` at `/home/marquee.css`) referenced with `<link rel="stylesheet">`.
- **Proposal:** teach the skin compiler to pass through `@font-face` and `@keyframes` blocks (it already handles `@media`; the indentation model fits). This keeps the design system in one file, which is the `.skin` pitch.

### F2. The directive scanner warns on at-rules inside raw `<style>` blocks

- **What happened:** with `@font-face` and `@keyframes` inside `<style>` blocks, every page that included the nav emitted a compiler warning ("@font-face looks like a directive but matches none"). 67 pages produced 199 identical warnings. `darkmown build` printed them as hints on every run.
- **Evidence:** pre-fix `darkmown validate` output; the cleanup commit `0ee3ea9` in darkmown-toothdocs.
- **Proposal:** suppress directive-lookalike scanning inside `<style>` and `<script>` raw HTML blocks. Warning noise at this scale trains users to ignore all warnings, which defeats the coded-error system.

### F3. Format pipes do not fold inside raw-HTML loop bodies

- **What we tried:** blog cards inside a static `@loop blog into post` used `{ post.date | date:"medium" }` inside a raw HTML `<div>` (needed for card markup).
- **What happened:** the pipe text rendered literally into the built HTML. Interpolation of plain `{ post.date }` works in raw HTML; the pipe form does not fold there in 2.7.0.
- **Workaround shipped:** every blog post carries a preformatted `pretty:` frontmatter field (`Dec 8, 2025`) that the cards interpolate instead. Duplicative and easy to forget when adding a post.
- **Proposal:** fold static pipes in raw-HTML loop bodies at build time, the same fold that already applies in prose. If that is genuinely hard, the compiler should error (not silently render braces) so the trap is loud.

### F6. Page skins cannot be shared across pages

- **What happened:** skins attach by basename, so interior patterns (page hero, breadcrumbs, CTA band, form layout, step cards) are duplicated verbatim across page skins. `site/pages/new-patient/index.skin` and `site/pages/virtual-consult/index.skin` are near-identical files; the services hub skin carries its own copy of `.page-hero`/`.crumbs`/`.tcard` with a comment admitting the duplication. We routed around it where possible by moving shared layout into include-colocated skins (`site/_/service-hero.skin`, `site/_/doctor-hero.skin`, `site/_/legal-hero.skin`), but that only works when the page's markup can live inside the include.
- **Proposal:** one of: (a) allow a page to list extra skins in frontmatter (`skins: [/interior.skin]`), (b) allow `@include /interior.skin` of a bare skin file, or (c) a `site/_/skins/` convention whose contents are opt-in shared. Any of the three deletes most duplicated CSS in real sites.

### F7. A menu toggle in shared chrome makes every page ship the runtime

- **What happened:** the mobile menu is `:state menuOpen` in `site/_/nav.wd`, which every page includes. Result: all 67 pages, including purely static legal and blog pages, ship the 6.6 KB runtime. The zero-JS-per-page story, the framework's headline feature, breaks at the shell level on any site with an interactive nav.
- **Workaround:** none shipped (accepted the runtime; it matches the source site's JS menu). A CSS-only `<details>`/checkbox menu would restore zero-JS but costs focus/ARIA quality.
- **Proposal:** document the CSS-only menu pattern as the recommended zero-JS chrome pattern, or ship a built-in zero-JS disclosure primitive designed for nav menus. Also consider: if a page's only state is chrome state, that is still worth the runtime, but users should be able to see and choose this tradeoff. `darkmown validate` already reports static vs reactive per page; surfacing "reactive because of include X" would make the cost legible.

### F11. Adjacent raw-HTML sibling lines collapse into one `<p>`

- **What happened (real bug, found in QA):** 16 insurance carrier cards written as consecutive raw-HTML lines were wrapped into a single Markdown paragraph, collapsing the grid to one column. Fixed by wrapping the list in an explicit raw `<div class="grid ...">` block. This is documented behavior (Markdown paragraph wrapping), and the AGENTS.md CTA gotcha covers it, but it is the single most likely trap for anyone porting a component-based site, where sibling components on consecutive lines are the norm.
- **Proposal:** a compiler warning when two or more consecutive raw-HTML block-level lines are about to be paragraph-wrapped ("N sibling elements will render inline in one <p>; wrap them in a container"). It is detectable at compile time and would have caught our bug before the browser did.

---

## P2 friction (real, but situational)

### F4. `:embed` is too rigid for real third-party embeds

- **What we tried:** the booking flow embeds NexHealth scheduler iframes (`app.nexhealth.com/appts/toothdocs?lid=...`) that need `allow="payment"` and a 56rem-tall frame.
- **What happened:** `:embed` hardcodes a 16:9 responsive box and a fixed `allow` list, so it cannot express this. Raw `<iframe>` used instead (fine because the page is `html: true`, but the directive exists precisely to make this safe and easy).
- **Proposal:** optional attributes on `:embed`: `height=`, `aspect=`, `allow=`. Whitelist-validate `allow` tokens. Until then the directive covers YouTube/Vimeo well and real product embeds poorly.

### F5. The favicon link is hardcoded by the page template

- **What happened:** the framework emits a fixed data-URI favicon `<link>` on every page. We copied the client's `icon.svg`, `icon-192.png`, `icon-512.png` into `site/pages/` where they serve correctly, but no page references them.
- **Proposal:** frontmatter key (`icon: /icon.svg`) or a convention: if `site/pages/icon.svg` (or `.png`/`ico`) exists, link it. Sites that care enough to ship icons should not need a dist postprocess.

### F8. No `noindex` frontmatter

- **What happened:** the source marks `/booking-confirmed` noindex/nofollow and keeps it out of the sitemap. Darkmown has no way to express either, so the demo ships it as a normal page.
- **Proposal:** `noindex: true` frontmatter emitting `<meta name="robots" content="noindex,nofollow">` and excluding the route from sitemap.xml and RSS. One line for users, standard SEO hygiene for confirmation/thank-you pages.

### F14. `darkmown serve` does not run `api/` functions

- **What happened:** our demo's forms work under `darkmown dev` but fail under `darkmown serve` (the documented "preview the built dist" path). During demo QA this produced a confusing "the form is broken" moment until we remembered the split.
- **Proposal:** `serve` should run the same local api-runner as `dev`. The preview command is what users point stakeholders at; it should behave like production, where the api functions exist.

---

## P3 friction (polish)

### F9. No build-time dynamic values in static content

- The footer year is hardcoded "2026" because there is no way to interpolate a build-time value like the current year into static prose. Proposal: a small set of build-time bindings (`{ $build.year }`, `{ $build.date }`) that fold at compile time.

### F10. Section-scoped state keys are awkward from the `.js` escape hatch

- The smile-gallery before/after wipes use `:slider` inside `::: .ba #baN` containers, so state keys became section-scoped (`baN:baN`). The colocated `.js` had to discover real keys by reading each input's `data-wd-bind-input` attribute at runtime. It works, and the docs do state the `sectionId:name` keying, but the discovery mechanism is folklore. Proposal: document `data-wd-bind-input` as the supported discovery path in the escape-hatch section, or have `wd.get`/`wd.subscribe` fall back to a unique section-scoped match.

### F12. Include skins load after page skins

- Emitted CSS orders page skins before include skins, so a page-level override of a design-system rule needs equal or higher specificity than `site/_/nav.skin`. Counterintuitive: the page is the most specific context and should win the cascade. Proposal: emit include skins first, page skins last. (Flag as a breaking change for anyone relying on current order; worth a minor version note.)

### F13. String composition from URL params needs the `.js` hatch (by design, needs a documented pattern)

- The source's `appointment-intents` module composes a pre-filled booking message from `?service=`/`?topic=`/`?office=` ("I'd like to start a smile makeover..."). The whitelisted action grammar cannot compose strings, correctly. We ported it to a colocated `index.js` with `wd.subscribe`. This is the escape hatch working as intended, but "pre-fill a form message from query params" is a top-five real-world pattern for marketing sites. Proposal: a worked recipe in the docs (from-url state + colocated js + `wd.subscribe`), so the next rebuild does not re-derive it.

---

## Things attributed correctly (NOT framework gaps)

Kept here so the wrong things do not end up on the framework roadmap:

- **Missing per-office provider lists and doctor quote cards:** the blueprint has no doctor→services mapping and no quote field. The live site skips these sections for the same reason. Data gap.
- **`/ai-disclaimer/` page:** its body exists only in the client's live CMS, nowhere in the source repo. Content gap.
- **Homepage insurance image:** the original loads from `cdn.capacms.com` with no local asset; we substituted a treatment-room photo from the library. Asset gap.
- **Retired doctors (Chou, Vaeth, Hariri):** flagged retired in newer `src/content/doctors.ts`, present in the CMS roster. We shipped the CMS roster; the client should decide. Data conflict.
- **NexHealth scheduling, Google Maps:** third-party iframes on both versions of the site. Nothing to rebuild.

## Dropped scope (framework could matter, not requested above)

- The motion.dev scroll-reveal animations were dropped by choice (hover/transitions carry the motion). If Darkmown ever wants a declarative reveal-on-scroll, a `reveal` container flag compiling to an IntersectionObserver one-liner would fit the philosophy. Nice-to-have, not friction we hit.
- The booking slot picker (day chips + 30-minute slots generated from office hours) was simplified to a "Preferred time" select. Rebuilding it faithfully is application logic, correctly out of framework scope.

---

## Proposed roadmap, in priority order

1. F2: stop directive-lookalike warnings inside `<style>`/`<script>` blocks (kills warning noise).
2. F1: `@font-face`/`@keyframes` support in `.skin` (design systems stay in one file).
3. F3: fold (or loudly reject) format pipes in raw-HTML loop bodies.
4. F6: shared page skins (any of the three mechanisms).
5. F11: compile-time warning for paragraph-wrapped sibling HTML blocks.
6. F14: run `api/` functions under `darkmown serve`.
7. F5: favicon frontmatter/convention. F8: `noindex` frontmatter. F4: `:embed` attributes.
8. F7: zero-JS nav pattern (docs or primitive). F9/F10/F12/F13 as docs and polish.

Items 1-6 are all small, compiler-local changes with clear acceptance tests, and they cover every workaround this rebuild shipped.

---

## Addendum: measured gaps from the performance comparison

Same-day browser measurement of the live Next.js site vs this rebuild (median of 3 loads, 4 matched routes; full data at /tmp/td-brief/perf-compare-2026-10-13.md). Darkmown won the categories it designed for and lost two it has not designed for yet:

- **JS payload: Darkmown wins by 28x.** 22 KB compressed across 1-2 files (the 6.6 KB gz runtime plus a behavior module) vs 226 KB compressed across 16 Next chunks, and the live site ships the identical 16 chunks on every page. Requests: 11-20 vs 46-70. Homepage HTML: 10.6 KB gz vs 24.9 KB br.
- **Font delivery: Darkmown loses by ~7x, and it is a framework-level gap.** The rebuild ships 3 raw variable TTFs (1.07 MB on the homepage, 578 KB on subpages) because `.skin`/the build has no font pipeline: no woff2 conversion, no subsetting, no `preload` hints. The live site's next/font serves 93-158 KB of subset woff2 for the same two families. Proposal: at minimum document the "convert to woff2 + subset + preload" recipe; better, a build step that subsets declared fonts to the used glyph set (the compiler knows every glyph on the page at build time, which no bundler has).
- **Images: Darkmown loses on any page with many photos, also framework-level.** The doctors page ships 1,045 KB of raw headshots vs 147 KB via the CDN's width variants. This is the known "no image pipeline" gap, now measured. Even a modest `srcset` emitter for colocated images (2-3 widths, lazy loading by default below the fold) would close most of it.
- **`darkmown serve` sends no compression.** Local totals are inflated because HTML goes over the wire uncompressed (57.4 KB vs its 10.6 KB gzipped form). A dev-server property, not the build output, but it makes local "how heavy is my site" checks misleading. Proposal: gzip/brotli on `serve` for text assets, or a printed note that preview is uncompressed.

## Follow-up found while adopting 2.8.0 (not yet scheduled)

- **The shipped CSP `frame-src` is a build-time constant that only pre-authorizes YouTube/Vimeo**, so a real product embed (the NexHealth scheduler, via raw iframe or the new `:embed`) is CSP-blocked whenever the framework's headers are served (preview, `_headers`, vercel.json). The compiler knows every `:embed` host at build time; the per-route CSP should union them into `frame-src` the same way per-route `script-src` already varies. Until then, any site with a non-video embed must weaken or bypass the shipped headers, which is the wrong default for the framework's security story.
