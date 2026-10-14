# Darkmown — Critical Product Review

**Date:** 2026-09-18 · **Version reviewed:** 2.7.0 · **Method:** 5 parallel research tracks (codebase, security, competitive, engineering, DX) with direct verification — tests run, claims measured, code read.

---

## 1. What Is It?

Darkmown is a Markdown-native web framework: `.md` files stay plain CommonMark forever, and renaming a file to `.wd` unlocks 25 whitelisted directives (loops, state, conditionals, `:fetch`, `:store`, forms) that compile to static HTML plus a single shared ~6.6 KB gz runtime — only on pages that need it. It's a zero-dependency-lean Node ≥20 ESM package (`@zvndev/darkmown`, 3 runtime deps) with a CLI, dev server, VS Code extension, browser playground, and a dogfooded production site (darkmown.com). Maturity: late pre-launch / early public — published on npm with provenance, but a young project by its own admission.

## 2. Is It Real?

**Yes — unusually, verifiably real.** Every headline claim was checked and held up:

- **Builds and runs:** `npm test` → 1,697 tests, 0 failures, ~7s. Playwright e2e (chromium) → 72 tests pass, behavior-real (clicks sort buttons, asserts DOM, no fixed waits).
- **Coverage gate:** `test:cov` enforces 100% line coverage on `src/` (16,353/16,353), with browser-only files excluded *by name with reasons* and covered by named alternative nets (Playwright, vm-boot of the exact minified bytes). The gate fails if an exclusion goes stale.
- **"~6.6 KB gz, CI-enforced under 8 KB":** measured 6,603 B gzipped against a committed artifact guarded by byte-drift tests in three places (unit, CI `--check`, release).
- **"Zero JS on static pages":** verified — script tags are emitted only when the compiler tracked reactivity (`src/compiler/page.js:144-151`), asserted per-route in tests.
- **Showcase apps:** Folio/Pulse/Forge/Compass/Ledger are genuine, readable `.wd` files (Folio is a working persistent-cart storefront in 168 lines), not mockups.
- **Docs can't rot:** every `wd` fence in README/AGENTS.md/docs is compile-tested; `docs/errors.md` is generated from the error registry.

Not built yet (stated honestly, not hidden): VS Code extension is highlighting-only (no LSP diagnostics), no SSR/multi-framework story, no scale validation beyond a published ~500 pages/s bench.

**Boundary precision:** the only doc-vs-code gaps found are a CHANGELOG bullet claiming a `darkmown validate` CLI command that exists only as a library tool (`src/tools/validate.js:164` — no such command in `src/cli.js`), and one undocumented directive (see §6). Everything else claimed exists and is test-guarded.

## 3. Is It Offering Something Unique?

**What's genuinely differentiated:**
- **Reactive islands with no component model.** State, loops, live filtering, forms, carts, fetch — authored *inside the Markdown file* as directives, compiling to one shared ~6.6 KB runtime. No competitor (Astro, Markdoc, Eleventy, Hugo, MDX, Nue) lets a non-developer author a working search-filter or add-to-cart without writing a framework component and shipping that framework's runtime. Markdoc — the philosophical neighbor — has no loop tag, no state, no client runtime at all.
- **The zero-JS boundary is automatic.** The compiler tracks reactivity; there's no `client:*` directive or export-mode decision to get wrong.
- **`.md` portability is literal.** Files are valid CommonMark you can walk away with — a real anti-lock-in property.
- **AI-authoring as a first-class surface:** agent tools (`src/tools/`) derive from the compiler's own symbol table (no second parser to drift), a generated GBNF grammar for constrained decoding, error codes with compilable examples tuned for edit loops, and AGENTS.md scaffolded into every project.

**What's NOT differentiated:**
- **The rename-gate itself.** Astro's `.md`→`.mdx` and mdsvex's `.md`→`.svx` precede it; inert-directives-in-plain-preview is shared with Markdoc. As a standalone mechanic it's gimmick-adjacent — the value is what sits behind it, not the gate.
- Zero-JS static output, content collections, syntax highlighting, dark mode, scoped styles — table stakes across Astro/Eleventy/Hugo.

**Differentiation verdict:** meaningful but narrow — Darkmown is the only *shipping* framework where a Markdown author gets real reactive islands with zero component authoring; the moat is the closed directive vocabulary, which is also the ceiling.

## 4. Who Is This For?

**Target users:** developers and technical writers building content sites (docs, blogs, marketing, changelogs) who need *a few* interactive islands and resent maintaining React/Svelte components — plus their framework runtime — to get a search box or a cart. Specifically: small teams and solo devs where the maintainer of the docs site is not a frontend engineer; AI-agent-driven authoring workflows (the tooling is explicitly shaped for this).

