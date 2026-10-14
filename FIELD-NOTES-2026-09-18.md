# Field Notes — Building a Real App with Darkmown 2.7.0

**Date:** 2026-09-18 · **App:** `../zvn-launchpad` — "ZVN Launchpad", a 11-route project dashboard (home with live search + `:fetch` stats, a `_schema.wd`-typed `work/` collection with 5 real entries, a persistent `:store` stars page, a notes page with `:form`/`:bind`, a plain `.md` about page, custom 404). Built against the local checkout (`file:../darkmown`). Companion to `PRODUCT-REVIEW-2026-09-18.md`.

**Headline:** the first `darkmown build` compiled all 11 routes with zero errors, and every deliberate error probe produced a coded, actionable message. The authoring model holds up under real use. The friction below is real but mostly small.

---

## Findings (ranked by how much they'd bite a real user)

### 1. Global chrome forces the runtime onto every page
I put `:theme` + theme buttons in `site/_/nav.wd`, included on every `.wd` page. Result: `/projects/` — a page whose only content is a build-time collection table — ships the 6.6 KB runtime and `data-wd-*` attributes (`data-wd-theme`, `data-wd-store`, 3× `data-wd-action`) purely because of the nav. The framework did exactly what it promises; the trap is architectural: **any interactive element in shared chrome ends the zero-JS story site-wide**, and there is no layout inheritance, so chrome must be an include.

*Suggestion:* document this tradeoff where `:theme` is introduced (AGENTS.md / README), with a blessed pattern — e.g. a static nav for zero-JS sites, theme toggle only on pages that already pay for the runtime, or a documented "pure-CSS dark mode" note (the `tokens dark` block already handles `prefers-color-scheme` with zero JS — many sites don't need `:theme` at all).

### 2. Hardcoded "D" favicon on every page of every site
`src/compiler/page.js:125-126` bakes a Georgia-serif **"D"** SVG favicon into the `<head>` of every page. My site is called "ZVN Launchpad" and its favicon says **D**. There is no documented frontmatter key to override it. Framework branding leaking into user sites is the kind of thing people screenshot on launch day.

*Suggestion:* derive the letter from the site title, or add a `favicon:` frontmatter key, or emit no favicon when the author provides none.

### 3. `darkmown serve --port 4399` silently ignores the flag
`serve` came up on the default 4173 with no error or warning. Silent flag-swallowing is a small trust leak in a CLI whose error culture is otherwise excellent.

*Suggestion:* honor `--port` or reject unknown flags with a WD9xx.

### 4. Shared design tokens require an undocumented trick
Skins compile `$accent` → `var(--accent)`, resolved at runtime against `:root` (`src/skin.js:196`). So tokens defined in an include's skin (my `nav.skin`) power every page that includes it — no duplication needed. I only discovered this by reading the compiler; every template instead duplicates the full `tokens`/`tokens dark` block into each page skin (and each collection entry skin — my 5 `work/*.skin` files are byte-identical copies).

*Suggestion:* document the "tokens live in your nav include's skin" pattern, or bless a global `site/_/base.skin`. Also worth stating in AGENTS.md's styling section: `.md` pages can't `@include`, so plain pages can't share chrome or tokens this way — they need their own tokens (or the framework could auto-link one nominated global skin).

### 5. `serve` doesn't run `api/` — documented, but the failure is quiet
`/api/stats` 404s under `darkmown serve` (works perfectly under `dev`). `docs/cli.md:99` does say "static only", so this is on me — but a one-line hint at serve startup ("api/ functions only run under dev/deploy targets") or a WD-coded build-time note when a page fetches `/api/*` would save the next person a debugging loop. What saved me: the `:fetch` error branch I wrote rendered the failure in-page exactly as designed.

### 6. `::: nav .nav` emits `class="nav nav"`
My own redundancy (the element already styles as `nav`), but the compiler could dedupe a class token that equals the element name. Trivial polish.

### 7. Fail-fast means one error at a time
A page with two errors (bare `:state`, then unknown pipe `sparkle`) reports them one rebuild at a time. Expected for a fail-fast compiler and the messages are good enough that this didn't hurt — noting it so it's a conscious choice, not an accident. A "N more errors suppressed" line would be a nice touch.

## What was genuinely delightful

- **First build passed clean.** 11 routes, collections + schema + reactive loops + store + fetch + forms + theme, no iterations. The AGENTS.md contract ("read this, don't invent syntax") works — I never guessed once.
- **Error UX is the best I've used in a small framework.** WD201/WD006 with file:line, cause, and a *compilable* example, in both the CLI and the served page. Dev recovered to a green 11-route build 124 ms after I deleted the bad file.
- **The zero-JS / reactive split is verifiable from `dist/`** — `grep -c runtime.js` per page tells the truth: 0 on `.md` pages and collection entries, 1 where state lives.
- **The collection + `_schema.wd` + static table loop** (with the escaped `\|` pipe) worked first try and renders real `<table>` rows at build time.
- **Dev API parity** — `(request) => Response`, my `api/stats.js` read the `work/` folder with `node:fs` and returned live JSON with zero config.
- **The `site_url` hint** at build time is the right nudge at the right moment.

## Install note (not the framework's fault, but watch it)

The scaffolded `package.json` pins `^2.7.0` from npm; pointing it at the local checkout needed a manual edit to `file:../darkmown` (`npm install ../darkmown` failed with a bare npm ENOENT). For contributors dogfooding pre-release code, a documented `file:`/`npm link` recipe in CONTRIBUTING.md would smooth this.

## Verdict

Building with Darkmown feels like the framework is on your side: the vocabulary is closed, the errors teach, and the output is inspectable. The fixes that matter most are the cheap ones — favicon override, the chrome-forces-runtime caveat, and documenting the shared-tokens pattern. Fold these with the review's items (shelf-asset guard, `:try`, `validate` CLI) and the next release's honesty-by-construction story gets stronger.
