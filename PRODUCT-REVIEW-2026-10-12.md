# Darkmown: Critical Product Review

**Date:** 2026-10-12
**Subject:** `@zvndev/darkmown` v2.7.0, Markdown-native web framework
**Method:** Five parallel research tracks (codebase, security, competition, engineering quality, UX/DX), evidence-cited, no code modified. Security findings 1-3 were reproduced live in throwaway builds.

---

## 1. What Is It?

Darkmown is a Markdown-native site framework: plain CommonMark `.md` files compile to zero-JS static pages, and renaming a file to `.wd` unlocks 25 directives (state, loops, conditionals, forms, fetch, theming) served by a 6.6 KB gzipped runtime. Pure ESM JavaScript on Node 20+, three runtime dependencies (markdown-it, highlight.js, a types package), published on npm at v2.7.0 with 20 semver tags since June 2026. It is dogfooded: the repo's own `site/` is the production darkmown.com. Maturity: late-stage pre-promotion, engineering-complete, ecosystem-empty by design.

---

## 2. Is It Real?

**Yes. This is functioning, disciplined software, not a demo.**

- It builds and runs. `dist/` contains a current build of the dogfood site with the runtime, sourcemap, behavior modules, and Cloudflare worker.
- Tests: 104 unit test files (32,713 lines) plus 12 Playwright e2e specs, a test/code ratio near 1.8:1. These are real behavioral assertions, not snapshot fluff: `tests/api-runner.test.js` boots live HTTP servers, `tests/fuzz.test.js` is a seeded property suite over thousands of generated documents, and `tests/docs-snippets.test.js` compiles every README example so docs cannot drift.
- Onboarding exists and works: `darkmown init` scaffolds from five real templates (store, blog, dashboard, landing, starter), each with its own README and full styling.
- The dogfood site is complete: landing page, 45-section docs, 6-post blog with schema validation, five full demo apps, an in-browser playground that runs the actual compiler, comparison pages, and working demo API endpoints.

**Not yet built:** the VS Code extension is unpublished to the Marketplace (highlighting and snippets only, no diagnostics); there is no standalone 2.0 migration guide; the docs are two monolithic pages rather than a structured reference. One doc/code mismatch exists: CHANGELOG 2.7.0 describes a `darkmown validate` CLI command that does not exist (the string lives in `src/tools/validate.js:164`, the agent-tools surface).

**Verdict:** real, shippable, and honest about its own edges. The "Limits" section in the README lists deliberate refusals (no SSR, no layouts, no custom pipes) that the code actually honors.

---

## 3. Is It Offering Something Unique?

### What's genuinely differentiated

1. **Reactivity authored in Markdown with zero component framework.** `:state`, `:if`, `@loop … where`, `:form`, `:fetch` are lines in a `.wd` file. Every competitor's answer to "filter this list live" is "write a React/Vue/Svelte component and pay its runtime." Darkmown's answer is three lines of Markdown and a shared 6.6 KB runtime, CI-budgeted under 8 KB.
2. **A compile-validated closed action grammar.** The `:button`/`:effect` vocabulary (`count++`, `list append v`, `refetch`) is whitelisted, checked at build time, and errors carry stable codes with concrete fix examples. Nothing else on the market does compile-time-checked interactivity in prose-like markup.
3. **The AI-authoring toolchain.** GBNF grammar (`grammar/wd-directives.gbnf`), `darkmown catalog --llms-full`, six compiler-derived editing tools exported as `@zvndev/darkmown/tools`, and AGENTS.md copied into every scaffold. Because the grammar is closed and the errors are coded, an LLM can author and repair `.wd` files reliably. No incumbent has productized this.
4. **Per-file zero-JS/JS dichotomy.** `.md` means static, always; a page gains the runtime only by declaring reactive behavior. Astro matches "0 KB static page" but not "add reactivity without adding a framework."

### What's NOT differentiated