**Adjacent audiences:** WordPress-migrating marketing sites (would need: import tooling, more templates, deploy guides); internal dashboard builders (the Ledger/Pulse demos point here — would need: auth story, more `:fetch` ergonomics); education (the playground + teaching errors are already the best onboarding in class).

**Market positioning:** sits between Markdoc (syntax-only, no runtime) and Astro (full islands, framework runtimes). The buyer in 2026 is a developer, not a pure content author — so the pitch that lands is "your docs site never needs a component framework," not "non-developers can build apps."

## 5. Security Audit

**Verdict up front: no CRITICAL or HIGH findings.** The codebase is unusually hardened for its class — a prior internal audit (`AUDIT-2026-09-04-REPORT.md`, scored 38.5/50 at 2.6.0) exists and every finding is visibly remediated in 2.7.0 with regression tests.

| Tier | Finding | Location | Impact |
|------|---------|----------|--------|
| MEDIUM | **Shelf assets (`site/_/`) published without the hidden-segment / symlink guards that page assets get** | `src/builder.js:1443-1455` (`emitShelfAssets`) vs guarded `emitPageAssets` at `:1474`; same asymmetry in incremental `copyChangedAsset` (`:656-663`) | A symlink `site/_/x.json → ~/.aws/credentials` or a dotfile under `site/_/` gets copied into `dist/` and publicly served. Real but requires write access to `site/_` (malicious PR / careless layout); not remotely triggerable. Fix is mechanical: reuse `hasHiddenPathSegment` + `lstatSync().isSymbolicLink()` in both shelf paths. |
| LOW | Frontmatter `__proto__` key sets the meta object's prototype (plain assignment) | `src/compiler/frontmatter.js:56-60` | The one surface that missed the reserved-name defense used everywhere else (`state.js:116`, `interpolation.js:61`, runtime `unsafeKey`). Doesn't propagate (downstream copies own-enumerable only). Theoretical hardening gap. |
| LOW | `darkmown init --template` has no containment check on the template name | `src/scaffold.js:39` | `--template ../../foo` copies an arbitrary local directory. Local self-targeted operator input; one-line `startsWith(templatesDir)` assert closes it. |
| LOW / theoretical | Raw-HTML interpolation into `on*=` handler attributes on `html: true` pages becomes live JS | `src/compiler/markdown.js:438-469` (`fillRawHtml`) | Quotes are escaped and URL attrs are scheme-guarded, but event-handler attrs aren't. Inside the documented trusted-author opt-in; worth one sentence in SECURITY.md. |
| Informational | Dev API runner passes full `process.env` to handlers | `src/api-runner.js:186` | Matches Vercel/Cloudflare parity; any `api/*.js` (incl. PR'd) can read tokens on localhost. |

**Verified strong (checked, not assumed):** layered XSS defense (markdown-it `html:false` default, all interpolation through `escapeHtml`, `safeScriptJson` with `<`→`\u003c`, scheme guards on bound `href`/`src` at *both* build and runtime pinned by 32 drift tests); `:fetch` URL scheme validation (`fetch.js:172-196`); include sandbox with lexical + realpath containment and symlink tests; route-output write containment; **no `eval`/`new Function` anywhere** — expressions compile to a closed serialized AST walked by interpreters; prototype-pollution defenses at every layer with dedicated tests; deploy shells nothing (arg arrays, no shell); clean repo (no secrets; the tracked `.secret.wd` is a deliberate canary fixture); strict CSP with hash-authorized speculation rules and a drift-guard test; `npm audit` gates in prepublish and release CI (0 vulns today); npm provenance + tarball smoke test.

**Security verdict:** ship-shape with one required fix — close the `site/_/` asset-publish guard asymmetry (MEDIUM) before encouraging multi-author sites.

## 6. Engineering Quality

**What's great:**
- **Honesty-by-construction.** Every generated artifact has a drift guard: error docs generated from the registry (`scripts/gen-errors.mjs`), types regenerated-and-diffed in tests (`tests/pack.test.js:87`, added after a real 344-line drift incident), runtime bytes checked in three places, README prose sizes pinned to the size snapshot, every doc code fence compile-tested.
- **Error handling is the product.** 154 stable `WDxxx` codes (`src/errors.js`), namespaced by subsystem, contractually never renumbered, each with cause + fix + a compilable example sourced from the same constants the compiler uses. Include cycles print the cycle path (`WD612`); bare directives route to their own teaching errors instead of rendering silently as prose.
- **Tests are real:** 1,697 unit + 72 e2e, seeded fuzz suites, golden-output tests, compiler/runtime parity tests, security tests with real symlinks on a real filesystem. ~1.7:1 test:source ratio.
- **CI/release rigor:** 5-OS/3-Node matrix with comments explaining *why* (cmd.exe glob expansion), e2e sharded per browser engine, tag-only releases, canary `next` dist-tag with a never-touch-`latest` contract, provenance publishing.
- **Type safety is real:** `tsc strict + checkJs` passes clean over all of `src/`; 3,817 lines of generated declarations with parity assertions.
- **Performance:** incremental dev rebuilds via versioned dep-map with full-rebuild fallback on any uncertainty (refuses to serve stale); AST-walking runtime with cache, rAF-coalesced renders, prefix-stable keyed reconciliation; published bench (~500 pages/s, linear to 5k pages).

**What's good:** module boundaries (22 focused compiler modules); comment culture (comments explain *why*, with failure history); the CHANGELOG — 450 lines that explain failure modes, why bugs were silent, and what fixes cost in bytes.

**What's bad:** nothing structural.

**What needs work:**
- `src/builder.js` (1,511 lines) and `src/compiler/loops.js` (1,457) are heavy; split candidates.
- `@types/markdown-it` is a **runtime** dependency (`package.json`) — type-only package shipped to consumers; move to devDependencies.
- No automated duplication check.

**The one real trust ding:** `:try` — a 26th directive (`src/compiler/structure.js:526`) used on the framework's own homepage, but absent from the catalog, the GBNF grammar, the VS Code grammar, and AGENTS.md, which explicitly claims "Twenty-five directives… nothing else exists" and "Never invent directives." A private escape hatch that contradicts the project's cardinal rule. Fix: document it, catalog it, or remove it from the homepage.

## 7. Competitive Landscape

| | **Darkmown 2.7** | **Astro 6** | **Markdoc 0.5** | **Eleventy 3** | **MDX + Next 16** |
|---|---|---|---|---|---|
| Zero-JS static pages | ✔ compiler-tracked per page | ✔ default | n/a (renderer only) | ✔ always | ✘ (React runtime/RSC) |
| Interactive islands | ✔ inline in Markdown | ✔ framework components | ✘ | partial (`<is-land>` add-on) | ✔ whole-component hydration |
| Island runtime cost | one shared 6.6 KB gz | per-island framework runtime (React ~40 KB gz) | none | island's own JS | tens of KB |
| Reactive authoring | directives (`:state`, `@loop`, `:fetch`, `:bind`) | JSX/Svelte/Vue components | `{% if %}` build-time only, no loops/state | template tags, build-time | JSX in `.mdx` |
| Content collections | any folder + `_schema.wd` | typed, schema-validated, any source | ✘ BYO | ✔ data cascade | via Next data layer |
| Component model | ✘ deliberately (includes are macros) | ✔ multi-framework | custom tags → your renderer | partials/shortcodes | ✔ full React |
| Backend story | thin `api/` serverless fns | SSR, server islands, adapters | ✘ | ✘ | ✔ full-stack |
| Maturity | young, 2.7.0 | Cloudflare-acquired Jan 2026, v6 stable | Stripe-maintained (0.5.10 shipped 2026-09-16) | mature v3.1 | industry heavyweight |

(Hugo omitted from the table for space: build-speed king at 10k+ pages, build-time-only shortcodes, no client story — competes for the static end, not the islands end. Nue.js is philosophically adjacent but pre-3.0/beta.)

**Competitors' real advantages over Darkmown:** Astro — ecosystem, SSR, live/headless-CMS collections, battle-tested scale, corporate backing. MDX/Next — arbitrary logic, full app capability. Eleventy/Hugo — maturity, themes, template freedom. Markdoc — embeddable renderer-agnostic schema inside existing apps.

**Darkmown's real advantage:** the only shipping option where interactivity is authored *in Markdown by a non-framework-user* at a fixed ~6.6 KB cost. Also the only one in this table whose docs are machine-verified against its compiler.

## 8. What to Fix Now

**Before anyone sees this:**
1. **Close the shelf-asset guard gap** (MEDIUM security): apply `hasHiddenPathSegment` + symlink skip in `emitShelfAssets` (`src/builder.js:1443`) and the shelf branch of `copyChangedAsset` (`:656`). Mirror the existing `security-include-sandbox` test pattern.
2. **Resolve the `:try` contradiction** — catalog it, document it, or pull it off the homepage. The closed-vocabulary promise is the product's identity; a secret 26th directive on your own landing page undermines it exactly where skeptics will look first.
3. **Fix the `darkmown validate` changelog claim** — either ship the CLI command (the tool exists in `src/tools/validate.js`) or correct the CHANGELOG. A claimed command that doesn't exist is the kind of thing that makes reviewers distrust everything else.

**Before launch/promotion:**
4. VS Code diagnostics: the compiler already emits perfectly structured `err.wd = { code, file, line, hint, example }` — wiring it to an LSP/diagnostic is the highest-leverage DX improvement available, and the hard part is already done.
5. Soften the `html: true` first-run stumble: it's every newcomer's first confusion ("my div rendered as text") and fails silently. Consider a build warning when a page contains raw HTML without the flag, or a `WDxxx`-coded notice.
6. Reserved-name guard in frontmatter (`frontmatter.js:56`) — one-line consistency fix.
7. Move `@types/markdown-it` to devDependencies.
8. A short tutorial-shaped quickstart — the README is a 96 KB manual; the playground helps, but a 10-minute "build a thing" doc would convert better.

**Can wait:**
9. Split `builder.js`/`loops.js`; add a duplication linter.
10. A comment syntax for `.wd` (or at minimum, reject trailing annotations on frontmatter values instead of silently swallowing them).
11. VS Code marketplace publishing (tracked in `PUBLISHING.md`).
12. `init --template` containment assert (`scaffold.js:39`).

## 9. The Verdict & Path Forward

**What's strong:** the engineering discipline is genuinely rare at any team size — 100% coverage with honest exclusions, drift guards on every generated artifact, permanent error codes with compilable examples, a changelog that documents its own measurement bugs. The core idea (directives instead of components, zero-JS by default, one tiny shared runtime) is real, working, and differentiated in the one way that matters for its niche. The security posture is audited, remediated, and regression-tested. The dogfooded site and showcase apps prove the authoring model end-to-end.

**What's holding it back:** narrowness is the strategy, but the edges of the closed vocabulary are where users will bounce — anything past 25 directives drops to a `.js` escape hatch, and that transition story is the weakest documented part. The VS Code extension (highlighting-only) wastes the framework's best asset (structured errors). The `:try`/`validate` discrepancies are small but corrosive precisely because the project's brand is honesty-by-construction. And the `html: true` stumble taxes every new user on day one.

**Strategic advice — Launch strategy (pre-launch, product is ready):**
1. **Fix the three trust items above this week** (shelf guard, `:try`, `validate`). They are hours of work and they protect the one thing competitors can't copy: verifiable honesty.
2. **Ship the "no components" demo as the launch artifact.** A 3-minute video/post: "add a live search + cart to a Markdown file in 40 lines, zero JS framework, 6.6 KB runtime" — Folio already exists; record it. Target: r/webdev, r/astro (as a friendly comparison, not a raid), the Astro and Eleventy Discords' showcase channels, Hacker News with the title framing "Markdown that runs: reactive islands without a component model."
3. **Publish the VS Code extension to the marketplace with diagnostics** before the launch push — the people who try the playground will reach for the editor next, and the delta between "highlighting only" and "the compiler's errors in my editor" is the difference between a toy impression and a tool impression.
4. **Write the comparison page you already have evidence for** — "Darkmown vs Markdoc vs Astro for a docs site that needs three interactive widgets," with byte budgets and the Folio source. Your `vs-markdoc` material shows you know this converts; make it a series.
5. **Lean into AI authoring as the wedge:** the GBNF grammar, symbol-table agent tools, and AGENTS.md scaffolding are ahead of every competitor's story in 2026's actual usage pattern. A short "your coding agent already speaks Darkmown" post (with the compile-tested AGENTS.md as proof) is timely and defensible.

## 10. Rating

**8/10.**

Rated as a pre-launch framework against pre-launch frameworks: the engineering (1,697 green tests, enforced 100% coverage, drift-proof docs, real CI/release rigor) and the security posture (layered escaping, no eval, audited and remediated) are exceptional for the class, and the differentiation — component-free reactive islands in Markdown at a fixed 6.6 KB — is real. It loses points for the MEDIUM shelf-asset guard gap, the `:try`/`validate` trust dings against its own honesty brand, the silent `html: true` newcomer stumble, and an editor experience that doesn't yet exploit its best engineering asset. None of these are structural; all are listed with fixes above. This is near-ready for real users.

---

*Review conducted via the `product-review` skill: 5 parallel research tracks, all headline claims directly verified on 2026-09-18.*