- Content collections, RSS/sitemap, JSON-LD, dark mode, syntax highlighting: Astro, Eleventy, and Hugo all do these, several better (Astro's Zod-typed collections beat the five-type `_schema.wd` vocabulary).
- Zero-JS static output: table stakes for every SSG.
- Deploy to Vercel/Cloudflare: universal.
- The closed-loop errors and docs parity: excellent engineering, but invisible to a choosing user.

**Differentiation verdict:** the authoring model itself is the moat, and a direct-clone check found the specific combination (closed declarative grammar in Markdown, keyed reactive patches, sub-7-KB runtime, per-file static/reactive decision) genuinely unoccupied as of October 2026. Markdoc proved the appetite for validated Markdown directives but stopped at validation; Darkmown continued to reactivity.

---

## 4. Who Is This For?

**Target users:**

- **Markdown-first authors and docs/blog owners** who want real interactivity (live search, filter, forms with field-level errors, theme toggle) without adopting React or hiring for it. Frustrated by: MDX pulling a component runtime into a writing workflow.
- **AI-agent-driven site generation.** This is the sharpest fit: the closed grammar, coded errors, GBNF, and catalog tooling make `.wd` the most machine-authorable site format available. A coding agent can write, compile, and repair Darkmown pages with a reliability JSX will never have.
- **Performance-purist content sites** where "static pages ship literally zero bytes of JS" is a requirement, not a preference.

**Adjacent audiences and their unlocks:**

- **Astro/11ty migrants** for small sites: unlocked by a structured docs reference and the VS Code extension on the Marketplace with diagnostics.
- **Design agencies shipping client marketing sites**: unlocked by the store/landing templates maturing and a `create`-style polished init flow.
- **Enterprise docs teams**: not reachable. No i18n, no docs versioning, no search, no plugin ecosystem, no SSR. Say so plainly and do not chase it.

**Market positioning:** the Markdown-native answer to the islands movement, competing with Astro at the small end (content sites with bounded interactivity), not with Next.js at the app end. The niche is real but narrow, and the incumbent (Astro, acquired by Cloudflare in January 2026 and now shipping with a Rust-based Markdown pipeline) could close downward faster than Darkmown grows upward. Speed of adoption is the strategic variable.

---

## 5. Security Audit

No CRITICAL or HIGH findings. Two MEDIUM findings, both reproduced live.

| # | Severity | Finding | Location | Impact |
|---|----------|---------|----------|--------|
| 1 | MEDIUM | Symlinked shelf asset publishes arbitrary files into `dist/` | `src/builder.js:1443-1455` | A PR adding `site/_/logo.png -> ~/.aws/credentials` publishes the target on the next CI build. The `@include` path has exactly this guard (`src/compiler/includes.js:195-199`); the asset path is an oversight. Reproduced. |
| 2 | MEDIUM | Hidden/dotfile shelf assets are published | `src/builder.js:1443-1455`, `656-658` | `site/_/.env.backup` copies verbatim to a publicly served `dist/__wd/media/.env.backup`, violating the framework's own dot/dash/underscore privacy convention. Reproduced with a fake secret. |
| 3 | MEDIUM | `darkmown serve` crashes on a null-byte URL | `src/statics.js:138-160` | One `curl 'http://host:4173/%00'` kills the preview process (`ERR_INVALID_ARG_VALUE` escapes uncaught). One-packet DoS against a documented command; bounded by loopback default. Reproduced. |
| 4 | LOW | Pinned `markdown-it@14.3.0` carries GHSA-253c-mchw-3w2r (moderate) | `package.json:80` | Not exploitable here (linkify stays `false`), and the `audit-level=high` gate passes it silently. `npm audit fix` clears it. |
| 5 | LOW | Generated Cloudflare worker returns `err.message` to clients | `src/builder.js:1140-1142` | Production 500s can leak file paths, SQL text, upstream URLs. Log server-side, return a generic body. |
| 6 | LOW | Dev API runner buffers request bodies unbounded | `src/api-runner.js:113-139` | Dev-only memory exhaustion via one large POST. |
| 7 | LOW | `measureImage` reads author-controlled absolute paths with no containment check | `src/compiler/page.js:335-353` | Weakest form of information disclosure (image dimensions only), but it is the one unguarded file-read in the compiler. |
| 8 | LOW | No compiler warning for secret-shaped `:state`/`:store` seeds | `src/compiler/state.js` | Hard rule #8 ("never write a secret into a page") is prose-only. A high-entropy/JWT-shape heuristic warning would catch the realistic mistake. |

**Done well, verified in code:** raw HTML escaped by default with per-file opt-in; every interpolation path escapes; runtime repaints use `textContent` never `innerHTML` for data; `javascript:`/`data:`/`vbscript:` rejected at compile time, build-time paint, and every runtime repaint with compiler/runtime parity pinned by tests; zero `eval`/`new Function` anywhere (closed AST evaluator), enabling a CSP with no `unsafe-inline` or `unsafe-eval` on `script-src`; prototype pollution guarded at one choke point with `Object.hasOwn` lookups; include sandbox is symlink-aware; forms force multipart for file inputs; fetch handling has generation tokens, abort timeouts, and single-flight token refresh; three runtime dependencies with a lockfile and no high/critical advisories.

**Security verdict:** the posture is strong and defense-in-depth is real, not claimed. The two MEDIUMs only matter in a multi-author or CI threat model; fix them anyway because they are one-liners in code paths that already have the correct pattern next door.

---

## 6. Engineering Quality

### What's great

- **The coverage gate is engineered against self-deception.** `scripts/test-coverage-gate.mjs` enforces 100% src-only line coverage, closes the 0/0 loophole, fails stale allowlist entries, and requires a stated reason per exclusion. The gate's own logic is unit-tested (`tests/gate-coverage.test.js`).
- **The error system is a contract.** 155 `WDxxx` codes in `src/errors.js`, never renumbered, never reused, generated docs with CI drift checks, examples imported from the same constants the compiler hints use. This is among the most systematic error surfaces you will find in any project at any size.
- **CI pays for the hard things on purpose.** Node 20/22/24, Windows and macOS legs (with documented reasoning, e.g. the Node-22 Windows floor), three browser engines with no cache fallbacks, runtime size budget, npm audit, byte-drift check on the committed minified runtime, and a consumer smoke test that installs the packed tarball and builds a scaffolded project.
- **Fuzzing that has found real bugs.** Seeded property suites for the compiler, router, and skin compiler; the spec-alignment log records a CSS-injection defect the skin fuzzer caught on first run.
- **Audit culture.** `docs/spec-alignment.md` is a dated engineering log that names its own past failures (CRLF frontmatter bug, silently stale `.d.ts` build, coverage inflation) and shows them closed structurally.

### What's good

- Clean layering: 23-module compiler, orchestration at top level, behaviors isolated, tools separated. Zero TODO/FIXME/HACK in `src/` or `scripts/`.
- Release engineering: provenance publish, canary channel with a written safety contract, detailed behavior-explicit CHANGELOG, SECURITY.md shipped.
- ~500 pages/sec build throughput on an M5 Max (`scripts/bench-build.mjs`).

### What's bad

- **`src/runtime.js` (1,345 lines), the most correctness-critical file, has no line-coverage measurement.** It is excluded from the gate because Node cannot instrument browser code; the compensating net is Playwright e2e plus a vm-boot byte test. The disclosure is honest, but the reactive core of the framework is the least-measured file in the repo.
- **Complexity concentration.** `src/compiler/loops.js` (1,457 lines) and `src/builder.js` (1,511 lines) are where the line-based grammar's edge cases will concentrate as features accrete.

### What needs work

- Hand-maintained `.d.ts` files have no drift guard, and the spec log already records one silent-staleness incident. Add a declaration drift test.
- The build benchmark is not CI-gated, so performance regressions land silently.
- `@types/markdown-it` is listed as a runtime dependency; it belongs in devDependencies.

**Engineering verdict:** this is a top-decile engineering organization for a project of any size. The weaknesses are disclosed in its own docs before a reviewer finds them.

---

## 7. Competitive Landscape

| Capability | Darkmown | Astro | Eleventy | Hugo | Markdoc/MDX |
|---|---|---|---|---|---|
| Interactivity model | Declarative directives, built-in | Framework islands (React/Vue/Svelte) | None built in | None built in | Custom components (React) |
| JS floor: static page | 0 KB | 0 KB | 0 KB | 0 KB | 0 KB (Markdoc) / React runtime (MDX) |
| JS floor: interactive page | 6.6 KB shared | Island framework runtime (~40 KB+ for React) | BYO | BYO | Full framework runtime |
| Interactivity without a component framework | Yes, only option | No | No | No | No |
| Compile-validated authoring grammar | Yes, 155 coded errors | No | No | No | Validation only (Markdoc) |
| Content collections | Yes, schema-checked (5 types) | Best in class (Zod) | Flexible, untyped | Sections/taxonomies | No (host framework) |
| Component ecosystem | None (macro includes only) | Entire React/Vue/Svelte world | Community plugins | Themes/shortcodes | Full React |
| SSR / dynamic routes | No (build-time only + `api/`) | Yes, hybrid | No | No | Yes (Next.js) |
| Image optimization | No | Yes | Plugin | Yes | Via host |
| Build speed | ~500 pgs/s | Moderate | Fast | Fastest in class | Slow (bundler) |
| AI-authoring tooling (grammar, catalog, edit tools) | Yes, productized | No | No | No | No |
| Backing / staying power | Single vendor (ZVN) | Cloudflare (acquired Jan 2026) | Community, 10+ yrs | Community, 10+ yrs | Stripe (Markdoc) |
| License | MIT | MIT | MIT | Apache 2.0 | MIT |

**Landscape verdict:** Darkmown loses on ecosystem, SSR, images, and institutional weight, and wins the two axes it chose: the lowest interactive floor in the industry and the only compile-validated authoring grammar. The contest is whether "interactivity without a framework" is a category buyers want before Astro's gravity makes the question moot.

---

## 8. What to Fix Now

### Before anyone sees this (security/correctness)

1. **Add symlink and hidden-segment guards to the shelf asset path** (`src/builder.js:1443-1455`, `656-658`). Copy the one-liners `emitPageAssets` already uses (`src/builder.js:1474`). Fixes Findings 1-2.
2. **Guard the `%00` crash in `darkmown serve`** (`src/statics.js:138-160` or the call site in `src/cli.js:307`): catch invalid-arg and answer 404. One-packet DoS on a documented command.
3. **Stop returning `err.message` from the generated Cloudflare worker** (`src/builder.js:1140-1142`).
4. **`npm audit fix`** to clear the markdown-it moderate advisory from the lockfile.

### Before launch/promotion

5. **Publish the VS Code extension to the Marketplace.** It is the single highest-leverage distribution artifact: a curious developer's second minute with the framework should have syntax highlighting without a manual VSIX install. Fix the 0.2.0-vs-2.7.0 version optics at the same time.
6. **Restructure the docs.** One 1,038-line page plus a 1,483-line README is a usability ceiling for a docs-driven product. Per-directive reference pages (the material already exists in `docs/errors.md` and the catalog).
7. **Fix the `darkmown validate` doc/code mismatch** (CHANGELOG 2.7.0 vs `src/cli.js`): either ship the CLI alias to the tools validate or correct the changelog.
8. **Add a declaration drift test for the hand-maintained `.d.ts` files**; move `@types/markdown-it` to devDependencies.
9. **Remove emoji icons from the landing/store templates.** They contradict the project's own authoring guidance ("read as a default-AI tell") in the exact files a new user copies first.
10. **Decide whether the npm tarball should ship the entire dogfood `site/`** (every consumer installs it today via `files` in `package.json`).

### Can wait

11. Add a compiler warning for secret-shaped `:state`/`:store` seeds (heuristic on JWT/base64 shapes).
12. Add a containment check to `measureImage` (`src/compiler/page.js:335-353`).
13. CI-gate the build benchmark; cap dev-runner body buffering; document the 2.0 migration as a standalone page.
14. Language-server diagnostics for the extension (currently build-time errors only).

---

## 9. The Verdict & Path Forward

### What's strong

- **The engineering is the best argument for the product.** A 100%-line-coverage gate designed against its own cheats, a permanent error-code contract, property fuzzing, three-OS three-browser CI, and a changelog that reads like an audit log. This is what "production-grade" actually looks like; almost nothing at this stage has it.
- **The differentiation is real and verified unoccupied.** Nobody else compiles a closed Markdown directive grammar into keyed reactive patches under a sub-7-KB budget with per-page zero-JS defaults.
- **The AI-authoring position is a second moat.** GBNF grammar, llms catalog, compiler-derived edit tools, and agent context copied into every scaffold make this the most machine-authorable web framework in existence, at exactly the moment agent-authored sites are becoming normal.
- **The dogfood site and playground prove the claims.** Five working demo apps, a real blog, and a zero-install browser playground running the actual compiler.

### What's holding it back

- **No component model, by design, and the ceiling shows.** Includes-as-macros (no children, no slots, no defaults) means anything past bounded interactivity requires the `.js` escape hatch or a different framework. The store template works precisely because a cart fits the grammar; a data-grid never will. This is a deliberate trade, but it caps the addressable sites.
- **Authoring DX lags the compiler.** Unpublished editor extension, no diagnostics, monolithic docs. The compiler catches errors brilliantly at build time; the editor should catch them at keystroke time.
- **No SSR, i18n, search, or image pipeline**, so whole categories (enterprise docs, commerce beyond catalog-plus-cart, apps) are correctly out of reach. The README says this; the market will test it.
- **The runtime is the least-measured critical file.** The e2e net is good, but a subtle reactivity regression is the highest-blast-radius bug class this project can ship.

### Strategic advice: **Launch strategy** (published, pre-promotion)

1. **Make the playground the front door.** It is the strongest proof point and already runs the real compiler. Put it at the center of every announcement: "type Markdown, get a reactive page, zero install." Add shareable URLs (state in the fragment) so every demo is a link.
2. **Publish the VS Code extension before any promotion push.** First impressions compound; a developer who installs the framework and gets no editor support in minute two bounces in minute five.
3. **Announce where the pitch lands hardest:** a Show HN titled around the verifiable claim ("Static Markdown pages ship 0 KB; reactive ones ship 6.6 KB, no React"), r/webdev and r/staticsitegenerators, the Astro and 11ty Discords (frame it as the Markdown-native complement, not a kill shot), and one deep blog post: "A compile-validated grammar for interactivity: why we banned eval and what it bought us" (the CSP-with-no-unsafe-inline story is genuinely novel content).
4. **Lean into the agent-authoring angle explicitly.** Publish a benchmark or demo of an LLM authoring and repairing a `.wd` site end-to-end using the GBNF grammar and coded errors. This is the positioning no incumbent can copy without becoming a different product.
5. **Ship the security one-liners and the `validate` fix first** so the codebase a launch-week reviewer reads has no medium-severity seams. The repo's own audit culture is a selling point; keep the record clean.

---

## 10. Rating

**8/10**

Rated as a pre-launch framework against pre-launch frameworks, Darkmown is exceptional on engineering rigor (test depth, coverage gating, error contracts, CI breadth, security defense-in-depth) and genuinely differentiated on authoring model, with the differentiation verified against the market rather than asserted. It is held back from 9 by real product gaps: an unpublished editor extension, monolithic docs, two reproduced medium-severity builder leaks, and an unmeasured browser runtime at the correctness core. None of those are structural, and the structural choices (closed grammar, zero-JS default, no eval) are the strongest things about it.
